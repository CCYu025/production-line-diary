/*
 * CRT 強度設定（docs/os-mode-spec.md §4.7、D7；X2）：關（off）／標準（std，預設）／濃（max）。
 * 偏好存在 localStorage（key：pld.os.crt），每次讀寫都包 try/catch，失敗一律當作預設（標準）。
 * 可訂閱的小型 store：指令列 `crt off|std|max` 與狀態列的三段切換都呼叫 setCrtLevel，A 區（著色器）與 B 區（CSS 疊層）用 useCrtLevel 讀。
 * 不同分頁：監聽 storage 事件同步（和 pld.mode 不同——強度是純外觀，同步無害）。
 */
import * as React from "react";

export type CrtLevel = "off" | "std" | "max";

export const CRT_STORAGE_KEY = "pld.os.crt";
export const CRT_DEFAULT: CrtLevel = "std";
export const CRT_LEVELS: readonly CrtLevel[] = ["off", "std", "max"];
/** 介面顯示用的名稱（狀態列三段切換的標籤） */
export const CRT_LABEL: Record<CrtLevel, string> = { off: "關", std: "標準", max: "濃" };

export function isCrtLevel(v: unknown): v is CrtLevel {
  return v === "off" || v === "std" || v === "max";
}

/** 解析儲存的字串；不合法一律是預設。 */
export function parseCrtLevel(raw: unknown): CrtLevel {
  return isCrtLevel(raw) ? raw : CRT_DEFAULT;
}

function readStored(): CrtLevel {
  try {
    return parseCrtLevel(window.localStorage.getItem(CRT_STORAGE_KEY));
  } catch {
    return CRT_DEFAULT;
  }
}

function writeStored(level: CrtLevel): void {
  try {
    window.localStorage.setItem(CRT_STORAGE_KEY, level);
  } catch {
    /* 隱私模式、被封鎖或已滿：只有這次載入有效 */
  }
}

let current: CrtLevel | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of Array.from(listeners)) l();
}

/** 目前強度（第一次讀取時從 localStorage 載入）。 */
export function getCrtLevel(): CrtLevel {
  if (current === null) current = readStored();
  return current;
}

/** 設定強度並寫入；沒變就什麼都不做。 */
export function setCrtLevel(level: CrtLevel): void {
  if (getCrtLevel() === level) return;
  current = level;
  writeStored(level);
  emit();
}

export function subscribeCrt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== CRT_STORAGE_KEY) return;
  const next = readStored();
  if (next === current) return;
  current = next;
  emit();
}

/** React hook：目前強度；變化時重繪。同時訂閱 storage 事件（別的分頁改了也跟著）。 */
export function useCrtLevel(): CrtLevel {
  React.useEffect(() => {
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return React.useSyncExternalStore(subscribeCrt, getCrtLevel, () => CRT_DEFAULT);
}

/** 測試用：丟掉記憶體中的值（下次讀取重新從 localStorage 載入）。 */
export function resetCrtForTest(): void {
  current = null;
  listeners.clear();
}
