// 後端輸入驗證（純函式）。server.js 的 POST/PUT 路由與照片路由共用。
//
// 原則：
//   - enum（severity / status / shift）必須是允許值；缺省（undefined / null）時才套預設
//   - 日期必須是真實存在的日期（2026-02-30 不行）、時間必須是 00:00–23:59
//   - 照片檔名必須是「單純的檔名」，不能夾帶路徑
//   - PUT 只取白名單欄位，不讓呼叫端用 body 改 id / deleted / updatedAt 之類的內部欄位
//   - PUT 只驗證 body 實際帶來的欄位（舊資料裡的怪值不該擋住「只改一個欄位」的請求）；
//     POST 是新建，全部欄位都要驗證

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

/** "YYYY-MM-DD"、真實存在、年份 1900 以後（拒絕 2026-02-30、2026-13-01、0000-01-01）。 */
export function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 1900) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
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
 * 耗時（分鐘）：正整數。接受 number 或「純數字字串」；陣列、布林、小數、0、負數、空字串都不行。
 * @returns {number|null} 合法時回傳整數，否則 null
 */
export function parseDuration(value) {
  let n;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^\d+$/.test(value)) n = Number(value);
  else return null;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * 路由的 :id 參數：只接受十進位正整數（不含 0x1、1e0、前後空白、前導 0）。
 * @returns {number|null}
 */
export function parseId(param) {
  if (typeof param !== "string" || !/^[1-9]\d*$/.test(param)) return null;
  const n = Number(param);
  return Number.isSafeInteger(n) ? n : null;
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

/**
 * 從任意 body 取出白名單欄位（只取 body 自己有的 key）。
 * photos 裡重複的檔名只留第一個（同一張照片列兩次沒有意義，也會讓「參照」判斷變得混亂）。
 */
export function pickRecordFields(body) {
  const out = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  for (const key of RECORD_FIELDS) {
    if (Object.hasOwn(body, key)) out[key] = body[key];
  }
  if (Array.isArray(out.photos)) out.photos = [...new Set(out.photos)];
  return out;
}

const absent = (v) => v === undefined || v === null;

/**
 * 把（已通過驗證的）欄位整理成要存的樣子：文字去頭尾空白、空的選填欄位存 null、duration 轉成數字。
 * 只處理傳進來有的 key，沒有的 key 不會出現在結果裡（PUT 靠這點避免動到沒碰的欄位）。
 */
export function normalizeRecordFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    switch (key) {
      case "duration":
        out.duration = parseDuration(value);
        break;
      case "equipment":
      case "problem":
        out[key] = String(value).trim();
        break;
      case "category":
        out.category = String(value || "其他").trim() || "其他";
        break;
      case "action":
        out.action = String(value || "").trim();
        break;
      case "rootCause":
      case "productCode":
      case "materialCategory":
        out[key] = value ? String(value).trim() || null : null;
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

/**
 * 驗證紀錄內容。
 * @param {object} rec       要驗證的內容（POST：body 取出的欄位；PUT：同樣只放 body 帶來的欄位）
 * @param {Iterable<string>} supplied  這次 body 實際帶來的欄位名稱
 * @param {{full?: boolean}} [opts]  full = true（POST）：必填欄位一律檢查；
 *                                   false（PUT，預設）：只檢查 supplied 裡有的欄位，
 *                                   這樣舊資料裡既有的怪值（duration 0、時間 "9:30"、空設備…）
 *                                   不會害使用者「只改狀態／根本原因」的 PUT 被擋下
 * @returns {string[]} 錯誤訊息（空陣列 = 通過）
 */
export function validateRecord(rec, supplied, { full = false } = {}) {
  const errors = [];
  const has = new Set(supplied);
  const check = (key) => full || has.has(key);

  if (check("date") && !isRealDate(rec.date)) errors.push("date 須為真實存在的日期（1900 年以後），格式 YYYY-MM-DD");
  if (check("time") && !isValidTime(rec.time)) errors.push("time 格式須為 HH:MM（00:00–23:59）");
  if (check("duration") && parseDuration(rec.duration) === null) errors.push("duration 須為正整數（分鐘）");

  for (const key of STRING_FIELDS) {
    if (has.has(key) && !absent(rec[key]) && typeof rec[key] !== "string") errors.push(`${key} 須為文字`);
  }
  if (check("equipment") && (typeof rec.equipment !== "string" || !rec.equipment.trim())) errors.push("equipment 為必填");
  if (check("problem") && (typeof rec.problem !== "string" || !rec.problem.trim())) errors.push("problem 為必填");

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
