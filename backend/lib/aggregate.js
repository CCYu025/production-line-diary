// 純函式：不碰檔案系統、不碰網路，只吃資料、吐資料 — 方便單元測試，
// 也是前端 dashboard 圖表背後的同一套邏輯（避免前後端各寫一份、算出兩種數字）。

export const SEVERITY_ORDER = ["輕微", "一般", "嚴重", "重大"];
export const STATUS_ORDER = ["待處理", "追蹤中", "已解決"];

// 分類/設備刻意不做成寫死的 enum —— 產線上一天內就冒出 RB2、CCD異常 這種新代號，
// 硬編碼的清單只會一直落後現實。這裡只提供「目前資料庫裡出現過的值」，
// 給前端的下拉選單當建議清單用，永遠可以輸入新的值。
export function knownEquipment(records) {
  return distinctSorted(records.map((r) => r.equipment));
}
export function knownCategories(records) {
  return distinctSorted(records.map((r) => r.category));
}

function distinctSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

/**
 * 嚴重度分級規則（依耗時，分鐘）：
 *   <=10  輕微
 *   11-15 一般
 *   16-20 嚴重
 *   >20   重大
 * 這條規則的值最終會被寫進紀錄本身（severity 欄位），不是即時算出來顯示用—
 * 所以規則以後就算調整，舊紀錄的意義不會被追溯改變。
 */
export function severityFromDuration(minutes) {
  if (minutes <= 10) return "輕微";
  if (minutes <= 15) return "一般";
  if (minutes <= 20) return "嚴重";
  return "重大";
}

/**
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {"all"|"month"|"week"} range
 * @param {Date} now - 注入目前時間，方便測試（避免測試依賴真實系統時鐘）
 */
export function withinRange(dateStr, range, now = new Date()) {
  if (!range || range === "all") return true;
  const d = new Date(`${dateStr}T00:00:00`);
  if (range === "week") {
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
    return d >= monday && d <= now;
  }
  if (range === "month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  return true;
}

function rankBy(records, keyFn, weight) {
  const map = new Map();
  const order = [];
  for (const r of records) {
    const key = keyFn(r);
    if (!map.has(key)) {
      map.set(key, { label: key, count: 0, minutes: 0 });
      order.push(key);
    }
    const entry = map.get(key);
    entry.count += 1;
    entry.minutes += r.duration;
  }
  return order
    .map((k) => map.get(k))
    .sort((a, b) => (weight === "count" ? b.count - a.count : b.minutes - a.minutes));
}

/**
 * @param {Array} allRecords - 完整紀錄陣列（含已刪除的）
 * @param {"all"|"month"|"week"} range
 * @param {Date} now
 */
export function aggregate(allRecords, range = "all", now = new Date()) {
  const active = allRecords.filter((r) => !r.deleted && withinRange(r.date, range, now));

  const totalEvents = active.length;
  const totalMinutes = active.reduce((s, r) => s + r.duration, 0);
  const withPhoto = active.filter((r) => (r.photos || []).length > 0).length;
  const avg = totalEvents ? totalMinutes / totalEvents : 0;

  const equipmentRanked = rankBy(active, (r) => r.equipment, "minutes");
  const categoryRanked = rankBy(active, (r) => r.category, "count");
  const problemRanked = rankBy(active, (r) => r.problem, "count");

  const severityCounts = SEVERITY_ORDER.map((s) => {
    const rows = active.filter((r) => r.severity === s);
    return { label: s, count: rows.length, minutes: rows.reduce((sum, r) => sum + r.duration, 0) };
  });
  const statusCounts = STATUS_ORDER.map((s) => {
    const rows = active.filter((r) => r.status === s);
    return { label: s, count: rows.length, minutes: rows.reduce((sum, r) => sum + r.duration, 0) };
  });

  const byDate = new Map();
  for (const r of active) {
    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, minutes: 0, count: 0 });
    const entry = byDate.get(r.date);
    entry.minutes += r.duration;
    entry.count += 1;
  }
  const trend = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

  const trackingRows = active.filter((r) => r.status === "追蹤中");
  const trackingMinutes = trackingRows.reduce((s, r) => s + r.duration, 0);
  const rootCauseMissing = active.filter((r) => r.status !== "已解決" && !r.rootCause).length;

  return {
    totalEvents,
    totalMinutes,
    withPhoto,
    avg,
    equipmentRanked,
    categoryRanked,
    problemRanked,
    severityCounts,
    statusCounts,
    trend,
    trackingRows,
    trackingMinutes,
    rootCauseMissing,
  };
}
