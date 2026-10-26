import { toISODate } from "@shared/aggregate";

/*
 * 日曆的純函式（不碰 React）：月份 ⇄ 網址、月曆格子、次數 → 色階。
 * 規則來自舊 UI renderCalendar：顏色深淺依「當天次數 ÷ 全部資料中單日最大次數」，不是分鐘。
 */

export interface YearMonth {
  year: number;
  /** 1–12 */
  month: number;
}

export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;
export const WEEKDAY_NAMES = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;

const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** 網址上的 `?month=YYYY-MM`。無法辨識（格式錯、月份不在 1–12、年份 < 1900）就回 null，呼叫端改用本月。 */
export function parseMonthParam(value: string | null | undefined): YearMonth | null {
  const m = MONTH_RE.exec(value ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 1900) return null;
  return { year, month };
}

export function formatMonthParam({ year, month }: YearMonth): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function monthOf(d: Date): YearMonth {
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month;
}

export function isoDate({ year, month }: YearMonth, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface CalendarCell {
  day: number;
  /** YYYY-MM-DD */
  date: string;
}

/** 以週（日～六）為列的月曆；月初前、月底後的空位是 null。 */
export function buildMonthGrid(ym: YearMonth): Array<Array<CalendarCell | null>> {
  const firstDow = new Date(ym.year, ym.month - 1, 1).getDay();
  const daysInMonth = new Date(ym.year, ym.month, 0).getDate();
  const slots: Array<CalendarCell | null> = Array.from({ length: firstDow }, () => null);
  for (let day = 1; day <= daysInMonth; day++) slots.push({ day, date: isoDate(ym, day) });
  while (slots.length % 7 !== 0) slots.push(null);
  const weeks: Array<Array<CalendarCell | null>> = [];
  for (let i = 0; i < slots.length; i += 7) weeks.push(slots.slice(i, i + 7));
  return weeks;
}

export type ColorStep = 1 | 2 | 3;

/** 色階：比例 > 0.7 最深、> 0.4 中間、其餘最淺（與舊 UI 相同的門檻）。 */
export function colorStep(count: number, max: number): ColorStep {
  const ratio = max > 0 ? count / max : 0;
  if (ratio > 0.7) return 3;
  if (ratio > 0.4) return 2;
  return 1;
}

/**
 * 每個色階的底色與文字色。文字色用「會跟著淺／深色主題翻轉」的 token，兩套主題對比度都 ≥ 4.5:1：
 *   淺色 seq-300 配 ink-1（黑）；seq-450／600 配 accent-ink（白）
 *   深色 seq-300（深藍）配 ink-1（白）；seq-450／600（亮藍）配 accent-ink（黑）
 * Tailwind 要在原始碼看得到完整 class 名稱，所以是對照表。
 */
export const STEP_CLASS: Record<ColorStep, string> = {
  1: "bg-seq-300 text-ink-1",
  2: "bg-seq-450 text-accent-ink",
  3: "bg-seq-600 text-accent-ink",
};

export function todayIso(now = new Date()): string {
  return toISODate(now);
}
