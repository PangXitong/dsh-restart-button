// src/index.ts
import { spawn } from "node:child_process";
import { platform } from "node:os";
var PLUGIN_ID = "dsh-restart-button";
var isWindows = platform() === "win32";
function quoteWin(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function quotePosix(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
function buildRelaunchCommand() {
  const execPath = process.execPath;
  const args = process.argv.slice(1);
  if (isWindows) {
    const tail2 = args.map(quoteWin).join(" ");
    const invoke2 = "& " + quoteWin(execPath) + (tail2 ? " " + tail2 : "");
    return "Start-Sleep -Seconds 2; " + invoke2;
  }
  const tail = args.map(quotePosix).join(" ");
  const invoke = "exec " + quotePosix(execPath) + (tail ? " " + tail : "");
  return "sleep 2; " + invoke;
}
function relaunchDetached() {
  const cmd = buildRelaunchCommand();
  try {
    if (isWindows) {
      const child2 = spawn(
        "powershell.exe",
        ["-WindowStyle", "Hidden", "-NoProfile", "-Command", cmd],
        { detached: true, stdio: "ignore", windowsHide: true }
      );
      child2.unref();
      return child2;
    }
    const child = spawn("sh", ["-c", cmd], { detached: true, stdio: "ignore" });
    child.unref();
    return child;
  } catch (err) {
    console.error("[" + PLUGIN_ID + "] relaunch spawn failed:", err);
    return null;
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
                console.log("[" + PLUGIN_ID + "] restart requested");
                relaunchDetached();
                sendJson(res, 200, { ok: true, action: "restart" });
                setTimeout(() => process.exit(0), 300);
              } else {
                console.log("[" + PLUGIN_ID + "] close requested");
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
