// 純函式版的搬遷邏輯（不碰檔案系統），從 scripts/migrate.js 抽出來方便單元測試。

import path from "node:path";
import { severityFromDuration } from "./aggregate.js";

// 問題文字 -> 分類 的對照表。刻意用「找得到就對照、找不到就歸類其他」而不是
// 寫死一個固定 enum——產線上一天就冒出 RB2、CCD異常 這種新狀況，
// 這張表本來就預期會一直被擴充，擴充只要加一行，不用改資料結構。
export const CATEGORY_KEYWORDS = [
  [/堆疊|取料失敗|歪斜/, "取料異常"],
  [/缺料/, "缺料"],
  [/厚度上限|厚度下限|尺寸/, "尺寸異常"],
  [/附於上模|沾模/, "沾模"],
  [/撕破|膠片破損|破損/, "材料損傷"],
  [/CCD/, "設備異常"],
  [/空抓|夾具/, "設備異常"],
];

export function categorize(problem) {
  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(problem)) return category;
  }
  return "其他";
}

/**
 * 同一天、同一個問題文字出現 >=3 次，視為「還在處理中」；其餘視為
 * 「當下已處理完成」（因為每一列的『處理』欄位本來就都有記錄實際做了什麼）。
 * @param {Array} legacyRows - readLegacyXlsx() 的輸出
 * @returns {Array} 符合 schema.md 的完整紀錄陣列，id 從 1 開始重新編號
 */
export function buildRecords(legacyRows) {
  const sameDayProblemCount = new Map();
  for (const row of legacyRows) {
    const key = `${row.date}__${row.problem}`;
    sameDayProblemCount.set(key, (sameDayProblemCount.get(key) || 0) + 1);
  }

  let id = 1;
  return legacyRows.map((row) => {
    const key = `${row.date}__${row.problem}`;
    const isRecurring = sameDayProblemCount.get(key) >= 3;
    return {
      id: id++,
      date: row.date,
      shift: row.shift || "早",
      time: row.time,
      duration: row.duration,
      equipment: row.equipment,
      category: categorize(row.problem),
      problem: row.problem,
      severity: severityFromDuration(row.duration),
      action: row.action,
      rootCause: null,
      status: isRecurring ? "追蹤中" : "已解決",
      // 舊版 Excel 從來沒有記錄品號／原料類別，這裡不猜——寧可留白，
      // 之後想補的話可以在 App 裡個別編輯，不要用假資料填滿統計數字。
      productCode: null,
      materialCategory: null,
      // 舊版 Excel 裡的照片路徑一律是 Windows 反斜線路徑（這台電腦存下來的），
      // 跟這支腳本實際在哪個作業系統上執行無關——所以固定用 path.win32，
      // 不要用平台相依的 path.basename()（在 Linux CI 上不會切反斜線，會整條路徑當檔名）。
      photos: row.photoPath ? [path.win32.basename(row.photoPath)] : [],
      updatedAt: null,
      deleted: false,
      deletedAt: null,
    };
  });
}
