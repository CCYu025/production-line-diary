/*
 * 開機畫面的時間軸與文字（docs/os-mode-spec.md §5.5、D3；X2）：純函式，3D 層每幀以「距開機開始的毫秒」呼叫。
 *  B2 BIOS 自檢文字逐行出現（只有完整開機）→ B3 一條亮線展開成全畫面 → B4 線框由中心向外描繪。
 *  短開機只有 B3＋B4（BOOT_SHORT）。B1（PRESS ANY KEY）留到 X4。
 * 所有時間取自 transition/timing.ts 的 BOOT_FULL／BOOT_SHORT。
 */
import { BOOT_FULL, BOOT_SHORT } from "../transition/timing";
import type { BootKind } from "../director/boot";

export interface BootFrame {
  /** 要不要畫 BIOS 文字（B2） */
  biosOn: boolean;
  /** B2 已出現的行數 */
  biosLines: number;
  /** BIOS 最後一行後面的游標 ▮ 是否亮 */
  cursorOn: boolean;
  /** 傳給著色器 */
  reveal: number;
  band: number;
  bandMix: number;
  /** 開機是否已播完 */
  done: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 亮線最細的半高（uv 單位）：約一條掃描線 */
export const BAND_MIN = 0.004;

/** B2 的逐行節奏：n 行平均分在 B2 區間（最後一行在 B2 結束前也已出現 BIOS_HOLD_MS 以上）。 */
export function biosVisibleLines(elapsedMs: number, total: number): number {
  const span = BOOT_FULL.B2[1] - BOOT_FULL.B2[0];
  const step = span / (total + 1);
  return Math.max(0, Math.min(total, Math.floor(elapsedMs / step) + 1));
}

/** 開機第 elapsedMs 毫秒的畫面參數。 */
export function bootFrame(kind: BootKind, elapsedMs: number, biosTotal: number): BootFrame {
  const t = BOOT_TIMES[kind];
  const done = elapsedMs >= t.total;
  const base = { biosOn: false, biosLines: 0, cursorOn: false, reveal: 1, band: -1, bandMix: 0, done };
  if (done) return base;
  if (kind === "full" && elapsedMs < BOOT_FULL.B2[1]) {
    return { ...base, biosOn: true, biosLines: biosVisibleLines(elapsedMs, biosTotal), cursorOn: Math.floor(elapsedMs / 250) % 2 === 0, reveal: 1 };
  }
  if (elapsedMs < t.B3[1]) {
    // B3：亮線從一條掃描線高展開到全畫面，亮度後半段退回背景（B4 開始時畫面和背景相同）
    const x = clamp01((elapsedMs - t.B3[0]) / (t.B3[1] - t.B3[0]));
    return { ...base, reveal: 0, band: BAND_MIN + (1.02 - BAND_MIN) * easeOut(x), bandMix: 1 - smooth(0.55, 1, x) };
  }
  // B4：線框由中心向外描繪
  const x = clamp01((elapsedMs - t.B4[0]) / (t.B4[1] - t.B4[0]));
  return { ...base, reveal: easeInOut(x) };
}

const BOOT_TIMES = {
  full: { total: BOOT_FULL.total, B3: BOOT_FULL.B3, B4: BOOT_FULL.B4 },
  short: { total: BOOT_SHORT.total, B3: BOOT_SHORT.B3, B4: BOOT_SHORT.B4 },
} as const;

export interface BootCounts {
  /** 機台數／紀錄數；資料還沒載入是 null（畫面顯示「---」，之後的幀會用真實數字取代） */
  machines: number | null;
  records: number | null;
}

/** B2 的 BIOS 文字（真實的機台數與紀錄數）。 */
export function biosLines(c: BootCounts): string[] {
  return [
    "PLD/OS 1995 BIOS",
    "MEMORY TEST ... 640K OK",
    `EQUIPMENT ... ${c.machines ?? "---"} UNITS`,
    `RECORDS ... ${c.records ?? "---"}`,
    "LOADING CONTROL ROOM ...",
  ];
}

/** 內容鍵：沒變就不重畫、不重傳貼圖。 */
export function biosKey(frame: BootFrame, c: BootCounts): string {
  return `${frame.biosLines}|${frame.cursorOn ? 1 : 0}|${c.machines ?? "-"}|${c.records ?? "-"}`;
}

export interface BiosColors {
  page: string;
  accent: string;
  ink: string;
}

/** 把 BIOS 文字畫進 w×h 的 2D canvas（與場景緩衝同尺寸，最近鄰放大）。 */
export function drawBios(canvas: HTMLCanvasElement, colors: BiosColors, frame: BootFrame, counts: BootCounts): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = colors.page;
  ctx.fillRect(0, 0, w, h);
  const size = Math.max(8, Math.round(h / 22));
  ctx.font = `500 ${size}px 'IBM Plex Mono', monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = biosLines(counts);
  const lead = Math.round(size * 1.5);
  const x = Math.round(w * 0.06);
  let y = Math.round(h * 0.08);
  for (let i = 0; i < Math.min(frame.biosLines, lines.length); i++) {
    ctx.fillStyle = i === 0 ? colors.accent : colors.ink;
    const last = i === frame.biosLines - 1;
    ctx.fillText(lines[i]! + (last && frame.cursorOn ? " ▮" : ""), x, y);
    y += lead;
  }
}
