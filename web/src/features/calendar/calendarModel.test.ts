import { describe, expect, it } from "vitest";
import { buildMonthGrid, colorStep, formatMonthParam, parseMonthParam, shiftMonth, STEP_CLASS } from "./calendarModel";

describe("月份 ⇄ 網址", () => {
  it("parseMonthParam 認得 YYYY-MM，其餘回 null", () => {
    expect(parseMonthParam("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonthParam("2026-1")).toBeNull();
    expect(parseMonthParam("2026-13")).toBeNull();
    expect(parseMonthParam("2026-00")).toBeNull();
    expect(parseMonthParam("0002-05")).toBeNull();
    expect(parseMonthParam("abc")).toBeNull();
    expect(parseMonthParam(null)).toBeNull();
  });

  it("formatMonthParam 補零", () => {
    expect(formatMonthParam({ year: 2026, month: 3 })).toBe("2026-03");
  });

  it("shiftMonth 會跨年", () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 10 }, 0)).toEqual({ year: 2026, month: 10 });
  });
});

describe("buildMonthGrid", () => {
  it("2026 年 10 月：1 日是星期四，共 31 天、5 週，前後用 null 補位", () => {
    const weeks = buildMonthGrid({ year: 2026, month: 10 });
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0]![4]).toEqual({ day: 1, date: "2026-10-01" });
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks[4]![6]).toEqual({ day: 31, date: "2026-10-31" });
  });

  it("2026 年 2 月（28 天、1 日是星期日）剛好 4 週、沒有補位", () => {
    const weeks = buildMonthGrid({ year: 2026, month: 2 });
    expect(weeks).toHaveLength(4);
    expect(weeks.flat().every(Boolean)).toBe(true);
  });
});

describe("colorStep（與舊 UI 同樣的門檻：> 0.7、> 0.4、其餘）", () => {
  it("邊界值", () => {
    expect(colorStep(10, 10)).toBe(3);
    expect(colorStep(8, 10)).toBe(3); // 0.8
    expect(colorStep(7, 10)).toBe(2); // 0.7 不大於 0.7
    expect(colorStep(5, 10)).toBe(2);
    expect(colorStep(4, 10)).toBe(1); // 0.4 不大於 0.4
    expect(colorStep(1, 10)).toBe(1);
  });

  it("最大值是 0 時不會除以 0", () => {
    expect(colorStep(0, 0)).toBe(1);
  });

  it("每個色階都有底色與會翻轉的文字色 token", () => {
    expect(STEP_CLASS[1]).toContain("bg-seq-300");
    expect(STEP_CLASS[1]).toContain("text-ink-1");
    expect(STEP_CLASS[2]).toContain("bg-seq-450");
    expect(STEP_CLASS[3]).toContain("bg-seq-600");
    expect(STEP_CLASS[2]).toContain("text-accent-ink");
    expect(STEP_CLASS[3]).toContain("text-accent-ink");
  });
});
