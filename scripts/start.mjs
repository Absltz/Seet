import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
const root = fileURLToPath(new URL("..", import.meta.url));
dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
const url = `http://127.0.0.1:${Number(process.env.PORT) || 4173}`;
const open = () => {
  if (process.env.SEET_NO_OPEN === '1') return;
  spawn("cmd", ["/c", "start", "", url], {
    windowsHide: true,
    stdio: "ignore",
  }).unref();
};
function announceReady() {
  const detail = `  [5/5] 启动服务 | 100% | 服务已就绪：${url}`;
  if (process.env.SEET_STARTUP_PROGRESS === '1') {
    if (process.stdout.isTTY) {
      // Save/restore the log cursor; refresh only the fixed dashboard after HTTP readiness.
      const lines = ['  见数 Seet | 启动准备', '  总体 [#####] 第 5/5 阶段', '  启动服务', '  [####################] 100%  已完成', `  服务已就绪：${url}`, '  ------------------------------------------------------'];
      process.stdout.write('\x1b7\x1b[H' + lines.map(line => '\x1b[2K' + line).join('\r\n') + '\x1b8');
    }
    console.log(detail);
  }
}
async function online() {
  try {
    const r = await fetch(url + "/api/status", {
      signal: AbortSignal.timeout(1000),
    });
    return r.ok && (await r.json()).configured !== undefined;
  } catch {
    return false;
  }
}
if (await online()) {
  console.log(`见数已运行：${url}`);
  announceReady();
  open();
} else {
  const server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  server.on("error", () => {
    console.error("服务启动失败。");
    process.exitCode = 1;
  });
  server.on("exit", (code) => {
    process.exitCode = process.exitCode || code || (ready ? 0 : 1);
  });
  let ready = false;
  const configuredWait = Number(process.env.SEET_STARTUP_TIMEOUT_MS);
  const waitMs = Number.isFinite(configuredWait) && configuredWait >= 100 ? Math.min(configuredWait, 60000) : 10000;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await online()) {
      ready = true;
      announceReady();
      open();
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) {
    console.error('服务未能就绪，请检查上方日志和端口占用后重试。');
    server.kill();
    process.exitCode = 1;
  }
}
