/*
 * 鏡頭軌道與拖曳手勢的純邏輯（docs/holo-mode-spec.md §5.4、§5.5；H1 雛形）。沒有 three／DOM 依賴。
 *  - 拖曳：位移 ≥ DRAG_THRESHOLD_PX（4px）才算拖曳，未達就放開算點擊。
 *  - 鏡頭有旋轉（俯仰）與縮放範圍；偏航不限。
 *  - 慣性：放開後速度線性衰減，總長 ≤ INERTIA_MS（400ms）；減少動態效果時沒有慣性。
 */

export const DRAG_THRESHOLD_PX = 4;
export const INERTIA_MS = 400;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface OrbitLimits {
  minDist: number;
  maxDist: number;
  /** 俯仰（弧度）：0 是水平，正值是從上往下看 */
  minPitch: number;
  maxPitch: number;
}

export interface OrbitState {
  yaw: number;
  pitch: number;
  dist: number;
}

export function rotated(s: OrbitState, dxPx: number, dyPx: number, limits: OrbitLimits, radPerPx = 0.0058): OrbitState {
  return { yaw: s.yaw - dxPx * radPerPx, pitch: clamp(s.pitch + dyPx * radPerPx, limits.minPitch, limits.maxPitch), dist: s.dist };
}

/** 滾輪縮放：每格約 ±10%，夾在範圍內 */
export function zoomed(s: OrbitState, deltaY: number, limits: OrbitLimits): OrbitState {
  const k = Math.exp(clamp(deltaY, -400, 400) * 0.0012);
  return { ...s, dist: clamp(s.dist * k, limits.minDist, limits.maxDist) };
}

/** 右鍵平移量（世界單位）：與鏡頭距離成正比 */
export function panScale(dist: number, fovDeg: number, viewportHeightPx: number): number {
  return (2 * dist * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportHeightPx);
}

export interface Velocity {
  yaw: number;
  pitch: number;
}

/**
 * 慣性：放開當下的角速度（弧度／毫秒）在 INERTIA_MS 內線性衰減到 0。
 * 回傳這一步要旋轉的量與新的剩餘時間；reduced 或沒速度時直接結束。
 */
export function inertiaStep(v: Velocity, remainingMs: number, dtMs: number, reduced: boolean): { dYaw: number; dPitch: number; remainingMs: number } {
  if (reduced || remainingMs <= 0) return { dYaw: 0, dPitch: 0, remainingMs: 0 };
  const dt = Math.min(dtMs, remainingMs);
  const k0 = remainingMs / INERTIA_MS;
  const k1 = (remainingMs - dt) / INERTIA_MS;
  const f = ((k0 + k1) / 2) * dt; // 線性衰減的平均係數 × dt
  return { dYaw: v.yaw * f, dPitch: v.pitch * f, remainingMs: remainingMs - dt };
}

/** 最近 80ms 內的移動估算放開時的速度（弧度／毫秒） */
export class VelocityTracker {
  private samples: { t: number; yaw: number; pitch: number }[] = [];
  push(t: number, dYaw: number, dPitch: number): void {
    this.samples.push({ t, yaw: dYaw, pitch: dPitch });
    const cut = t - 80;
    while (this.samples.length > 1 && this.samples[0]!.t < cut) this.samples.shift();
  }
  release(now: number): Velocity {
    const live = this.samples.filter((s) => now - s.t <= 80);
    this.samples = [];
    if (live.length < 2) return { yaw: 0, pitch: 0 };
    const span = Math.max(16, live[live.length - 1]!.t - live[0]!.t + 16);
    return { yaw: live.reduce((a, s) => a + s.yaw, 0) / span, pitch: live.reduce((a, s) => a + s.pitch, 0) / span };
  }
  reset(): void {
    this.samples = [];
  }
}

/* ---------- 拖曳門檻 ---------- */

export type DragEvent = "none" | "start" | "move";

export class DragTracker {
  private active = false;
  private dragging = false;
  private sx = 0;
  private sy = 0;
  private lx = 0;
  private ly = 0;
  pointerId = -1;
  button = 0;

  get isActive(): boolean {
    return this.active;
  }
  get isDragging(): boolean {
    return this.dragging;
  }

  down(pointerId: number, x: number, y: number, button: number): void {
    this.active = true;
    this.dragging = false;
    this.pointerId = pointerId;
    this.button = button;
    this.sx = this.lx = x;
    this.sy = this.ly = y;
  }

  /**
   * 移動：位移達門檻才開始拖曳（回傳 "start"，此後的 move 才有位移）。
   * dx／dy 是相對上一次回報的位置（拖曳開始那一次從按下點起算，所以不會丟失門檻前的位移）。
   */
  move(x: number, y: number): { event: DragEvent; dx: number; dy: number } {
    if (!this.active) return { event: "none", dx: 0, dy: 0 };
    if (!this.dragging) {
      if (Math.hypot(x - this.sx, y - this.sy) < DRAG_THRESHOLD_PX) return { event: "none", dx: 0, dy: 0 };
      this.dragging = true;
      const r = { event: "start" as const, dx: x - this.sx, dy: y - this.sy };
      this.lx = x;
      this.ly = y;
      return r;
    }
    const r = { event: "move" as const, dx: x - this.lx, dy: y - this.ly };
    this.lx = x;
    this.ly = y;
    return r;
  }

  /** 手勢結束（任何原因）。回傳結束時是不是拖曳（不是拖曳的放開才算點擊）。一律清除狀態。 */
  end(): { wasDragging: boolean; wasActive: boolean } {
    const r = { wasDragging: this.dragging, wasActive: this.active };
    this.active = false;
    this.dragging = false;
    this.pointerId = -1;
    return r;
  }
}
