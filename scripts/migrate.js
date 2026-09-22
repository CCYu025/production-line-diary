#!/usr/bin/env node
// 一次性搬遷腳本：把舊版 8 欄 Excel（日期/班別/時間/耗時/設備/問題/處理/照片）
// 轉成 data.json 的新格式（見 backend/data/schema.md）。
//
// 用法：
//   node --env-file-if-exists=.env scripts/migrate.js [--force]
//   （需要先在 .env 設定 DATA_DIR 與 LEGACY_XLSX_PATH，見 .env.example）
//
// --force 會覆蓋掉已存在的 data.json；沒加這個旗標、且 data.json 裡已經有
// 紀錄的話，腳本會直接中止，避免不小心蓋掉你在正式版 App 裡已經編輯過的資料。
//
// 轉換規則（分類對照表、嚴重度、「追蹤中/已解決」判斷）都在
// backend/lib/migrateLogic.js，有獨立的單元測試。

import path from "node:path";
import { existsSync } from "node:fs";
import { readLegacyXlsx } from "../backend/lib/xlsx.js";
import { loadStore, saveStore } from "../backend/lib/store.js";
import { buildRecords } from "../backend/lib/migrateLogic.js";

const DATA_DIR = process.env.DATA_DIR;
const LEGACY_XLSX_PATH = process.env.LEGACY_XLSX_PATH;
const FORCE = process.argv.includes("--force");

if (!DATA_DIR || !LEGACY_XLSX_PATH) {
  console.error("請先設定環境變數 DATA_DIR 與 LEGACY_XLSX_PATH（可複製 .env.example 成 .env 修改）");
  process.exit(1);
}
if (!existsSync(LEGACY_XLSX_PATH)) {
  console.error(`找不到舊版 Excel：${LEGACY_XLSX_PATH}`);
  process.exit(1);
}

async function run() {
  const legacyRows = await readLegacyXlsx(LEGACY_XLSX_PATH);
  console.log(`從舊版 Excel 讀到 ${legacyRows.length} 筆紀錄`);

  const existing = await loadStore(DATA_DIR);
  if (existing.records.length > 0 && !FORCE) {
    console.error(
      `data.json 裡已經有 ${existing.records.length} 筆紀錄。這個腳本是一次性搬遷用，` +
        `不會拿舊 Excel 去覆蓋你之後在 App 裡編輯過的資料。\n` +
        `如果你確定要用舊 Excel 重新覆蓋，請加 --force。`
    );
    process.exit(1);
  }

  const records = buildRecords(legacyRows);
  await saveStore(DATA_DIR, { meta: existing.meta, records });
  console.log(`已寫入 ${records.length} 筆紀錄至 ${path.join(DATA_DIR, "data.json")}`);

  const categoryTally = new Map();
  const statusTally = new Map();
  for (const r of records) {
    categoryTally.set(r.category, (categoryTally.get(r.category) || 0) + 1);
    statusTally.set(r.status, (statusTally.get(r.status) || 0) + 1);
  }
  console.log("分類分布：", Object.fromEntries(categoryTally));
  console.log("狀態分布：", Object.fromEntries(statusTally));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
