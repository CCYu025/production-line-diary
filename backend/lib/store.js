// data.json 的讀寫。原則見 backend/data/schema.md：
//   - data.json 是唯一事實來源
//   - 寫入用「先寫暫存檔、再原子性 rename」，避免程式中途當機把檔案寫壞一半
//   - 找不到檔案時回傳空資料，而不是丟例外——讓全新安裝、還沒有任何紀錄時也能正常開機

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = "1.0";

function dataFilePath(dataDir) {
  return path.join(dataDir, "data.json");
}

export function emptyStore() {
  return {
    meta: { schemaVersion: SCHEMA_VERSION, app: "產線日誌" },
    records: [],
  };
}

export async function loadStore(dataDir) {
  const file = dataFilePath(dataDir);
  if (!existsSync(file)) return emptyStore();
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw);
  return {
    meta: { schemaVersion: SCHEMA_VERSION, app: "產線日誌", ...parsed._meta },
    records: Array.isArray(parsed.records) ? parsed.records : [],
  };
}

export async function saveStore(dataDir, store) {
  await mkdir(dataDir, { recursive: true });
  const file = dataFilePath(dataDir);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const payload = {
    _meta: {
      ...store.meta,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
    },
    records: store.records,
  };
  await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await rename(tmp, file);
  return payload;
}

export function nextId(records) {
  return records.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
}

// date "2026-09-21" -> 資料夾名稱 "20260921"，跟照片資料夾的命名規則對齊（見 schema.md）
export function dateToPhotoFolder(dateStr) {
  return String(dateStr).replaceAll("-", "");
}
