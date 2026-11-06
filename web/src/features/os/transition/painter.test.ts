import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_FRAME_FULL, exitBlockRect, type Rect } from "./choreo";
import { resetTransitionDebugForTest, transitionDebugEnabled } from "./debug";
import { fillNoise, makeNoisePool, NOISE_POOL_FRAMES, OverlayPainter, OVERLAY_H, OVERLAY_W, runWarmFrame, WARM_FRAMES, type OverlayKind, type OverlayPalette } from "./painter";
import { ENTER, EXIT, SWITCH } from "./timing";
import type { CrtLevel } from "../crt/settings";

interface Call {
  fn: string;
  args: number[];
  alpha: number;
  style: unknown;
  op: string;
}

/** 記錄每次繪製呼叫（含呼叫當下的 globalAlpha／fillStyle／合成模式）的假 2D context。 */
function fakeCtx(w: number, h: number) {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "", globalCompositeOperation: "source-over", letterSpacing: "" };
  const canvas = { width: w, height: h };
  const ctx = new Proxy({} as object, {
    get(_t, prop: string) {
      if (prop === "canvas") return canvas;
      if (prop in state) return state[prop];
      if (prop === "measureText") return (s: string) => ({ width: s.length * 72, fontBoundingBoxAscent: 102.5, fontBoundingBoxDescent: 27.5 });
      return (...args: number[]) => {
        calls.push({ fn: prop, args, alpha: state.globalAlpha as number, style: state.fillStyle, op: state.globalCompositeOperation as string });
      };
    },
    set(_t, prop: string, v) {
      state[prop] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, state };
}

const palette: OverlayPalette = { page: [7, 11, 17], line: [20, 30, 40], lineStrong: [44, 64, 84], accent: [34, 230, 255], tag: [60, 240, 255], ink: [230, 240, 250] };
const face: Rect = { x: 0.185, y: 0.08, w: 0.63, h: 0.84 };
const target: Rect = { x: 1790.5, y: 20.25, w: 50.4, h: 14 };

function make(kind: OverlayKind, opts: { level?: CrtLevel; readTagRect?: () => Rect | null } = {}) {
  const main = fakeCtx(OVERLAY_W, OVERLAY_H);
  const tag = fakeCtx(1920, 1080);
  const clock = { start: 5000 as number | null };
  const readTagRect = vi.fn(opts.readTagRect ?? (() => target));
  const painter = new OverlayPainter(main.ctx, tag.ctx, {
    kind,
    level: opts.level ?? "std",
    palette,
    tag: "CH-02",
    code: "RECORDS",
    clock,
    viewport: { w: 1920, h: 1080 },
    faceRect: kind === "enter" ? face : null,
    readTagRect,
    now: () => clock.start! + 0,
    raf: () => 1,
    caf: () => {},
  });
  const at = (t: number) => painter.frame(5000 + t);
  const reset = () => {
    main.calls.length = 0;
    tag.calls.length = 0;
  };
  reset(); // 建構時的字型量測呼叫不算
  return { painter, main, tag, clock, readTagRect, at, reset };
}

const drawing = (calls: Call[]) => calls.filter((c) => ["fillRect", "strokeRect", "fillText", "drawImage", "clearRect"].includes(c.fn));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  window.history.replaceState({}, "", "/");
  resetTransitionDebugForTest();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetTransitionDebugForTest();
});

describe("進入：E1 疊層不畫、E2 卡片外框從螢幕面接續", () => {
  it("E1（0–600ms）沒有任何疊層繪製呼叫（只有 3D 鏡頭）", () => {
    const m = make("enter");
    for (const t of [0, 100, 300, 599]) m.at(t);
    expect(m.main.calls).toEqual([]);
    expect(m.tag.calls).toEqual([]);
  });
  it("600ms 第一幀：外框矩形＝螢幕面投影矩形（轉成 640×360 座標），四周之外是透明（先 clearRect）", () => {
    const m = make("enter");
    m.at(ENTER.E2[0]);
    const clear = m.main.calls.find((c) => c.fn === "clearRect")!;
    expect(clear.args).toEqual([0, 0, OVERLAY_W, OVERLAY_H]);
    const stroke = m.main.calls.find((c) => c.fn === "strokeRect")!;
    expect(stroke.args[0]).toBeCloseTo(face.x * OVERLAY_W, 9);
    expect(stroke.args[1]).toBeCloseTo(face.y * OVERLAY_H, 9);
    expect(stroke.args[2]).toBeCloseTo(face.w * OVERLAY_W, 9);
    expect(stroke.args[3]).toBeCloseTo(face.h * OVERLAY_H, 9);
  });
  it("E2 結束（750ms）外框＝全幅外框（四周各 24 像素）", () => {
    const m = make("enter");
    m.at(ENTER.E2[0]);
    m.reset();
    m.at(ENTER.E3[0] - 0.01);
    const stroke = m.main.calls.find((c) => c.fn === "strokeRect")!;
    expect(stroke.args[0]).toBeCloseTo(CARD_FRAME_FULL.x * OVERLAY_W, 1);
    expect(stroke.args[2]).toBeCloseTo(CARD_FRAME_FULL.w * OVERLAY_W, 1);
  });
  it("OSD 的 signal lock 格子：E2 初 0 格亮，750ms 前 3 格，1000ms 4 格（亮格 fillStyle 是 accent）", () => {
    const litCells = (calls: Call[]) => calls.filter((c) => c.fn === "fillRect" && c.args[2] === 9 && c.args[3] === 14).length;
    const m = make("enter");
    m.at(600);
    expect(litCells(m.main.calls)).toBe(0);
    m.reset();
    m.at(740);
    expect(litCells(m.main.calls)).toBe(3);
    m.reset();
    m.at(950);
    expect(litCells(m.main.calls)).toBe(3);
    m.reset();
    m.at(1000);
    expect(litCells(m.main.calls)).toBe(4);
  });
  it("台標層：600ms 起在畫面中央（裝置解析度、CSS 像素座標）；1000ms 前不動", () => {
    const m = make("enter");
    m.at(600);
    const t = m.tag.calls.find((c) => c.fn === "fillText")!;
    const h0 = Math.round(1080 * 0.085); // 92
    const w0 = 3.6 * h0;
    expect(t.args[1]).toBeCloseTo(960 - w0 / 2, 6);
    expect(t.args[2]).toBeCloseTo(1080 * 0.4 - h0 / 2 + h0 / 2 + 0.375 * h0, 6);
    m.reset();
    m.at(700);
    m.at(999); // 沒有移動就不重畫
    expect(m.tag.calls).toEqual([]);
  });
});

describe("進入：真實台標矩形只在交接點讀一次", () => {
  it("交接點之前不讀；交接點之後第一幀讀一次，之後不再讀", () => {
    const m = make("enter");
    for (const t of [600, 700, 800, ENTER.handoff - 1]) m.at(t);
    expect(m.readTagRect).not.toHaveBeenCalled();
    m.at(ENTER.handoff);
    expect(m.readTagRect).toHaveBeenCalledTimes(1);
    for (const t of [900, 1000, 1070, 1139]) m.at(t);
    expect(m.readTagRect).toHaveBeenCalledTimes(1);
  });
  it("讀不到（沒有該元素或矩形是 0）時用右上角預設位置，不丟錯", () => {
    const m = make("enter", { readTagRect: () => null });
    expect(() => {
      for (const t of [600, 880, 1100, 1139]) m.at(t);
    }).not.toThrow();
    const m2 = make("enter", { readTagRect: () => ({ x: 0, y: 0, w: 0, h: 0 }) });
    expect(() => m2.at(900)).not.toThrow();
  });
  it("落點：1139ms 的台標文字位置（CSS 像素 × 畫布縮放）幾乎等於真實台標矩形；字高 14", () => {
    const m = make("enter");
    m.at(ENTER.handoff);
    m.at(1139.9);
    const font = m.tag.state.font as string;
    expect(font).toMatch(/^600 1[34](\.\d+)?px /);
    const t = m.tag.calls.filter((c) => c.fn === "fillText").at(-1)!;
    expect(Math.abs(t.args[1]! - (target.x))).toBeLessThan(0.05 + 0.0);
    // 基線 = 頂端 + 高/2 + (asc-desc)/2/高
    const expectBaseline = target.y + target.h / 2 + ((102.5 - 27.5) / 200) * target.h;
    expect(Math.abs(t.args[2]! - expectBaseline)).toBeLessThan(0.1);
  });
});

describe("進入：最後 60ms 完全乾淨", () => {
  it("1140ms 起疊層與台標層都只 clearRect 一次，之後不再畫任何東西", () => {
    const m = make("enter");
    m.at(1130);
    m.reset();
    m.at(ENTER.total - 60);
    expect(m.main.calls.filter((c) => c.fn === "clearRect")).toHaveLength(1);
    expect(m.tag.calls.filter((c) => c.fn === "clearRect").length).toBeGreaterThanOrEqual(1);
    expect(drawing(m.main.calls).every((c) => c.fn === "clearRect")).toBe(true);
    m.reset();
    for (const t of [1150, 1170, 1190, 1199]) m.at(t);
    expect(m.main.calls).toEqual([]);
    expect(m.tag.calls).toEqual([]);
  });
  it("交接點之後是透明疊層：每幀 clearRect（不拖尾），不是 --page 滿版填色", () => {
    const m = make("enter");
    m.at(ENTER.handoff - 1);
    m.reset();
    m.at(ENTER.handoff + 10);
    expect(m.main.calls[0]!.fn).toBe("clearRect");
    expect(m.main.calls.some((c) => c.fn === "fillRect" && c.args[0] === 0 && c.args[2] === OVERLAY_W && c.args[3] === OVERLAY_H)).toBe(false);
  });
});

describe("磷光拖尾（疊層）：CRT 開才拖尾，關＝全蓋不拖", () => {
  it("離開 X1：CRT 標準第二幀以 1-keep 的不透明度蓋 --page；CRT 關每幀都是不透明 --page", () => {
    const std = make("exit", { level: "std" });
    std.at(0);
    std.reset();
    std.at(16.67);
    const cover = std.main.calls.find((c) => c.fn === "fillRect" && c.args[2] === OVERLAY_W)!;
    expect(cover.alpha).toBeCloseTo(0.15, 3);
    const off = make("exit", { level: "off" });
    off.at(0);
    off.reset();
    off.at(16.67);
    const cover2 = off.main.calls.find((c) => c.fn === "fillRect" && c.args[2] === OVERLAY_W)!;
    expect(cover2.alpha).toBe(1);
  });
  it("拖尾依實際 dt 換算（兩倍 dt 蓋得更多）", () => {
    const a = make("exit", { level: "std" });
    a.at(0);
    a.reset();
    a.at(33.3);
    const cover = a.main.calls.find((c) => c.fn === "fillRect" && c.args[2] === OVERLAY_W)!;
    expect(cover.alpha).toBeCloseTo(1 - 0.85 ** 2, 2);
  });
});

describe("離開：X1 亮面塊壓成亮線、X2 收成亮點、X3 淡出", () => {
  const W = OVERLAY_W;
  const H = OVERLAY_H;
  const block = exitBlockRect(1920, 1080);
  it("第一幀（同步）就是不透明 --page 滿版＋面塊（不露出舊畫面）", () => {
    const m = make("exit");
    m.at(0);
    const cover = m.main.calls.find((c) => c.fn === "fillRect")!;
    expect(cover.args).toEqual([0, 0, W, H]);
    expect(cover.alpha).toBe(1);
    expect(m.main.calls.filter((c) => c.fn === "fillRect").length).toBeGreaterThanOrEqual(2);
  });
  it("X1 結束（150ms）：亮線（高度約 2 像素、寬度＝工作站外框範圍）", () => {
    const m = make("exit", { level: "off" });
    m.at(0);
    m.reset();
    m.at(EXIT.X1[1]);
    const rects = m.main.calls.filter((c) => c.fn === "fillRect");
    const line = rects[rects.length - 1]!;
    expect(line.args[3]).toBeCloseTo(2, 6);
    expect(line.args[2]).toBeCloseTo(block.w * W, 6);
  });
  it("交接點（300ms）疊層清空（露出控制室與 HUD），之後只畫亮點；400ms 起清空且不再畫", () => {
    const m = make("exit", { level: "std" });
    m.at(0);
    m.at(EXIT.handoff - 1);
    m.reset();
    m.at(EXIT.handoff);
    expect(m.main.calls[0]!.fn).toBe("clearRect");
    const dots = m.main.calls.filter((c) => c.fn === "fillRect");
    expect(dots.some((c) => c.args[2] === 6 && c.args[3] === 6)).toBe(true);
    // 之後用 destination-out 拖尾（透明衰減），不蓋 --page
    m.reset();
    m.at(EXIT.handoff + 16.67);
    const trail = m.main.calls.find((c) => c.fn === "fillRect" && c.op === "destination-out");
    expect(trail).toBeDefined();
    expect(m.main.calls.some((c) => c.fn === "fillRect" && c.args[2] === W && c.op === "source-over")).toBe(false);
    m.reset();
    m.at(EXIT.X3[1]);
    expect(m.main.calls.filter((c) => c.fn === "clearRect")).toHaveLength(1);
    m.reset();
    m.at(EXIT.X3[1] + 50);
    m.at(EXIT.total);
    expect(m.main.calls).toEqual([]);
  });
  it("離開沒有任何文字（signal lock 等）與台標層繪製", () => {
    const m = make("exit");
    for (const t of [0, 100, 200, 299, 300, 350, 399]) m.at(t);
    expect(m.main.calls.some((c) => c.fn === "fillText")).toBe(false);
    expect(m.tag.calls).toEqual([]);
  });
});

describe("短轉場：目的地台標卡從 t=0 在雜訊下面；台標落在真實位置", () => {
  it("0ms 第一幀：不透明 --page 滿版、台標卡外框、code 文字、1 格亮；台標層在中央", () => {
    const m = make("switch");
    m.at(0);
    expect(m.main.calls.find((c) => c.fn === "fillRect")!.args).toEqual([0, 0, OVERLAY_W, OVERLAY_H]);
    expect(m.main.calls.some((c) => c.fn === "strokeRect")).toBe(true);
    expect(m.main.calls.some((c) => c.fn === "fillText")).toBe(true);
    expect(m.tag.calls.some((c) => c.fn === "fillText")).toBe(true);
  });
  it("交接點（75ms）讀台標矩形一次；之後疊層透明（clearRect）", () => {
    const m = make("switch");
    m.at(0);
    m.at(SWITCH.handoff - 1);
    expect(m.readTagRect).not.toHaveBeenCalled();
    m.reset();
    m.at(SWITCH.handoff);
    expect(m.readTagRect).toHaveBeenCalledTimes(1);
    expect(m.main.calls[0]!.fn).toBe("clearRect");
    m.at(200);
    expect(m.readTagRect).toHaveBeenCalledTimes(1);
  });
  it("最後 60ms（240ms 起）乾淨", () => {
    const m = make("switch");
    m.at(230);
    m.reset();
    m.at(SWITCH.total - 60);
    expect(drawing(m.main.calls).every((c) => c.fn === "clearRect")).toBe(true);
    m.reset();
    m.at(280);
    expect(m.main.calls).toEqual([]);
  });
});

describe("清理", () => {
  it("stop() 清空疊層與台標層；之後 frame() 不再畫", () => {
    const m = make("enter");
    m.at(900);
    m.reset();
    m.painter.stop();
    expect(m.main.calls.some((c) => c.fn === "clearRect")).toBe(true);
    expect(m.tag.calls.some((c) => c.fn === "clearRect")).toBe(true);
    m.reset();
    m.at(950);
    expect(m.main.calls).toEqual([]);
  });
  it("start() 同步畫第一幀並排下一幀", () => {
    const raf = vi.fn(() => 1);
    const main = fakeCtx(OVERLAY_W, OVERLAY_H);
    const clock = { start: performance.now() as number | null };
    const p = new OverlayPainter(main.ctx, null, { kind: "exit", level: "std", palette, tag: "CH-02", code: "RECORDS", clock, viewport: { w: 1280, h: 720 }, faceRect: null, readTagRect: () => null, raf });
    p.start();
    expect(main.calls.length).toBeGreaterThan(0);
    expect(raf).toHaveBeenCalledTimes(1);
    p.stop();
  });
});

describe("第一個 rAF 幀的時間戳早於時鐘起點（t 為負）：夾在 0，雜訊與台標從第一幀就在", () => {
  it("短轉場：t=-8ms 的幀畫出卡片、台標文字與 signal lock，和 t=0 一樣", () => {
    const early = make("switch");
    early.at(-8);
    const zero = make("switch");
    zero.at(0);
    expect(early.tag.calls.filter((c) => c.fn === "fillText").length).toBe(1);
    expect(early.main.calls.map((c) => c.fn)).toEqual(zero.main.calls.map((c) => c.fn));
    expect(early.tag.calls.map((c) => c.fn)).toEqual(zero.tag.calls.map((c) => c.fn));
  });
  it("進入：t 為負不會進到任何階段（等同 E1，不畫）", () => {
    const m = make("enter");
    m.at(-20);
    expect(m.main.calls).toEqual([]);
    expect(m.tag.calls).toEqual([]);
  });
});

describe("雜訊池（每幀不再逐像素跑亂數產生器）", () => {
  it("makeNoisePool 決定性：同一個 seed 同一串位元組，不同 seed 不同", () => {
    const a = makeNoisePool(4096, 7);
    const b = makeNoisePool(4096, 7);
    const c = makeNoisePool(4096, 8);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    expect(NOISE_POOL_FRAMES).toBeGreaterThanOrEqual(2);
  });
  it("位元組大致均勻（256 個值都出現、沒有偏向）", () => {
    const pool = makeNoisePool(256 * 400);
    const hist = new Array<number>(256).fill(0);
    for (const v of pool) hist[v]!++;
    expect(Math.min(...hist)).toBeGreaterThan(250);
    expect(Math.max(...hist)).toBeLessThan(560);
  });
  it("fillNoise：dst[i] = lut[pool[offset + i]]；不同起點得到不同的顆粒", () => {
    const pool = makeNoisePool(2000, 3);
    const lut = new Uint32Array(256).map((_, i) => i * 1000 + 1);
    const a = new Uint32Array(1000);
    const b = new Uint32Array(1000);
    fillNoise(a, lut, pool, 0);
    fillNoise(b, lut, pool, 777);
    for (let i = 0; i < 1000; i += 97) {
      expect(a[i]).toBe(lut[pool[i]!]);
      expect(b[i]).toBe(lut[pool[777 + i]!]);
    }
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
  it("池長 ≥ 兩倍畫面像素：起點範圍 [0, 池長 − 像素數] 內永遠不會讀超出池", () => {
    const len = OVERLAY_W * OVERLAY_H * NOISE_POOL_FRAMES;
    const maxOffset = len - OVERLAY_W * OVERLAY_H;
    expect(maxOffset).toBeGreaterThan(OVERLAY_W * OVERLAY_H - 1);
  });
});

describe("閒置預熱（runWarmFrame）", () => {
  const targets = () => {
    const main = fakeCtx(OVERLAY_W, OVERLAY_H);
    const tag = fakeCtx(1920, 1080);
    return {
      main,
      tag,
      w: { ctx: main.ctx, tagCtx: tag.ctx, level: "std" as CrtLevel, palette, tag: "CH-02", code: "RECORDS", viewport: { w: 1920, h: 1080 } },
    };
  };
  it("代表幀涵蓋進入／短轉場／離開，每個閒置回呼只畫一幀；最後一幀回傳 done", () => {
    expect(new Set(WARM_FRAMES.map((f) => f.kind))).toEqual(new Set(["enter", "switch", "exit"]));
    const t = targets();
    const dones = WARM_FRAMES.map((_, i) => runWarmFrame(i, t.w));
    expect(dones.slice(0, -1).every((d) => !d)).toBe(true);
    expect(dones[dones.length - 1]).toBe(true);
    expect(runWarmFrame(WARM_FRAMES.length, t.w)).toBe(true);
  });
  it("每一幀結束都 stop() 清空兩個畫布（畫面上什麼都不會留下）", () => {
    const t = targets();
    runWarmFrame(0, t.w);
    expect(t.main.calls[t.main.calls.length - 1]!.fn).toBe("clearRect");
    expect(t.tag.calls[t.tag.calls.length - 1]!.fn).toBe("clearRect");
  });
  it("不寫驗證掛鉤的計數、不讀台標矩形、不排 rAF", () => {
    window.history.replaceState({}, "", "/?osdebug=transition");
    resetTransitionDebugForTest();
    expect(transitionDebugEnabled()).toBe(true);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const t = targets();
    for (let i = 0; i < WARM_FRAMES.length; i++) runWarmFrame(i, t.w);
    expect(raf).not.toHaveBeenCalled();
    const snap = window.__osTransition?.();
    expect(snap?.overlayFrames).toBe(0);
    expect(snap?.overlayFrameTimes).toEqual([]);
  });
});
