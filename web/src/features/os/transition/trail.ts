/*
 * 2D 轉場疊層的磷光拖尾（docs/os-mode-spec.md §4.2，X3）：每幀不清掉畫面，改用 --page 色以 (1 - keep^(dt/16.67ms)) 的不透明度蓋上去，
 * 舊畫面因此指數衰減、留下短拖尾。CRT 強度「關」＝keep 0＝全清（和 X0 一樣）。純函式，與 fps 無關。
 */
import { rgbCss, type Rgb } from "../colors";
import { decayFactor, keepFor } from "../crt/phosphor";
import type { CrtLevel } from "../crt/settings";

/** 本幀蓋上 --page 的不透明度；0＝完全不蓋（不會發生，keep < 1），1＝全蓋（關）。 */
export function trailCoverAlpha(level: CrtLevel, dtMs: number): number {
  const keep = keepFor(level);
  if (keep <= 0) return 1;
  return 1 - decayFactor(keep, dtMs);
}

/**
 * 在畫新一幀之前呼叫：關＝clearRect；否則用 page 色以 trailCoverAlpha 蓋住上一幀。
 * first＝true（第一幀、或暫停後）一律全清，不拖影。
 */
export function applyTrail(ctx: CanvasRenderingContext2D, page: Rgb, level: CrtLevel, dtMs: number, w: number, h: number, first = false): void {
  const a = first ? 1 : trailCoverAlpha(level, dtMs);
  if (a >= 1) {
    ctx.clearRect(0, 0, w, h);
    return;
  }
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = a;
  ctx.fillStyle = rgbCss(page);
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = prev;
}

/**
 * 透明疊層版的拖尾：用 destination-out 把上一幀的不透明度乘上 keep^(dt/16.67ms)，向「透明」衰減（下層的畫面照常透出來）。
 * 用在疊層下面有東西要露出來的階段（離開的亮點淡出、進入交接點之後的雜訊）；CRT「關」或 first＝全清。
 * 注意：applyTrail 向 --page 色衰減，只適合疊層本來就是不透明 --page 的階段。
 */
export function applyAlphaTrail(ctx: CanvasRenderingContext2D, level: CrtLevel, dtMs: number, w: number, h: number, first = false): void {
  const a = first ? 1 : trailCoverAlpha(level, dtMs);
  if (a >= 1) {
    ctx.clearRect(0, 0, w, h);
    return;
  }
  const prevOp = ctx.globalCompositeOperation;
  const prevA = ctx.globalAlpha;
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = a;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = prevOp;
  ctx.globalAlpha = prevA;
}
