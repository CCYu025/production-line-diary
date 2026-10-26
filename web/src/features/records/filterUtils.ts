import { datePresets, emptyFilter, facetCounts } from "@shared/aggregate";
import type { DiaryRecord, RecordFilter } from "@/lib/types";

/** 逐位打字時，每一位都會觸發一次 change（0002 → 0020 → 0202 → 2026）；年份不到 1900 的中間值直接忽略。空字串（清除）算合理。 */
export function plausibleDate(v: string): boolean {
  return v === "" || Number(v.slice(0, 4)) >= 1900;
}

/** 不是今年的日期要帶年份，不然「10/15」可能是別年的。 */
export function mdLabel(iso: string, now: Date = new Date()): string {
  return (iso.slice(0, 4) === String(now.getFullYear()) ? "" : `${iso.slice(0, 4)}/`) + iso.slice(5).replace("-", "/");
}

/** 日期篩選按鈕／chip 上的文字；沒有日期條件回傳 ""。符合快捷（今天、本週…）就顯示快捷名稱。 */
export function dateLabel(f: Pick<RecordFilter, "from" | "to">, now: Date = new Date()): string {
  if (!f.from && !f.to) return "";
  const preset = datePresets(now).find((p) => p.id !== "all" && p.from === f.from && p.to === f.to);
  if (preset) return preset.label;
  if (f.from === f.to) return mdLabel(f.from, now);
  return `${f.from ? mdLabel(f.from, now) : "…"}–${f.to ? mdLabel(f.to, now) : "…"}`;
}

/** 起 > 迄：只提示、列表為空；不自動改另一端。 */
export function isDateRangeReversed(f: Pick<RecordFilter, "from" | "to">): boolean {
  return !!(f.from && f.to && f.from > f.to);
}

/**
 * 多選下拉（設備、分類）的選項：已知清單（meta，含目前沒有紀錄的值）∪ 資料裡出現過的 ∪ 已選的。
 * 依「全部紀錄中的總筆數」由多到少排，順序不會因為套用其他條件而跳動（才不會一勾選就整串跳動）。
 */
export function multiOptions(
  key: "equipment" | "category",
  known: readonly string[],
  active: readonly DiaryRecord[],
  selected: readonly string[],
): string[] {
  const totals = facetCounts(active, emptyFilter(), key);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...known, ...Object.keys(totals), ...selected]) {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0) || a.localeCompare(b, "zh-Hant"));
}

/** 詳情面板的上一筆／下一筆順序：全部「有效」紀錄的時間順序（舊 → 新），不跟列表的篩選或排序方向。 */
export function chronological(list: readonly DiaryRecord[]): DiaryRecord[] {
  return list.slice().sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`) || a.id - b.id);
}
