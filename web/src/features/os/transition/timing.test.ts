import { describe, expect, it } from "vitest";
import {
  BOOT_FULL,
  BOOT_FULL_CAP_MS,
  BOOT_SHORT,
  BOOT_SHORT_CAP_MS,
  ENTER,
  ENTER_TOTAL_CAP_MS,
  EXIT,
  EXIT_TOTAL_CAP_MS,
  PATROL_IDLE_MS,
  SWITCH,
  SWITCH_TOTAL_CAP_MS,
} from "./timing";

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

describe("A4：開機時間 token", () => {
  it("完整版 ≤ 4000ms，短版 ≤ 1000ms", () => {
    expect(BOOT_FULL.total).toBeLessThanOrEqual(BOOT_FULL_CAP_MS);
    expect(BOOT_SHORT.total).toBeLessThanOrEqual(BOOT_SHORT_CAP_MS);
    expect(BOOT_FULL_CAP_MS).toBe(4000);
    expect(BOOT_SHORT_CAP_MS).toBe(1000);
  });
  it("完整版 B2→B3→B4 首尾相接並止於總長", () => {
    expect(BOOT_FULL.B2[0]).toBe(0);
    expect(BOOT_FULL.B3[0]).toBe(BOOT_FULL.B2[1]);
    expect(BOOT_FULL.B4[0]).toBe(BOOT_FULL.B3[1]);
    expect(BOOT_FULL.B4[1]).toBe(BOOT_FULL.total);
  });
  it("短版 B3→B4 首尾相接並止於總長（沒有 B2）", () => {
    expect(BOOT_SHORT.B3[0]).toBe(0);
    expect(BOOT_SHORT.B4[0]).toBe(BOOT_SHORT.B3[1]);
    expect(BOOT_SHORT.B4[1]).toBe(BOOT_SHORT.total);
  });
  it("待機巡視 60 秒", () => expect(PATROL_IDLE_MS).toBe(60_000));
});
