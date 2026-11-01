/*
 * 轉場疊層（docs/os-mode-spec.md §3.4、§5.2–5.3）：全螢幕 2D <canvas>，低內部解析度（640×360）、CSS 最近鄰放大，
 * pointer-events: none、aria-hidden；沒有轉場時 display:none，rAF 只在轉場期間存在。
 * 不擷取網頁畫面：進入時畫「台標卡」＋雜訊，離開時畫簡化的亮面塊壓成亮線、亮點。
 */
import * as React from "react";
import { mixRgb, parseCssColor, readOsColors, rgbCss, type Rgb } from "../colors";
import type { TransitionClock } from "../director/useDirector";
import { ENTER, EXIT, SWITCH } from "./timing";

export const OVERLAY_W = 640;
export const OVERLAY_H = 360;

export interface OverlayPalette {
  page: Rgb;
  line: Rgb;
  lineStrong: Rgb;
  accent: Rgb;
  ink: Rgb;
}

export function readPalette(): OverlayPalette {
  const c = readOsColors();
  return {
    page: parseCssColor(c.page),
    line: parseCssColor(c.line),
    lineStrong: parseCssColor(c.lineStrong),
    accent: parseCssColor(c.accent),
    ink: parseCssColor(c.ink),
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const WHITE: Rgb = [255, 255, 255];

interface Card {
  canvas: HTMLCanvasElement;
}

function makeCard(p: OverlayPalette, code: string): Card {
  const c = document.createElement("canvas");
  c.width = OVERLAY_W;
  c.height = OVERLAY_H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = rgbCss(p.page);
  ctx.fillRect(0, 0, OVERLAY_W, OVERLAY_H);
  ctx.strokeStyle = rgbCss(p.accent);
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, OVERLAY_W - 48, OVERLAY_H - 48);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = rgbCss(p.accent);
  ctx.font = "700 40px 'IBM Plex Mono', monospace";
  ctx.fillText(code, OVERLAY_W / 2, OVERLAY_H / 2 - 18);
  ctx.fillStyle = rgbCss(p.ink);
  ctx.font = "400 18px 'IBM Plex Mono', monospace";
  ctx.fillText("signal lock ▮▮▮▯", OVERLAY_W / 2, OVERLAY_H / 2 + 28);
  return { canvas: c };
}

function drawNoise(ctx: CanvasRenderingContext2D, p: OverlayPalette, alpha: number) {
  const img = ctx.createImageData(OVERLAY_W, OVERLAY_H);
  const d = img.data;
  const tint = mixRgb(p.lineStrong, p.accent, 0.5);
  const a = Math.round(255 * alpha);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random();
    const t = v * v;
    d[i] = p.page[0] + (tint[0] - p.page[0]) * t * 2.2;
    d[i + 1] = p.page[1] + (tint[1] - p.page[1]) * t * 2.2;
    d[i + 2] = p.page[2] + (tint[2] - p.page[2]) * t * 2.2;
    d[i + 3] = a;
  }
  // 疊在目前畫面上（putImageData 會取代像素，所以先用暫存 canvas）
  const tmp = document.createElement("canvas");
  tmp.width = OVERLAY_W;
  tmp.height = OVERLAY_H;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0);
}

/** 進入轉場的第 t 毫秒（E1 無疊層；E2 台標卡；E3 雜訊＋水平撕裂＋垂直滾動；E4 淡出）。 */
export function drawEnter(ctx: CanvasRenderingContext2D, p: OverlayPalette, card: Card, t: number) {
  ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
  if (t < ENTER.E2[0]) return;
  if (t < ENTER.E3[0]) {
    ctx.drawImage(card.canvas, 0, 0);
    return;
  }
  if (t < ENTER.E4[0]) {
    const k = (t - ENTER.E3[0]) / (ENTER.E3[1] - ENTER.E3[0]);
    // 垂直滾動：隨時間減弱；水平撕裂：幾條隨機橫帶左右位移
    const roll = Math.round((1 - k) * OVERLAY_H * 0.45 * Math.sin(k * 9));
    const bands = 8;
    const bh = OVERLAY_H / bands;
    for (let i = 0; i < bands; i++) {
      const dx = Math.random() < 0.5 ? Math.round((Math.random() - 0.5) * 90 * (1 - k * 0.6)) : 0;
      const sy = i * bh;
      const dy = (sy + roll + OVERLAY_H) % OVERLAY_H;
      ctx.drawImage(card.canvas, 0, sy, OVERLAY_W, bh, dx, dy, OVERLAY_W, bh);
    }
    // 雜訊在交接點（875ms）之前升到不透明，把「換成真實工作站」遮住
    const alpha = t < ENTER.handoff - 60 ? 0.55 + 0.45 * ((t - ENTER.E3[0]) / (ENTER.handoff - 60 - ENTER.E3[0])) : t < ENTER.handoff + 20 ? 1 : 0.85;
    drawNoise(ctx, p, clamp01(alpha));
    return;
  }
  // E4：雜訊淡出
  const k = clamp01((t - ENTER.E4[0]) / (ENTER.E4[1] - ENTER.E4[0]));
  drawNoise(ctx, p, 0.85 * (1 - k));
}

/** 離開轉場的第 t 毫秒。0–300ms 全面不透明 --page（控制室還沒出現）；300ms 起只剩亮點淡出。 */
export function drawExit(ctx: CanvasRenderingContext2D, p: OverlayPalette, t: number) {
  const cx = OVERLAY_W / 2;
  const cy = OVERLAY_H / 2;
  ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
  const base = mixRgb(p.page, p.accent, 0.3);
  if (t < EXIT.handoff) {
    ctx.fillStyle = rgbCss(p.page);
    ctx.fillRect(0, 0, OVERLAY_W, OVERLAY_H);
    const k1 = clamp01((t - EXIT.X1[0]) / (EXIT.X1[1] - EXIT.X1[0])); // 垂直壓扁
    const k2 = clamp01((t - EXIT.X2[0]) / (EXIT.X2[1] - EXIT.X2[0])); // 水平收成點
    const w = (OVERLAY_W * 0.92) * (1 - k2) + 8 * k2;
    const h = (OVERLAY_H * 0.9) * (1 - k1) + 3 * k1;
    const bright = mixRgb(base, WHITE, Math.max(k1, k2));
    ctx.fillStyle = rgbCss(bright);
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    return;
  }
  if (t < EXIT.X3[1]) {
    const k = clamp01((t - EXIT.X3[0]) / (EXIT.X3[1] - EXIT.X3[0]));
    ctx.fillStyle = rgbCss(WHITE, 1 - k);
    ctx.fillRect(cx - 4, cy - 2, 8, 4);
  }
}

/** 短轉場的雜訊不透明度（t 為毫秒）：0 到交接點完全不透明（遮住目的地現身）、到 150ms 為 0.85、150–300ms 淡出。 */
export function switchNoiseAlpha(t: number): number {
  if (t < 0 || t >= SWITCH.total) return 0;
  if (t < SWITCH.handoff) return 1;
  if (t < SWITCH.noise[1]) return 0.85;
  return 0.85 * (1 - clamp01((t - SWITCH.lock[0]) / (SWITCH.lock[1] - SWITCH.lock[0])));
}

/** 短轉場是否還要在雜訊底下畫目的地的台標卡（只到交接點為止；之後下面是真正的工作站）。 */
export function switchShowsCard(t: number): boolean {
  return t >= 0 && t < SWITCH.handoff;
}

/** 短轉場的第 t 毫秒（§5.4）：目的地頻道的台標卡被不透明雜訊蓋住 → 交接點後工作站現身、雜訊 0.85 → 訊號鎖定淡出。 */
export function drawSwitch(ctx: CanvasRenderingContext2D, p: OverlayPalette, card: Card, t: number) {
  ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
  const alpha = switchNoiseAlpha(t);
  if (alpha <= 0) return;
  if (switchShowsCard(t)) ctx.drawImage(card.canvas, 0, 0);
  drawNoise(ctx, p, alpha);
}

export type OverlayKind = "enter" | "exit" | "switch";

export interface TransitionOverlayProps {
  kind: OverlayKind | null;
  clock: TransitionClock;
  /** 台標卡上的文字，例如 CH-02 RECORDS（切換時是目的地頻道） */
  cardText: string;
}

export function TransitionOverlay({ kind, clock, cardText }: TransitionOverlayProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (!kind) {
      canvas.style.display = "";
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const palette = readPalette();
    const card = kind === "exit" ? null : makeCard(palette, cardText);
    const total = kind === "enter" ? ENTER.total : kind === "switch" ? SWITCH.total : EXIT.X3[1];
    canvas.style.display = "";
    let raf = 0;
    const frame = () => {
      const t = clock.start == null ? 0 : performance.now() - clock.start;
      if (kind === "enter") drawEnter(ctx, palette, card!, t);
      else if (kind === "switch") drawSwitch(ctx, palette, card!, t);
      else drawExit(ctx, palette, t);
      if (t < total) raf = requestAnimationFrame(frame);
      else if (kind === "exit") canvas.style.display = "none"; // 疊層的部分在 400ms 就結束了（鏡頭拉回到 900ms）
    };
    // 同步畫第一幀（在繪製之前）：離開時 0–300ms 要是不透明的 --page，不能有空白幀露出舊畫面
    frame();
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
    };
  }, [kind, clock, cardText]);

  return (
    <canvas
      ref={ref}
      id="os-overlay"
      data-os="overlay"
      data-active={kind ? "true" : "false"}
      width={OVERLAY_W}
      height={OVERLAY_H}
      aria-hidden="true"
    />
  );
}
