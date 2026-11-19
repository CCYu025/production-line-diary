import { describe, expect, it } from "vitest";
import type { DiaryRecord } from "@/lib/types";
import { makeRecord } from "@/test/recordsHarness";
import { isRecurringProblem, topProblemOf } from "./recurring";

const many = (problem: string, n: number, startId: number, extra: Partial<DiaryRecord> = {}) =>
  Array.from({ length: n }, (_, i) => makeRecord({ id: startId + i, problem, ...extra }));

describe("isRecurringProblem", () => {
  it("門檻邊界：2 次 → 0；3 次 → 3；4 次 → 4", () => {
    const probe = makeRecord({ id: 900, problem: "卡料" });
    expect(isRecurringProblem(many("卡料", 2, 1), probe)).toBe(0);
    expect(isRecurringProblem(many("卡料", 3, 1), probe)).toBe(3);
    expect(isRecurringProblem(many("卡料", 4, 1), probe)).toBe(4);
  });

  it("比對的是 problem 文字，不是 category", () => {
    const records = many("卡料", 3, 1, { category: "機構" });
    expect(isRecurringProblem(records, makeRecord({ id: 900, problem: "別的問題", category: "機構" }))).toBe(0);
    expect(isRecurringProblem(records, makeRecord({ id: 901, problem: "卡料", category: "電控" }))).toBe(3);
  });

  it("不是最高頻的問題 → 0（即使它自己也 ≥ 3 次）", () => {
    const records = [...many("A", 5, 1), ...many("B", 3, 10)];
    expect(isRecurringProblem(records, makeRecord({ id: 900, problem: "A" }))).toBe(5);
    expect(isRecurringProblem(records, makeRecord({ id: 901, problem: "B" }))).toBe(0);
  });

  it("平手時沿用 aggregate 的排序（先出現的那個）", () => {
    const records = [...many("A", 3, 1), ...many("B", 3, 10)];
    expect(topProblemOf(records)?.label).toBe("A");
    expect(isRecurringProblem(records, makeRecord({ id: 900, problem: "B" }))).toBe(0);
  });

  it("統計由 aggregate 負責，軟刪除的紀錄不計入次數", () => {
    const records = [...many("卡料", 2, 1), ...many("卡料", 3, 10, { deleted: true })];
    expect(isRecurringProblem(records, makeRecord({ id: 900, problem: "卡料" }))).toBe(0);
  });

  it("空資料 → 0、topProblemOf → null", () => {
    expect(topProblemOf([])).toBeNull();
    expect(isRecurringProblem([], makeRecord({ id: 1, problem: "卡料" }))).toBe(0);
  });
});
