/*
 * 時間螺旋的幾何與 LOD（docs/holo-mode-spec.md §6.1；H1 雛形）。純函式，沒有 three／DOM 依賴。
 *  - 一圈 7 天、半徑 6 單位、每圈前進 4 單位；最新的紀錄在 z = 0（最前面），越舊 z 越負。
 *  - 位置由「日期＋時間」的字串解析而來：只做曆法算術（Date.UTC 只用來把 YYYY-MM-DD 轉成天數），不經過時區轉換。
 *  - 順序沿用 chronological()（和詳情的上一筆／下一筆一致）；同一天的卡片沿徑向往外疊。
 *  - LOD：游標前後 8 週完整卡片（上限 1,500）、8–52 週小方點、再外面每週一條刻度線。
 */
import { chronological } from "@/features/records/filterUtils";
import type { DiaryRecord, Severity, Status } from "@/lib/types";

export const DAYS_PER_TURN = 7;
export const SPIRAL_RADIUS = 6;
export const ADVANCE_PER_TURN = 4;
/** 同一天的第 n 張卡片比第 n-1 張往外多 STACK_STEP */
export const STACK_STEP = 0.9;
/** 一天內時間（0–1）對應的角度佔「一天的角度」的比例，讓同一天的卡片留在自己的扇形裡 */
export const DAY_SLICE_FILL = 0.8;
export const FULL_WEEKS = 8;
export const DOT_WEEKS = 52;
export const FULL_CARD_CAP = 1500;
export const CARD_MIN_WIDTH = 0.5;
export const CARD_MAX_WIDTH = 3;
export const CARD_HEIGHT = 0.7;

export const SEVERITY_INDEX: Record<Severity, number> = { 輕微: 0, 一般: 1, 嚴重: 2, 重大: 3 };
/** 狀態編碼：0 待處理、1 追蹤中、2 已解決（著色器用） */
export const STATUS_CODE: Record<Status, number> = { 待處理: 0, 追蹤中: 1, 已解決: 2 };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})/;

/** YYYY-MM-DD → 從 1970-01-01 起算的天數（純曆法；不合法回傳 NaN）。與執行環境的時區無關。 */
export function dayNumber(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return NaN;
  return Math.round(ms / 86_400_000);
}

export function dayNumberToDate(day: number): string {
  const d = new Date(day * 86_400_000);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "HH:MM" → 一天內的比例 0–1（讀不懂是 0） */
export function timeFraction(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) return 0;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return 0;
  return (h * 60 + mi) / 1440;
}

/** 耗時（分鐘）→ 卡片寬度；有下限，耗時 0 也看得到 */
export function cardWidth(duration: number): number {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return Math.min(CARD_MAX_WIDTH, Math.max(CARD_MIN_WIDTH, 0.35 + Math.sqrt(d) * 0.28));
}

export interface SpiralItem {
  id: number;
  /** 天數（dayNumber） */
  day: number;
  /** 連續時間（天，含一天內的時間） */
  t: number;
  x: number;
  y: number;
  z: number;
  /** 卡片繞 z 軸的旋轉（寬度沿切線） */
  rot: number;
  radius: number;
  stack: number;
  width: number;
  severity: number;
  status: number;
  photoCount: number;
  firstPhoto: string | null;
  date: string;
}

export interface SpiralWeek {
  /** 該週第一天的天數（從第一筆紀錄起每 7 天一格） */
  startDay: number;
  z: number;
  count: number;
}

export interface SpiralModel {
  items: SpiralItem[];
  weeks: SpiralWeek[];
  minDay: number;
  maxDay: number;
  /** 最新紀錄的連續時間（z = 0 的位置） */
  originT: number;
}

export function spiralPoint(t: number, originT: number, stack: number): { x: number; y: number; z: number; rot: number; radius: number } {
  const theta = (2 * Math.PI * t) / DAYS_PER_TURN;
  const radius = SPIRAL_RADIUS + stack * STACK_STEP;
  return { x: radius * Math.cos(theta), y: radius * Math.sin(theta), z: ((t - originT) * ADVANCE_PER_TURN) / DAYS_PER_TURN, rot: theta + Math.PI / 2, radius };
}

/** 軸線上某一天的 z（鏡頭游標用） */
export function zOfDay(day: number, originT: number): number {
  return ((day - originT) * ADVANCE_PER_TURN) / DAYS_PER_TURN;
}

export function buildSpiral(records: readonly DiaryRecord[]): SpiralModel {
  const active = chronological(records.filter((r) => !r.deleted));
  const parsed = active.map((r) => ({ r, day: dayNumber(r.date) })).filter((p) => Number.isFinite(p.day));
  if (!parsed.length) return { items: [], weeks: [], minDay: 0, maxDay: 0, originT: 0 };
  const last = parsed[parsed.length - 1]!;
  const originT = last.day + timeFraction(last.r.time) * DAY_SLICE_FILL;
  const items: SpiralItem[] = [];
  let prevDay = Number.NaN;
  let stack = 0;
  for (const { r, day } of parsed) {
    stack = day === prevDay ? stack + 1 : 0;
    prevDay = day;
    const t = day + timeFraction(r.time) * DAY_SLICE_FILL;
    const p = spiralPoint(t, originT, stack);
    items.push({
      id: r.id,
      day,
      t,
      x: p.x,
      y: p.y,
      z: p.z,
      rot: p.rot,
      radius: p.radius,
      stack,
      width: cardWidth(r.duration),
      severity: SEVERITY_INDEX[r.severity] ?? 1,
      status: STATUS_CODE[r.status] ?? 2,
      photoCount: r.photos?.length ?? 0,
      firstPhoto: r.photos?.[0] ?? null,
      date: r.date,
    });
  }
  const minDay = items[0]!.day;
  const maxDay = items[items.length - 1]!.day;
  const weeks: SpiralWeek[] = [];
  const weekCount = Math.floor((maxDay - minDay) / DAYS_PER_TURN) + 1;
  for (let i = 0; i < weekCount; i++) {
    const startDay = minDay + i * DAYS_PER_TURN;
    weeks.push({ startDay, z: zOfDay(startDay + DAYS_PER_TURN / 2, originT), count: 0 });
  }
  for (const it of items) weeks[Math.floor((it.day - minDay) / DAYS_PER_TURN)]!.count++;
  return { items, weeks, minDay, maxDay, originT };
}

/** items 以 day 遞增排列：第一個 day >= target 的索引 */
export function lowerBoundDay(items: readonly { day: number }[], target: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid]!.day < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type Range = [start: number, end: number];

export interface LodRanges {
  /** 完整卡片（已套用上限） */
  full: Range;
  dotsBefore: Range;
  dotsAfter: Range;
  /** 刻度線（weeks 的索引範圍）：游標之前的週、之後的週 */
  ticksBefore: Range;
  ticksAfter: Range;
}

export const rangeSize = (r: Range) => Math.max(0, r[1] - r[0]);

export function lodRanges(model: SpiralModel, cursorDay: number, opts: { fullWeeks?: number; dotWeeks?: number; cap?: number } = {}): LodRanges {
  const fullWeeks = opts.fullWeeks ?? FULL_WEEKS;
  const dotWeeks = opts.dotWeeks ?? DOT_WEEKS;
  const cap = opts.cap ?? FULL_CARD_CAP;
  const { items, weeks } = model;
  let fullLo = lowerBoundDay(items, cursorDay - fullWeeks * DAYS_PER_TURN);
  let fullHi = lowerBoundDay(items, cursorDay + fullWeeks * DAYS_PER_TURN + 1);
  const dotLo = lowerBoundDay(items, cursorDay - dotWeeks * DAYS_PER_TURN);
  const dotHi = lowerBoundDay(items, cursorDay + dotWeeks * DAYS_PER_TURN + 1);
  // 上限：從離游標較遠的那端往內收，被收掉的變成小方點
  while (fullHi - fullLo > cap) {
    const dLo = Math.abs(items[fullLo]!.day - cursorDay);
    const dHi = Math.abs(items[fullHi - 1]!.day - cursorDay);
    if (dLo >= dHi) fullLo++;
    else fullHi--;
  }
  // 刻度線：整週都在 dotWeeks 以外
  const beforeCut = cursorDay - dotWeeks * DAYS_PER_TURN;
  const afterCut = cursorDay + dotWeeks * DAYS_PER_TURN;
  let tb = 0;
  while (tb < weeks.length && weeks[tb]!.startDay + DAYS_PER_TURN - 1 < beforeCut) tb++;
  let ta = weeks.length;
  while (ta > tb && weeks[ta - 1]!.startDay > afterCut) ta--;
  return {
    full: [fullLo, fullHi],
    dotsBefore: [dotLo, fullLo],
    dotsAfter: [fullHi, dotHi],
    ticksBefore: [0, tb],
    ticksAfter: [ta, weeks.length],
  };
}

export const clampDay = (day: number, model: Pick<SpiralModel, "minDay" | "maxDay">) => Math.min(model.maxDay, Math.max(model.minDay, Math.round(day)));

/** 滾輪／PageUp／PageDown → 游標天數的增量。向下滾（deltaY > 0）＝往過去；Shift 一次一週。 */
export function wheelToDays(deltaY: number, shift: boolean): number {
  if (!deltaY) return 0;
  return (deltaY > 0 ? -1 : 1) * (shift ? DAYS_PER_TURN : 1);
}

export function keyToDays(key: string, shift: boolean): number {
  if (key === "PageUp") return shift ? DAYS_PER_TURN : 1;
  if (key === "PageDown") return shift ? -DAYS_PER_TURN : -1;
  return 0;
}
