import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { getMode, initMode, LEGACY_MODE_SESSION_KEY, MODE_STORAGE_KEY, resetModeForTest, setMode, subscribeMode, useMode } from "./mode";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  resetModeForTest();
});
afterEach(() => vi.restoreAllMocks());

describe("initMode", () => {
  it("預設是 web", () => {
    expect(initMode()).toBe("web");
    expect(getMode()).toBe("web");
  });

  it("讀 localStorage 的 pld.mode", () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, "os");
    expect(initMode()).toBe("os");
    expect(getMode()).toBe("os");
  });

  it("?mode=os 設定、寫回 localStorage，並從網址移除（保留其他 query 與 hash）", () => {
    window.history.replaceState(null, "", "/?a=1&mode=os#/records?x=2");
    expect(initMode()).toBe("os");
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe("os");
    expect(window.location.search).toBe("?a=1");
    expect(window.location.hash).toBe("#/records?x=2");
  });

  it("只有 ?mode 時網址乾淨", () => {
    window.history.replaceState(null, "", "/records?mode=os");
    initMode();
    expect(window.location.pathname + window.location.search).toBe("/records");
  });

  it("?mode=web 蓋過已存的 os，並寫回 web", () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, "os");
    window.history.replaceState(null, "", "/?mode=web");
    expect(initMode()).toBe("web");
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe("web");
  });

  it("不認得的值忽略（儲存值與網址參數），網址參數原樣保留", () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, "banana");
    window.history.replaceState(null, "", "/?mode=banana");
    expect(initMode()).toBe("web");
    expect(window.location.search).toBe("?mode=banana");
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe("banana");
  });

  it("移除 X0 的 sessionStorage pld.mode.session，且不讀它", () => {
    window.sessionStorage.setItem(LEGACY_MODE_SESSION_KEY, "os");
    expect(initMode()).toBe("web");
    expect(window.sessionStorage.getItem(LEGACY_MODE_SESSION_KEY)).toBeNull();
  });

  it("localStorage 讀取丟例外 → web", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(initMode()).toBe("web");
  });

  it("localStorage 寫入丟例外：不炸，這次載入仍套用 ?mode 並清網址", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    window.history.replaceState(null, "", "/?mode=os");
    expect(initMode()).toBe("os");
    expect(window.location.search).toBe("");
  });

  it("連 window.localStorage 本身都拋例外也安全", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(initMode()).toBe("web");
    expect(() => setMode("os")).not.toThrow();
    expect(getMode()).toBe("os");
  });

  it("不監聽 storage 事件：別的分頁改偏好不影響目前模式", () => {
    initMode();
    window.localStorage.setItem(MODE_STORAGE_KEY, "os");
    window.dispatchEvent(new StorageEvent("storage", { key: MODE_STORAGE_KEY, newValue: "os" }));
    expect(getMode()).toBe("web");
  });
});

describe("setMode / subscribeMode", () => {
  it("setMode 改變模式、寫進 localStorage、通知訂閱者", () => {
    const fn = vi.fn();
    subscribeMode(fn);
    setMode("os");
    expect(getMode()).toBe("os");
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe("os");
    expect(fn).toHaveBeenCalledTimes(1);
    setMode("web");
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe("web");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("模式沒變：不通知、不寫入", () => {
    const fn = vi.fn();
    subscribeMode(fn);
    const set = vi.spyOn(Storage.prototype, "setItem");
    setMode("web");
    expect(fn).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("取消訂閱後不再通知", () => {
    const fn = vi.fn();
    const off = subscribeMode(fn);
    off();
    setMode("os");
    expect(fn).not.toHaveBeenCalled();
  });

  it("initMode 改變了模式也通知訂閱者", () => {
    const fn = vi.fn();
    subscribeMode(fn);
    window.localStorage.setItem(MODE_STORAGE_KEY, "os");
    initMode();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("useMode", () => {
  it("訂閱模式並隨 setMode 重繪", () => {
    const { result } = renderHook(() => useMode());
    expect(result.current).toBe("web");
    act(() => setMode("os"));
    expect(result.current).toBe("os");
    act(() => setMode("web"));
    expect(result.current).toBe("web");
  });
});
