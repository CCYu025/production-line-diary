// data.json 的讀寫。原則見 backend/data/schema.md：
//   - data.json 是唯一事實來源
//   - 寫入用「先寫暫存檔、再原子性 rename」，避免程式中途當機把檔案寫壞一半
//   - 找不到檔案時回傳空資料，而不是丟例外——讓全新安裝、還沒有任何紀錄時也能正常開機
//   - 所有「讀 → 改 → 寫」都要走 withStore()，同一個資料夾的寫入排隊一個一個做，
//     不然兩個同時進來的請求會讀到同一份舊資料、後寫的蓋掉先寫的（遺失紀錄、重複 id）
//   - data.json 解析失敗時丟 StoreCorruptError，絕不覆寫原檔
//   - 每天第一次寫入前，把現有 data.json 複製到 backups/data-YYYYMMDD.json，保留最近 14 份

import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = "1.2";
export const BACKUP_KEEP = 14;

/**
 * data.json 讀得到但不是合法 JSON：呼叫端應回 500，且不可以寫入（會蓋掉原檔）。
 * message 會原樣回給前端，所以不放伺服器上的絕對路徑；路徑與解析錯誤原因放在 file / cause，只進伺服器 log。
 */
export class StoreCorruptError extends Error {
  constructor(file, cause) {
    super("data.json 無法解析，原檔未被修改，請檢查或從 backups/ 還原");
    this.name = "StoreCorruptError";
    this.file = file;
    this.cause = cause;
  }
}

function dataFilePath(dataDir) {
  return path.join(dataDir, "data.json");
}

export function emptyStore() {
  return {
    meta: { schemaVersion: SCHEMA_VERSION, app: "產線日誌" },
    records: [],
    equipmentMap: [],
  };
}

export async function loadStore(dataDir) {
  const file = dataFilePath(dataDir);
  if (!existsSync(file)) return emptyStore();
  let raw = await readFile(file, "utf8");
  // 用記事本等工具存檔時可能在開頭加上 UTF-8 BOM（U+FEFF），JSON.parse 會直接失敗
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StoreCorruptError(file, err);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StoreCorruptError(file, new Error("最上層不是物件"));
  }
  return {
    meta: { schemaVersion: SCHEMA_VERSION, app: "產線日誌", ...parsed._meta },
    records: Array.isArray(parsed.records) ? parsed.records : [],
    equipmentMap: Array.isArray(parsed.equipmentMap) ? parsed.equipmentMap : [],
  };
}

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_BACKOFF_MS = [50, 100, 200, 400, 800]; // 最多重試 5 次（共 6 次嘗試）

/**
 * rename 遇到 EPERM / EBUSY / EACCES（Windows 上 OneDrive、防毒、檔案總管暫時鎖住檔案時常見）
 * 就退避重試，重試用完仍失敗才把最後一個錯誤丟出去。
 * `rename` 與 `delays` 可注入，方便測試。
 */
export async function renameWithRetry(from, to, { rename: doRename = rename, delays = RENAME_BACKOFF_MS } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      await doRename(from, to);
      return;
    } catch (err) {
      if (!RETRYABLE_RENAME_CODES.has(err?.code) || attempt >= delays.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

// 本地日曆日（不是 UTC）：台灣清晨 0–8 點用 toISOString 會變成前一天
function localDayStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

const BACKUP_NAME = /^data-\d{8}\.json$/;

/**
 * 每天第一次寫入前，把現有的 data.json 複製到 DATA_DIR/backups/data-YYYYMMDD.json，
 * 並只保留最新的 BACKUP_KEEP 份。備份失敗只記 log、不擋住這次寫入。
 */
export async function backupBeforeFirstSaveOfDay(dataDir, now = new Date()) {
  try {
    const file = dataFilePath(dataDir);
    if (!existsSync(file)) return null;
    const dir = path.join(dataDir, "backups");
    const target = path.join(dir, `data-${localDayStamp(now)}.json`);
    if (existsSync(target)) return null;
    await mkdir(dir, { recursive: true });
    await copyFile(file, target);
    const names = (await readdir(dir)).filter((n) => BACKUP_NAME.test(n)).sort();
    for (const old of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
      await rm(path.join(dir, old), { force: true });
    }
    return target;
  } catch (err) {
    console.error("每日備份失敗（本次仍會繼續寫入）：", err.message);
    return null;
  }
}

let tmpCounter = 0;

export async function saveStore(dataDir, store) {
  await mkdir(dataDir, { recursive: true });
  const file = dataFilePath(dataDir);
  await backupBeforeFirstSaveOfDay(dataDir);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${tmpCounter++}`;
  const payload = {
    _meta: {
      ...store.meta,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
    },
    records: store.records,
    equipmentMap: store.equipmentMap || [],
  };
  await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  try {
    await renameWithRetry(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return payload;
}

// 每個 dataDir 一條 promise 鏈。鏈尾永遠是「不會 reject」的版本，
// 前一個請求失敗不會讓後面的請求跟著失敗，也不會卡住。
const locks = new Map();

/**
 * 在鎖內完成「讀 → 改 → 寫」。
 *
 *   const record = await withStore(dataDir, async (store) => {
 *     const rec = { id: nextId(store.records), ... };
 *     store.records.push(rec);
 *     await store.save();   // 要寫入時呼叫；不呼叫（或中途丟例外）就不會寫入
 *     return rec;
 *   });
 *
 * - 同一個 dataDir 的 withStore 一個接一個執行；`nextId` 要在回呼裡算。
 * - 回呼收到的 store 多了一個 `save()`（不可列舉，不會被序列化），用目前的內容寫回 data.json。
 * - 回呼丟例外 → 不寫入、例外原樣丟給呼叫端，後面排隊的請求照常執行。
 * - 純讀取（GET）可以直接用 loadStore，不必排隊。
 */
export function withStore(dataDir, fn) {
  const key = path.resolve(dataDir);
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(async () => {
    const store = await loadStore(dataDir);
    Object.defineProperty(store, "save", {
      value: () => saveStore(dataDir, store),
      enumerable: false,
    });
    return fn(store);
  });
  const tail = run.then(
    () => {},
    () => {},
  );
  locks.set(key, tail);
  tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

export function nextId(records) {
  return records.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
}

// date "2026-09-21" -> 資料夾名稱 "20260921"，跟照片資料夾的命名規則對齊（見 schema.md）
export function dateToPhotoFolder(dateStr) {
  return String(dateStr).replaceAll("-", "");
}
