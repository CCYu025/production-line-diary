import { describe, expect, it } from "vitest";
import { effectiveDpr, FlickerClock, FLICKER, levelParams } from "./level";

describe("levelParams（H-D6：關＝只有線、標準、濃）", () => {
  it("關：沒有光暈、掃描線、閃爍", () => {
    expect(levelParams("off", false)).toMatchObject({ blurPx: 0, glow: 0, scan: 0, flicker: false });
  });
  it("標準 4px、濃 8px；掃描線 5%", () => {
    expect(levelParams("std", false)).toMatchObject({ blurPx: 4, scan: 0.05, flicker: true });
    expect(levelParams("max", false).blurPx).toBe(8);
  });
  it("減少動態效果：不閃爍，其餘不變", () => {
    expect(levelParams("std", true).flicker).toBe(false);
    expect(levelParams("std", true).blurPx).toBe(4);
  });
  it("DPR 上限 1.5、下限 1", () => {
    expect(effectiveDpr(3)).toBe(1.5);
    expect(effectiveDpr(1)).toBe(1);
    expect(effectiveDpr(0)).toBe(1);
  });
});

describe("FlickerClock", () => {
  it("間隔 6–12 秒；閃爍 60ms、亮度降 8%", () => {
    const c = new FlickerClock(() => 0, 0); // 間隔 = 6000
    expect(c.factor(5999, true)).toBe(1);
    expect(c.factor(6000, true)).toBeCloseTo(0.92, 9);
    expect(c.factor(6000 + FLICKER.durationMs - 1, true)).toBeCloseTo(0.92, 9);
    expect(c.factor(6000 + FLICKER.durationMs, true)).toBe(1);
    // 下一次在 (6060 + 6000) 之後
    expect(c.factor(6060 + 5999, true)).toBe(1);
    expect(c.factor(6060 + 6000, true)).toBeCloseTo(0.92, 9);
  });
  it("隨機值最大時間隔是 12 秒", () => {
    const c = new FlickerClock(() => 1, 0);
    expect(c.factor(11999, true)).toBe(1);
    expect(c.factor(12000, true)).toBeLessThan(1);
  });
  it("停用時永遠是 1", () => {
    const c = new FlickerClock(() => 0, 0);
    for (let t = 0; t < 40000; t += 7) expect(c.factor(t, false)).toBe(1);
  });
});
