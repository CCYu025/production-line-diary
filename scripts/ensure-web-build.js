// `npm start`（也就是 start.bat）啟動伺服器前先呼叫：確保前端 web/dist 存在且不比原始碼舊。
//   - web/dist 不存在、或比 web/ 底下的原始碼（含 backend/lib 共用邏輯）舊 → 重新建置
//   - 建置所需套件（vite）還沒裝 → 先 npm install（例如 git pull 後 node_modules 是舊的）
//   - **建置失敗不再有舊介面可退**（舊介面已移除），所以：
//       1. 在主控台印出明確的錯誤（不是一行小警告）；
//       2. 把錯誤摘要寫進專案根目錄的 .web-build-error.log（不進版控），伺服器的「介面建置失敗」頁會顯示它；
//       3. 結束碼仍是 0，讓伺服器照常啟動——這樣瀏覽器打開看到的是說明怎麼處理的頁面，而不是「無法連線」；
//          API 與照片不受影響。若先前已有一份舊的 web/dist，會沿用它（主控台會講清楚是舊版本）。
//     建置成功就刪掉 .web-build-error.log。
// 用法：node scripts/ensure-web-build.js [--force]

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_INDEX = path.join(ROOT, "web", "dist", "index.html");
const VITE_BIN = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
// 會被 server.js（WEB_BUILD_ERROR_FILE）讀去顯示；兩邊的預設路徑要一致
export const ERROR_LOG = process.env.WEB_BUILD_ERROR_FILE
  ? path.resolve(process.env.WEB_BUILD_ERROR_FILE)
  : path.join(ROOT, ".web-build-error.log");
const LOG_TAIL_LINES = 40;

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

// 子程序輸出照樣顯示在主控台，同時留下最後幾十行（去掉顏色碼）當錯誤摘要
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
const outputTail = [];

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: ["inherit", "pipe", "pipe"], encoding: "utf8" });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  outputTail.push(...text.replace(ANSI, "").split(/\r?\n/).filter(Boolean));
  if (result.error) throw new Error(`${label}失敗：${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}失敗（結束碼 ${result.status}）`);
}

function reportFailure(err) {
  const hadOldBuild = existsSync(DIST_INDEX);
  const summary = [err.message, "", ...outputTail.slice(-LOG_TAIL_LINES)].join("\n");
  try {
    writeFileSync(ERROR_LOG, `${summary}\n`, "utf8");
  } catch {
    // 寫不進去就只剩主控台訊息
  }
  const bar = "=".repeat(60);
  console.error(`\n${bar}\n[錯誤] 介面建置失敗：${err.message}\n${bar}`);
  if (hadOldBuild) {
    console.error("沿用上一次建置成功的介面（可能不是最新的）。資料不受影響。");
  } else {
    console.error("目前沒有可用的介面，瀏覽器會顯示「介面建置失敗」頁面（資料與照片不受影響）。");
  }
  console.error("處理方式：執行 npm install，再執行 npm run build；成功後重新整理瀏覽器即可。\n");
}

function main() {
  const force = process.argv.includes("--force");
  if (!force && !isBuildStale()) return;

  try {
    if (!existsSync(VITE_BIN)) {
      console.log("介面需要安裝建置套件，執行 npm install …");
      const npmCli = process.env.npm_execpath;
      if (!npmCli) throw new Error("找不到 npm（請用 npm start 啟動，或手動執行 npm install）");
      run([npmCli, "install"], "npm install");
    }
    console.log("建置介面（web/dist）…");
    run([VITE_BIN, "build", "--config", path.join("web", "vite.config.ts")], "建置");
    rmSync(ERROR_LOG, { force: true });
  } catch (err) {
    reportFailure(err);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
