import * as React from "react";
import { armInputGate } from "./inputGate";

/** active＝轉場在交接點之前。見 inputGate.ts。 */
export function useInputGate(active: boolean, onSkip: () => void): void {
  const skipRef = React.useRef(onSkip);
  skipRef.current = onSkip;
  React.useEffect(() => {
    if (!active) return;
    const gate = armInputGate(window, () => skipRef.current());
    return () => gate.release();
  }, [active]);
}
