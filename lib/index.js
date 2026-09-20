// src/index.ts
import { execFile, spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
var PLUGIN_ID = "dsh-restart-button";
var isWindows = platform() === "win32";
var RESTART_DELAY_SECONDS = 3;
var LOG_PATH = join(tmpdir(), PLUGIN_ID + ".log");
function log(message) {
  try {
    appendFileSync(LOG_PATH, "[" + (/* @__PURE__ */ new Date()).toISOString() + "] " + message + "\n");
  } catch {
  }
}
function quotePs(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function quotePosix(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
function launchParts() {
  return { execPath: process.execPath, args: process.argv.slice(1) };
}
function writeWindowsHelper() {
  const { execPath, args } = launchParts();
  const invocation = "& " + quotePs(execPath) + args.map((a) => " " + quotePs(a)).join("");
  const lines = [
    '$ErrorActionPreference = "Continue"',
    "$log = " + quotePs(LOG_PATH),
    'Add-Content -LiteralPath $log -Value ("[" + (Get-Date).ToString("o") + "] helper started, waiting ' + RESTART_DELAY_SECONDS + 's")',
    "Start-Sleep -Seconds " + RESTART_DELAY_SECONDS,
    "Set-Location -LiteralPath " + quotePs(process.cwd()),
    'Add-Content -LiteralPath $log -Value ("[" + (Get-Date).ToString("o") + "] helper launching dsh")',
    // The helper stays alive as the parent of the server, so its hidden
    // console is inherited and no window flashes.
    invocation,
    'Add-Content -LiteralPath $log -Value ("[" + (Get-Date).ToString("o") + "] dsh exited with code " + $LASTEXITCODE)'
  ];
  const helperPath = join(tmpdir(), PLUGIN_ID + "-relaunch.ps1");
  writeFileSync(helperPath, lines.join("\r\n") + "\r\n", "utf8");
  return helperPath;
}
function relaunchWindows(done) {
  let helperPath;
  try {
    helperPath = writeWindowsHelper();
  } catch (err) {
    log("could not write helper script, falling back: " + String(err));
    relaunchViaSpawnWindows();
    done();
    return;
  }
  const commandLine = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + helperPath + '"';
  const psCommand = "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = " + quotePs(commandLine) + " } | Select-Object -ExpandProperty ProcessId";
  execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", psCommand],
    { encoding: "utf8", windowsHide: true, timeout: 2e4 },
    (err, stdout) => {
      const pid = String(stdout || "").trim();
      if (err || !pid) {
        log("WMI relaunch failed, falling back: " + String(err || "no process id"));
        try {
          relaunchViaSpawnWindows();
        } catch (fallbackErr) {
          log("fallback relaunch also failed: " + String(fallbackErr));
        }
      } else {
        log("relaunch via WMI succeeded: helper pid " + pid + " (" + helperPath + ")");
      }
      done();
    }
  );
}
function relaunchViaSpawnWindows() {
  const { execPath, args } = launchParts();
  const cmd = "Start-Sleep -Seconds " + RESTART_DELAY_SECONDS + "; & " + quotePs(execPath) + args.map((a) => " " + quotePs(a)).join("");
  const child = spawn(
    "powershell.exe",
    ["-WindowStyle", "Hidden", "-NoProfile", "-Command", cmd],
    { detached: true, stdio: "ignore", windowsHide: true }
  );
  child.unref();
  log("relaunch via detached spawn (fallback), pid " + child.pid);
}
function relaunchPosix() {
  const { execPath, args } = launchParts();
  const cmd = "sleep " + RESTART_DELAY_SECONDS + "; exec " + quotePosix(execPath) + args.map((a) => " " + quotePosix(a)).join("");
  const child = spawn("sh", ["-c", cmd], { detached: true, stdio: "ignore" });
  child.unref();
  log("relaunch via detached sh, pid " + child.pid);
}
function relaunchDetached(done) {
  try {
    if (isWindows) {
      relaunchWindows(done);
      return;
    }
    relaunchPosix();
    done();
  } catch (err) {
    log("relaunch failed: " + String(err));
    console.error("[" + PLUGIN_ID + "] relaunch failed:", err);
    done();
  }
}
function sendJson(res, status, body) {
  try {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  } catch {
  }
}
function apply(ctx) {
  ctx.inject(["webServer"], (httpCtx) => {
    httpCtx.effect(() => {
      const routes = [
        { path: "/" + PLUGIN_ID + "/close", action: "close" },
        { path: "/" + PLUGIN_ID + "/restart", action: "restart" }
      ];
      const disposers = [];
      for (const route of routes) {
        const dispose = httpCtx.webServer.register({
          kind: "exact",
          path: route.path,
          handler: async (req, res) => {
            if (req.method !== "POST") {
              sendJson(res, 405, { ok: false, error: "method not allowed" });
              return;
            }
            try {
              if (route.action === "restart") {
                log("restart requested");
                sendJson(res, 200, { ok: true, action: "restart" });
                relaunchDetached(() => setTimeout(() => process.exit(0), 300));
              } else {
                log("close requested");
                sendJson(res, 200, { ok: true, action: "close" });
                setTimeout(() => process.exit(0), 300);
              }
            } catch (err) {
              sendJson(res, 500, { ok: false, error: String(err) });
            }
          }
        });
        disposers.push(dispose);
      }
      return () => {
        for (const dispose of disposers) {
          if (typeof dispose === "function") dispose();
        }
      };
    });
  });
}
var name = PLUGIN_ID;
var inject = [];
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
