/*
 * 螢幕貼圖（docs/os-mode-spec.md §4.3–4.4；X2）：每台螢幕一張 2D canvas。
 * 版面：上方頻道代號（粗體、大）、中央大字（即時訊號）、下方短的英文大寫標籤（PENDING／TODAY／MONTH／TRASH／UNITS；READY 沒有標籤）。
 * 不放小的中文：3D 場景只渲染在 640×360（濃：426×240）的低解析度，小字讀不出來；中文名稱在 HUD 按鈕上。
 * 這是唯一允許的貼圖。只在內容鍵（signalKey）改變時重畫，絕不每幀畫；選中與否由材質顏色（亮度 100%／60%）決定，不重畫。
 * CH-03 的 READY 後面的 ▮ 不畫進貼圖，而是獨立小網格切換可見性，所以閃爍不會重新上傳貼圖。
 */
import type { Channel } from "../channels";
import type { ChannelSignal } from "./signals";

export const TEX_W = 256;
export const TEX_H = 192;
/** 未選中螢幕的亮度 */
export const UNSELECTED_BRIGHTNESS = 0.6;

export interface ScreenColors {
  page: string;
  accent: string;
  ink: string;
}

/** ▮ 游標在貼圖座標（像素）的位置與大小；沒有游標的頻道回傳 null。 */
export interface CursorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FONT = "'IBM Plex Mono', 'Noto Sans TC', monospace";

/** 版面常數（貼圖像素）：測試與游標網格共用。字級在 640×360 的低解析度下仍要讀得出來（每台螢幕只有約 60–70 像素寬）。 */
export const SCREEN_LAYOUT = {
  /** 頻道代號 */
  codeY: 36,
  codeSize: 50,
  /** 中央大字：最大字級與可用寬度（超過就縮小） */
  bigY: 104,
  bigSize: 104,
  bigMaxWidth: 224,
  /** READY（較長，字級小一些）與游標 */
  readySize: 58,
  cursorGap: 8,
  /** 下方標籤 */
  labelY: 160,
  labelSize: 38,
  smallSize: 30,
} as const;

/** 畫一張螢幕；回傳 ▮ 游標的矩形（CH-03）或 null。getContext 不可用（jsdom）回傳 null。 */
export function drawMonitorScreen(canvas: HTMLCanvasElement, colors: ScreenColors, ch: Channel, sig: ChannelSignal): CursorRect | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const L = SCREEN_LAYOUT;
  ctx.fillStyle = colors.page;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, TEX_W - 12, TEX_H - 12);

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  // 頻道代號
  ctx.fillStyle = colors.accent;
  ctx.font = `700 ${L.codeSize}px ${FONT}`;
  ctx.fillText(ch.id, TEX_W / 2, L.codeY);

  let cursor: CursorRect | null = null;
  if (sig.big !== null) {
    const ready = sig.blinkCursor;
    ctx.fillStyle = colors.accent;
    let size: number = ready ? L.readySize : L.bigSize;
    ctx.font = `700 ${size}px ${FONT}`;
    const w0 = ctx.measureText(sig.big).width;
    const gap = ready ? L.cursorGap : 0;
    const cursorW = ready ? Math.round(size * 0.5) : 0;
    const avail = L.bigMaxWidth - gap - cursorW;
    if (w0 > avail) {
      size = Math.floor((size * avail) / w0);
      ctx.font = `700 ${size}px ${FONT}`;
    }
    const textW = ctx.measureText(sig.big).width;
    // READY 與 ▮ 一起置中：文字往左挪半個游標
    const cx = TEX_W / 2 - (ready ? (gap + Math.round(size * 0.5)) / 2 : 0);
    ctx.fillText(sig.big, cx, L.bigY);
    if (ready) cursor = { x: cx + textW / 2 + gap, y: L.bigY - size * 0.42, w: Math.round(size * 0.5), h: Math.round(size * 0.84) };
  }
  if (sig.caption !== null) {
    ctx.fillStyle = colors.ink;
    ctx.font = `700 ${L.labelSize}px ${FONT}`;
    if (sig.small !== null) {
      // 標籤＋小字（CH-04：TODAY 3）一起置中
      const lw = ctx.measureText(sig.caption).width;
      ctx.font = `700 ${L.smallSize}px ${FONT}`;
      const sw = ctx.measureText(sig.small).width;
      const total = lw + 12 + sw;
      const x0 = (TEX_W - total) / 2;
      ctx.textAlign = "left";
      ctx.font = `700 ${L.labelSize}px ${FONT}`;
      ctx.fillText(sig.caption, x0, L.labelY);
      ctx.fillStyle = colors.accent;
      ctx.font = `700 ${L.smallSize}px ${FONT}`;
      ctx.fillText(sig.small, x0 + lw + 12, L.labelY + 2);
    } else {
      ctx.fillText(sig.caption, TEX_W / 2, L.labelY);
    }
  }
  return cursor;
}
