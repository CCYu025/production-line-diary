/*
 * 音效事件接線（docs/os-mode-spec.md §8；X4）：由導演狀態推導「什麼時候該發什麼聲」。
 *  - 開機 B2（完整、不含 B1 等待）：boot；離開 BOOT（播完或被跳過）時 30ms 淡出。
 *  - 進入：E1 rise（0）、E2 click（600ms）、E3 noise（750ms）；離開：X1 chirp（0）、X4 descend（300ms）；短轉場：noise（0）。
 *    時間取自 transition/timing.ts 的 token，用 context 時間排程（不靠 setTimeout 漂移）。
 *    轉場結束或被跳過（gen 改變、狀態離開轉場）：正在播的 30ms 淡出、還沒播的取消。每個事件各排一次。
 *  - 減少動態效果的直接切換（沒有轉場狀態）：只有一聲 cut 喀噠。
 *  - 嗡聲：只在 HUB（不含巡視以外任何條件）。
 *  - 雷達新異常：setAlertToneHook，2 秒內最多一次。
 */
import * as React from "react";
import { setAlertToneHook } from "../hub/alerts";
import { isTransition, transitionKindOf, type DirectorState } from "../director/reducer";
import type { TransitionClock } from "../director/useDirector";
import { ENTER, EXIT } from "../transition/timing";
import { getAudioEngine, type Playback } from "./engine";
import { ALERT_MIN_INTERVAL_MS, SKIP_FADE_MS } from "./sounds";

/** 直接切換（減少動態效果、沒有轉場狀態）：HUB／STATION 之間，或 STATION 換頻道。 */
export function isDirectCut(before: DirectorState, after: DirectorState): boolean {
  if (before === after) return false;
  if (before.kind === "HUB" && after.kind === "STATION") return true;
  if (before.kind === "STATION" && after.kind === "HUB") return true;
  return before.kind === "STATION" && after.kind === "STATION" && before.ch !== after.ch;
}

/** 警示音限流：minIntervalMs 內最多回呼一次。 */
export function createAlertTone(play: () => void, now: () => number = () => performance.now(), minIntervalMs: number = ALERT_MIN_INTERVAL_MS): () => void {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < minIntervalMs) return;
    last = t;
    play();
  };
}

/** 轉場內各音效的起點（毫秒，相對轉場開始）。 */
export const TRANSITION_CUES = {
  enter: [
    { id: "enterRise", atMs: 0 },
    { id: "enterClick", atMs: ENTER.E2[0] },
    { id: "enterNoise", atMs: ENTER.E3[0] },
  ],
  exit: [
    { id: "exitChirp", atMs: 0 },
    { id: "exitDescend", atMs: EXIT.X4[0] },
  ],
  switch: [{ id: "switchNoise", atMs: 0 }],
} as const;

export function useAudioEvents(state: DirectorState, clock: TransitionClock, suspended: boolean): void {
  // ---- 開機 B2 ----
  const bootFull = state.kind === "BOOT" && !state.short && !state.b1;
  const bootGen = state.gen;
  React.useEffect(() => {
    if (!bootFull || suspended) return;
    const playback = getAudioEngine().play("boot");
    return () => playback.cancel(SKIP_FADE_MS);
  }, [bootFull, bootGen, suspended]);

  // ---- 轉場 ----
  const kind = transitionKindOf(state);
  const gen = isTransition(state) ? state.gen : -1;
  React.useEffect(() => {
    if (!kind || suspended) return;
    const engine = getAudioEngine();
    const lagMs = clock.start != null ? Math.max(0, performance.now() - clock.start) : 0;
    const playbacks: Playback[] = TRANSITION_CUES[kind].map((c) => engine.play(c.id, Math.max(0, c.atMs - lagMs) / 1000));
    return () => {
      for (const p of playbacks) p.cancel(SKIP_FADE_MS);
    };
  }, [kind, gen, suspended, clock]);

  // ---- 直接切換（減少動態效果） ----
  const prev = React.useRef(state);
  React.useEffect(() => {
    const before = prev.current;
    prev.current = state;
    if (!suspended && isDirectCut(before, state)) getAudioEngine().play("cut");
  }, [state, suspended]);

  // ---- 嗡聲：只在 HUB ----
  const wantHum = state.kind === "HUB" && !suspended;
  React.useEffect(() => {
    getAudioEngine().setHum(wantHum);
  }, [wantHum]);

  // ---- 雷達新異常 ----
  React.useEffect(() => {
    setAlertToneHook(createAlertTone(() => void getAudioEngine().play("alert")));
    return () => setAlertToneHook(null);
  }, []);
}
