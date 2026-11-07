import { describe, expect, it } from "vitest";
import { CHANNELS } from "../channels";
import { drawMonitorScreen, SCREEN_LAYOUT, SCREEN_LAYOUT_MAX, TEX_H, TEX_W } from "./screenTexture";
import type { ChannelSignal } from "./signals";

/** 記錄 fillText／strokeText 的假 2D context（jsdom 沒有 canvas）。 */
function fakeCanvas() {
  const texts: Array<{ text: string; size: number; y: number }> = [];
  let font = "";
  const ctx = new Proxy({} as object, {
    get(_t, prop: string) {
      if (prop === "measureText") return (s: string) => ({ width: s.length * (Number(/(\d+)px/.exec(font)?.[1] ?? 10) * 0.6) });
      if (prop === "fillText") return (text: string, _x: number, y: number) => texts.push({ text, size: Number(/(\d+)px/.exec(font)?.[1]), y });
      if (prop === "font") return font;
      return () => {};
    },
    set(_t, prop: string, v) {
      if (prop === "font") font = String(v);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const canvas = { width: TEX_W, height: TEX_H, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, texts };
}

const colors = { page: "#070b11", accent: "#22e6ff", ink: "#eef" };
const sig = (over: Partial<ChannelSignal>): ChannelSignal => ({ id: "CH-04", caption: "TODAY", big: "11/07", small: "3", blinkCursor: false, hudLabel: "今日 3", compact: "", name: "", ...over });
const ch04 = CHANNELS.find((c) => c.id === "CH-04")!;

describe("螢幕貼圖（X5：濃 CRT 讓主數值）", () => {
  it("標準：畫代號、大字、下方標籤與小字（版面不變）", () => {
    const { canvas, texts } = fakeCanvas();
    drawMonitorScreen(canvas, colors, ch04, sig({}));
    expect(texts.map((t) => t.text)).toEqual(["CH-04", "11/07", "TODAY", "3"]);
    expect(texts.find((t) => t.text === "CH-04")!.y).toBe(SCREEN_LAYOUT.codeY);
  });
  it("關與標準的版面一樣", () => {
    const a = fakeCanvas();
    const b = fakeCanvas();
    drawMonitorScreen(a.canvas, colors, ch04, sig({}), "std");
    drawMonitorScreen(b.canvas, colors, ch04, sig({}), "off");
    expect(b.texts).toEqual(a.texts);
  });
  it("濃：不畫下方標籤與小字；主數值比標準大（單位數字）", () => {
    const std = fakeCanvas();
    const max = fakeCanvas();
    const one = sig({ id: "CH-01", caption: "PENDING", big: "4", small: null });
    drawMonitorScreen(std.canvas, colors, CHANNELS[0]!, one, "std");
    drawMonitorScreen(max.canvas, colors, CHANNELS[0]!, one, "max");
    expect(max.texts.map((t) => t.text)).toEqual(["CH-01", "4"]);
    const big = (r: typeof std.texts) => r.find((t) => t.text === "4")!.size;
    expect(big(max.texts)).toBe(SCREEN_LAYOUT_MAX.bigSize);
    expect(big(max.texts)).toBeGreaterThan(big(std.texts));
  });
  it("濃：長字（11/07）縮到可用寬度內，仍不小於標準", () => {
    const std = fakeCanvas();
    const max = fakeCanvas();
    drawMonitorScreen(std.canvas, colors, ch04, sig({}), "std");
    drawMonitorScreen(max.canvas, colors, ch04, sig({}), "max");
    const size = (r: typeof std.texts) => r.find((t) => t.text === "11/07")!.size;
    expect(size(max.texts)).toBeGreaterThanOrEqual(size(std.texts));
  });
});
