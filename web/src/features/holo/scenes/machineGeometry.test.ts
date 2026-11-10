import { describe, expect, it } from "vitest";
import { buildMachine, PANEL_ANCHOR, segmentCount } from "./machineGeometry";

describe("展示機台（程序產生的線框）", () => {
  const parts = buildMachine();
  it("約 2,000 條線段", () => {
    const n = segmentCount(parts);
    expect(n).toBeGreaterThanOrEqual(1800);
    expect(n).toBeLessThanOrEqual(2300);
  });
  it("有方塊、圓柱、管線、操作面板；座標都是有限數字", () => {
    expect(parts.map((p) => p.name)).toEqual(expect.arrayContaining(["底座", "塔架", "儲槽", "管線", "操作面板"]));
    for (const p of parts) {
      expect(p.lines.length % 6).toBe(0);
      expect(p.faces.length % 9).toBe(0);
      expect(p.lines.every(Number.isFinite)).toBe(true);
    }
  });
  it("終端板的錨點在操作面板的包圍盒內", () => {
    const panel = parts.find((p) => p.name === "操作面板")!;
    for (let k = 0; k < 3; k++) {
      expect(PANEL_ANCHOR[k]!).toBeGreaterThanOrEqual(panel.min[k]! - 1e-6);
      expect(PANEL_ANCHOR[k]!).toBeLessThanOrEqual(panel.max[k]! + 1e-6);
    }
  });
  it("確定性：兩次產生的結果相同", () => {
    expect(buildMachine()).toEqual(parts);
  });
});
