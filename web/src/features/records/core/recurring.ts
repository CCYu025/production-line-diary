import { aggregate } from "@shared/aggregate";
import type { DiaryRecord } from "@/lib/types";

/** 「重複發生」的門檻：全部紀錄中出現最多次的問題，次數 ≥ 3 才算。 */
export const RECURRING_THRESHOLD = 3;

export interface TopProblem {
  label: string;
  count: number;
}

/**
 * 全部紀錄中出現最多次的問題（平手時沿用 aggregate 的既有排序）。沒有紀錄時為 null。
 * `records` 是完整紀錄陣列（含軟刪除）：統計一律交給 `aggregate`（它自己排除已刪除的）。
 */
export function topProblemOf(records: readonly DiaryRecord[]): TopProblem | null {
  return aggregate(records as DiaryRecord[], "all").problemRanked[0] ?? null;
}

/**
 * 這筆紀錄的問題是「重複發生」嗎？是則回傳次數，否則 0（0 表示不顯示標籤）。
 * 條件：這筆的 `problem` 就是全部紀錄中出現最多次的那個問題（`top`），且次數 ≥ 3。
 * 元件先用 `topProblemOf(records)` 依 records 記憶一次 top，每筆紀錄只做這個便宜的比對。
 */
export function recurringCount(top: TopProblem | null, r: Pick<DiaryRecord, "problem">): number {
  return top && top.count >= RECURRING_THRESHOLD && top.label === r.problem ? top.count : 0;
}

/** `recurringCount(topProblemOf(records), r)` 的一步版本。 */
export function isRecurringProblem(records: readonly DiaryRecord[], r: Pick<DiaryRecord, "problem">): number {
  return recurringCount(topProblemOf(records), r);
}
