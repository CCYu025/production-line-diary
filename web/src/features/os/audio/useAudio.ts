/*
 * 音效的 React 接線（docs/os-mode-spec.md §8；X4）：
 *  - useAudioSession：OsStage 呼叫一次。第一次手勢啟用（window 捕獲階段的 keydown／pointerdown，不吞事件）、靜音偏好同步、
 *    分頁隱藏 suspend／可見 resume、卸載（離開 OS 模式）close。
 *  - useSoundButton：狀態列音效按鈕的狀態（SND ON／OFF／…／N/A 與中文 accessible name）。
 *
 * 手勢監聽器在 OsStage 的 layout effect 裡、早於輸入閘（useInputGate）裝上：同一個 window 捕獲階段按註冊順序執行，
 * 所以輸入閘 stopImmediatePropagation 吃掉的那一次手勢（B1、跳過）也會先啟用音效。
 */
import * as React from "react";
import { emitAudio, disposeAudioEngine, getAudioEngine, getAudioSnapshot, subscribeAudio, type AudioEngine, type EngineStatus } from "./engine";
import { useSoundPref, type SoundPref } from "./settings";

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "Fn", "OS"]);

/** 在 target 的捕獲階段裝上「第一次手勢啟用音效」；不呼叫 preventDefault／stopPropagation。回傳移除函式。 */
export function installGestureActivation(target: Window, engine: () => AudioEngine): () => void {
  const onKey = (e: Event) => {
    const k = (e as KeyboardEvent).key;
    if (MODIFIER_KEYS.has(k)) {
      engine().noteInput();
      return; // 只按修飾鍵不算手勢（但算輸入：延後建立要等它安靜）
    }
    engine().activate();
  };
  const onPointer = () => engine().activate();
  // 其餘輸入只記時間（延後建立 context 要等使用者 ≥1000ms 沒有任何輸入）；被動監聽、不影響捲動
  const onInput = () => engine().noteInput();
  const INPUT_EVENTS = ["pointermove", "pointerup", "wheel", "keyup", "touchstart", "touchmove"] as const;
  target.addEventListener("keydown", onKey, true);
  target.addEventListener("pointerdown", onPointer, true);
  for (const t of INPUT_EVENTS) target.addEventListener(t, onInput, { capture: true, passive: true });
  return () => {
    target.removeEventListener("keydown", onKey, true);
    target.removeEventListener("pointerdown", onPointer, true);
    for (const t of INPUT_EVENTS) target.removeEventListener(t, onInput, true);
  };
}

export interface AudioSessionState {
  /** 停在 B1（PRESS ANY KEY）：那一次手勢在處理函式裡同步建立 context（黑畫面，看不出卡頓）；其餘情況延後建立 */
  waiting: boolean;
  /** 轉場或開機進行中：延後的 context 建立要等它結束 */
  busy: boolean;
}

export function useAudioSession(session: AudioSessionState): void {
  const pref = useSoundPref();
  const sessionRef = React.useRef(session);
  sessionRef.current = session;

  React.useLayoutEffect(() => {
    getAudioEngine().configure({ shouldDefer: () => !sessionRef.current.waiting, isBusy: () => sessionRef.current.busy });
    emitAudio();
    return installGestureActivation(window, getAudioEngine);
  }, []);

  React.useLayoutEffect(() => {
    getAudioEngine().setMuted(pref === "off");
  }, [pref]);

  React.useEffect(() => {
    const onVisibility = () => {
      const e = getAudioEngine();
      if (document.visibilityState === "hidden") e.suspendForHidden();
      else e.resumeFromHidden();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "hidden") getAudioEngine().suspendForHidden();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      // 離開 OS 模式：close()
      disposeAudioEngine();
    };
  }, []);
}

export interface SoundButtonState {
  /** 按鈕上的字 */
  label: "SND ON" | "SND OFF" | "SND …" | "SND N/A";
  /** 中文 accessible name（完整句子） */
  name: string;
  pressed: boolean;
  disabled: boolean;
}

/** 純函式：偏好與引擎狀態 → 按鈕顯示。 */
export function soundButtonState(pref: SoundPref, status: EngineStatus, gestured = false): SoundButtonState {
  if (status === "unsupported") return { label: "SND N/A", name: "音效：此瀏覽器不支援", pressed: false, disabled: true };
  if (pref === "off") return { label: "SND OFF", name: "音效：已靜音，按下開啟", pressed: false, disabled: false };
  if (status === "running") return { label: "SND ON", name: "音效：開啟，按下切換為靜音", pressed: true, disabled: false };
  // 手勢已發生、context 還在等安靜視窗才建立（idle＋gestured）：準備中，不是在等按鍵
  if (status === "idle" && gestured) return { label: "SND …", name: "音效準備中", pressed: true, disabled: false };
  return { label: "SND …", name: "音效：開啟，等待第一次按鍵或點擊後才會出聲，按下切換為靜音", pressed: true, disabled: false };
}

export function useSoundButton(): SoundButtonState {
  const pref = useSoundPref();
  const snap = React.useSyncExternalStore(subscribeAudio, getAudioSnapshot, getAudioSnapshot);
  return soundButtonState(pref, snap.status, snap.gestured);
}
