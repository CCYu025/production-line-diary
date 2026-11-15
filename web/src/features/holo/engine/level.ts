/*
 * 全像強度（docs/holo-mode-spec.md §4.2、H-D6）：讀 pld.os.crt（off｜std｜max）。
 *   關：只有線（沒有光暈、掃描線、閃爍）；標準：光暈 4px；濃：光暈 8px。
 * 減少動態效果時不閃爍、場景內隨時間流動的效果也凍結（光暈與掃描線是靜態的，照常）。純函式，方便測試。
 */
import type { CrtLevel } from "@/features/os/crt/settings";

export interface LevelParams {
  /** 光暈模糊半徑（CSS px）；0＝沒有光暈 */
  blurPx: number;
  /** 光暈疊加的強度 */
  glow: number;
  /** 掃描線強度（0–1）；週期固定 SCAN_PERIOD_PX */
  scan: number;
  /** 是否偶發閃爍 */
  flicker: boolean;
  /** 光暈取樣數 */
  taps: number;
  /** 場景裡隨時間流動的效果（例如追蹤中卡片的虛線外框）是否推進時間；減少動態效果或強度「關」時凍結 */
  animate: boolean;
}

export const SCAN_PERIOD_PX = 2;
export const SCAN_STRENGTH = 0.05;
/** 景深霧：最遠的物件保留的亮度 */
export const FOG_MIN_BRIGHTNESS = 0.15;
export const LINE_WIDTH_PX = 1.5;
export const LINE_WIDTH_SELECTED_PX = 2.5;
/** 面（薄膜）的最大不透明度 */
export const FILM_OPACITY = 0.06;
export const DPR_CAP = 1.5;

export function levelParams(level: CrtLevel, reducedMotion: boolean): LevelParams {
  switch (level) {
    case "off":
      return { blurPx: 0, glow: 0, scan: 0, flicker: false, taps: 0, animate: false };
    case "std":
      return { blurPx: 4, glow: 0.9, scan: SCAN_STRENGTH, flicker: !reducedMotion, taps: 12, animate: !reducedMotion };
    case "max":
      return { blurPx: 8, glow: 1.15, scan: SCAN_STRENGTH, flicker: !reducedMotion, taps: 16, animate: !reducedMotion };
  }
}

/** 場景動畫時間（秒）：animating 為 false 時完全不推進 */
export const advanceAnimTime = (sec: number, dtMs: number, animating: boolean) => (animating ? sec + dtMs / 1000 : sec);

export const effectiveDpr = (devicePixelRatio: number) => Math.min(DPR_CAP, Math.max(1, devicePixelRatio || 1));

/* ---------- 閃爍：每 6–12 秒一次，亮度降 8%、持續 60ms ---------- */

export const FLICKER = { minGapMs: 6000, maxGapMs: 12000, durationMs: 60, drop: 0.08 } as const;

export class FlickerClock {
  private nextAt: number;
  constructor(
    private readonly rand: () => number = Math.random,
    start = 0,
  ) {
    this.nextAt = start + this.gap();
  }
  private gap(): number {
    return FLICKER.minGapMs + this.rand() * (FLICKER.maxGapMs - FLICKER.minGapMs);
  }
  /** 這一刻的亮度倍率（1 或 0.92）。enabled=false 時一律 1，也不累積閃爍。 */
  factor(nowMs: number, enabled: boolean): number {
    if (!enabled) {
      if (nowMs >= this.nextAt) this.nextAt = nowMs + this.gap();
      return 1;
    }
    if (nowMs >= this.nextAt + FLICKER.durationMs) {
      this.nextAt = nowMs + this.gap();
      return 1;
    }
    return nowMs >= this.nextAt ? 1 - FLICKER.drop : 1;
  }
}
