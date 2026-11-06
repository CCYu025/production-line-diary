/*
 * 音效開關（docs/os-mode-spec.md §8；X4）：開（on，預設）／關（off）。
 * 偏好存在 localStorage（key：pld.os.sound），每次讀寫都包 try/catch，失敗一律當作預設（開）。
 * 結構與 crt/settings.ts 相同：可訂閱的小型 store；狀態列按鈕、`M` 鍵與指令列 `sound on|off` 都呼叫 setSoundEnabled。
 * 不同分頁：監聽 storage 事件同步。
 */
import * as React from "react";

export type SoundPref = "on" | "off";

export const SOUND_STORAGE_KEY = "pld.os.sound";
export const SOUND_DEFAULT: SoundPref = "on";
export const SOUND_PREFS: readonly SoundPref[] = ["on", "off"];

export function isSoundPref(v: unknown): v is SoundPref {
  return v === "on" || v === "off";
}

/** 解析儲存的字串；不合法一律是預設。 */
export function parseSoundPref(raw: unknown): SoundPref {
  return isSoundPref(raw) ? raw : SOUND_DEFAULT;
}

function readStored(): SoundPref {
  try {
    return parseSoundPref(window.localStorage.getItem(SOUND_STORAGE_KEY));
  } catch {
    return SOUND_DEFAULT;
  }
}

function writeStored(pref: SoundPref): void {
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, pref);
  } catch {
    /* 隱私模式、被封鎖或已滿：只有這次載入有效 */
  }
}

let current: SoundPref | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of Array.from(listeners)) l();
}

/** 目前偏好（第一次讀取時從 localStorage 載入）。 */
export function getSoundPref(): SoundPref {
  if (current === null) current = readStored();
  return current;
}

export const isSoundEnabled = (): boolean => getSoundPref() === "on";

/** 設定並寫入；沒變就什麼都不做。 */
export function setSoundPref(pref: SoundPref): void {
  if (getSoundPref() === pref) return;
  current = pref;
  writeStored(pref);
  emit();
}

export const setSoundEnabled = (enabled: boolean): void => setSoundPref(enabled ? "on" : "off");

export function toggleSound(): void {
  setSoundEnabled(!isSoundEnabled());
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== SOUND_STORAGE_KEY) return;
  const next = readStored();
  if (next === current) return;
  current = next;
  emit();
}

/** React hook：目前偏好是否為開；變化時重繪。同時訂閱 storage 事件（別的分頁改了也跟著）。 */
export function useSoundPref(): SoundPref {
  React.useEffect(() => {
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return React.useSyncExternalStore(subscribeSound, getSoundPref, () => SOUND_DEFAULT);
}

/** 測試用：丟掉記憶體中的值（下次讀取重新從 localStorage 載入）。 */
export function resetSoundForTest(): void {
  current = null;
  listeners.clear();
}
