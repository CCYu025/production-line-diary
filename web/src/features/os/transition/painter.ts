/*
 * 轉場疊層繪製器（docs/os-mode-spec.md §3.4、§5.2–5.4；X3 第 2 部分）。命令式、無 React：由 TransitionOverlay 在轉場開始時建立，
 * 在 requestAnimationFrame 裡每幀依「距轉場開始的毫秒 t」（choreo.ts 的純函式）畫一幀，轉場結束或卸載時清空。
 *
 * 兩個畫布：
 *  - 主疊層 640×360（A 區：低解析度、CSS 最近鄰放大）：台標卡外框、雜訊、撕裂、滾動、離開的亮線亮點。
 *  - 台標層（裝置解析度）：頻道小標 `CH-0x` 只在這一層畫。640×360 的畫布上 1 像素＝1920 寬時 3 個 CSS 像素，
 *    落地誤差 ≤ 2px 做不到，字也會糊，所以台標用裝置解析度畫，落點座標直接是 CSS 像素。
 *
 * 磷光拖尾（trail.ts）：疊層不透明（--page）的階段用 applyTrail（向 --page 衰減）；下面有東西要透出來的階段（離開亮點、
 * 進入交接點之後）改用 applyAlphaTrail 或直接清除；CRT「關」＝全清、沒有拖尾。交接點之後的雜訊不拖尾：雜訊不透明度
 * 的淡出排程（最後 60ms 為 0）必須精確，拖尾會在工作站上留下鬼影。最後 60ms 疊層與台標層都已完全清空。
 */
import { mixRgb, rgbCss, type Rgb } from "../colors";
import { keepFor } from "../crt/phosphor";
import type { CrtLevel } from "../crt/settings";
import {
  CARD_FRAME_FULL,
  CARD_H,
  CARD_W,
  cardFrameRect,
  enterNoise,
  enterRollPx,
  exitBlockRect,
  exitGeometry,
  lockCells,
  LOCK_CELLS,
  NOISE_CLEAN_TAIL_MS,
  osdAlpha,
  rollFrac,
  span,
  switchNoise,
  tagPlanOf,
  tagRectAt,
  tagStartRect,
  tearBands,
  tearDx,
  tearStrength,
  type NoiseLevel,
  type Rect,
  type TearBand,
  type TransitionKind,
} from "./choreo";
import { dbgBegin, dbgOverlayFrame, dbgSet, dbgTime, transitionDebugEnabled } from "./debug";
import { ENTER, EXIT, SWITCH } from "./timing";
import { applyAlphaTrail, applyTrail } from "./trail";

export const OVERLAY_W = CARD_W;
export const OVERLAY_H = CARD_H;

export interface OverlayPalette {
  page: Rgb;
  line: Rgb;
  lineStrong: Rgb;
  accent: Rgb;
  /** 台標文字色（--accent-text，與工作站右上角的真實台標同色） */
  tag: Rgb;
  ink: Rgb;
}

const WHITE: Rgb = [255, 255, 255];
const FONT = "'IBM Plex Mono', monospace";
const TAG_FONT_WEIGHT = 600;
/** 與 .os-tag 的 letter-spacing: 0.12em 一致 */
const TAG_SPACING_EM = 0.12;

/* ---------- 雜訊緩衝（只建一次；每幀不配置） ---------- */

interface NoiseBuf {
  tmp: HTMLCanvasElement;
  tctx: CanvasRenderingContext2D;
  img: ImageData;
  d32: Uint32Array;
  lut: Uint32Array;
}
let noiseBuf: NoiseBuf | null = null;
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** 預先建好雜訊緩衝（控制室閒置時呼叫，轉場開始那一刻不建任何東西）。沒有 2D canvas 時回傳 null。 */
export function getNoiseBuf(): NoiseBuf | null {
  if (noiseBuf) return noiseBuf;
  const tmp = document.createElement("canvas");
  tmp.width = OVERLAY_W;
  tmp.height = OVERLAY_H;
  const tctx = tmp.getContext("2d");
  if (!tctx) return null;
  const img = tctx.createImageData(OVERLAY_W, OVERLAY_H);
  noiseBuf = { tmp, tctx, img, d32: new Uint32Array(img.data.buffer), lut: new Uint32Array(256) };
  return noiseBuf;
}

const byte = (x: number) => (x < 0 ? 0 : x > 255 ? 255 : Math.round(x));
const pack = (r: number, g: number, b: number, a: number) => (LITTLE_ENDIAN ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0);

/**
 * 雜訊：xorshift32 逐像素取 8 位元亂數、查 256 項顏色表（顏色表每幀重建，只有 256 項）。
 * opacity＝整層不透明度；grain＝顆粒強度（顏色表的對比；0＝只剩一層 --page 色）。兩者由 choreo 的排程一起淡到 0。
 */
export function drawNoise(ctx: CanvasRenderingContext2D, p: OverlayPalette, tint: Rgb, opacity: number, grain: number): void {
  const nb = getNoiseBuf();
  if (!nb || opacity <= 0.004) return;
  const a = Math.round(255 * Math.min(1, opacity));
  for (let k = 0; k < 256; k++) {
    const v = k / 255;
    const t = v * v * 2.2 * grain;
    nb.lut[k] = pack(byte(p.page[0] + (tint[0] - p.page[0]) * t), byte(p.page[1] + (tint[1] - p.page[1]) * t), byte(p.page[2] + (tint[2] - p.page[2]) * t), a);
  }
  const d = nb.d32;
  const lut = nb.lut;
  let x = (Math.random() * 0xffffffff) | 1;
  for (let i = 0; i < d.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    d[i] = lut[(x >>> 24) & 255]!;
  }
  nb.tctx.putImageData(nb.img, 0, 0);
  ctx.drawImage(nb.tmp, 0, 0);
}

/* ---------- 台標文字量測（模組層級快取） ---------- */

let tagRatioCache: { text: string; ratio: number } | null = null;
let baselineRatio = 0.375;
function applyLetterSpacing(ctx: CanvasRenderingContext2D, px: number) {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(TAG_SPACING_EM * px).toFixed(3)}px`;
}
const tagFont = (px: number) => `${TAG_FONT_WEIGHT} ${px}px ${FONT}`;

/** 台標文字寬度／字高（含 letter-spacing；等寬字所以與字高成正比）。 */
export function measureTagRatio(ctx: CanvasRenderingContext2D, text: string): number {
  if (tagRatioCache && tagRatioCache.text === text) return tagRatioCache.ratio;
  const px = 100;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = tagFont(px);
  applyLetterSpacing(ctx, px);
  const m = ctx.measureText(text);
  const asc = m.fontBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent;
  if (Number.isFinite(asc) && Number.isFinite(desc) && asc + desc > 0) baselineRatio = (asc - desc) / (2 * px);
  const ratio = m.width > 0 ? m.width / px : 0.72 * text.length;
  ctx.restore();
  tagRatioCache = { text, ratio };
  return ratio;
}

/* ---------- 繪製器 ---------- */

export type OverlayKind = TransitionKind;

export interface PainterOptions {
  kind: OverlayKind;
  level: CrtLevel;
  palette: OverlayPalette;
  /** 台標文字 CH-0x 與台標卡上的英文代號（RECORDS…） */
  tag: string;
  code: string;
  clock: { start: number | null };
  /** 視窗大小（CSS 像素）；台標層的畫布以 tagScale 倍數對應 */
  viewport: { w: number; h: number };
  /** 進入：E1 結束（600ms）螢幕面的投影矩形（視窗比例）＝台標卡外框的起點 */
  faceRect: Rect | null;
  /** 交接點讀一次真實台標的矩形（CSS 像素）；讀不到回傳 null（用右上角的預設位置） */
  readTagRect: () => Rect | null;
  now?: () => number;
  raf?: (cb: (t: number) => void) => number;
  caf?: (h: number) => void;
}

/** 讀不到真實台標時的預設位置（工作站外框右上角：外框內距 10px、頂列內距 14px、頂列高 40px）。 */
export function fallbackTagRect(vw: number, ratio: number): Rect {
  const h = 14;
  const w = ratio * h;
  return { x: vw - 10 - 14 - 1 - w, y: 8 + 1 + (40 - 2 - h) / 2, w, h };
}

export class OverlayPainter {
  private raf = 0;
  private lastNow: number | null = null;
  private stopped = false;
  private cleaned = false;
  private covered = false;
  private handedOff = false;
  /** 驗證旗標（?osdebug=transition）：沒開時不產生任何除錯用的物件 */
  private readonly dbg = transitionDebugEnabled();
  private tagTarget: Rect | null = null;
  private tagStart: Rect;
  private tagKey = "";
  private tagRatio: number;
  private readonly seed: number;
  private readonly bands: TearBand[];
  private readonly ys: number[] = [];
  private readonly tint: Rgb;
  private readonly base: Rgb;
  private readonly block: Rect;
  private readonly now: () => number;
  private readonly schedule: (cb: (t: number) => void) => number;
  private readonly cancel: (h: number) => void;
  private readonly face: Rect;
  private readonly total: number;
  private readonly handoff: number;
  private readonly sx: number;
  private readonly sy: number;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly tagCtx: CanvasRenderingContext2D | null,
    private readonly o: PainterOptions,
  ) {
    this.now = o.now ?? (() => performance.now());
    this.schedule = o.raf ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = o.caf ?? ((h) => cancelAnimationFrame(h));
    this.seed = o.kind === "enter" ? 11 : 23;
    this.bands = o.kind === "exit" ? [] : tearBands(this.seed);
    this.tint = mixRgb(o.palette.lineStrong, o.palette.accent, 0.5);
    this.base = mixRgb(o.palette.page, o.palette.accent, 0.3);
    this.block = exitBlockRect(o.viewport.w, o.viewport.h);
    this.face = o.faceRect ?? CARD_FRAME_FULL;
    this.total = o.kind === "enter" ? ENTER.total : o.kind === "switch" ? SWITCH.total : EXIT.total;
    this.handoff = o.kind === "enter" ? ENTER.handoff : o.kind === "switch" ? SWITCH.handoff : EXIT.handoff;
    this.tagRatio = tagCtx ? measureTagRatio(tagCtx, o.tag) : 0.72 * o.tag.length;
    this.tagStart = tagStartRect(o.viewport.w, o.viewport.h, this.tagRatio);
    // 台標層：座標用 CSS 像素，畫布尺寸可能是 dpr 倍
    this.sx = tagCtx ? tagCtx.canvas.width / Math.max(1, o.viewport.w) : 1;
    this.sy = tagCtx ? tagCtx.canvas.height / Math.max(1, o.viewport.h) : 1;
    // 撕裂帶的切分點（畫面由上到下切成「帶」與「帶之間」的列段；不重疊）
    this.ys.push(0);
    for (const b of this.bands) this.ys.push(b.y * OVERLAY_H, (b.y + b.h) * OVERLAY_H);
    this.ys.push(OVERLAY_H);
  }

  /** 同步畫第一幀（在瀏覽器繪製之前：離開時 0–300ms 要是不透明的 --page，不能有空白幀露出舊畫面），然後交給 rAF。 */
  start(): void {
    dbgBegin(this.o.kind);
    this.frame(this.now());
    this.next();
  }

  stop(): void {
    this.stopped = true;
    this.cancel(this.raf);
    this.clearAll();
  }

  private next(): void {
    if (this.stopped) return;
    const t = this.o.clock.start == null ? 0 : this.now() - this.o.clock.start;
    if (t >= this.total) return;
    this.raf = this.schedule((ts) => {
      this.frame(ts);
      this.next();
    });
  }

  private clearAll(): void {
    this.ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
    this.tagCtx?.clearRect(0, 0, this.tagCtx.canvas.width, this.tagCtx.canvas.height);
    this.tagKey = "";
  }

  /** 畫一幀（now＝rAF 時間戳或 performance.now()）。 */
  frame(now: number): void {
    if (this.stopped) return;
    const t = this.o.clock.start == null ? 0 : now - this.o.clock.start;
    const first = this.lastNow === null;
    const dt = first ? 16.67 : Math.max(0, now - this.lastNow!);
    this.lastNow = now;
    dbgTime(t);
    if (this.o.kind === "enter") this.paintEnter(t, dt);
    else if (this.o.kind === "switch") this.paintSwitch(t, dt);
    else this.paintExit(t, dt);
  }

  /* ----- 共用 ----- */

  /** 不透明階段的開頭：CRT 開＝向 --page 拖尾（applyTrail）；第一次或 CRT 關＝直接蓋一層不透明 --page。 */
  private coverPage(dt: number): void {
    const { ctx } = this;
    if (this.covered && keepFor(this.o.level) > 0) applyTrail(ctx, this.o.palette.page, this.o.level, dt, OVERLAY_W, OVERLAY_H, false);
    else {
      ctx.fillStyle = rgbCss(this.o.palette.page);
      ctx.fillRect(0, 0, OVERLAY_W, OVERLAY_H);
    }
    this.covered = true;
  }

  private cleanOnce(dt: number): void {
    if (!this.cleaned) {
      this.clearAll();
      this.cleaned = true;
    }
    dbgOverlayFrame(dt, true);
  }

  private drawPanel(r: Rect, withDeco = true): void {
    const { ctx } = this;
    const p = this.o.palette;
    const x = r.x * OVERLAY_W;
    const y = r.y * OVERLAY_H;
    const w = r.w * OVERLAY_W;
    const h = r.h * OVERLAY_H;
    ctx.fillStyle = rgbCss(p.page);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgbCss(p.accent);
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    if (withDeco && w > 80 && h > 60) {
      ctx.strokeStyle = rgbCss(p.lineStrong);
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    }
  }

  /** 台標卡外框，帶水平撕裂（帶內左右位移）與垂直滾動（整張卡上下捲動、接縫對齊）。 */
  private drawPanelTorn(r: Rect, t: number, roll: number, strength: number): void {
    const { ctx } = this;
    if (roll === 0 && strength <= 0) {
      this.drawPanel(r);
      return;
    }
    const ys = this.ys;
    for (let i = 0; i + 1 < ys.length; i++) {
      const y0 = ys[i]!;
      const y1 = ys[i + 1]!;
      if (y1 - y0 <= 0.01) continue;
      const band = i % 2 === 1 ? this.bands[(i - 1) / 2] : undefined;
      const dx = band ? tearDx(band, (i - 1) / 2, this.seed, t, strength) : 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y0, OVERLAY_W, y1 - y0);
      ctx.clip();
      ctx.translate(dx, roll);
      this.drawPanel(r);
      if (roll !== 0) {
        ctx.translate(0, -OVERLAY_H);
        this.drawPanel(r);
      }
      ctx.restore();
    }
  }

  /** 撕裂帶本身的亮痕（雜訊上的水平亮條，隨強度淡出）。 */
  private drawTearBars(t: number, strength: number): void {
    if (strength <= 0) return;
    const { ctx } = this;
    ctx.fillStyle = rgbCss(this.tint, 0.5 * strength);
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i]!;
      const dx = tearDx(b, i, this.seed, t, strength);
      const y = b.y * OVERLAY_H;
      ctx.fillRect(Math.max(0, dx), y, OVERLAY_W - Math.abs(dx), Math.max(1, b.h * OVERLAY_H * 0.35));
    }
  }

  /** 垂直滾動的亮條（類比電視「垂直不同步」的橫條，隨滾動減速移動）。 */
  private drawHumBar(t: number): void {
    if (t < ENTER.E3[0] || t >= ENTER.E3[1]) return;
    const k = span(t, ENTER.E3[0], ENTER.E3[1]);
    const y = rollFrac(k) * OVERLAY_H;
    const h = OVERLAY_H * 0.16;
    const { ctx } = this;
    ctx.fillStyle = rgbCss(this.tint, 0.2 * (1 - 0.5 * k));
    ctx.fillRect(0, y - h / 2, OVERLAY_W, h);
    if (y - h / 2 < 0) ctx.fillRect(0, y - h / 2 + OVERLAY_H, OVERLAY_W, h);
    if (y + h / 2 > OVERLAY_H) ctx.fillRect(0, y - h / 2 - OVERLAY_H, OVERLAY_W, h);
  }

  /** 台標卡的文字（英文代號、signal lock 與 4 個格子）；格子亮幾個由 lockCells 決定。不受撕裂與滾動影響（像電視的 OSD）。 */
  private drawOsd(t: number): void {
    const a = osdAlpha(this.o.kind, t);
    if (a <= 0) return;
    const { ctx } = this;
    const p = this.o.palette;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = rgbCss(p.accent);
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(this.o.code, OVERLAY_W / 2, OVERLAY_H * 0.56);
    const y = OVERLAY_H * 0.68;
    ctx.textAlign = "right";
    ctx.fillStyle = rgbCss(p.ink);
    ctx.font = `400 14px ${FONT}`;
    ctx.fillText("signal lock", OVERLAY_W / 2 - 8, y);
    const lit = lockCells(this.o.kind, t);
    const x0 = OVERLAY_W / 2 + 4;
    for (let i = 0; i < LOCK_CELLS; i++) {
      const x = x0 + i * 14;
      if (i < lit) {
        ctx.fillStyle = rgbCss(p.accent);
        ctx.fillRect(x, y - 7, 9, 14);
      } else {
        ctx.strokeStyle = rgbCss(p.lineStrong);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y - 6.5, 8, 13);
      }
    }
    ctx.restore();
  }

  /** 交接點讀一次真實台標矩形（getBoundingClientRect）；讀不到就用預設位置。之後不再讀。 */
  private ensureTagTarget(t: number): void {
    if (this.tagTarget || t < this.handoff) return;
    const r = this.o.readTagRect();
    this.tagTarget = r && r.w > 0 && r.h > 0 ? r : fallbackTagRect(this.o.viewport.w, this.tagRatio);
    if (this.dbg) dbgSet({ tagTarget: this.tagTarget });
  }

  /** 台標層：中央 → 右上角真實台標位置（裝置解析度）。只在矩形改變時重畫。 */
  private paintTag(t: number): void {
    const tc = this.tagCtx;
    const plan = tagPlanOf(this.o.kind);
    if (!tc || !plan) return;
    const target = this.tagTarget ?? this.tagStart;
    const r = tagRectAt(plan, t, this.tagStart, target);
    const key = r ? `${r.x.toFixed(3)},${r.y.toFixed(3)},${r.h.toFixed(3)}` : "";
    if (key === this.tagKey) return;
    this.tagKey = key;
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.clearRect(0, 0, tc.canvas.width, tc.canvas.height);
    if (this.dbg) dbgSet({ tagRect: r });
    if (!r) return;
    tc.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    tc.font = tagFont(r.h);
    applyLetterSpacing(tc, r.h);
    tc.textAlign = "left";
    tc.textBaseline = "alphabetic";
    tc.fillStyle = rgbCss(this.o.palette.tag);
    // 行高 1 的方框裡，字型內容區（上升＋下降）置中
    tc.fillText(this.o.tag, r.x, r.y + r.h / 2 + baselineRatio * r.h);
  }

  private noiseLayer(n: NoiseLevel): void {
    drawNoise(this.ctx, this.o.palette, this.tint, n.opacity, n.grain);
  }

  /* ----- 進入 ----- */

  private paintEnter(t: number, dt: number): void {
    if (t < ENTER.E2[0]) return; // E1：只有 3D 鏡頭推近，疊層不畫
    if (t >= ENTER.total - NOISE_CLEAN_TAIL_MS) {
      this.cleanOnce(dt);
      return;
    }
    const { ctx } = this;
    this.ensureTagTarget(t);
    const noise = enterNoise(t);
    const strength = tearStrength("enter", t);
    if (t < ENTER.E3[0]) {
      // E2：卡片外框從螢幕面的投影矩形接續、ease-out 展開；外框外面是 3D（透明）
      ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
      const fr = cardFrameRect(t, this.face);
      this.drawPanel(fr);
      if (this.dbg) dbgSet({ cardFrame: fr });
    } else if (t < this.handoff) {
      // E3 交接點之前：不透明疊層（卡片＋撕裂＋滾動＋雜訊），向 --page 拖尾
      this.coverPage(dt);
      this.drawPanelTorn(CARD_FRAME_FULL, t, Math.round(enterRollPx(t)), strength);
      this.noiseLayer(noise);
      this.drawTearBars(t, strength);
      this.drawHumBar(t);
      if (this.dbg) dbgSet({ cardFrame: CARD_FRAME_FULL });
    } else {
      // 交接點之後：工作站已在下面，疊層透明，只剩雜訊（不拖尾，淡出排程精確）
      ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
      this.noiseLayer(noise);
      this.drawTearBars(t, strength);
      this.drawHumBar(t);
      if (this.dbg) dbgSet({ cardFrame: null });
    }
    this.drawOsd(t);
    this.paintTag(t);
    dbgOverlayFrame(dt, false);
  }

  /* ----- 短轉場 ----- */

  private paintSwitch(t: number, dt: number): void {
    if (t >= SWITCH.total - NOISE_CLEAN_TAIL_MS) {
      this.cleanOnce(dt);
      return;
    }
    const { ctx } = this;
    this.ensureTagTarget(t);
    const noise = switchNoise(t);
    const strength = tearStrength("switch", t);
    if (t < this.handoff) {
      // 0–75ms：目的地的台標卡從 t=0 就在雜訊下面（不透明）
      this.coverPage(dt);
      this.drawPanelTorn(CARD_FRAME_FULL, t, 0, strength);
      this.noiseLayer(noise);
      this.drawTearBars(t, strength);
    } else {
      ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
      this.noiseLayer(noise);
      this.drawTearBars(t, strength);
    }
    this.drawOsd(t);
    this.paintTag(t);
    dbgOverlayFrame(dt, false);
  }

  /* ----- 離開 ----- */

  private paintExit(t: number, dt: number): void {
    const { ctx } = this;
    if (t >= EXIT.X3[1]) {
      this.cleanOnce(dt);
      return;
    }
    const g = exitGeometry(t, OVERLAY_W, OVERLAY_H, this.block);
    const p = this.o.palette;
    if (t < EXIT.handoff) {
      // X1／X2：不透明 --page 上的亮面塊（代表工作站外框範圍）→ 亮線 → 亮點；CRT 開時留下磷光拖尾
      this.coverPage(dt);
      ctx.fillStyle = rgbCss(mixRgb(this.base, WHITE, g.heat));
      ctx.fillRect(g.x, g.y, g.w, g.h);
    } else {
      // 交接點：疊層清空（控制室與 HUD 在下面），只剩亮點淡出（透明拖尾）
      if (!this.handedOff) {
        ctx.clearRect(0, 0, OVERLAY_W, OVERLAY_H);
        this.handedOff = true;
      } else applyAlphaTrail(ctx, this.o.level, dt, OVERLAY_W, OVERLAY_H, false);
      ctx.fillStyle = rgbCss(WHITE, g.alpha * 0.25);
      ctx.fillRect(g.x - 6, g.y - 3, g.w + 12, g.h + 6);
      ctx.fillStyle = rgbCss(mixRgb(WHITE, p.accent, 0.15), g.alpha);
      ctx.fillRect(g.x, g.y, g.w, g.h);
    }
    dbgOverlayFrame(dt, false);
  }
}
