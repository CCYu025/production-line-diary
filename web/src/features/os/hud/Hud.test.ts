import { describe, expect, it } from "vitest";
import { formatClock } from "./Hud";

describe("formatClock", () => {
  it("HH:MM:SS（24 小時制、補零）", () => {
    expect(formatClock(new Date(2026, 10, 1, 0, 5, 9))).toBe("00:05:09");
    expect(formatClock(new Date(2026, 10, 1, 23, 59, 59))).toBe("23:59:59");
    expect(formatClock(new Date(2026, 10, 1, 13, 0, 0))).toBe("13:00:00");
  });
});
