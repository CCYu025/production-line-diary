import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getAppliedTheme, getThemePreference, initTheme, setThemePreference, subscribeTheme, switchTheme } from "./theme";

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
