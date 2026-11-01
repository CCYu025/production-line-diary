/*
 * 介面模式（docs/os-mode-spec.md §3.2、D1/D2）：「網頁模式」(web) 或「PLD/OS 1995」(os)。
 * X1：可訂閱的小型 store。偏好存在 localStorage（key：pld.mode，值 web｜os），每次讀寫都包 try/catch，失敗一律當作 web。
 * 執行期可切換（setMode），不需重新載入；ModeShell 以 useMode() 訂閱並在 AppShell 與 OsShell 之間切換。
 * 不做跨分頁同步（不監聽 storage 事件）：別的分頁改了偏好，只影響之後新開的頁面。
 */
import * as React from "react";

export type Mode = "web" | "os";

export const MODE_STORAGE_KEY = "pld.mode";
/** X0 的分頁層級 key（已廢止）：initMode 會把它清掉。 */
export const LEGACY_MODE_SESSION_KEY = "pld.mode.session";

let current: Mode = "web";
const listeners = new Set<() => void>();

function isMode(v: unknown): v is Mode {
  return v === "web" || v === "os";
}

function notify(): void {
  for (const l of Array.from(listeners)) l();
}

function writeStored(mode: Mode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* 隱私模式、被封鎖或已滿：只有這次載入有效 */
  }
}

/** 目前模式（initMode 之前是 "web"）。 */
export function getMode(): Mode {
  return current;
}

/** 訂閱模式變化；回傳取消訂閱函式。 */
export function subscribeMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 切換模式並寫進 localStorage；模式沒變就什麼都不做（不通知、不寫入）。 */
export function setMode(mode: Mode): void {
  if (mode === current) return;
  current = mode;
  writeStored(mode);
  notify();
}

/** React hook：目前模式，模式變化時重繪。 */
export function useMode(): Mode {
  return React.useSyncExternalStore(subscribeMode, getMode, getMode);
}

/**
 * main.tsx 在 initTheme() 之後、createRoot 之前同步呼叫。
 * 優先序：網址 ?mode=os|web（hash 之前的 query）＞ localStorage 的 pld.mode ＞ web。
 * ?mode 會寫回 localStorage，再用 history.replaceState 只把 mode 參數拿掉（保留其他 query 與 #hash，不觸發導覽，比照 ?theme=）。
 * 同時清掉 X0 的 sessionStorage pld.mode.session。
 */
export function initMode(): Mode {
  try {
    window.sessionStorage.removeItem(LEGACY_MODE_SESSION_KEY);
  } catch {
    /* 忽略 */
  }
  let mode: Mode = "web";
  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (isMode(stored)) mode = stored;
  } catch {
    mode = "web";
  }
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("mode");
    if (isMode(q)) {
      mode = q;
      writeStored(q);
      url.searchParams.delete("mode");
      try {
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      } catch {
        /* 取代網址失敗不影響模式 */
      }
    }
  } catch {
    /* 網址解析失敗就忽略 */
  }
  const changed = mode !== current;
  current = mode;
  if (changed) notify();
  return mode;
}

/** 測試用：回到初始狀態（web、無訂閱者）。 */
export function resetModeForTest(): void {
  current = "web";
  listeners.clear();
}
