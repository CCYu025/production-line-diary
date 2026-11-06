import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decayFactor,
  DT_MAX_MS,
  FRAME_MS,
  isPhosphorDegraded,
  keepFor,
  keepForMotion,
  markPhosphorDegraded,
  PHOSPHOR_KEEP_MOVING,
  needsReset,
  PhosphorGovernor,
  phosphorEnabled,
  resetPhosphorDegradedForTest,
} from "./phosphor";

afterEach(() => {
  resetPhosphorDegradedForTest();
  vi.restoreAllMocks();
});

describe("磷光殘留比例", () => {
  it("CRT 強度對應：關 0、標準 0.85、濃 0.88", () => {
    expect(keepFor("off")).toBe(0);
    expect(keepFor("std")).toBe(0.85);
    expect(keepFor("max")).toBe(0.88);
  });
  it("dt = 16.67ms 得到 keep；dt = 33.3ms 約 keep²", () => {
    expect(decayFactor(0.85, FRAME_MS)).toBeCloseTo(0.85, 10);
    expect(decayFactor(0.85, 33.3)).toBeCloseTo(0.85 ** 2, 3);
    expect(decayFactor(0.88, FRAME_MS)).toBeCloseTo(0.88, 10);
  });
  it("與 fps 無關：兩個半幀等於一個整幀", () => {
    const half = decayFactor(0.85, FRAME_MS / 2);
    const twoHalves = half * half;
    expect(twoHalves).toBeCloseTo(0.85, 6);
    expect(decayFactor(0.88, 8) * decayFactor(0.88, 8) * decayFactor(0.88, 8) * decayFactor(0.88, 8)).toBeCloseTo(decayFactor(0.88, 32), 8);
  });
  it("dt 夾在 [1, 100]ms；不合法視為一幀；keep 0 永遠 0", () => {
    expect(decayFactor(0.85, 5000)).toBeCloseTo(decayFactor(0.85, DT_MAX_MS), 12);
    expect(decayFactor(0.85, 0)).toBeCloseTo(decayFactor(0.85, 1), 12);
    expect(decayFactor(0.85, -5)).toBeCloseTo(decayFactor(0.85, 1), 12);
    expect(decayFactor(0.85, NaN)).toBeCloseTo(0.85, 10);
    expect(decayFactor(0, 16)).toBe(0);
  });
  it("第一幀（沒有 dt）或暫停很久後不拖影", () => {
    expect(needsReset(undefined)).toBe(true);
    expect(needsReset(1000)).toBe(true);
    expect(needsReset(NaN)).toBe(true);
    expect(needsReset(16.7)).toBe(false);
    expect(needsReset(100)).toBe(false);
  });
});

describe("鏡頭推拉期間的殘留（X3 修正：縮短大字的殘影）", () => {
  it("靜止時與 keepFor 相同；推拉中標準 0.55、濃 0.6；關永遠 0", () => {
    for (const l of ["off", "std", "max"] as const) expect(keepForMotion(l, false)).toBe(keepFor(l));
    expect(keepForMotion("std", true)).toBe(0.55);
    expect(keepForMotion("max", true)).toBe(0.6);
    expect(keepForMotion("off", true)).toBe(0);
  });
  it("推拉中的 keep 一定比靜止小（衰減更快）、仍在 (0, 1) 內", () => {
    for (const l of ["std", "max"] as const) {
      expect(PHOSPHOR_KEEP_MOVING[l]).toBeGreaterThan(0);
      expect(PHOSPHOR_KEEP_MOVING[l]).toBeLessThan(keepFor(l));
    }
  });
  it("標準：推拉中 5 幀後殘留 < 6%（原 0.85 要 17 幀才低於 6%），3 幀 < 20%", () => {
    expect(decayFactor(keepForMotion("std", true), FRAME_MS * 5)).toBeLessThan(0.06);
    expect(decayFactor(keepForMotion("std", true), FRAME_MS * 3)).toBeLessThan(0.2);
    expect(decayFactor(keepFor("std"), FRAME_MS * 5)).toBeGreaterThan(0.4);
  });
  it("依 dt 換算：與 fps 無關", () => {
    const k = keepForMotion("std", true);
    expect(decayFactor(k, 8) * decayFactor(k, 8)).toBeCloseTo(decayFactor(k, 16), 8);
  });
});

describe("減少動態效果與旗標", () => {
  it("減少動態效果、強度關、被降級都沒有磷光", () => {
    expect(phosphorEnabled("std", false)).toBe(true);
    expect(phosphorEnabled("max", false)).toBe(true);
    expect(phosphorEnabled("std", true)).toBe(false);
    expect(phosphorEnabled("off", false)).toBe(false);
    markPhosphorDegraded();
    expect(phosphorEnabled("std", false)).toBe(false);
  });
  it("降級旗標只在記憶體，只 console.info 一行", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(isPhosphorDegraded()).toBe(false);
    expect(markPhosphorDegraded(42)).toBe(true);
    expect(markPhosphorDegraded(42)).toBe(false);
    expect(isPhosphorDegraded()).toBe(true);
    expect(info).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

function feed(g: PhosphorGovernor, fps: number, seconds: number) {
  const dt = 1000 / fps;
  for (let t = 0; t < seconds * 1000; t += dt) g.push(dt);
}

describe("PhosphorGovernor 自動降級", () => {
  it("不足 3 秒不判斷", () => {
    const g = new PhosphorGovernor();
    feed(g, 30, 2.5);
    expect(g.shouldDegrade()).toBe(false);
  });
  it("59 fps → 49 fps 持續 3 秒會降級", () => {
    const g = new PhosphorGovernor();
    feed(g, 59, 4);
    expect(g.shouldDegrade()).toBe(false);
    feed(g, 49, 3.2);
    expect(g.shouldDegrade()).toBe(true);
  });
  it("穩定 55 fps 不降級；穩定 49 fps 降級", () => {
    const a = new PhosphorGovernor();
    feed(a, 55, 10);
    expect(a.shouldDegrade()).toBe(false);
    const b = new PhosphorGovernor();
    feed(b, 49, 3.1);
    expect(b.shouldDegrade()).toBe(true);
  });
  it("單次尖峰（中位數）不降級", () => {
    const g = new PhosphorGovernor();
    feed(g, 60, 1.5);
    g.push(200);
    feed(g, 60, 2);
    expect(g.shouldDegrade()).toBe(false);
  });
  it("連續一串卡頓但不到半個視窗不降級", () => {
    const g = new PhosphorGovernor();
    feed(g, 60, 2);
    feed(g, 20, 0.9);
    feed(g, 60, 1);
    expect(g.shouldDegrade()).toBe(false);
  });
  it("reset 清空視窗重新累積；暫停（dt > 250ms）自動 reset", () => {
    const g = new PhosphorGovernor();
    feed(g, 40, 4);
    expect(g.shouldDegrade()).toBe(true);
    g.reset();
    expect(g.shouldDegrade()).toBe(false);
    expect(g.medianFps()).toBeNull();
    feed(g, 40, 4);
    g.push(2000);
    expect(g.shouldDegrade()).toBe(false);
    expect(g.ready).toBe(false);
  });
  it("滑動視窗：恢復到 60 fps 之後不再降級", () => {
    const g = new PhosphorGovernor();
    feed(g, 40, 3.2);
    expect(g.shouldDegrade()).toBe(true);
    feed(g, 60, 3.5);
    expect(g.shouldDegrade()).toBe(false);
  });
});
