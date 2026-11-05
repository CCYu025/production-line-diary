/*
 * 轉場疊層（docs/os-mode-spec.md §3.4、§5.2–5.4；X3）：兩個全螢幕 <canvas>，pointer-events: none、aria-hidden，沒有轉場時 display:none。
 *  - #os-overlay：640×360 低解析度（CSS 最近鄰放大）——台標卡外框、雜訊、撕裂、滾動、離開的亮線亮點（painter.ts）。
 *  - #os-overlay-tag：裝置解析度——頻道小標 CH-0x（由螢幕中央縮到右上角真實台標的位置，誤差 ≤ 2px）。
 * 不擷取網頁畫面。減少動態效果：不畫任何幀（kind 本來就是 null；執行中切換時立刻取消）。
 * 繪製細節在 painter.ts，時間排程在 choreo.ts（純函式）；這裡只負責建立／清理與閒置時預熱。
 */
import * as React from "react";
import type { ChannelId } from "../channels";
import { parseCssColor, readOsColors, readToken } from "../colors";
import { A_ZONE } from "../crt/zones";
import type { CrtLevel } from "../crt/settings";
import type { TransitionClock } from "../director/useDirector";
import { faceRectAt } from "../hub/faceRect";
import { switchNoise, type Rect } from "./choreo";
import { dbgEnd, transitionDebugEnabled } from "./debug";
import { getNoiseBuf, measureTagRatio, OVERLAY_H, OVERLAY_W, OverlayPainter, runWarmFrame, type OverlayKind, type OverlayPalette } from "./painter";
import { SWITCH } from "./timing";

export { OVERLAY_H, OVERLAY_W };
export type { OverlayKind, OverlayPalette };

export function readPalette(): OverlayPalette {
  const c = readOsColors();
  return {
    page: parseCssColor(c.page),
    line: parseCssColor(c.line),
    lineStrong: parseCssColor(c.lineStrong),
    accent: parseCssColor(c.accent),
    tag: parseCssColor(readToken("--accent-text") || c.accent),
    ink: parseCssColor(c.ink),
  };
}

/** 短轉場的雜訊不透明度（t 為毫秒）：0 到交接點完全不透明、到 150ms 為 0.85、之後不透明度與顆粒強度一起淡到 0（最後 60ms 乾淨）。 */
export function switchNoiseAlpha(t: number): number {
  return switchNoise(t).opacity;
}

/** 短轉場是否還要在雜訊底下畫目的地的台標卡（只到交接點為止；之後下面是真正的工作站）。 */
export function switchShowsCard(t: number): boolean {
  return t >= 0 && t < SWITCH.handoff;
}

/** 台標層的畫布尺寸＝視窗 × min(dpr, 2)；尺寸不同才設（設尺寸會重置狀態並重新配置）。 */
export function prepareTagCanvas(c: HTMLCanvasElement | null, vw: number, vh: number): CanvasRenderingContext2D | null {
  if (!c) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(vw * dpr));
  const h = Math.max(1, Math.round(vh * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c.getContext("2d");
}

/** 讀工作站右上角真實台標的矩形（CSS 像素）。只在交接點由繪製器呼叫一次。 */
function readTagRect(): Rect | null {
  const el = document.querySelector('[data-os="tag"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

export interface TransitionOverlayProps {
  kind: OverlayKind | null;
  /** 每段轉場唯一的世代（導演的 gen；沒有轉場是 -1）：轉場中又換路由會直接接上同種類的下一段，要重新開始繪製 */
  gen: number;
  clock: TransitionClock;
  /** 台標卡上的文字，例如 `CH-02 RECORDS`（切換時是目的地頻道） */
  cardText: string;
  /** 進入推近的目標螢幕（選中的頻道）與 CRT 強度：決定 E1 結束時螢幕面的投影矩形與拖尾 */
  channel: ChannelId;
  level: CrtLevel;
  /** 減少動態效果：不畫任何幀 */
  reduced: boolean;
}

export function TransitionOverlay({ kind, gen, clock, cardText, channel, level, reduced }: TransitionOverlayProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const tagRef = React.useRef<HTMLCanvasElement>(null);
  const latest = React.useRef({ cardText, channel, level });
  latest.current = { cardText, channel, level };
  const active = !!kind && !reduced;

  // 驗證用掛鉤（?osdebug=transition）：掛載就安裝，驗證腳本在第一段轉場之前就拿得到
  React.useEffect(() => {
    transitionDebugEnabled();
  }, []);

  // 控制室閒置時預熱：雜訊緩衝（含亂數池）、台標層畫布（裝置解析度）、台標字型量測，再用真正的繪製路徑在兩個畫布上各畫幾個代表幀
  // （runWarmFrame：配置 2D 畫布後端、熱 JIT 與字型），每個閒置回呼只畫一幀；進入轉場開始那一刻不建立、不第一次執行任何東西。
  // 減少動態效果時疊層永遠不畫，不預熱。
  React.useEffect(() => {
    if (kind || reduced) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    const hasIdle = typeof w.requestIdleCallback === "function";
    let handle = 0;
    let cancelled = false;
    let i = 0;
    const schedule = (fn: () => void) => {
      if (hasIdle) handle = w.requestIdleCallback!(fn, { timeout: 1500 });
      else handle = window.setTimeout(fn, 200);
    };
    const step = () => {
      if (cancelled) return;
      let done = true;
      try {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const { cardText: text, level: lv } = latest.current;
        const [tag = "", ...rest] = text.split(" ");
        if (i === 0) {
          void document.fonts?.load?.('600 14px "IBM Plex Mono"').catch(() => {});
          void document.fonts?.load?.('700 30px "IBM Plex Mono"').catch(() => {});
          getNoiseBuf();
        }
        const tc = prepareTagCanvas(tagRef.current, vw, vh);
        if (i === 0 && tc) measureTagRatio(tc, tag);
        const ctx = ref.current?.getContext("2d") ?? null;
        done = ctx ? runWarmFrame(i, { ctx, tagCtx: tc, level: lv, palette: readPalette(), tag, code: rest.join(" "), viewport: { w: vw, h: vh } }) : true;
        i++;
      } catch {
        /* 沒有 2D canvas（測試環境）：進入轉場開始時再建 */
        done = true;
      }
      if (!done) schedule(step);
    };
    schedule(step);
    return () => {
      cancelled = true;
      if (hasIdle) w.cancelIdleCallback?.(handle);
      else window.clearTimeout(handle);
    };
  }, [kind, reduced, cardText]);

  React.useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.style.display = "";
    if (!kind || reduced) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { cardText: text, channel: ch, level: lv } = latest.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const [tag = "", ...rest] = text.split(" ");
    const painter = new OverlayPainter(ctx, prepareTagCanvas(tagRef.current, vw, vh), {
      kind,
      level: lv,
      palette: readPalette(),
      tag,
      code: rest.join(" "),
      clock,
      viewport: { w: vw, h: vh },
      faceRect: kind === "enter" ? faceRectAt(vw / Math.max(1, vh), ch, 1, A_ZONE[lv].effects ? A_ZONE[lv].barrel : 0) : null,
      readTagRect,
    });
    painter.start();
    return () => {
      painter.stop();
      dbgEnd();
    };
  }, [kind, gen, clock, reduced]);

  return (
    <>
      <canvas
        ref={ref}
        id="os-overlay"
        data-os="overlay"
        data-active={active ? "true" : "false"}
        width={OVERLAY_W}
        height={OVERLAY_H}
        aria-hidden="true"
      />
      <canvas ref={tagRef} id="os-overlay-tag" data-os="overlay-tag" data-active={active ? "true" : "false"} width={1} height={1} aria-hidden="true" />
    </>
  );
}
