/*
 * 雷達台光點（docs/os-mode-spec.md §4.3–4.4）：純函式。
 * - 光點：近 7 天（本機日期的今天往前 6 天，共 7 天）有未刪除紀錄的機台各一個。
 * - 顏色鍵：該機台（7 天內）最嚴重的「未解決」（狀態不是已解決）紀錄的嚴重度；全部已解決＝dim。
 *     輕微→good、一般→warning、嚴重→serious、重大→critical、dim→--ink-muted（全部已解決：呼叫端把它往 --page 混 DIM_BLIP_MIX 當作安靜但看得見的顏色；呼叫端以 readToken 取色，不寫死色碼）。
 * - 位置：機台名稱的穩定雜湊 → 角度 0..2π、半徑 0.35..0.9（占雷達半徑的比例），每次開啟位置相同。
 * - 新異常：進入 HUB 時看到的最大 id 為基準；之後出現、id 大於基準的未刪除紀錄。第一次載入不算。
 */
import { SEVERITY_ORDER, toISODate } from "@shared/aggregate";
import type { DiaryRecord, Severity } from "@/lib/types";

export const RADAR_WINDOW_DAYS = 7;
/** 已解決光點的顏色＝--page 往 --ink-muted 混的比例：亮度約為嚴重度色的 2/3（40% 與 50% 在 CRT 掃描線與暗角下的 1px 細線實測仍太暗，故取 0.7） */
export const DIM_BLIP_MIX = 0.7;
export const RADAR_RADIUS_MIN = 0.35;
export const RADAR_RADIUS_MAX = 0.9;

export type BlipColorKey = "good" | "warning" | "serious" | "critical" | "dim";

/** 顏色鍵 → Cyber token 名稱（--good／--warning／--serious／--critical／--ink-muted）。 */
export const BLIP_TOKEN: Record<BlipColorKey, string> = {
  good: "--good",
  warning: "--warning",
  serious: "--serious",
  critical: "--critical",
  dim: "--ink-muted",
};

export const SEVERITY_KEY: Record<Severity, Exclude<BlipColorKey, "dim">> = {
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

/** 角度與半徑各用一個獨立的雜湊（不同的 FNV 起始值），F3／K1／M9 這種相近名稱才不會擠在一起。 */
export const HASH_SEED_ANGLE = 0x811c9dc5;
export const HASH_SEED_RADIUS = 0x9e3779b1;

/** 32 位元 FNV-1a ＋ murmur3 的 fmix32 終結混合（讓相近名稱 F1／F2 也分散）。穩定、與平台無關；seed 是 FNV 的起始值。 */
export function hashName(name: string, seed: number = HASH_SEED_ANGLE): number {
  let h = seed >>> 0;
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
  const a = hashName(name, HASH_SEED_ANGLE) / 0x100000000;
  const r = hashName(name, HASH_SEED_RADIUS) / 0x100000000;
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

/* ---------- PPI 雷達：掃描點亮＋餘暉（X2） ---------- */

/** 掃描一圈的秒數與角速度（rad/s） */
export const SWEEP_PERIOD_S = 4;
export const SWEEP_OMEGA = (Math.PI * 2) / SWEEP_PERIOD_S;
/** 掃描線尾跡楔形長度（弧度）：與最慢的光點餘暉（tau 0.45s，約 1.3s 後幾乎消失）視覺一致 */
export const SWEEP_TAU_S = 0.45;
export const WEDGE_SPAN_S = 1.3;

/** 光點分級（由顏色鍵決定）：resolved＝全部已解決；normal＝輕微／一般；serious；critical */
export type BlipTier = "resolved" | "normal" | "serious" | "critical";

export interface TierParams {
  /** 餘暉指數衰減時間常數（秒） */
  tau: number;
  /** 兩次掃描之間的底光（0＝完全看不見） */
  floor: number;
  /** 掃描線掃過時發出一圈擴張的 ping 環 */
  ping: boolean;
  /** 菱形鎖定框（持續存在，慢速閃爍） */
  lock: boolean;
}

export const TIER_PARAMS: Record<BlipTier, TierParams> = {
  resolved: { tau: 0.3, floor: 0, ping: false, lock: false },
  normal: { tau: SWEEP_TAU_S, floor: 0, ping: false, lock: false },
  serious: { tau: SWEEP_TAU_S, floor: 0.15, ping: true, lock: false },
  critical: { tau: SWEEP_TAU_S, floor: 0.15, ping: true, lock: true },
};

export function tierOf(key: BlipColorKey): BlipTier {
  switch (key) {
    case "dim":
      return "resolved";
    case "good":
    case "warning":
      return "normal";
    case "serious":
      return "serious";
    case "critical":
      return "critical";
  }
}

/** 嚴重度 → 顏色鍵（新異常的外圈顏色用） */
export function severityColorKey(s: Severity): Exclude<BlipColorKey, "dim"> {
  return SEVERITY_KEY[s];
}

const TAU2 = Math.PI * 2;
export function wrapAngle(a: number): number {
  return ((a % TAU2) + TAU2) % TAU2;
}

/** 掃描線經過光點方位角之後經過的秒數：t = ((sweep - blip) mod 2π) / ω（0..週期）。 */
export function secondsSinceSweep(sweepAngle: number, blipAngle: number): number {
  return wrapAngle(sweepAngle - blipAngle) / SWEEP_OMEGA;
}

/** 磷光衰減：剛被掃過＝1，exp(-t/tau)。 */
export function phosphor(tSince: number, tau: number): number {
  return Math.exp(-Math.max(0, tSince) / tau);
}

/** 低於這個亮度視為完全熄滅（避免殘留的 0.001 讓畫面「看起來有點亮」） */
const INVISIBLE_BELOW = 0.02;

/** 光點亮度 0..1（只有顏色／不透明度，不動幾何）：掃描點亮後衰減，不低於該分級的底光。 */
export function blipBrightness(tier: BlipTier, sweepAngle: number, blipAngle: number): number {
  const p = TIER_PARAMS[tier];
  const d = phosphor(secondsSinceSweep(sweepAngle, blipAngle), p.tau);
  return Math.max(p.floor, d < INVISIBLE_BELOW ? 0 : d);
}

/** 柔和的開／關閃爍（不是硬閃）：hz 次/秒，亮度在 lo..1 之間，近似方波但邊緣是平滑的。 */
export function blinkLevel(tSec: number, hz: number, lo = 0): number {
  const s = 0.5 + 0.8 * Math.sin(TAU2 * hz * tSec);
  return lo + (1 - lo) * Math.min(1, Math.max(0, s));
}

export const ALERT_BLINK_HZ = 2;
export const LOCK_BLINK_HZ = 1;
export const PING_MS = 500;
/** 外圈慢速呼吸的週期（秒） */
export const ALERT_RING_PERIOD_S = 2.4;

/** 掃描線這一幀是否掃過了方位角（prev→cur，單位弧度，可以是未包裹的累積角）。間隔超過半圈（例如分頁被擱置）視為沒掃過。 */
export function sweepCrossed(prev: number, cur: number, target: number): boolean {
  const d = wrapAngle(cur - prev);
  if (d === 0 || d > Math.PI) return false;
  return wrapAngle(target - prev) <= d && wrapAngle(target - prev) > 0;
}

export interface BlipFrame {
  /** 0..1：顏色往 --page 混的程度的反面（1＝完整顏色） */
  brightness: number;
  /** 鎖定框不透明度（0＝不顯示） */
  lock: number;
  /** 未確認警示：框要加粗（減少動態效果時取代閃爍） */
  thick: boolean;
}

/**
 * 一個光點在某一刻的外觀（純函式）。
 * - 一般：掃描點亮＋餘暉。
 * - 未確認警示（alert）：以 2Hz 閃爍，兩次掃描之間也看得見。
 * - 重大：鎖定框持續存在，以 1Hz 柔和閃爍。
 * - 減少動態效果：亮度固定 1、不閃爍；重大的框常亮；未確認警示用較粗的常亮框。
 */
export function blipFrame(tier: BlipTier, sweepAngle: number, blipAngle: number, alert: boolean, tSec: number, reduced: boolean): BlipFrame {
  const lockTier = TIER_PARAMS[tier].lock;
  if (reduced) return { brightness: 1, lock: lockTier || alert ? 1 : 0, thick: alert };
  let brightness = blipBrightness(tier, sweepAngle, blipAngle);
  if (alert) brightness = Math.max(brightness, blinkLevel(tSec, ALERT_BLINK_HZ, 0.1));
  return { brightness, lock: lockTier ? blinkLevel(tSec, LOCK_BLINK_HZ, 0.2) : 0, thick: false };
}
