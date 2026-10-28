import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREV_COLOR_SCHEME_ATTR,
  THEME_STORAGE_KEY,
  applyTheme,
  getAppliedTheme,
  getThemePreference,
  initTheme,
  setThemePreference,
  subscribeTheme,
  switchTheme,
} from "./theme";

const root = document.documentElement;

function addMeta(content: string) {
  const meta = document.createElement("meta");
  meta.name = "color-scheme";
  meta.content = content;
  document.head.appendChild(meta);
  return meta;
}
const metaContent = () => document.querySelector('meta[name="color-scheme"]')?.getAttribute("content") ?? null;

function setUrl(suffix: string) {
  window.history.replaceState(null, "", `/${suffix}`);
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  applyTheme("standard");
  delete root.dataset.theme;
  root.removeAttribute(PREV_COLOR_SCHEME_ATTR);
  document.querySelectorAll('meta[name="color-scheme"]').forEach((m) => m.remove());
  window.localStorage.clear();
  setUrl("");
});

describe("getThemePreference / setThemePreference", () => {
  it("沒有儲存時是 standard；存 cyber 後讀得回來（key：pld.theme）", () => {
    expect(getThemePreference()).toBe("standard");
    setThemePreference("cyber");
    expect(window.localStorage.getItem("pld.theme")).toBe("cyber");
    expect(getThemePreference()).toBe("cyber");
    setThemePreference("standard");
    expect(getThemePreference()).toBe("standard");
  });

  it("儲存的值不認得時當作 standard", () => {
    window.localStorage.setItem("pld.theme", "neon");
    expect(getThemePreference()).toBe("standard");
  });

  it("讀取時 localStorage 丟例外：回傳 standard、不拋錯", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(getThemePreference()).toBe("standard");
  });

  it("寫入時 localStorage 丟例外：不拋錯", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => setThemePreference("cyber")).not.toThrow();
  });

  it("連 window.localStorage 本身都拋例外（被封鎖的瀏覽器）也安全", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(getThemePreference()).toBe("standard");
    expect(() => setThemePreference("cyber")).not.toThrow();
  });
});

describe("applyTheme", () => {
  it("cyber：設定 data-theme 並把 color-scheme meta 設成 dark；standard：移除並還原 meta", () => {
    addMeta("light dark");
    applyTheme("cyber");
    expect(root.dataset.theme).toBe("cyber");
    expect(metaContent()).toBe("dark");
    expect(getAppliedTheme()).toBe("cyber");

    applyTheme("standard");
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(metaContent()).toBe("light dark");
    expect(getAppliedTheme()).toBe("standard");
  });

  it("一開始就是標準時不動 meta 與 data-theme（標準主題與沒有這套機制時完全一樣）", () => {
    addMeta("light dark");
    applyTheme("standard");
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(metaContent()).toBe("light dark");
  });

  it("重複套用 cyber 不會把「原本的值」覆寫成 cyber", () => {
    addMeta("light dark");
    applyTheme("cyber");
    applyTheme("cyber");
    applyTheme("standard");
    expect(metaContent()).toBe("light dark");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("保留既有的 data-theme=light|dark 強制指定：cyber 期間蓋過，切回標準時還原", () => {
    for (const forced of ["light", "dark"]) {
      root.dataset.theme = forced;
      applyTheme("cyber");
      expect(root.dataset.theme).toBe("cyber");
      applyTheme("standard");
      expect(root.dataset.theme).toBe(forced);
    }
  });

  it("標準主題下不碰別人設定的 data-theme=light|dark", () => {
    root.dataset.theme = "dark";
    applyTheme("standard");
    expect(root.dataset.theme).toBe("dark");
  });

  it("頁面原本沒有 color-scheme meta：cyber 時建立，切回標準時移除", () => {
    applyTheme("cyber");
    expect(metaContent()).toBe("dark");
    applyTheme("standard");
    expect(metaContent()).toBeNull();
  });

  it("同步通知訂閱者；取消訂閱後不再通知", () => {
    const fn = vi.fn();
    const off = subscribeTheme(fn);
    applyTheme("cyber");
    expect(fn).toHaveBeenCalled();
    fn.mockClear();
    off();
    applyTheme("standard");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("switchTheme", () => {
  it("存偏好並立刻套用", () => {
    switchTheme("cyber");
    expect(getThemePreference()).toBe("cyber");
    expect(root.dataset.theme).toBe("cyber");
    switchTheme("standard");
    expect(getThemePreference()).toBe("standard");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("localStorage 壞掉時仍然套用到畫面（只是不會記住）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    switchTheme("cyber");
    expect(root.dataset.theme).toBe("cyber");
  });
});

describe("initTheme（開機：網址 ?theme= ＞ 已儲存的偏好）", () => {
  it("?theme=cyber 套用並寫回偏好", () => {
    setUrl("?theme=cyber");
    expect(initTheme()).toBe("cyber");
    expect(root.dataset.theme).toBe("cyber");
    expect(window.localStorage.getItem("pld.theme")).toBe("cyber");
  });

  it("?theme=standard 套用並寫回偏好（覆寫已儲存的 cyber）", () => {
    window.localStorage.setItem("pld.theme", "cyber");
    setUrl("?theme=standard");
    expect(initTheme()).toBe("standard");
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem("pld.theme")).toBe("standard");
  });

  it("沒有網址參數時用已儲存的偏好", () => {
    window.localStorage.setItem("pld.theme", "cyber");
    expect(initTheme()).toBe("cyber");
    expect(root.dataset.theme).toBe("cyber");
  });

  it("網址參數不認得時忽略，改用已儲存的偏好", () => {
    window.localStorage.setItem("pld.theme", "cyber");
    setUrl("?theme=neon");
    expect(initTheme()).toBe("cyber");
    expect(window.localStorage.getItem("pld.theme")).toBe("cyber");
  });

  it("hash 後面的 ?theme 不算（只看 hash 之前的 query）", () => {
    setUrl("#/dashboard?theme=cyber");
    expect(initTheme()).toBe("standard");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("localStorage 壞掉：?theme=cyber 仍然套用", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setUrl("?theme=cyber");
    expect(initTheme()).toBe("cyber");
    expect(root.dataset.theme).toBe("cyber");
  });
});

describe("?theme= 套用後只把 theme 參數從網址拿掉", () => {
  it("保留其他 query 與 #hash 路由；不觸發 hashchange", () => {
    setUrl("?a=1&theme=cyber&b=2#/records?x=y");
    const onHash = vi.fn();
    window.addEventListener("hashchange", onHash);
    initTheme();
    window.removeEventListener("hashchange", onHash);
    expect(window.location.search).toBe("?a=1&b=2");
    expect(window.location.hash).toBe("#/records?x=y");
    expect(onHash).not.toHaveBeenCalled();
  });

  it("只有 theme 參數時 query 整個消失，路徑不變", () => {
    setUrl("?theme=standard#/dashboard");
    initTheme();
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toBe("#/dashboard");
  });

  it("保留 history.state", () => {
    window.history.replaceState({ k: 1 }, "", "/?theme=cyber");
    initTheme();
    expect(window.history.state).toEqual({ k: 1 });
  });

  it("沒有 theme 參數時不呼叫 replaceState", () => {
    setUrl("?a=1#/records");
    const spy = vi.spyOn(window.history, "replaceState");
    initTheme();
    expect(spy).not.toHaveBeenCalled();
  });

  it("theme 值不認得時不動網址", () => {
    setUrl("?theme=neon&a=1");
    const spy = vi.spyOn(window.history, "replaceState");
    initTheme();
    expect(spy).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?theme=neon&a=1");
  });
});

describe("其他分頁切換主題（storage 事件）", () => {
  function storageEvent(key: string | null, newValue: string | null) {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: window.localStorage }));
  }

  it("pld.theme 變成 cyber／standard 時套用；不寫回 storage", () => {
    initTheme();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    storageEvent(THEME_STORAGE_KEY, "cyber");
    expect(root.dataset.theme).toBe("cyber");
    storageEvent(THEME_STORAGE_KEY, "standard");
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("未知值、被刪除（null 值）都當 standard", () => {
    initTheme();
    applyTheme("cyber");
    storageEvent(THEME_STORAGE_KEY, "neon");
    expect(root.hasAttribute("data-theme")).toBe(false);
    applyTheme("cyber");
    storageEvent(THEME_STORAGE_KEY, null);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("key 為 null（localStorage.clear()）視為 standard", () => {
    initTheme();
    applyTheme("cyber");
    storageEvent(null, null);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("忽略其他 key", () => {
    initTheme();
    applyTheme("cyber");
    storageEvent("something-else", "standard");
    expect(root.dataset.theme).toBe("cyber");
  });

  it("忽略 sessionStorage 的事件", () => {
    initTheme();
    applyTheme("cyber");
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "standard", storageArea: window.sessionStorage }));
    expect(root.dataset.theme).toBe("cyber");
  });

  it("initTheme 重複呼叫只註冊一次監聽", async () => {
    vi.resetModules();
    const fresh = await import("./theme");
    const add = vi.spyOn(window, "addEventListener");
    fresh.initTheme();
    fresh.initTheme();
    const registered = add.mock.calls.filter(([type]) => type === "storage");
    expect(registered).toHaveLength(1);
    // 這個全新模組實例的監聽器不要留給別的測試
    window.removeEventListener("storage", registered[0]![1] as EventListener);
  });
});

describe("index.html 的開機 inline script（避免閃一幀標準主題）", () => {
  const html = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../index.html"), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  const run = () => new Function(script!)();

  it("有一段 head 內、color-scheme meta 之後的同步（非 module）inline script", () => {
    expect(script).toBeDefined();
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head.indexOf("<script>")).toBeGreaterThan(head.indexOf('name="color-scheme"'));
  });

  it("使用的 storage key、cyber 值、還原屬性名稱與 theme.ts 一致", () => {
    expect(script).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(script).toContain('"cyber"');
    expect(script).toContain('"standard"');
    expect(script).toContain(`"${PREV_COLOR_SCHEME_ATTR}"`);
  });

  it("已存偏好 cyber：套上 data-theme=cyber 與 meta=dark，並記下 meta 原值", () => {
    addMeta("light dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, "cyber");
    run();
    expect(root.dataset.theme).toBe("cyber");
    expect(metaContent()).toBe("dark");
    expect(root.getAttribute(PREV_COLOR_SCHEME_ATTR)).toBe("light dark");
  });

  it("?theme=cyber 套用；?theme=standard 蓋過已存的 cyber；沒有偏好時什麼都不做", () => {
    addMeta("light dark");
    setUrl("?theme=cyber");
    run();
    expect(root.dataset.theme).toBe("cyber");
    delete root.dataset.theme;
    root.removeAttribute(PREV_COLOR_SCHEME_ATTR);
    document.querySelector('meta[name="color-scheme"]')!.setAttribute("content", "light dark");

    window.localStorage.setItem(THEME_STORAGE_KEY, "cyber");
    setUrl("?theme=standard");
    run();
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(metaContent()).toBe("light dark");

    window.localStorage.clear();
    setUrl("");
    run();
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.hasAttribute(PREV_COLOR_SCHEME_ATTR)).toBe(false);
  });

  it("localStorage 拋例外時不拋錯、不套用", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(run).not.toThrow();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("inline 已設好 cyber → initTheme → 切回標準：meta 還原成原值、移除 data-theme 與記錄用屬性", () => {
    addMeta("light dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, "cyber");
    run();
    expect(initTheme()).toBe("cyber");
    expect(root.dataset.theme).toBe("cyber");
    expect(metaContent()).toBe("dark");

    switchTheme("standard");
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(metaContent()).toBe("light dark");
    expect(root.hasAttribute(PREV_COLOR_SCHEME_ATTR)).toBe(false);

    // 再切回 cyber、再切標準，一樣能還原
    switchTheme("cyber");
    expect(metaContent()).toBe("dark");
    switchTheme("standard");
    expect(metaContent()).toBe("light dark");
  });
});
