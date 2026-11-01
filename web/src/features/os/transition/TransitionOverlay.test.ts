import { describe, expect, it } from "vitest";
import { switchNoiseAlpha, switchShowsCard } from "./TransitionOverlay";
import { SWITCH } from "./timing";

describe("短轉場的雜訊時間（§5.4）", () => {
  it("t=0 到交接點完全不透明，並畫目的地的台標卡", () => {
    for (const t of [0, 1, 40, SWITCH.handoff - 1]) {
      expect(switchNoiseAlpha(t)).toBe(1);
      expect(switchShowsCard(t)).toBe(true);
    }
  });

  it("交接點到 150ms 為 0.85，不再畫台標卡（下面是真正的工作站）", () => {
    for (const t of [SWITCH.handoff, 100, SWITCH.noise[1] - 1]) {
      expect(switchNoiseAlpha(t)).toBe(0.85);
      expect(switchShowsCard(t)).toBe(false);
    }
  });

  it("150–300ms 線性淡出，300ms 起沒有雜訊", () => {
    expect(switchNoiseAlpha(SWITCH.lock[0])).toBeCloseTo(0.85, 5);
    expect(switchNoiseAlpha(225)).toBeCloseTo(0.425, 5);
    expect(switchNoiseAlpha(SWITCH.total - 1)).toBeLessThan(0.01);
    expect(switchNoiseAlpha(SWITCH.total)).toBe(0);
    expect(switchNoiseAlpha(1000)).toBe(0);
    expect(switchNoiseAlpha(-5)).toBe(0);
  });

  it("交接點在雜訊段內、段落首尾相接", () => {
    expect(SWITCH.noise[1]).toBe(SWITCH.lock[0]);
    expect(SWITCH.lock[1]).toBe(SWITCH.total);
    expect(SWITCH.handoff).toBeLessThan(SWITCH.noise[1]);
  });
});
