import * as React from "react";
import { createIdlePatrol, type IdlePatrol } from "./patrol";

/**
 * 待機巡視旗標（見 patrol.ts）。eligible＝導演在 HUB 且介面沒暫停且沒有減少動態效果（呼叫端組合）。
 * 回傳 true 時場景層讓鏡頭巡視；任何輸入立刻回 false（輸入不被吞掉）。
 */
export function usePatrol(eligible: boolean): boolean {
  const [patrolling, setPatrolling] = React.useState(false);
  const ref = React.useRef<IdlePatrol | null>(null);
  React.useEffect(() => {
    const p = createIdlePatrol({ onChange: setPatrolling, target: window });
    ref.current = p;
    return () => {
      p.dispose();
      ref.current = null;
    };
  }, []);
  React.useEffect(() => {
    ref.current?.setEligible(eligible);
  }, [eligible]);
  return patrolling;
}
