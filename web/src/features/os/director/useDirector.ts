import * as React from "react";
import { ENTER, EXIT, SWITCH } from "../transition/timing";
import {
  initialState,
  isPreHandoff,
  isTransition,
  reduce,
  transitionKindOf,
  type DirectorEvent,
  type DirectorState,
  type Place,
  type TransitionKind,
} from "./reducer";

/** 轉場時鐘：start 是目前這段轉場開始的 performance.now()；沒有轉場時是 null。疊層與 3D 鏡頭每幀讀它。 */
export interface TransitionClock {
  start: number | null;
}

const TIMING: Record<TransitionKind, { total: number; handoff: number }> = {
  enter: ENTER,
  exit: EXIT,
  switch: SWITCH,
};

export function transitionTotal(s: DirectorState): number {
  const k = transitionKindOf(s);
  return k ? TIMING[k].total : 0;
}

export function transitionHandoff(s: DirectorState): number {
  const k = transitionKindOf(s);
  return k ? TIMING[k].handoff : 0;
}

const placeKey = (p: Place) => (p.kind === "hub" ? "hub" : `ch:${p.ch ?? "-"}`);

/**
 * 路由同步：導演狀態在「render 期間」依路由推導（路由在轉場一開始就切換，頁面立刻開始載入，轉場只是視覺）。
 * 計時器只送 HANDOFF／DONE，且事件帶著建立計時器時的 gen（過期的計時器不會影響新轉場）；使用者輸入由 useInputGate 送 INPUT。
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
  // 每段轉場有唯一的 gen；-1＝目前沒有轉場
  const transitionGen = isTransition(state) ? state.gen : -1;
  const kind = transitionKindOf(state);

  // 時鐘與計時器：每段轉場（以 gen 區分）開始時設一次（insertion effect：先於整棵樹的 layout／passive effect，所以疊層與鏡頭第一幀就讀得到起點）
  React.useInsertionEffect(() => {
    if (transitionGen < 0 || !kind) {
      clock.start = null;
      return;
    }
    const timing = TIMING[kind];
    const gen = transitionGen;
    clock.start = performance.now();
    const t1 = window.setTimeout(() => setState((s) => reduce(s, { type: "HANDOFF", gen })), timing.handoff);
    const t2 = window.setTimeout(() => setState((s) => reduce(s, { type: "DONE", gen })), timing.total);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [transitionGen, kind, clock]);

  const skip = React.useCallback(() => setState((s) => reduce(s, { type: "INPUT", swallowed: true })), []);
  return { state, dispatch, skip, clock, gateActive: isPreHandoff(state) };
}
