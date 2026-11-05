import { describe, expect, it, vi } from "vitest";
import { FRAME_MS } from "../crt/phosphor";
import { applyAlphaTrail, applyTrail, trailCoverAlpha } from "./trail";

describe("轉場疊層拖尾", () => {
  it("關＝全蓋（clear）；標準／濃一幀蓋 1 - keep", () => {
    expect(trailCoverAlpha("off", FRAME_MS)).toBe(1);
    expect(trailCoverAlpha("std", FRAME_MS)).toBeCloseTo(0.15, 10);
    expect(trailCoverAlpha("max", FRAME_MS)).toBeCloseTo(0.12, 10);
  });
  it("依 dt 換算：兩倍 dt 的殘留是 keep²；與 fps 無關", () => {
    expect(1 - trailCoverAlpha("std", 33.3)).toBeCloseTo(0.85 ** 2, 3);
    const half = 1 - trailCoverAlpha("std", FRAME_MS / 2);
    expect(half * half).toBeCloseTo(0.85, 6);
  });
  it("關或第一幀 clearRect；否則用 page 色以 alpha 蓋住，不整個清掉", () => {
    const mk = () => {
      const o = { clearRect: vi.fn(), alphaAtFill: -1, globalAlpha: 1, fillStyle: "", fillRect: vi.fn() };
      o.fillRect.mockImplementation(() => {
        o.alphaAtFill = o.globalAlpha;
      });
      return o;
    };
    const off = mk();
    applyTrail(off as unknown as CanvasRenderingContext2D, [10, 20, 30], "off", 16, 640, 360);
    expect(off.clearRect).toHaveBeenCalledWith(0, 0, 640, 360);
    expect(off.fillRect).not.toHaveBeenCalled();
    const first = mk();
    applyTrail(first as unknown as CanvasRenderingContext2D, [10, 20, 30], "std", 16, 640, 360, true);
    expect(first.clearRect).toHaveBeenCalled();
    const std = mk();
    applyTrail(std as unknown as CanvasRenderingContext2D, [10, 20, 30], "std", FRAME_MS, 640, 360);
    expect(std.clearRect).not.toHaveBeenCalled();
    expect(std.fillRect).toHaveBeenCalledWith(0, 0, 640, 360);
    expect(std.fillStyle).toBe("rgba(10,20,30,1)");
    expect(std.alphaAtFill).toBeCloseTo(0.15, 10);
    expect(std.globalAlpha).toBe(1); // 還原
  });
});

describe("透明疊層拖尾（destination-out）", () => {
  const mk = () => {
    const o = {
      clearRect: vi.fn(),
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      seen: null as null | { op: string; alpha: number },
      fillRect: vi.fn(),
    };
    o.fillRect.mockImplementation(() => {
      o.seen = { op: o.globalCompositeOperation, alpha: o.globalAlpha };
    });
    return o;
  };
  it("關或第一幀 clearRect；否則用 destination-out 把舊畫面的不透明度乘上 keep，並還原狀態", () => {
    const off = mk();
    applyAlphaTrail(off as unknown as CanvasRenderingContext2D, "off", 16, 640, 360);
    expect(off.clearRect).toHaveBeenCalledWith(0, 0, 640, 360);
    const first = mk();
    applyAlphaTrail(first as unknown as CanvasRenderingContext2D, "std", 16, 640, 360, true);
    expect(first.clearRect).toHaveBeenCalled();
    const std = mk();
    applyAlphaTrail(std as unknown as CanvasRenderingContext2D, "std", FRAME_MS, 640, 360);
    expect(std.clearRect).not.toHaveBeenCalled();
    expect(std.seen?.op).toBe("destination-out");
    expect(std.seen?.alpha).toBeCloseTo(0.15, 10);
    expect(std.globalCompositeOperation).toBe("source-over");
    expect(std.globalAlpha).toBe(1);
  });
});
