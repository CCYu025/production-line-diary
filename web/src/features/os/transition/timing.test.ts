import { describe, expect, it } from "vitest";
import { ENTER, ENTER_TOTAL_CAP_MS, EXIT, EXIT_TOTAL_CAP_MS } from "./timing";

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
});
