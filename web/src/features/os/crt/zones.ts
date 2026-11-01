/*
 * CRT 強度對應各區的參數（docs/os-mode-spec.md §4.7）：純資料與純函式。
 *  A 區（3D 控制室、開機、疊層）：著色器管線讀 A_ZONE；切換強度時管線依 lowHeight 重建／縮放離屏緩衝，不得洩漏 render target。
 *  B 區（HUD 外框、狀態列、工作站 CRT 外框）：CSS 疊層，條紋週期用 bZoneVars 以整數「裝置像素」計算。
 *  C 區（工作站內容）：任何強度都清晰，沒有參數。
 */
import type { CrtLevel } from "./settings";

export interface AZoneParams {
  /** 離屏低解析度的高度（寬度依長寬比；16:9 時 off／std＝640×360、max＝426×240） */
  lowHeight: number;
  /** 16:9 時的低解析度寬度（文件與測試用；實際寬度由管線依視窗長寬比算） */
  lowWidth16x9: number;
  /** 是否做著色器效果（桶狀、色偏、掃描線、映像管紋理、暈開、暗角、閃爍）。off＝只有低解析度放大，直接輸出 */
  effects: boolean;
  /** 螢光暈開的疊加強度（0＝不做模糊 pass；1＝目前；max＝1.5 倍） */
  bloom: number;
  /** 暗角強度（四角變暗比例；目前 0.25，max＝1.5 倍） */
  vignette: number;
  /** 桶狀弧面的邊緣最大位移（目前 0.03，max＝1.5 倍） */
  barrel: number;
}

/** 目前（X0／X1）的著色器常數：標準強度＝這組值。 */
export const A_ZONE_STD_BASE = { bloom: 1, vignette: 0.25, barrel: 0.03 } as const;
/** 濃：暈開、暗角、弧面各約 1.5 倍。 */
export const A_ZONE_MAX_SCALE = 1.5;

export const A_ZONE: Record<CrtLevel, AZoneParams> = {
  off: { lowHeight: 360, lowWidth16x9: 640, effects: false, bloom: 0, vignette: 0, barrel: 0 },
  std: { lowHeight: 360, lowWidth16x9: 640, effects: true, ...A_ZONE_STD_BASE },
  max: {
    lowHeight: 240,
    lowWidth16x9: 426,
    effects: true,
    bloom: A_ZONE_STD_BASE.bloom * A_ZONE_MAX_SCALE,
    vignette: A_ZONE_STD_BASE.vignette * A_ZONE_MAX_SCALE,
    barrel: A_ZONE_STD_BASE.barrel * A_ZONE_MAX_SCALE,
  },
};

/** 低解析度寬度（依視窗長寬比，無條件捨去使 16:9 剛好是 640／426；至少 16）。 */
export function lowWidthFor(level: CrtLevel, aspect: number): number {
  return Math.max(16, Math.floor(A_ZONE[level].lowHeight * aspect + 1e-6));
}

/* ---------- B 區 ---------- */

/** 無效的 devicePixelRatio（0、負、NaN、Infinity）一律當 1。 */
export function sanitizeDpr(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/**
 * Trinitron 式紅綠藍直條的週期（整數裝置像素）：3 的倍數（R、G、B 各占整數裝置像素），
 * 大小跟著 dpr 成長，視覺上接近 3 個 CSS 像素。dpr 1→3、1.25→3、1.5→6、2→6、3→9。
 */
export function stripePeriodDevicePx(dpr: number): number {
  return 3 * Math.max(1, Math.round(sanitizeDpr(dpr)));
}

/** 水平掃描線的週期（整數裝置像素，偶數）：約 4 個 CSS 像素。 */
export function scanPeriodDevicePx(dpr: number): number {
  const px = Math.max(2, Math.round(4 * sanitizeDpr(dpr)));
  return px % 2 === 0 ? px : px + 1;
}

/** 整數裝置像素換成 CSS 像素（瀏覽器乘回 dpr 後剛好是整數裝置像素）。 */
export function devicePxToCss(devicePx: number, dpr: number): number {
  return devicePx / sanitizeDpr(dpr);
}

export interface BZoneVars {
  /** `--os-crt-stripe`：條紋週期（CSS px 字串，例如 "2.4px"） */
  "--os-crt-stripe": string;
  /** `--os-crt-scan`：掃描線週期 */
  "--os-crt-scan": string;
  /** `--os-crt-stripe-a`／`--os-crt-scan-a`：條紋與掃描線的不透明度 */
  "--os-crt-stripe-a": string;
  "--os-crt-scan-a": string;
}

/** B 區疊層的不透明度：關＝無疊層（呼叫端不渲染）、標準＝淡、濃＝加深。 */
export const B_ZONE_ALPHA: Record<Exclude<CrtLevel, "off">, { stripe: number; scan: number }> = {
  std: { stripe: 0.04, scan: 0.06 },
  max: { stripe: 0.08, scan: 0.12 },
};

/** B 區疊層的 CSS 變數；off 回傳 null（不渲染疊層）。dpr 改變時重算。 */
export function bZoneVars(level: CrtLevel, dpr: number): BZoneVars | null {
  if (level === "off") return null;
  const a = B_ZONE_ALPHA[level];
  return {
    "--os-crt-stripe": `${devicePxToCss(stripePeriodDevicePx(dpr), dpr)}px`,
    "--os-crt-scan": `${devicePxToCss(scanPeriodDevicePx(dpr), dpr)}px`,
    "--os-crt-stripe-a": String(a.stripe),
    "--os-crt-scan-a": String(a.scan),
  };
}
