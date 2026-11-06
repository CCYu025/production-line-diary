import * as React from "react";
import { BOOT_FULL, BOOT_SHORT, ENTER, EXIT, SWITCH } from "../transition/timing";
import { decideB1, decideBoot, markB1Passed, markBootDone, readB1Passed, readBootDone } from "./boot";
import {
  bootState,
  initialState,
  isGateActive,
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
  /** 開機（BOOT）開始的 performance.now()；不在開機中是 null。3D 層與 BIOS 文字疊層每幀讀它（相對時間用 transition/timing.ts 的 BOOT_FULL／BOOT_SHORT） */
  bootStart: number | null;
}

/** 開機總長（毫秒）；非 BOOT 狀態回傳 0。 */
export function bootTotal(s: DirectorState): number {
  if (s.kind !== "BOOT") return 0;
  return s.short ? BOOT_SHORT.total : BOOT_FULL.total;
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
  // 開機決策只在掛載時做一次（boot.ts）：減少動態效果＝不開機；直接載入工作站＝不開機。
  // B1（X4）：完整開機之前、或減少動態效果的第一次控制室，先停在 BOOT＋b1 等第一次手勢（沒有計時器、不寫 key）
  const [state, setState] = React.useState<DirectorState>(() => {
    const done = readBootDone();
    const boot = decideBoot({ place, reduced: instant, done });
    if (decideB1({ place, reduced: instant, boot, passed: readB1Passed() })) return bootState(place, 0, boot === "short" || (boot === null && done), true);
    return boot ? bootState(place, 0, boot === "short") : initialState(place);
  });
  const [prevKey, setPrevKey] = React.useState(() => placeKey(place));
  const key = placeKey(place);
  if (key !== prevKey) {
    // 同一頻道內的導航 key 不變（例如 /records → /records/63/edit 都是 ch:CH-02），不會進到這裡
    setPrevKey(key);
    setState((s) => reduce(s, { type: "ROUTE", to: place, instant }));
  }

  const dispatch = React.useCallback((e: DirectorEvent) => setState((s) => reduce(s, e)), []);

  const clock = React.useRef<TransitionClock>({ start: null, bootStart: null }).current;
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

  // 開機：計時器送 DONE；開機結束（播完或被跳過）時寫 sessionStorage key。B1 等待手勢期間沒有計時器、bootStart 是 null（B2 在手勢那一刻才開始）
  const booting = state.kind === "BOOT";
  const waiting = state.kind === "BOOT" && !!state.b1;
  const bootShort = state.kind === "BOOT" && !!state.short;
  const bootGen = state.gen;
  React.useInsertionEffect(() => {
    if (!booting || waiting) {
      clock.bootStart = null;
      return;
    }
    clock.bootStart = performance.now();
    const t = window.setTimeout(() => setState((s) => reduce(s, { type: "DONE", gen: bootGen })), bootShort ? BOOT_SHORT.total : BOOT_FULL.total);
    return () => window.clearTimeout(t);
  }, [booting, waiting, bootShort, bootGen, clock]);
  // 開機結束寫 key：只有真的開過機（B2／B3 開始過）才寫；減少動態效果在 B1 之後直接進控制室不算（和 X2 一樣不寫）。B1 通過另外記
  const bootRan = React.useRef(false);
  const wasWaiting = React.useRef(waiting);
  React.useEffect(() => {
    if (wasWaiting.current && !waiting) markB1Passed();
    wasWaiting.current = waiting;
    if (booting && !waiting) bootRan.current = true;
    else if (!booting && bootRan.current) {
      bootRan.current = false;
      markBootDone();
    }
  }, [booting, waiting]);

  // 開機中打開「減少動態效果」：直接跳到結束（像跳過，但不吞任何輸入，也不經過輸入閘）
  React.useEffect(() => {
    if (instant && state.kind === "BOOT" && !state.b1) setState((s) => reduce(s, { type: "INPUT" }));
  }, [instant, state.kind, waiting]);

  // 轉場進行中打開「減少動態效果」：立刻跳到終點（疊層取消、鏡頭到終點位置、焦點與宣告走既有的抵達規則）。
  // 不經過輸入閘，也不吞任何輸入（不是使用者輸入）。交接點之後也要跳：swallowed 讓它無視交接旗標。
  const inTransition = isTransition(state);
  React.useEffect(() => {
    if (instant && inTransition) setState((s) => reduce(s, { type: "INPUT", swallowed: true }));
  }, [instant, inTransition]);

  // 輸入閘吃到的那一次手勢：B1 等待中＝通過 B1（減少動態效果直接進控制室）；其他＝跳過（轉場／開機）
  const instantRef = React.useRef(instant);
  instantRef.current = instant;
  const skip = React.useCallback(
    () => setState((s) => (s.kind === "BOOT" && s.b1 ? reduce(s, { type: "GESTURE", instant: instantRef.current }) : reduce(s, { type: "INPUT", swallowed: true }))),
    [],
  );
  return { state, dispatch, skip, clock, gateActive: isGateActive(state), waiting };
}
