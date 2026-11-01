/*
 * 焦點規則（docs/os-mode-spec.md §6、brief 第 12 項）：目的地「出現」的那一刻，焦點移到目的地。
 * - 進入／切換：交接點（或被輸入／減少動態效果直接跳到終點的那一刻）→ 工作站主內容
 * - 離開：交接點（或跳到終點）→ 控制室選中的頻道按鈕
 * 純函式：比較前後兩個導演狀態，回傳目的地剛出現的是哪一個（沒有則 null）。
 */
import type { DirectorState } from "./reducer";

export type Arrival = "station" | "hub";

type Enterish = Extract<DirectorState, { kind: "ENTERING" | "SWITCHING" }>;

const isEnterish = (s: DirectorState): s is Enterish => s.kind === "ENTERING" || s.kind === "SWITCHING";

export function arrivalOf(before: DirectorState, after: DirectorState): Arrival | null {
  if (before === after) return null;

  if (isEnterish(after) && after.handoff) {
    const sameTransition = before.kind === after.kind && before.gen === after.gen;
    return sameTransition && (before as Enterish).handoff ? null : "station";
  }
  if (after.kind === "EXITING" && after.handoff) {
    const sameTransition = before.kind === "EXITING" && before.gen === after.gen;
    return sameTransition && before.handoff ? null : "hub";
  }
  if (after.kind === "STATION") {
    if (isEnterish(before)) return before.handoff ? null : "station"; // 交接點之前被跳到終點
    if (before.kind === "HUB" || before.kind === "EXITING") return "station"; // 減少動態效果：直接切換
    if (before.kind === "STATION" && before.ch !== after.ch) return "station"; // 同上（頻道之間）
    return null;
  }
  if (after.kind === "HUB") {
    if (before.kind === "BOOT") return "hub"; // 開機結束（播完或被跳過）：焦點到選中的頻道按鈕
    if (before.kind === "EXITING") return before.handoff ? null : "hub";
    if (before.kind === "STATION" || isEnterish(before)) return "hub"; // 減少動態效果：直接切換
    return null;
  }
  return null;
}
