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
    if (MODIFIER_KEYS.has(k)) return; // 只按修飾鍵不算手勢
    engine().activate();
  };
  const onPointer = () => engine().activate();
  target.addEventListener("keydown", onKey, true);
  target.addEventListener("pointerdown", onPointer, true);
  return () => {
    target.removeEventListener("keydown", onKey, true);
    target.removeEventListener("pointerdown", onPointer, true);
  };
}

export function useAudioSession(): void {
  const pref = useSoundPref();

  React.useLayoutEffect(() => {
    getAudioEngine();
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
export function soundButtonState(pref: SoundPref, status: EngineStatus): SoundButtonState {
  if (status === "unsupported") return { label: "SND N/A", name: "音效：此瀏覽器不支援", pressed: false, disabled: true };
  if (pref === "off") return { label: "SND OFF", name: "音效：已靜音，按下開啟", pressed: false, disabled: false };
  if (status === "running") return { label: "SND ON", name: "音效：開啟，按下切換為靜音", pressed: true, disabled: false };
  return { label: "SND …", name: "音效：開啟，等待第一次按鍵或點擊後才會出聲，按下切換為靜音", pressed: true, disabled: false };
}

export function useSoundButton(): SoundButtonState {
  const pref = useSoundPref();
  const snap = React.useSyncExternalStore(subscribeAudio, getAudioSnapshot, getAudioSnapshot);
  return soundButtonState(pref, snap.status);
}
