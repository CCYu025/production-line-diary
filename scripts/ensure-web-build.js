// `npm start`（也就是 start.bat）啟動伺服器前先呼叫：確保新前端 web/dist 存在且不比原始碼舊。
//   - web/dist 不存在、或比 web/ 底下的原始碼（含 backend/lib 共用邏輯）舊 → 重新建置
//   - 建置所需套件（vite）還沒裝 → 先 npm install（例如 git pull 後 node_modules 是舊的）
//   - 任何一步失敗都只印警告、退出碼 0：新 UI 還只是掛在 /next/ 的預覽版，
//     不能因為它建置失敗就害每天在用的舊 UI（/）打不開。
// 用法：node scripts/ensure-web-build.js [--force]

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_INDEX = path.join(ROOT, "web", "dist", "index.html");
const VITE_BIN = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

// 這些路徑底下（或檔案本身）有任何檔案比 dist 新，就視為過期。
const SOURCES = [
  "web",
  "backend/lib/aggregate.js",
  "backend/lib/aggregate.d.ts",
  "backend/lib/types.d.ts",
  "package.json",
  "package-lock.json",
];
const SKIP_DIRS = new Set(["node_modules", "dist"]);

// 只比「檔案」的修改時間（遞迴）；資料夾自己的 mtime 會因為 dev server 建立暫存檔等原因變動，
// 不代表原始碼改了，算進去會造成不必要的重新建置。
function newestMtime(target) {
  let st;
  try {
    st = statSync(target);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    newest = Math.max(newest, newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

export function isBuildStale() {
  if (!existsSync(DIST_INDEX)) return true;
  const distTime = statSync(DIST_INDEX).mtimeMs;
  return SOURCES.some((s) => newestMtime(path.join(ROOT, s)) > distTime);
}

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${label}失敗（結束碼 ${result.status}）`);
}

function main() {
  const force = process.argv.includes("--force");
  if (!force && !isBuildStale()) return;

  try {
    if (!existsSync(VITE_BIN)) {
      console.log("新介面需要安裝建置套件，執行 npm install …");
      const npmCli = process.env.npm_execpath;
      if (!npmCli) throw new Error("找不到 npm（請用 npm start 啟動，或手動執行 npm install）");
      run([npmCli, "install"], "npm install");
    }
    console.log("建置新介面（web/dist）…");
    run([VITE_BIN, "build", "--config", path.join("web", "vite.config.ts")], "建置");
  } catch (err) {
    console.warn(`\n[警告] 新介面（/next/）沒有建置成功：${err.message}`);
    console.warn("舊介面（/）不受影響，伺服器會照常啟動。要看新介面請執行 npm install 後再 npm run build。\n");
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
