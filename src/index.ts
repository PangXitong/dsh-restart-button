/**
 * dsh-restart-button — Host half (runs in the DSH main process, Node).
 *
 * Registers two same-origin HTTP routes that the browser-side button calls:
 *   POST /dsh-restart-button/close    → exit the DSH process
 *   POST /dsh-restart-button/restart  → spawn an independent re-launch, then exit
 *
 * Restart strategy (Windows)
 * --------------------------
 * A plain `spawn(..., { detached: true })` from the DSH process is NOT
 * reliable: the helper is still created as a child of DSH, so it dies with
 * the parent (and stays inside whatever job object the launcher set up).
 *
 * Instead we hand the re-launch to the WMI service:
 *
 *   1. Write a small PowerShell helper script to %TEMP% that sleeps a few
 *      seconds and then starts `node <dsh bin> <args>`.
 *   2. Ask WMI (Win32_Process.Create) to create a hidden PowerShell that runs
 *      the helper.  The WMI provider is the parent, so the new process is
 *      completely outside DSH's process tree and survives DSH exiting.
 *   3. Exit DSH.  The helper wakes up after the delay and re-binds the port.
 *
 * The WMI creation runs synchronously so we know the helper exists before
 * DSH goes away.  If it fails for any reason we fall back to the detached
 * spawn (better than nothing).
 *
 * POSIX keeps the simple `sh -c 'sleep N; exec ...'` approach — there the
 * `detached` flag calls setsid(2), which genuinely reparents the child.
 */
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

const PLUGIN_ID = 'dsh-restart-button';

const isWindows = platform() === 'win32';

/** Seconds the helper waits before re-launching, so the port is released. */
const RESTART_DELAY_SECONDS = 3;

/** Best-effort diagnostic log; never throws. */
const LOG_PATH = join(tmpdir(), PLUGIN_ID + '.log');

function log(message: string): void {
  try {
    appendFileSync(LOG_PATH, '[' + new Date().toISOString() + '] ' + message + '\n');
  } catch {
    // logging must never break the plugin
  }
}

/** Escape a value for a single-quoted PowerShell string (' -> ''). */
function quotePs(value: string): string {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/** Escape a value for a single-quoted POSIX sh string (' -> '\''). */
function quotePosix(value: string): string {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

/** The exact command line that started this process, re-runnable as-is. */
function launchParts(): { execPath: string; args: string[] } {
  return { execPath: process.execPath, args: process.argv.slice(1) };
}

/**
 * Lines that copy this process's environment into the helper.
 *
 * A WMI-created process inherits the WMI provider's environment, not DSH's,
 * so anything DSH was launched with (PATH, proxy settings, tokens, ...) would
 * otherwise be lost on the way back up.
 */
function envSetupLines(): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Only names PowerShell can address as Env:<name>.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    lines.push('Set-Item -LiteralPath ' + quotePs('Env:' + key) + ' -Value ' + quotePs(value));
  }
  return lines;
}

/**
 * Write a PowerShell helper that waits, then re-runs the launch command.
 * Returns the helper's absolute path.
 */
function writeWindowsHelper(): string {
  const { execPath, args } = launchParts();
  const invocation = '& ' + quotePs(execPath) + args.map((a) => ' ' + quotePs(a)).join('');
  const lines = [
    '$ErrorActionPreference = "Continue"',
    '$log = ' + quotePs(LOG_PATH),
    'Add-Content -LiteralPath $log -Value ("[" + (Get-Date).ToString("o") + "] helper started, waiting ' +
      RESTART_DELAY_SECONDS +
      's")',
    'Start-Sleep -Seconds ' + RESTART_DELAY_SECONDS,
    'Set-Location -LiteralPath ' + quotePs(process.cwd()),
    ...envSetupLines(),
    'Add-Content -LiteralPath $log -Value ("[" + (Get-Date).ToString("o") + "] helper launching dsh")',
    // The helper stays alive as the parent of the server, so its hidden
    // console is inherited and no window flashes.
    invocation,
    'Add-Content -LiteralPath $log -Value ("[" + (Get-Date).ToString("o") + "] dsh exited with code " + $LASTEXITCODE)',
  ];
  const helperPath = join(tmpdir(), PLUGIN_ID + '-relaunch.ps1');
  writeFileSync(helperPath, lines.join('\r\n') + '\r\n', 'utf8');
  return helperPath;
}

/**
 * Ask the WMI service to create the helper process.  Because WmiPrvSE is the
 * parent, the helper is not part of DSH's process tree and survives DSH
 * exiting.  Calls back once the helper exists (or once we gave up).
 */
function relaunchWindows(done: () => void): void {
  let helperPath: string;
  try {
    helperPath = writeWindowsHelper();
  } catch (err) {
    log('could not write helper script, falling back: ' + String(err));
    relaunchViaSpawnWindows();
    done();
    return;
  }

  const commandLine =
    'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
    helperPath +
    '"';
  const psCommand =
    'Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ' +
    quotePs(commandLine) +
    ' } | Select-Object -ExpandProperty ProcessId';

  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psCommand],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 },
    (err, stdout) => {
      const pid = String(stdout || '').trim();
      if (err || !pid) {
        log('WMI relaunch failed, falling back: ' + String(err || 'no process id'));
        try {
          relaunchViaSpawnWindows();
        } catch (fallbackErr) {
          log('fallback relaunch also failed: ' + String(fallbackErr));
        }
      } else {
        log('relaunch via WMI succeeded: helper pid ' + pid + ' (' + helperPath + ')');
      }
      done();
    },
  );
}

/** Last-resort Windows path: a detached spawn (works on many setups). */
function relaunchViaSpawnWindows(): void {
  const { execPath, args } = launchParts();
  const cmd =
    'Start-Sleep -Seconds ' +
    RESTART_DELAY_SECONDS +
    '; & ' +
    quotePs(execPath) +
    args.map((a) => ' ' + quotePs(a)).join('');
  const child = spawn(
    'powershell.exe',
    ['-WindowStyle', 'Hidden', '-NoProfile', '-Command', cmd],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
  log('relaunch via detached spawn (fallback), pid ' + child.pid);
}

/** POSIX path: setsid + sleep + exec. */
function relaunchPosix(): void {
  const { execPath, args } = launchParts();
  const cmd =
    'sleep ' +
    RESTART_DELAY_SECONDS +
    '; exec ' +
    quotePosix(execPath) +
    args.map((a) => ' ' + quotePosix(a)).join('');
  const child = spawn('sh', ['-c', cmd], { detached: true, stdio: 'ignore' });
  child.unref();
  log('relaunch via detached sh, pid ' + child.pid);
}

/**
 * Create the re-launch helper, then report back through `done`.
 * `done` is what should trigger this process to exit.
 */
function relaunchDetached(done: () => void): void {
  try {
    if (isWindows) {
      relaunchWindows(done);
      return;
    }
    relaunchPosix();
    done();
  } catch (err) {
    log('relaunch failed: ' + String(err));
    console.error('[' + PLUGIN_ID + '] relaunch failed:', err);
    done();
  }
}

/** Send a JSON response and end the request. */
function sendJson(res: any, status: number, body: unknown): void {
  try {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  } catch {
    // response may already be gone during process teardown — ignore
  }
}

/** Minimal type for the cordis context we touch. */
interface DshContext {
  inject(services: string[], cb: (ctx: DshContext) => void): void;
  effect(cb: () => (() => void) | void): void;
  webServer?: {
    register(opts: {
      kind: string;
      path: string;
      handler: (req: any, res: any) => void | Promise<void>;
    }): (() => void) | void;
  };
  get<T = unknown>(name: string): T | undefined;
}

function apply(ctx: DshContext): void {
  ctx.inject(['webServer'], (httpCtx: DshContext) => {
    httpCtx.effect(() => {
      const routes: Array<{ path: string; action: 'close' | 'restart' }> = [
        { path: '/' + PLUGIN_ID + '/close', action: 'close' },
        { path: '/' + PLUGIN_ID + '/restart', action: 'restart' },
      ];

      const disposers: Array<(() => void) | void> = [];
      for (const route of routes) {
        const dispose = httpCtx.webServer!.register({
          kind: 'exact',
          path: route.path,
          handler: async (req: any, res: any) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'method not allowed' });
              return;
            }
            try {
              if (route.action === 'restart') {
                log('restart requested');
                // Answer immediately — the helper creation takes a moment.
                sendJson(res, 200, { ok: true, action: 'restart' });
                // Create the successor FIRST, then exit: the helper is owned
                // by the WMI service, so it outlives this process.
                relaunchDetached(() => setTimeout(() => process.exit(0), 300));
              } else {
                log('close requested');
                sendJson(res, 200, { ok: true, action: 'close' });
                setTimeout(() => process.exit(0), 300);
              }
            } catch (err) {
              sendJson(res, 500, { ok: false, error: String(err) });
            }
          },
        });
        disposers.push(dispose);
      }

      return () => {
        for (const dispose of disposers) {
          if (typeof dispose === 'function') dispose();
        }
      };
    });
  });
}

const name = PLUGIN_ID;
const inject: string[] = [];

export { apply, inject, name };
