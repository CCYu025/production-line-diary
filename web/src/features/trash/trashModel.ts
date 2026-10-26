import type { DiaryRecord } from "@/lib/types";

/** 回收桶的列：已軟刪除的紀錄，依「日期＋時間」由舊到新（與舊 UI 的 chronological 相同）。 */
export function trashRows(records: readonly DiaryRecord[]): DiaryRecord[] {
  return records
    .filter((r) => r.deleted)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id - b.id);
}

/** ISO 時間 → 「M/D HH:MM」（本地時間）。沒有時間或無法解析回空字串。 */
export function formatDeletedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
