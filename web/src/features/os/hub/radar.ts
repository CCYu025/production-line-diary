/*
 * 雷達台光點（docs/os-mode-spec.md §4.3–4.4）：純函式。
 * - 光點：近 7 天（本機日期的今天往前 6 天，共 7 天）有未刪除紀錄的機台各一個。
 * - 顏色鍵：該機台（7 天內）最嚴重的「未解決」（狀態不是已解決）紀錄的嚴重度；全部已解決＝dim。
 *     輕微→good、一般→warning、嚴重→serious、重大→critical、dim→--line（呼叫端以 readToken 取色，不寫死色碼）。
 * - 位置：機台名稱的穩定雜湊 → 角度 0..2π、半徑 0.35..0.9（占雷達半徑的比例），每次開啟位置相同。
 * - 新異常：進入 HUB 時看到的最大 id 為基準；之後出現、id 大於基準的未刪除紀錄。第一次載入不算。
 */
import { SEVERITY_ORDER, toISODate } from "@shared/aggregate";
import type { DiaryRecord, Severity } from "@/lib/types";

export const RADAR_WINDOW_DAYS = 7;
export const RADAR_RADIUS_MIN = 0.35;
export const RADAR_RADIUS_MAX = 0.9;

export type BlipColorKey = "good" | "warning" | "serious" | "critical" | "dim";

/** 顏色鍵 → Cyber token 名稱（--good／--warning／--serious／--critical／--line）。 */
export const BLIP_TOKEN: Record<BlipColorKey, string> = {
  good: "--good",
  warning: "--warning",
  serious: "--serious",
  critical: "--critical",
  dim: "--line",
};

const SEVERITY_KEY: Record<Severity, Exclude<BlipColorKey, "dim">> = {
  輕微: "good",
  一般: "warning",
  嚴重: "serious",
  重大: "critical",
};

export interface Blip {
  machine: string;
  /** 弧度 0..2π（0＝右方，逆時針；場景自行決定座標軸） */
  angle: number;
  /** 占雷達半徑的比例 RADAR_RADIUS_MIN..RADAR_RADIUS_MAX */
  radius: number;
  colorKey: BlipColorKey;
  /** 7 天內該機台的紀錄筆數 */
  count: number;
}

/** 32 位元 FNV-1a ＋ murmur 終結混合（讓相近名稱 F1／F2 也分散）。穩定、與平台無關。 */
export function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 機台名稱 → 角度與半徑（穩定）。 */
export function blipPosition(name: string): { angle: number; radius: number } {
  const h = hashName(name);
  const a = (h & 0xffff) / 0x10000;
  const r = (h >>> 16) / 0x10000;
  return { angle: a * Math.PI * 2, radius: RADAR_RADIUS_MIN + r * (RADAR_RADIUS_MAX - RADAR_RADIUS_MIN) };
}

/** 7 天視窗的起日（含）與迄日（含），本機日期 YYYY-MM-DD。 */
export function radarWindow(now: Date): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (RADAR_WINDOW_DAYS - 1));
  return { from: toISODate(from), to: toISODate(now) };
}

function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export function computeBlips(records: readonly DiaryRecord[] | undefined, now: Date): Blip[] {
  if (!records) return [];
  const { from, to } = radarWindow(now);
  const byMachine = new Map<string, DiaryRecord[]>();
  for (const r of records) {
    if (r.deleted || !r.equipment || r.date < from || r.date > to) continue;
    const list = byMachine.get(r.equipment);
    if (list) list.push(r);
    else byMachine.set(r.equipment, [r]);
  }
  const blips: Blip[] = [];
  for (const [machine, list] of byMachine) {
    let worst: Severity | null = null;
    for (const r of list) {
      if (r.status === "已解決") continue;
      if (worst === null || severityRank(r.severity) > severityRank(worst)) worst = r.severity;
    }
    blips.push({ machine, ...blipPosition(machine), colorKey: worst ? SEVERITY_KEY[worst] : "dim", count: list.length });
  }
  return blips.sort((a, b) => a.machine.localeCompare(b.machine, "zh-Hant"));
}

/* ---------- 新異常 ---------- */

export interface AnomalyTracker {
  /** 進入 HUB 時看到的最大 id；null＝還沒有基準（資料還沒載入完） */
  baseline: number | null;
}

/** 進入 HUB 時建立（每次進入 HUB 都重建）。 */
export function newAnomalyTracker(): AnomalyTracker {
  return { baseline: null };
}

/**
 * 觀察一次資料更新。records 為 undefined 或 settled 為 false（還在抓）時不動：
 * 進入 HUB 時快取可能是舊的、馬上會被新資料取代，基準要取「抓完的第一份」，才不會把進入前就存在的紀錄當成新異常。
 * 第一份抓完的資料只設基準（第一次載入不算新異常）；之後 id 大於基準的未刪除紀錄＝新異常，並把基準推到目前最大 id（不重複報）。
 */
export function observeAnomalies(
  tracker: AnomalyTracker,
  records: readonly DiaryRecord[] | undefined,
  settled: boolean,
): { tracker: AnomalyTracker; fresh: DiaryRecord[] } {
  if (!records || !settled) return { tracker, fresh: [] };
  const maxId = records.reduce((m, r) => (r.id > m ? r.id : m), 0);
  if (tracker.baseline === null) return { tracker: { baseline: maxId }, fresh: [] };
  if (maxId <= tracker.baseline) return { tracker, fresh: [] };
  const base = tracker.baseline;
  const fresh = records.filter((r) => r.id > base && !r.deleted);
  return { tracker: { baseline: maxId }, fresh };
}

/** 新異常的光點應脈衝的機台（去重；只含目前有光點的機台）。 */
export function pulseMachines(fresh: readonly DiaryRecord[], blips: readonly Blip[]): string[] {
  const have = new Set(blips.map((b) => b.machine));
  return Array.from(new Set(fresh.map((r) => r.equipment))).filter((m) => have.has(m));
}

/**
 * aria-live polite 公告：一筆「新紀錄：F3（嚴重）」；多筆取最嚴重的一筆加總數「新紀錄 3 筆：F3（嚴重）等」。沒有新異常回傳 null。
 */
export function anomalyAnnouncement(fresh: readonly DiaryRecord[]): string | null {
  if (fresh.length === 0) return null;
  let top = fresh[0]!;
  for (const r of fresh) if (severityRank(r.severity) > severityRank(top.severity)) top = r;
  const one = `${top.equipment}（${top.severity}）`;
  return fresh.length === 1 ? `新紀錄：${one}` : `新紀錄 ${fresh.length} 筆：${one}等`;
}

/**
 * 光點相對雷達中心的位置（單位＝雷達半徑的比例，x 向右、z 向前方鏡頭為正）：
 * 角度 0＝右方、逆時針（從上往下看，-z 是上方），與掃描線的旋轉同向。
 */
export function blipLocalUnit(b: Pick<Blip, "angle" | "radius">): { x: number; z: number } {
  return { x: Math.cos(b.angle) * b.radius, z: -Math.sin(b.angle) * b.radius };
}
