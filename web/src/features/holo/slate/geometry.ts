/*
 * 終端板定位的純邏輯（docs/holo-mode-spec.md §3.3 方法 P：投影定位）。沒有 three／DOM 依賴。
 *  - 終端板放在錨點右邊（放不下改左邊），垂直置中於錨點；最後夾在畫面內，至少留 24px 邊距。
 *  - 位移小於 0.5px 不寫 DOM。
 *  - 寫入的位置對齊到裝置像素（避免文字落在半個像素上變糊）。
 */

export const SLATE_MARGIN = 24;
export const SLATE_GAP = 56;
export const SLATE_MOVE_EPS = 0.5;

export interface Pt {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}

export function placeSlate(anchor: Pt, slate: Size, viewport: Size, margin = SLATE_MARGIN, gap = SLATE_GAP): Pt {
  let x = anchor.x + gap;
  if (x + slate.w > viewport.w - margin) x = anchor.x - gap - slate.w;
  let y = anchor.y - slate.h / 2;
  const maxX = viewport.w - margin - slate.w;
  const maxY = viewport.h - margin - slate.h;
  // 板子比可用空間大：貼著左／上邊距（內容捲動由板子自己處理）
  x = Math.max(margin, Math.min(x, Math.max(margin, maxX)));
  y = Math.max(margin, Math.min(y, Math.max(margin, maxY)));
  return { x, y };
}

export function movedEnough(prev: Pt | null, next: Pt, eps = SLATE_MOVE_EPS): boolean {
  if (!prev) return true;
  return Math.abs(next.x - prev.x) >= eps || Math.abs(next.y - prev.y) >= eps;
}

/** 對齊到裝置像素 */
export function snapToDevicePixel(p: Pt, dpr: number): Pt {
  return { x: Math.round(p.x * dpr) / dpr, y: Math.round(p.y * dpr) / dpr };
}
