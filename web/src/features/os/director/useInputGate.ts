import * as React from "react";
import { armInputGate } from "./inputGate";

/**
 * active＝轉場在交接點之前（或開機中，含 B1）。見 inputGate.ts。
 * 用 layout effect：閘的裝上與移除要跟 DOM／phase 屬性在同一個 commit 發生，不能落在 passive effect 的延遲窗口裡
 * （否則「phase 已是 entering-post、閘卻還在」的瞬間點擊會被吞掉）。
 */
export function useInputGate(active: boolean, onSkip: () => void, rearmKey: unknown = null): void {
  const skipRef = React.useRef(onSkip);
  skipRef.current = onSkip;
  React.useLayoutEffect(() => {
    if (!active) return;
    const gate = armInputGate(window, () => skipRef.current());
    return () => gate.release();
    // rearmKey 改變＝重新武裝（B1 的手勢結束、換成 B2 的跳過閘；已開始的那次手勢仍攔到結束）
  }, [active, rearmKey]);
}
