/*
 * 轉場驗證用的量測掛鉤（X3）：網址帶 ?osdebug=transition（可與其他旗標用逗號並列）時，window.__osTransition() 回傳目前這段轉場的快照；
 * 沒有旗標時 enabled() 是 false，所有 dbg* 函式第一行就返回（零成本，不配置、不讀 DOM）。
 *
 * 快照欄位（獨立驗證者用）：
 *   kind/tMs            目前轉場種類與距開始的毫秒（沒有轉場時 kind＝null）
 *   overlayFrames       疊層實際畫過的幀數（reduced motion 必須是 0；E1／離開 X4 沒有疊層繪製也不算）
 *   overlayFrameTimes   每次疊層繪製的幀間隔（毫秒）
 *   hubFrameTimes       進出轉場期間 3D 迴圈每一幀的間隔（毫秒）：驗收「沒有任何一幀 > 33ms」看這個
 *   faceRect            螢幕面目前的投影矩形（視窗比例）；cardFrame 是疊層目前的卡片外框（視窗比例）
 *   tagTarget/tagRect   交接點讀到的真實台標矩形（CSS 像素）與疊層台標目前的矩形
 *   camera              鏡頭位置／看向點與進度 p
 *   cleanTail           最後 60ms 疊層是否完全清空（已清空旗標）
 */
import type { Rect } from "./choreo";

export type DebugKind = "enter" | "exit" | "switch";

export interface TransitionDebugSnapshot {
  kind: DebugKind | null;
  tMs: number;
  overlayFrames: number;
  overlayFrameTimes: number[];
  hubFrameTimes: number[];
  faceRect: Rect | null;
  cardFrame: Rect | null;
  tagTarget: Rect | null;
  tagRect: Rect | null;
  camera: { position: [number, number, number]; lookAt: [number, number, number]; progress: number } | null;
  cleanTail: boolean;
  reduced: boolean;
}

declare global {
  interface Window {
    /** ?osdebug=transition 時的轉場量測快照（驗證用） */
    __osTransition?: () => TransitionDebugSnapshot;
  }
}

const MAX_SAMPLES = 400;
let on: boolean | null = null;
let snap: TransitionDebugSnapshot | null = null;

function fresh(): TransitionDebugSnapshot {
  return { kind: null, tMs: 0, overlayFrames: 0, overlayFrameTimes: [], hubFrameTimes: [], faceRect: null, cardFrame: null, tagTarget: null, tagRect: null, camera: null, cleanTail: false, reduced: false };
}

export function transitionDebugEnabled(): boolean {
  if (on === null) {
    try {
      on = (new URLSearchParams(window.location.search).get("osdebug") ?? "").split(",").includes("transition");
    } catch {
      on = false;
    }
    if (on) {
      snap = fresh();
      window.__osTransition = () => JSON.parse(JSON.stringify(snap)) as TransitionDebugSnapshot;
    }
  }
  return on;
}

/** 測試用：丟掉快取的旗標與快照。 */
export function resetTransitionDebugForTest(): void {
  on = null;
  snap = null;
  delete window.__osTransition;
}

/** 一段轉場開始：清空計數。 */
export function dbgBegin(kind: DebugKind, reduced = false): void {
  if (!transitionDebugEnabled() || !snap) return;
  snap = { ...fresh(), kind, reduced };
}

/** 一段轉場結束（疊層卸載）：保留計數供事後讀取，只把 kind 設回 null。 */
export function dbgEnd(): void {
  if (!snap) return;
  snap.kind = null;
}

export function dbgTime(tMs: number): void {
  if (snap) snap.tMs = tMs;
}

export function dbgOverlayFrame(dtMs: number, cleanTail: boolean): void {
  if (!snap) return;
  snap.overlayFrames++;
  if (snap.overlayFrameTimes.length < MAX_SAMPLES) snap.overlayFrameTimes.push(Math.round(dtMs * 100) / 100);
  snap.cleanTail = cleanTail;
}

export function dbgHubFrame(dtMs: number): void {
  if (snap && snap.hubFrameTimes.length < MAX_SAMPLES) snap.hubFrameTimes.push(Math.round(dtMs * 100) / 100);
}

export function dbgSet(patch: Partial<TransitionDebugSnapshot>): void {
  if (snap) Object.assign(snap, patch);
}
