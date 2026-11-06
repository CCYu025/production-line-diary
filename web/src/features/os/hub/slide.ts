/*
 * E1／X4 的兩側螢幕（docs/os-mode-spec.md §5.2、§5.3；X3）：純函式。鏡頭進度 p（0＝休息、1＝推到位，來自 camera.cameraProgress）
 * 同時是側邊螢幕的滑動進度：進入時另外 6 台沿著弧線往兩側滑開並淡入霧，離開時（X4）依同一條曲線滑回。
 * 選中的那台不動。滑動只改群組的位置與朝向（沿弧線，朝向仍面向圓心），淡出只改顏色亮度（不使用透明度，所以不會觸發著色器重編譯）。
 */
import { ARC_RADIUS, arcAngleDeg } from "./layout";

/** 側邊螢幕沿弧線往外滑開的角度（度）：6 台全部滑到視野之外。 */
export const SIDE_SLIDE_DEG = 40;
/** 淡出區間（以進度 p 計）：p 在 [0.05, 0.8] 之間由 1 淡到 0，之後已完全融進霧色。 */
export const SIDE_FADE_FROM = 0.05;
export const SIDE_FADE_TO = 0.8;

const rad = (d: number) => (d * Math.PI) / 180;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 第 index 台在進度 p 時沿弧線的角度（度）；選中的那台不動。 */
export function slideAngleDeg(index: number, selected: number, p: number): number {
  const base = arcAngleDeg(index);
  if (index === selected) return base;
  return base + Math.sign(index - selected) * SIDE_SLIDE_DEG * clamp01(p);
}

export interface SlidePose {
  x: number;
  z: number;
  /** 繞 y 軸的旋轉（弧度） */
  yaw: number;
}

/** 與 layout.monitorPose 相同的公式，只是角度換成滑動後的角度（p＝0 時完全相同）。寫進 out，不配置物件。 */
export function slidePose(index: number, selected: number, p: number, out: SlidePose): SlidePose {
  const a = rad(slideAngleDeg(index, selected, p));
  out.x = ARC_RADIUS * Math.sin(a);
  out.z = ARC_RADIUS - ARC_RADIUS * Math.cos(a);
  out.yaw = -a;
  return out;
}

/** 側邊螢幕融進霧色的程度 0..1（選中的那台永遠 0）。 */
export function sideFade(index: number, selected: number, p: number): number {
  return index === selected ? 0 : smoothstep(SIDE_FADE_FROM, SIDE_FADE_TO, p);
}
