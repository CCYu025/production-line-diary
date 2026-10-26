import { toISODate } from "@shared/aggregate";
import type { DiaryRecord, RankEntry } from "@/lib/types";
import { isRealIsoDate } from "@/lib/utils";
import { chronological } from "@/features/records/filterUtils";

/*
 * 列印報表的純函式（不碰 React／DOM）：預設日期、選紀錄、排行表（前 5 名＋其他）、日期分組、照片格 class。
 * 規則全部來自切換前的舊 UI（已移除，函式是 reportRankHtml／reportRecordsHtml／reportRecordHtml／initReportView，可查 git 歷史），
 * 行為必須一致；對應的測試在 reportModel.test.ts。
 */

export const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** 排行表只列前幾名，其餘併成「其他 n 項」 */
export const RANK_TOP = 5;

/** 照片格最多排到 n6（超過 6 張仍用 n6 的 3 欄格子，自然往下排） */
export const PHOTO_GRID_MAX = 6;

export interface ReportRange {
  start: string;
  end: string;
}

/**
 * 預設日期＝今天的「本地」日期（起迄都是今天）。
 * 不能用 `toISOString().slice(0, 10)`：那是 UTC，台灣 00:00–08:00 會變成昨天（WP1a 的 B3）。
 */
export function defaultReportRange(now: Date = new Date()): ReportRange {
  const today = toISODate(now);
  return { start: today, end: today };
}


/**
 * 網址上的 `?from=YYYY-MM-DD&to=YYYY-MM-DD`：兩個都有、格式正確、起 <= 迄才算（否則 null，不自動產生）。
 * 報表的範圍放在網址上，瀏覽器上一頁／下一頁、離開再回來才能還原報表（舊 UI 切頁後還在）。
 */
export function parseReportRangeParams(params: URLSearchParams): ReportRange | null {
  const start = params.get("from") ?? "";
  const end = params.get("to") ?? "";
  if (!isRealIsoDate(start) || !isRealIsoDate(end) || start > end) return null;
  return { start, end };
}

/**
 * 網址上兩個日期都是真實存在的日期、但起 > 迄：回傳原樣的值（不自動產生、也不換成別的範圍）。
 * 頁面會顯示和按「產生報表」時相同的驗證訊息，輸入框保留網址上的值讓使用者自己改。
 */
export function reversedReportRangeParams(params: URLSearchParams): ReportRange | null {
  const start = params.get("from") ?? "";
  const end = params.get("to") ?? "";
  return isRealIsoDate(start) && isRealIsoDate(end) && start > end ? { start, end } : null;
}

/** 起訖驗證；回傳要顯示給使用者的錯誤訊息，沒問題回 null（訊息與舊 UI 相同）。 */
export function validateReportRange({ start, end }: ReportRange): string | null {
  if (!start || !end) return "請選擇起訖日期";
  if (start > end) return "起始日期不能晚於結束日期";
  return null;
}

/** 範圍內「有效」（未軟刪除）的紀錄，依時間排序（舊 → 新）。 */
export function selectReportRecords(all: readonly DiaryRecord[], { start, end }: ReportRange): DiaryRecord[] {
  return chronological(all.filter((r) => !r.deleted && r.date >= start && r.date <= end));
}

export function rangeLabel({ start, end }: ReportRange): string {
  return start === end ? start : `${start} ～ ${end}`;
}

/** 「產出時間」：M/D HH:MM（本地時間），與舊 UI 的 fmtDateTime 相同。 */
export function formatGeneratedAt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface RankRow {
  /** 名次（兩位數，如 "01"）；「其他」列沒有 */
  rank: string;
  label: string;
  count: number;
  /** 占全部事件數的百分比（四捨五入的整數） */
  pct: number;
  minutes: number;
  /** 細條寬度（占「最大那列」的百分比，至少 6）；「其他」列沒有細條 */
  barPct: number | null;
  isRest: boolean;
}

export interface RankTable {
  /** 全部項目數（不是只有列出的） */
  totalItems: number;
  /** 有被併進「其他」的項目數 */
  restItems: number;
  /** 前 RANK_TOP 名 */
  top: RankRow[];
  /** 「其他 n 項」那一列；沒有超過 RANK_TOP 就是 null */
  rest: RankRow | null;
}

/**
 * 統計區的「排行表」：依次數排序（同次數比累計耗時）、只列前 5 名，其餘併成「其他 n 項」。
 * 占比＝該項次數 ÷ 全部事件數；累計耗時＝該項所有事件的耗時加總。
 * `aggregate()` 回傳的 equipmentRanked 預設是依分鐘排序，所以這裡自己重排，呼叫端不要直接拿來用。
 */
export function buildRankTable(rows: readonly RankEntry[], total: number): RankTable {
  const sorted = rows.slice().sort((a, b) => b.count - a.count || b.minutes - a.minutes);
  const topRows = sorted.slice(0, RANK_TOP);
  const restRows = sorted.slice(RANK_TOP);
  const max = topRows.length ? (topRows[0] as RankEntry).count : 1;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const top: RankRow[] = topRows.map((r, i) => ({
    rank: String(i + 1).padStart(2, "0"),
    label: r.label,
    count: r.count,
    pct: pct(r.count),
    minutes: r.minutes,
    barPct: Math.max(6, Math.round((r.count / max) * 100)),
    isRest: false,
  }));

  let rest: RankRow | null = null;
  if (restRows.length) {
    const count = restRows.reduce((s, r) => s + r.count, 0);
    rest = {
      rank: "",
      label: `其他 ${restRows.length} 項`,
      count,
      pct: pct(count),
      minutes: restRows.reduce((s, r) => s + r.minutes, 0),
      barPct: null,
      isRest: true,
    };
  }
  return { totalItems: sorted.length, restItems: restRows.length, top, rest };
}

export interface DayGroup {
  date: string;
  records: DiaryRecord[];
}

/** 依日期把（已依時間排序的）紀錄分組，保持順序。 */
export function groupByDay(records: readonly DiaryRecord[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const r of records) {
    const last = groups[groups.length - 1];
    if (last && last.date === r.date) last.records.push(r);
    else groups.push({ date: r.date, records: [r] });
  }
  return groups;
}

/** 日期分組標題：「10/26（週一）」＋「3 筆・累計 55 分」。只有報表跨多天時才會用到。 */
export function dayHeader(group: DayGroup): { title: string; summary: string } {
  const d = new Date(`${group.date}T00:00:00`);
  const minutes = group.records.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
  return {
    title: `${d.getMonth() + 1}/${d.getDate()}（週${WEEKDAY[d.getDay()]}）`,
    summary: `${group.records.length} 筆・累計 ${minutes} 分`,
  };
}

/** 照片格的 class：n1…n6（1／2／3 欄的格子）。沒有照片回 null。 */
export function photoGridClass(count: number): string | null {
  return count > 0 ? `n${Math.min(count, PHOTO_GRID_MAX)}` : null;
}
