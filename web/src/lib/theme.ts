/*
 * 介面主題（docs/cyber-theme-spec.md §3.1）：「標準」（淺色／深色跟隨系統）或「CYBER」（Cyber-Terminal）。
 * 主題狀態只放在 <html data-theme="cyber"> 這一個屬性上；現有的 data-theme="light|dark" 強制指定機制保留，
 * 只是 cyber 啟用期間會被 "cyber" 暫時蓋過，切回標準時還原。
 * 偏好存在 localStorage（key：pld.theme）；每次讀寫都包 try/catch，失敗一律當作「標準」。
 */

export type ThemePreference = "standard" | "cyber";

export const THEME_STORAGE_KEY = "pld.theme";

const CYBER_COLOR_SCHEME = "dark";

/**
 * index.html <head> 裡有一小段同步 inline script，在第一次繪製之前就把 <html data-theme="cyber"> 設好（避免閃一幀標準主題）。
 * 它同時把 color-scheme meta 的原值記在 <html> 的這個屬性上，這樣 applyTheme 之後切回標準時才能把 meta 還原成原值。
 * theme.test.ts 會執行那段 script，並檢查它用的 storage key、cyber 值與這個屬性名稱都和這裡一致。
 */
export const PREV_COLOR_SCHEME_ATTR = "data-prev-color-scheme";

function isThemePreference(v: unknown): v is ThemePreference {
  return v === "standard" || v === "cyber";
}

/** 讀取已儲存的偏好；沒有、值不認得、或 localStorage 丟例外時回傳 "standard"。 */
export function getThemePreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : "standard";
  } catch {
    return "standard";
  }
}

/** 儲存偏好；localStorage 寫入失敗時靜默略過（本次工作階段仍可用 applyTheme 套用）。 */
export function setThemePreference(v: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, v);
  } catch {
    /* 隱私模式、被封鎖或已滿：當作沒有記憶功能 */
  }
}

// ---- 套用到 <html> ----

/** 進入 cyber 之前 <html> 上原有的 data-theme（"light"｜"dark"｜沒有），切回標準時還原。 */
let previousForcedTheme: string | undefined;
/** 進入 cyber 之前 <meta name="color-scheme"> 的內容；null＝原本沒有這個 meta；undefined＝還沒進過 cyber（不需還原）。 */
let previousColorScheme: string | null | undefined;

const listeners = new Set<() => void>();

/** index.html 的 inline script 已先把 <html> 設成 cyber 時，接手它留下的 color-scheme 原值（只接手一次）。 */
function adoptInlineScriptState(root: HTMLElement): void {
  if (root.dataset.theme !== "cyber" || previousColorScheme !== undefined) return;
  const prev = root.getAttribute(PREV_COLOR_SCHEME_ATTR);
  if (prev !== null) {
    previousColorScheme = prev;
    root.removeAttribute(PREV_COLOR_SCHEME_ATTR);
  }
}

function colorSchemeMeta(): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
}

/** 目前 <html> 上實際生效的主題（以 DOM 為準，所以 localStorage 壞掉時畫面與狀態仍一致）。 */
export function getAppliedTheme(): ThemePreference {
  return document.documentElement.dataset.theme === "cyber" ? "cyber" : "standard";
}

/**
 * 把主題套用到 <html>：cyber 時設 data-theme="cyber" 並把 color-scheme meta 設為 dark；
 * 標準時移除 cyber 值、還原原本的 data-theme／meta（標準主題的最終狀態與沒有這套機制時完全一樣）。
 * 重複呼叫是安全的。
 */
export function applyTheme(v: ThemePreference): void {
  const root = document.documentElement;
  adoptInlineScriptState(root);
  const wasCyber = root.dataset.theme === "cyber";
  if (v === "cyber") {
    if (!wasCyber) {
      previousForcedTheme = root.dataset.theme;
      const meta = colorSchemeMeta();
      previousColorScheme = meta ? meta.content : null;
      root.dataset.theme = "cyber";
    }
    let meta = colorSchemeMeta();
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "color-scheme";
      document.head.appendChild(meta);
    }
    meta.content = CYBER_COLOR_SCHEME;
  } else if (wasCyber) {
    if (previousForcedTheme === undefined) delete root.dataset.theme;
    else root.dataset.theme = previousForcedTheme;
    previousForcedTheme = undefined;
    if (previousColorScheme !== undefined) {
      const meta = colorSchemeMeta();
      if (previousColorScheme === null) meta?.remove();
      else if (meta) meta.content = previousColorScheme;
      previousColorScheme = undefined;
    }
  }
  listeners.forEach((fn) => fn());
}

/** 使用者切換主題：存偏好並立刻套用（不重新整理頁面）。 */
export function switchTheme(v: ThemePreference): void {
  setThemePreference(v);
  applyTheme(v);
}

/**
 * 開機時決定要用哪個主題：網址 ?theme=cyber|standard（hash 之前的 query）優先並寫回偏好，
 * 並用 history.replaceState 只把 theme 參數從網址拿掉（保留其他 query 與 #hash 路由，不觸發導覽）；
 * 否則用已儲存的偏好。回傳決定的結果（尚未套用）。
 */
export function resolveInitialTheme(): ThemePreference {
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("theme");
    if (isThemePreference(q)) {
      setThemePreference(q);
      url.searchParams.delete("theme");
      try {
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      } catch {
        /* 取代網址失敗不影響主題 */
      }
      return q;
    }
  } catch {
    /* 網址解析失敗就忽略 */
  }
  return getThemePreference();
}

let storageListenerRegistered = false;

/**
 * 別的分頁改了偏好（localStorage 的 storage 事件）：這個分頁跟著套用。
 * 用 applyTheme 而不是 switchTheme——偏好已經被那個分頁寫好了，這裡不再寫回。
 * key 為 null 是 localStorage.clear()，視為標準；值不認得也當標準。
 */
function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== THEME_STORAGE_KEY) return;
  try {
    if (e.storageArea && e.storageArea !== window.localStorage) return;
  } catch {
    return;
  }
  applyTheme(e.key !== null && isThemePreference(e.newValue) ? e.newValue : "standard");
}

/** main.tsx 在 createRoot 之前同步呼叫，避免先閃一下標準主題；同時開始監聽其他分頁的切換（只註冊一次）。 */
export function initTheme(): ThemePreference {
  const v = resolveInitialTheme();
  applyTheme(v);
  if (!storageListenerRegistered) {
    storageListenerRegistered = true;
    window.addEventListener("storage", onStorage);
  }
  return v;
}

// ---- 訂閱（給 React 的 useSyncExternalStore 與 useFx 用） ----

let observer: MutationObserver | null = null;

/**
 * 訂閱「<html> 的主題改變」：applyTheme 會同步通知；別處直接改 data-theme 屬性（例如測試、開發者工具）
 * 則由 MutationObserver 通知。回傳取消訂閱函式。
 */
export function subscribeTheme(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => listeners.forEach((fn) => fn()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}
