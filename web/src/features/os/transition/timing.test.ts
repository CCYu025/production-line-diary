import { describe, expect, it } from "vitest";
import { ENTER, ENTER_TOTAL_CAP_MS, EXIT, EXIT_TOTAL_CAP_MS, SWITCH, SWITCH_TOTAL_CAP_MS } from "./timing";

describe("timing", () => {
  it("總長不超過規格上限", () => {
    expect(ENTER.total).toBeLessThanOrEqual(ENTER_TOTAL_CAP_MS);
    expect(EXIT.total).toBeLessThanOrEqual(EXIT_TOTAL_CAP_MS);
  });
  it("交接點", () => {
    expect(ENTER.handoff).toBe(875);
    expect(EXIT.handoff).toBe(300);
    expect(ENTER.handoff).toBeLessThan(ENTER.total);
    expect(EXIT.handoff).toBeLessThan(EXIT.total);
  });
  it("段落首尾相接、不超出總長", () => {
    expect(ENTER.E1[0]).toBe(0);
    expect(ENTER.E1[1]).toBe(ENTER.E2[0]);
    expect(ENTER.E2[1]).toBe(ENTER.E3[0]);
    expect(ENTER.E3[1]).toBe(ENTER.E4[0]);
    expect(ENTER.E4[1]).toBe(ENTER.total);
    expect(EXIT.X1[1]).toBe(EXIT.X2[0]);
    expect(EXIT.X2[1]).toBe(EXIT.X3[0]);
    expect(EXIT.X4[1]).toBe(EXIT.total);
  });
  it("交接點落在規格指定的段落內", () => {
    expect(ENTER.handoff).toBeGreaterThanOrEqual(ENTER.E3[0]);
    expect(ENTER.handoff).toBeLessThan(ENTER.E3[1]);
    expect(EXIT.handoff).toBe(EXIT.X2[1]);
  });

  describe("短轉場 SWITCH（§5.4）", () => {
    it("總長 300ms、不超過上限；交接點 75ms", () => {
      expect(SWITCH.total).toBe(300);
      expect(SWITCH.total).toBeLessThanOrEqual(SWITCH_TOTAL_CAP_MS);
      expect(SWITCH.handoff).toBe(75);
      expect(SWITCH.handoff).toBeLessThan(SWITCH.total);
    });
    it("雜訊 150ms＋訊號鎖定 150ms，首尾相接且不超出總長", () => {
      expect(SWITCH.noise[0]).toBe(0);
      expect(SWITCH.noise[1] - SWITCH.noise[0]).toBe(150);
      expect(SWITCH.noise[1]).toBe(SWITCH.lock[0]);
      expect(SWITCH.lock[1] - SWITCH.lock[0]).toBe(150);
      expect(SWITCH.lock[1]).toBe(SWITCH.total);
    });
    it("交接點落在雜訊段內", () => {
      expect(SWITCH.handoff).toBeGreaterThanOrEqual(SWITCH.noise[0]);
      expect(SWITCH.handoff).toBeLessThan(SWITCH.noise[1]);
    });
    it("比進入、離開轉場都短", () => {
      expect(SWITCH.total).toBeLessThan(EXIT.total);
      expect(SWITCH.total).toBeLessThan(ENTER.total);
    });
  });
});
