import { describe, expect, it } from "vitest";
import { buildHubLines, countSegments, HUB_SEGMENT_CAP } from "./hubLines";

describe("hubLines", () => {
  it("線段總數 > 0 且 ≤ 4,000", () => {
    const { group, segments } = buildHubLines({ floor: "#2c4054", housing: "#2c4054", screenFrame: "#22e6ff" });
    expect(segments).toBeGreaterThan(50);
    expect(segments).toBeLessThanOrEqual(HUB_SEGMENT_CAP);
    expect(countSegments(group)).toBe(segments);
  });
});
