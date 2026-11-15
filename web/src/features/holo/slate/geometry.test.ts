import { describe, expect, it } from "vitest";
import { movedEnough, placeSlate, SLATE_MARGIN, snapToDevicePixel } from "./geometry";

const vp = { w: 1920, h: 1080 };
const slate = { w: 560, h: 420 };

describe("placeSlate（方法 P）", () => {
  it("預設在錨點右邊、垂直置中", () => {
    const p = placeSlate({ x: 600, y: 500 }, slate, vp);
    expect(p.x).toBeGreaterThan(600);
    expect(p.y).toBe(500 - 210);
  });
  it("右邊放不下改放左邊", () => {
    const p = placeSlate({ x: 1700, y: 500 }, slate, vp);
    expect(p.x + slate.w).toBeLessThan(1700);
  });
  it("夾在畫面內，四邊至少留 24px", () => {
    for (const a of [{ x: -500, y: -500 }, { x: 5000, y: 5000 }, { x: 0, y: 1080 }, { x: 1920, y: 0 }]) {
      const p = placeSlate(a, slate, vp);
      expect(p.x).toBeGreaterThanOrEqual(SLATE_MARGIN);
      expect(p.y).toBeGreaterThanOrEqual(SLATE_MARGIN);
      expect(p.x + slate.w).toBeLessThanOrEqual(vp.w - SLATE_MARGIN);
      expect(p.y + slate.h).toBeLessThanOrEqual(vp.h - SLATE_MARGIN);
    }
  });
  it("板子比畫面還大時貼著邊距，不會跑到負值", () => {
    const p = placeSlate({ x: 100, y: 100 }, { w: 3000, h: 3000 }, { w: 800, h: 600 });
    expect(p).toEqual({ x: SLATE_MARGIN, y: SLATE_MARGIN });
  });
});

describe("movedEnough／snap", () => {
  it("位移小於 0.5px 不寫 DOM；第一次一定寫", () => {
    expect(movedEnough(null, { x: 1, y: 1 })).toBe(true);
    expect(movedEnough({ x: 10, y: 10 }, { x: 10.4, y: 10.49 })).toBe(false);
    expect(movedEnough({ x: 10, y: 10 }, { x: 10.5, y: 10 })).toBe(true);
  });
  it("對齊到裝置像素：DPR 1.5 時是 1/1.5 的整數倍", () => {
    const s = snapToDevicePixel({ x: 10.3, y: 20.8 }, 1.5);
    expect(s.x * 1.5).toBeCloseTo(Math.round(s.x * 1.5), 9);
    expect(s.y * 1.5).toBeCloseTo(Math.round(s.y * 1.5), 9);
    expect(snapToDevicePixel({ x: 10.6, y: 3.4 }, 1)).toEqual({ x: 11, y: 3 });
  });
});
