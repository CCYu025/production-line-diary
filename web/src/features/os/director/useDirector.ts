import * as React from "react";
import { ENTER, EXIT } from "../transition/timing";
import { isPreHandoff, isTransition, reduce, type DirectorEvent, type DirectorState, type Place } from "./reducer";
import { initialState } from "./reducer";

/** 轉場時鐘：start 是目前這段轉場開始的 performance.now()；沒有轉場時是 null。疊層與 3D 鏡頭每幀讀它。 */
export interface TransitionClock {
  start: number | null;
}

export function transitionTotal(s: DirectorState): number {
  return s.kind === "ENTERING" ? ENTER.total : s.kind === "EXITING" ? EXIT.total : 0;
}

export function transitionHandoff(s: DirectorState): number {
  return s.kind === "ENTERING" ? ENTER.handoff : s.kind === "EXITING" ? EXIT.handoff : 0;
}

const placeKey = (p: Place) => (p.kind === "hub" ? "hub" : `ch:${p.ch ?? "-"}`);

/**
 * 路由同步：導演狀態在「render 期間」依路由推導（路由在轉場一開始就切換，頁面立刻開始載入，轉場只是視覺）。
 * 計時器只送 HANDOFF／DONE；使用者輸入由 useInputGate 送 INPUT。
 */
export function useDirector(place: Place, instant: boolean) {
  const [state, setState] = React.useState<DirectorState>(() => initialState(place));
  const [prevKey, setPrevKey] = React.useState(() => placeKey(place));
  const key = placeKey(place);
  if (key !== prevKey) {
    // 同一頻道內的導航 key 不變（例如 /records → /records/63/edit 都是 ch:CH-02），不會進到這裡
    setPrevKey(key);
    setState((s) => reduce(s, { type: "ROUTE", to: place, instant }));
  }

  const dispatch = React.useCallback((e: DirectorEvent) => setState((s) => reduce(s, e)), []);

  const clock = React.useRef<TransitionClock>({ start: null }).current;
  const transitionId = isTransition(state) ? `${state.kind}:${state.ch ?? "-"}` : "";

  // 時鐘與計時器：每段轉場開始時設一次（insertion effect：先於整棵樹的 layout／passive effect，所以疊層與鏡頭第一幀就讀得到起點）
  React.useInsertionEffect(() => {
    if (!transitionId) {
      clock.start = null;
      return;
    }
    const kind = transitionId.startsWith("ENTERING") ? ENTER : EXIT;
    clock.start = performance.now();
    const t1 = window.setTimeout(() => setState((s) => reduce(s, { type: "HANDOFF" })), kind.handoff);
    const t2 = window.setTimeout(() => setState((s) => reduce(s, { type: "DONE" })), kind.total);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [transitionId, clock]);

  const skip = React.useCallback(() => setState((s) => reduce(s, { type: "INPUT", swallowed: true })), []);
  return { state, dispatch, skip, clock, gateActive: isPreHandoff(state) };
}
