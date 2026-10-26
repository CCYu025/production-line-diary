// 後端輸入驗證（純函式）。server.js 的 POST/PUT 路由與照片路由共用。
//
// 原則：
//   - enum（severity / status / shift）必須是允許值；缺省（undefined / null）時才套預設
//   - 日期必須是真實存在的日期（2026-02-30 不行）、時間必須是 00:00–23:59
//   - 照片檔名必須是「單純的檔名」，不能夾帶路徑
//   - PUT 只取白名單欄位，不讓呼叫端用 body 改 id / deleted / updatedAt 之類的內部欄位

import { SEVERITY_ORDER, STATUS_ORDER } from "./aggregate.js";

export const SHIFTS = ["早", "中", "晚"];

/** PUT / POST 允許從 body 取用的欄位（白名單）。 */
export const RECORD_FIELDS = [
  "date",
  "shift",
  "time",
  "duration",
  "equipment",
  "category",
  "problem",
  "severity",
  "action",
  "rootCause",
  "status",
  "productCode",
  "materialCategory",
  "photos",
  "photoCaptions",
];

const STRING_FIELDS = ["equipment", "category", "problem", "action", "rootCause", "productCode", "materialCategory"];

/** "YYYY-MM-DD" 且是真實存在的日期（拒絕 2026-02-30、2026-13-01）。 */
export function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC 對 0–99 年會當成 1900+，用 setUTCFullYear 避開
  dt.setUTCFullYear(y);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "HH:MM"，00:00–23:59。 */
export function isValidTime(value) {
  if (typeof value !== "string") return false;
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

/**
 * 安全的照片檔名：非空字串、不含 / \ : 、不含 ".."、不含控制字元、不是 "."、長度 ≤ 255。
 * （":" 在 Windows 上可能被解讀成磁碟機或 NTFS 資料流，一併擋掉。）
 */
export function isSafeFilename(name) {
  if (typeof name !== "string" || !name || name.length > 255) return false;
  if (name === ".") return false;
  if (name.includes("..")) return false;
  if (/[/\\:]/.test(name)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) return false;
  return true;
}

/** 從任意 body 取出白名單欄位（只取 body 自己有的 key）。 */
export function pickRecordFields(body) {
  const out = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  for (const key of RECORD_FIELDS) {
    if (Object.hasOwn(body, key)) out[key] = body[key];
  }
  return out;
}

const absent = (v) => v === undefined || v === null;

/**
 * 驗證一筆（合併後的）紀錄內容。
 * @param {object} rec       要驗證的完整內容（必填欄位一律檢查）
 * @param {Iterable<string>} supplied  這次 body 實際帶來的欄位名稱——enum／型別／照片檔名只檢查這些，
 *                                      這樣舊資料裡既有的怪值不會害使用者「只改一個欄位」的 PUT 被擋下
 * @returns {string[]} 錯誤訊息（空陣列 = 通過）
 */
export function validateRecord(rec, supplied) {
  const errors = [];
  const has = new Set(supplied);

  if (!isRealDate(rec.date)) errors.push("date 須為真實存在的日期，格式 YYYY-MM-DD");
  if (!isValidTime(rec.time)) errors.push("time 格式須為 HH:MM（00:00–23:59）");
  if (!Number.isFinite(Number(rec.duration)) || Number(rec.duration) <= 0) errors.push("duration 須為正數");

  for (const key of STRING_FIELDS) {
    if (has.has(key) && !absent(rec[key]) && typeof rec[key] !== "string") errors.push(`${key} 須為文字`);
  }
  if (typeof rec.equipment !== "string" || !rec.equipment.trim()) errors.push("equipment 為必填");
  if (typeof rec.problem !== "string" || !rec.problem.trim()) errors.push("problem 為必填");

  if (has.has("shift") && !SHIFTS.includes(rec.shift)) errors.push(`shift 須為 ${SHIFTS.join("／")}`);
  if (has.has("severity") && !SEVERITY_ORDER.includes(rec.severity)) {
    errors.push(`severity 須為 ${SEVERITY_ORDER.join("／")}`);
  }
  if (has.has("status") && !STATUS_ORDER.includes(rec.status)) errors.push(`status 須為 ${STATUS_ORDER.join("／")}`);

  if (has.has("photos")) {
    if (!Array.isArray(rec.photos)) {
      errors.push("photos 須為陣列");
    } else {
      const bad = rec.photos.filter((fn) => !isSafeFilename(fn));
      if (bad.length) errors.push("photos 含有不合法的檔名");
    }
  }
  if (has.has("photoCaptions") && !absent(rec.photoCaptions)) {
    if (typeof rec.photoCaptions !== "object" || Array.isArray(rec.photoCaptions)) {
      errors.push("photoCaptions 須為物件");
    }
  }
  return errors;
}
