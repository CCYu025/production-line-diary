/*
 * 螢幕貼圖（docs/os-mode-spec.md §4.3–4.4；X2）：每台螢幕一張 2D canvas，上方頻道代號＋名稱，中央大字（即時訊號）。
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

/** 版面常數（貼圖像素）：測試與游標網格共用。 */
export const SCREEN_LAYOUT = { bigY: 108, bigSize: 64, readySize: 46, cursorGap: 8 } as const;

/** 畫一張螢幕；回傳 ▮ 游標的矩形（CH-03）或 null。getContext 不可用（jsdom）回傳 null。 */
export function drawMonitorScreen(canvas: HTMLCanvasElement, colors: ScreenColors, ch: Channel, sig: ChannelSignal): CursorRect | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = colors.page;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, TEX_W - 12, TEX_H - 12);

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = colors.accent;
  ctx.font = `700 16px ${FONT}`;
  ctx.fillText(`${ch.id}  ${ch.code}`, 16, 24);
  ctx.fillStyle = colors.ink;
  ctx.font = `500 16px ${FONT}`;
  ctx.fillText(ch.name, 16, 46);

  let cursor: CursorRect | null = null;
  ctx.textAlign = "center";
  if (sig.big !== null) {
    const ready = sig.blinkCursor;
    const size = ready ? SCREEN_LAYOUT.readySize : SCREEN_LAYOUT.bigSize;
    ctx.fillStyle = colors.accent;
    ctx.font = `700 ${size}px ${FONT}`;
    const gap = ready ? SCREEN_LAYOUT.cursorGap : 0;
    const textW = ctx.measureText(sig.big).width;
    const cursorW = ready ? Math.round(size * 0.5) : 0;
    // READY 與 ▮ 一起置中：文字往左挪半個游標
    const cx = TEX_W / 2 - (ready ? (gap + cursorW) / 2 : 0);
    ctx.fillText(sig.big, cx, SCREEN_LAYOUT.bigY);
    if (ready) {
      cursor = { x: cx + textW / 2 + gap, y: SCREEN_LAYOUT.bigY - size * 0.42, w: cursorW, h: Math.round(size * 0.84) };
    }
  } else if (sig.blinkCursor) {
    // 理論上不會發生（CH-03 永遠有 READY）；保險
    cursor = null;
  }
  if (sig.caption !== null) {
    ctx.fillStyle = colors.ink;
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText(sig.caption, TEX_W / 2, 158);
  }
  return cursor;
}
