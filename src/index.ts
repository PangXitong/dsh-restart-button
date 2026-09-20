/**
 * dsh-restart-button — Host half (runs in the DSH main process, Node).
 *
 * Registers two same-origin HTTP routes that the browser-side button calls:
 *   POST /dsh-restart-button/close    → exit the DSH process
 *   POST /dsh-restart-button/restart  → spawn a detached re-launch, then exit
 *
 * The restart is self-contained: it re-runs the exact command that started
 * this process (process.execPath + process.argv) inside a detached, hidden
 * helper process that waits ~2s for this process to release the port before
 * relaunching. No external .bat/.sh script is required, so the plugin stays
 * distributable as a single npm package across Windows / macOS / Linux.
 */
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const PLUGIN_ID = 'dsh-restart-button';

const isWindows = platform() === 'win32';

/** Escape a single value for a single-quoted PowerShell string (' -> ''). */
function quoteWin(value: string): string {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/** Escape a single value for a single-quoted POSIX sh string (' -> '\''). */
function quotePosix(value: string): string {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

/**
 * Build the shell command that waits briefly (so this process can release the
 * port / exit) and then re-runs the exact launch command.
 *
 * Re-running process.execPath + process.argv works whether DSH was started
 * via `dsh web`, `npx @deepseek-ai/dsh web`, or `node /path/to/dsh web` —
 * the spawned child inherits the same argv and therefore the same profile /
 * flags (e.g. `--profile web`).
 */
function buildRelaunchCommand(): string {
  const execPath = process.execPath;
  const args = process.argv.slice(1);
  if (isWindows) {
    // PowerShell: hidden, no profile, sleep 2s, then invoke execPath with args.
    const tail = args.map(quoteWin).join(' ');
    const invoke = '& ' + quoteWin(execPath) + (tail ? ' ' + tail : '');
    return 'Start-Sleep -Seconds 2; ' + invoke;
  }
  // POSIX sh: sleep 2s, then exec execPath with args.
  const tail = args.map(quotePosix).join(' ');
  const invoke = 'exec ' + quotePosix(execPath) + (tail ? ' ' + tail : '');
  return 'sleep 2; ' + invoke;
}

/**
 * Spawn the relaunch helper as a detached process and let it outlive
 * this one. Returns the spawned ChildProcess (or null on failure).
 *
 * Windows notes:
 *   • We rely on PowerShell's `-WindowStyle Hidden` instead of
 *     `windowsHide: true`.  In Node ≥ 20 the `windowsHide` flag can
 *     interfere with detached process survival — the child may be
 *     terminated when the parent exits even though `detached: true`
 *     creates a new process group.
 *   • We do NOT pass `stdio: 'ignore'` for the PowerShell wrapper.
 *     `stdio: 'ignore'` on Windows has been observed to cause the
 *     child process to be cleaned up prematurely when the parent
 *     exits, because the OS tears down inherited stdio handles in a
 *     way that can affect detached children.
 */
function relaunchDetached() {
  const cmd = buildRelaunchCommand();
  try {
    if (isWindows) {
      const child = spawn(
        'powershell.exe',
        ['-WindowStyle', 'Hidden', '-NoProfile', '-Command', cmd],
        { detached: true, stdio: 'inherit' },
      );
      child.unref();
      return child;
    }
    const child = spawn('sh', ['-c', cmd], { detached: true, stdio: 'ignore' });
    child.unref();
    return child;
  } catch (err) {
    console.error('[' + PLUGIN_ID + '] relaunch spawn failed:', err);
    return null;
  }
}

/** Send a JSON response and end the request. */
function sendJson(res: any, status: number, body: unknown) {
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

function apply(ctx: DshContext) {
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
                console.log('[' + PLUGIN_ID + '] restart requested');
                relaunchDetached();
                sendJson(res, 200, { ok: true, action: 'restart' });
                // Give the response time to flush, then exit so the
                // detached helper can re-bind the port.  We wait
                // 2 s to ensure PowerShell has fully started and
                // begun its own sleep cycle.
                setTimeout(() => process.exit(0), 2000);
              } else {
                console.log('[' + PLUGIN_ID + '] close requested');
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
