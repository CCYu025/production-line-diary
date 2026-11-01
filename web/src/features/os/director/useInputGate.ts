import * as React from "react";
import { armInputGate } from "./inputGate";

/**
 * active＝轉場在交接點之前。見 inputGate.ts。
 * 用 layout effect：閘的裝上與移除要跟 DOM／phase 屬性在同一個 commit 發生，不能落在 passive effect 的延遲窗口裡
 * （否則「phase 已是 entering-post、閘卻還在」的瞬間點擊會被吞掉）。
 */
export function useInputGate(active: boolean, onSkip: () => void): void {
  const skipRef = React.useRef(onSkip);
  skipRef.current = onSkip;
  React.useLayoutEffect(() => {
    if (!active) return;
    const gate = armInputGate(window, () => skipRef.current());
    return () => gate.release();
  }, [active]);
}
