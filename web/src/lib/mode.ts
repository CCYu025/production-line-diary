/*
 * 介面模式（docs/os-mode-spec.md §3.2）：「網頁模式」(web) 或「PLD/OS 1995」(os)。
 * X0 的偏離（設計師已核准）：OS 模式只存在於「這個分頁」——?mode=os｜web 寫進 sessionStorage（key：pld.mode.session），
 * 不讀寫 localStorage 的 pld.mode（跨分頁記憶與離開時寫回留到 X1）。
 * 模式在整個頁面生命週期內是靜態的：只有 initMode() 會決定它，之後 getMode() 永遠回傳同一個值。
 * 每次讀寫都包 try/catch，失敗一律當作 web。
 */

export type Mode = "web" | "os";

export const MODE_SESSION_KEY = "pld.mode.session";

let current: Mode = "web";

function isMode(v: unknown): v is Mode {
  return v === "web" || v === "os";
}

/** 目前模式（initMode 之前是 "web"）。 */
export function getMode(): Mode {
  return current;
}

/**
 * main.tsx 在 initTheme() 之後、createRoot 之前同步呼叫。
 * 網址 ?mode=os|web（hash 之前的 query）優先並寫進 sessionStorage，再用 history.replaceState 只把 mode 參數拿掉
 * （保留其他 query 與 #hash，不觸發導覽，比照 ?theme=）；否則讀這個分頁已存的值。
 */
export function initMode(): Mode {
  let mode: Mode = "web";
  try {
    const stored = window.sessionStorage.getItem(MODE_SESSION_KEY);
    if (isMode(stored)) mode = stored;
  } catch {
    mode = "web";
  }
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("mode");
    if (isMode(q)) {
      mode = q;
      try {
        window.sessionStorage.setItem(MODE_SESSION_KEY, q);
      } catch {
        /* 寫入失敗：只有這次載入有效 */
      }
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
  current = mode;
  return mode;
}

/** 測試用：回到初始狀態。 */
export function resetModeForTest(): void {
  current = "web";
}
