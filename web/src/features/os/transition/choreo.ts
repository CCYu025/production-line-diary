/*
 * 轉場編排（docs/os-mode-spec.md §5.2–5.4；X3 第 2 部分）：純函式，全部是「時間 t（毫秒，相對轉場開始）」的函式，
 * 不依賴 DOM／three，疊層繪製器、鏡頭與單元測試共用。時間 token 一律來自 timing.ts，這裡不新增任何時間常數的總長。
 */
import { ENTER, EXIT, SWITCH } from "./timing";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });
export const easeInCubic = (x: number) => x * x * x;
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** 區間 [a, b] 內的進度 0..1（區間外夾在 0／1）。 */
export const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** 雜訊最後這麼久（毫秒）完全乾淨：雜訊不透明度與顆粒強度都是 0（修 X0「淡出太弱」）。 */
export const NOISE_CLEAN_TAIL_MS = 60;

export type TransitionKind = "enter" | "exit" | "switch";

/* ---------- 台標卡外框（E2） ---------- */

/** 疊層內部解析度（640×360）。卡片外框的最終位置＝四周各留 24 像素。 */
export const CARD_W = 640;
export const CARD_H = 360;
export const CARD_MARGIN = 24;
/** 台標卡外框的終點（視窗比例）：E2 結束（750ms）後的位置，也是短轉場台標卡的位置。 */
export const CARD_FRAME_FULL: Rect = { x: CARD_MARGIN / CARD_W, y: CARD_MARGIN / CARD_H, w: 1 - (2 * CARD_MARGIN) / CARD_W, h: 1 - (2 * CARD_MARGIN) / CARD_H };

/**
 * 進入轉場第 t 毫秒的卡片外框（視窗比例）：E1 結束（600ms）的位置＝螢幕面的投影矩形 start（不跳）；
 * E2（600–750）ease-out 展開到 CARD_FRAME_FULL。t 在 E2 之前回傳 start。
 */
export function cardFrameRect(t: number, start: Rect): Rect {
  const k = span(t, ENTER.E2[0], ENTER.E2[1]);
  return k <= 0 ? start : k >= 1 ? CARD_FRAME_FULL : lerpRect(start, CARD_FRAME_FULL, easeOutCubic(k));
}

/* ---------- signal lock 格子 ---------- */

export const LOCK_CELLS = 4;
/** 各格亮起的時間（毫秒，相對轉場開始）；第 4 格在 E4 開始（訊號鎖定）時亮。 */
export const ENTER_LOCK_AT: readonly number[] = [625, 675, 725, ENTER.E4[0]];
/** 短轉場：前 3 格在交接點之前依序亮，第 4 格在訊號鎖定開始（150ms）時亮。 */
export const SWITCH_LOCK_AT: readonly number[] = [0, 25, 50, SWITCH.lock[0]];

/** 第 t 毫秒亮著幾格（0..4）。離開轉場沒有 signal lock。 */
export function lockCells(kind: TransitionKind, t: number): number {
  if (kind === "exit") return 0;
  const at = kind === "enter" ? ENTER_LOCK_AT : SWITCH_LOCK_AT;
  let n = 0;
  for (const a of at) if (t >= a) n++;
  return n;
}

/* ---------- 雜訊：不透明度與顆粒強度 ---------- */

export interface NoiseLevel {
  /** 雜訊層不透明度 0..1 */
  opacity: number;
  /** 顆粒強度 0..1（雜訊的對比；0＝只剩一層 --page 色） */
  grain: number;
}

const NONE: NoiseLevel = { opacity: 0, grain: 0 };

/**
 * 進入轉場的雜訊：E3 開始 0.55 → 交接點前 60ms 升到 1（把「換成真實工作站」遮住）→ 交接點後 20ms 起 0.85；
 * E4 開始（1000ms）不透明度與顆粒強度「一起」線性淡到 0，在總長減 NOISE_CLEAN_TAIL_MS（1140ms）達到 0，之後完全乾淨。
 */
export function enterNoise(t: number): NoiseLevel {
  if (t < ENTER.E3[0] || t >= ENTER.total - NOISE_CLEAN_TAIL_MS) return NONE;
  const base = t < ENTER.handoff - 60 ? 0.55 + 0.45 * span(t, ENTER.E3[0], ENTER.handoff - 60) : t < ENTER.handoff + 20 ? 1 : 0.85;
  const fade = 1 - span(t, ENTER.E4[0], ENTER.total - NOISE_CLEAN_TAIL_MS);
  return { opacity: base * fade, grain: fade };
}

/** 短轉場的雜訊：0 到交接點 1、到 150ms 為 0.85、150ms 起不透明度與顆粒強度一起淡到 0（總長減 60ms＝240ms 達到 0）。 */
export function switchNoise(t: number): NoiseLevel {
  if (t < 0 || t >= SWITCH.total - NOISE_CLEAN_TAIL_MS) return NONE;
  const base = t < SWITCH.handoff ? 1 : 0.85;
  const fade = 1 - span(t, SWITCH.lock[0], SWITCH.total - NOISE_CLEAN_TAIL_MS);
  return { opacity: base * fade, grain: fade };
}

/* ---------- 水平撕裂帶與垂直滾動 ---------- */

/** 32 位元整數雜湊 → 0..1（決定性：同一組輸入永遠同一個值）。 */
export function hash01(a: number, b = 0): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export interface TearBand {
  /** 帶的上緣與高度（占疊層高度的比例） */
  y: number;
  h: number;
  /** 位移振幅（疊層像素）與方向 */
  amp: number;
  sign: 1 | -1;
}

/** 撕裂帶的數量：3–5（由 seed 決定，決定性）。 */
export function tearCount(seed: number): number {
  return 3 + Math.floor(hash01(seed, 101) * 3);
}

/** 撕裂帶（決定性）：互不重疊、由上到下排序。 */
export function tearBands(seed: number): TearBand[] {
  const n = tearCount(seed);
  const slot = 1 / n;
  const out: TearBand[] = [];
  for (let i = 0; i < n; i++) {
    const h = 0.04 + hash01(seed, 200 + i) * 0.08;
    const y = i * slot + hash01(seed, 300 + i) * (slot - h);
    out.push({ y, h, amp: 30 + hash01(seed, 400 + i) * 80, sign: hash01(seed, 500 + i) < 0.5 ? -1 : 1 });
  }
  return out;
}

/** 撕裂的強度包絡：進入 E3（750–1000）1 → 0.4 再歸 0；短轉場雜訊段（0–150）1 → 0.5。其餘為 0。 */
export function tearStrength(kind: TransitionKind, t: number): number {
  if (kind === "enter") return t < ENTER.E3[0] || t >= ENTER.E3[1] ? 0 : 1 - 0.6 * span(t, ENTER.E3[0], ENTER.E3[1]);
  if (kind === "switch") return t < 0 || t >= SWITCH.noise[1] ? 0 : 1 - 0.5 * span(t, 0, SWITCH.noise[1]);
  return 0;
}

/** 撕裂帶在第 t 毫秒的水平位移（疊層像素）：位移每 33ms 換一次（決定性的抖動）。 */
export function tearDx(band: TearBand, index: number, seed: number, t: number, strength: number): number {
  if (strength <= 0) return 0;
  const step = Math.floor(t / 33);
  const j = 0.35 + 0.65 * hash01(seed * 31 + index, step);
  return Math.round(band.sign * band.amp * j * strength);
}

/** 垂直滾動：減速的一次滾動，k（0..1）時的位移占疊層高度的比例；k=1 時剛好滾完一整圈（回到 0，接縫對齊）。 */
export function rollFrac(k: number): number {
  const x = clamp01(k);
  return 1 - Math.pow(1 - x, 3);
}

/** 進入 E3 的垂直滾動位移（疊層像素，已對高度取模）。 */
export function enterRollPx(t: number, height = CARD_H): number {
  return (rollFrac(span(t, ENTER.E3[0], ENTER.E3[1])) * height) % height;
}

/* ---------- 台標（小頻道標）落點 ---------- */

export interface TagPlan {
  /** 台標開始出現在螢幕中央的時間 */
  showFrom: number;
  /** 由中央縮到右上角真實台標位置的區間；結束後疊層上的台標消失（下面的真實台標接手，最後 60ms 完全乾淨） */
  landFrom: number;
  landTo: number;
}

export const ENTER_TAG: TagPlan = { showFrom: ENTER.E2[0], landFrom: ENTER.E4[0], landTo: ENTER.total - NOISE_CLEAN_TAIL_MS };
export const SWITCH_TAG: TagPlan = { showFrom: 0, landFrom: SWITCH.lock[0], landTo: SWITCH.total - NOISE_CLEAN_TAIL_MS };

export function tagPlanOf(kind: TransitionKind): TagPlan | null {
  return kind === "enter" ? ENTER_TAG : kind === "switch" ? SWITCH_TAG : null;
}

/** 落點進度 k（0..1）的台標矩形：k=0 是 start、k=1 剛好等於 target（誤差 0）。 */
export function tagLerp(k: number, start: Rect, target: Rect): Rect {
  return k <= 0 ? start : k >= 1 ? target : lerpRect(start, target, easeOutCubic(k));
}

/** 第 t 毫秒的台標矩形；不在顯示區間 [showFrom, landTo) 內回傳 null（landTo 起疊層上沒有台標，下面的真實台標接手）。 */
export function tagRectAt(plan: TagPlan, t: number, start: Rect, target: Rect): Rect | null {
  if (t < plan.showFrom || t >= plan.landTo) return null;
  return tagLerp(span(t, plan.landFrom, plan.landTo), start, target);
}

/** 台標一開始在螢幕中央的位置（視窗 CSS 像素）：寬度由呼叫端依字型量出。 */
export function tagStartRect(vw: number, vh: number, textWidthPerPx: number): Rect {
  const h = Math.max(28, Math.round(vh * 0.085));
  const w = textWidthPerPx * h;
  return { x: vw / 2 - w / 2, y: vh * 0.4 - h / 2, w, h };
}

/** 台標與卡片文字（code／signal lock）的不透明度：卡片文字在鎖定後淡出，最後 60ms 之前就全部消失。 */
export function osdAlpha(kind: TransitionKind, t: number): number {
  if (kind === "enter") return 1 - span(t, 1060, 1130);
  if (kind === "switch") return 1 - span(t, 175, 225);
  return 0;
}

/* ---------- 離開（X1–X3） ---------- */

/** 亮線與亮點的尺寸（疊層像素） */
export const EXIT_LINE_H = 2;
export const EXIT_DOT = 6;

/** 離開時代表工作站外框範圍的亮面塊（視窗比例）：與 .os-frame 的內距（左右 10px、上 8px、下 10px）一致。 */
export function exitBlockRect(vw: number, vh: number): Rect {
  return { x: 10 / vw, y: 8 / vh, w: 1 - 20 / vw, h: 1 - 18 / vh };
}

export interface ExitGeo {
  /** 疊層像素：左上角與大小；kind 為 none 時無意義 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0＝面塊的底色、1＝白熱（壓成線之後） */
  heat: number;
  /** 整體不透明度（亮點淡出）；面塊與亮線＝1 */
  alpha: number;
  kind: "block" | "dot" | "none";
}

/**
 * 離開的亮面塊幾何（疊層像素，width×height＝疊層大小，block＝工作站外框範圍的像素矩形）：
 * X1（0–150）面塊垂直壓成亮線（ease-in）；X2（150–300）亮線水平收成亮點（ease-in）；X3（300–400）亮點淡出；之後 none。
 */
export function exitGeometry(t: number, width: number, height: number, block: Rect): ExitGeo {
  const cx = width / 2;
  const cy = height / 2;
  const bw = block.w * width;
  const bh = block.h * height;
  if (t >= EXIT.X3[1] || t < 0) return { x: cx, y: cy, w: 0, h: 0, heat: 1, alpha: 0, kind: "none" };
  if (t < EXIT.X2[0]) {
    const k = easeInCubic(span(t, EXIT.X1[0], EXIT.X1[1]));
    const h = lerp(bh, EXIT_LINE_H, k);
    return { x: cx - bw / 2, y: cy - h / 2, w: bw, h, heat: k, alpha: 1, kind: "block" };
  }
  if (t < EXIT.X3[0]) {
    const k = easeInCubic(span(t, EXIT.X2[0], EXIT.X2[1]));
    const w = lerp(bw, EXIT_DOT, k);
    const h = lerp(EXIT_LINE_H, EXIT_DOT, easeInCubic(k)); // 亮線的粗細在最後才長成點，面積只會減少
    return { x: cx - w / 2, y: cy - h / 2, w, h, heat: 1, alpha: 1, kind: k >= 1 ? "dot" : "block" };
  }
  const a = 1 - span(t, EXIT.X3[0], EXIT.X3[1]);
  return { x: cx - EXIT_DOT / 2, y: cy - EXIT_DOT / 2, w: EXIT_DOT, h: EXIT_DOT, heat: 1, alpha: a, kind: "dot" };
}
