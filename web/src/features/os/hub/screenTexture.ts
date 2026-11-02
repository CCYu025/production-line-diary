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
  /** 頻道代號：粗、佔滿寬度（濃的 426×240 下一台螢幕只有約 30–40 像素寬，字要夠大） */
  codeY: 30,
  codeSize: 66,
  codeMaxWidth: 214,
  /** 中央大字：最大字級與可用寬度（超過就縮小） */
  bigY: 94,
  bigSize: 100,
  bigMaxWidth: 224,
  /** READY（較長，字級小一些）與游標 */
  readySize: 62,
  cursorGap: 8,
  /** 下方標籤：粗、盡量大（寬度內自動縮小） */
  labelY: 158,
  labelSize: 54,
  labelMaxWidth: 224,
  smallSize: 40,
  /** 字的外描邊（--page 色）：和邊框、掃描線分開，降低色偏造成的彩邊 */
  outline: 5,
} as const;
/** 粗體用 IBM Plex Mono 600（已載入的最粗字重；700 沒有載入會被瀏覽器合成假粗體而糊掉） */
const WEIGHT = 600;

/** 以最大字級畫 text，超過 maxWidth 就等比縮小；回傳實際字級與寬度。 */
function fitFont(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number): { size: number; width: number } {
  ctx.font = `${WEIGHT} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  if (w <= maxWidth) return { size, width: w };
  const s = Math.floor((size * maxWidth) / w);
  ctx.font = `${WEIGHT} ${s}px ${FONT}`;
  return { size: s, width: ctx.measureText(text).width };
}

function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, page: string): void {
  ctx.lineJoin = "round";
  ctx.lineWidth = SCREEN_LAYOUT.outline;
  ctx.strokeStyle = page;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** 畫一張螢幕；回傳 ▮ 游標的矩形（CH-03）或 null。getContext 不可用（jsdom）回傳 null。 */
export function drawMonitorScreen(canvas: HTMLCanvasElement, colors: ScreenColors, ch: Channel, sig: ChannelSignal): CursorRect | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const L = SCREEN_LAYOUT;
  ctx.fillStyle = colors.page;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(5, 5, TEX_W - 10, TEX_H - 10);

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  // 頻道代號
  const code = fitFont(ctx, ch.id, L.codeSize, L.codeMaxWidth);
  void code;
  outlined(ctx, ch.id, TEX_W / 2, L.codeY, colors.accent, colors.page);

  let cursor: CursorRect | null = null;
  if (sig.big !== null) {
    const ready = sig.blinkCursor;
    const gap = ready ? L.cursorGap : 0;
    const fit = fitFont(ctx, sig.big, ready ? L.readySize : L.bigSize, L.bigMaxWidth - gap - (ready ? Math.round(L.readySize * 0.5) : 0));
    const cursorW = ready ? Math.round(fit.size * 0.5) : 0;
    // READY 與 ▮ 一起置中：文字往左挪半個游標
    const cx = TEX_W / 2 - (ready ? (gap + cursorW) / 2 : 0);
    outlined(ctx, sig.big, cx, L.bigY, colors.accent, colors.page);
    if (ready) cursor = { x: cx + fit.width / 2 + gap, y: L.bigY - fit.size * 0.42, w: cursorW, h: Math.round(fit.size * 0.84) };
  }
  if (sig.caption !== null) {
    if (sig.small !== null) {
      // 標籤＋小字（CH-04：TODAY 3）一起置中
      const lab = fitFont(ctx, sig.caption, L.labelSize, 130);
      const lw = lab.width;
      const sm = fitFont(ctx, sig.small, L.smallSize + 8, 80);
      const total = lw + 14 + sm.width;
      const x0 = (TEX_W - total) / 2;
      ctx.textAlign = "left";
      ctx.font = `${WEIGHT} ${lab.size}px ${FONT}`;
      outlined(ctx, sig.caption, x0, L.labelY, colors.ink, colors.page);
      ctx.font = `${WEIGHT} ${sm.size}px ${FONT}`;
      outlined(ctx, sig.small, x0 + lw + 14, L.labelY, colors.accent, colors.page);
    } else {
      fitFont(ctx, sig.caption, L.labelSize, L.labelMaxWidth);
      outlined(ctx, sig.caption, TEX_W / 2, L.labelY, colors.ink, colors.page);
    }
  }
  return cursor;
}
