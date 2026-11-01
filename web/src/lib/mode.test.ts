import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMode, initMode, MODE_SESSION_KEY, resetModeForTest } from "./mode";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  resetModeForTest();
});
afterEach(() => vi.restoreAllMocks());

describe("mode", () => {
  it("預設是 web", () => {
    expect(initMode()).toBe("web");
    expect(getMode()).toBe("web");
  });

  it("?mode=os 設定並寫進 sessionStorage，且從網址移除（保留其他 query 與 hash）", () => {
    window.history.replaceState(null, "", "/?a=1&mode=os#/records?x=2");
    expect(initMode()).toBe("os");
    expect(getMode()).toBe("os");
    expect(window.sessionStorage.getItem(MODE_SESSION_KEY)).toBe("os");
    expect(window.location.search).toBe("?a=1");
    expect(window.location.hash).toBe("#/records?x=2");
  });

  it("不讀寫 localStorage pld.mode", () => {
    window.localStorage.setItem("pld.mode", "os");
    window.history.replaceState(null, "", "/?mode=os");
    initMode();
    expect(initMode()).toBe("os");
    expect(window.localStorage.getItem("pld.mode")).toBe("os"); // 沒被改
    resetModeForTest();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    expect(initMode()).toBe("web"); // 也沒被讀
  });

  it("沒有 ?mode 時讀這個分頁已存的值；?mode=web 蓋回去", () => {
    window.sessionStorage.setItem(MODE_SESSION_KEY, "os");
    expect(initMode()).toBe("os");
    window.history.replaceState(null, "", "/?mode=web");
    expect(initMode()).toBe("web");
    expect(window.sessionStorage.getItem(MODE_SESSION_KEY)).toBe("web");
  });

  it("不認得的值忽略", () => {
    window.sessionStorage.setItem(MODE_SESSION_KEY, "banana");
    window.history.replaceState(null, "", "/?mode=banana");
    expect(initMode()).toBe("web");
  });

  it("sessionStorage 讀取丟例外 → web", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(initMode()).toBe("web");
  });

  it("sessionStorage 寫入丟例外：不炸，這次載入仍套用 ?mode", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    window.history.replaceState(null, "", "/?mode=os");
    expect(initMode()).toBe("os");
    expect(window.location.search).toBe("");
  });

  it("模式在頁面生命週期內靜態：initMode 之後改 sessionStorage 不影響 getMode", () => {
    initMode();
    window.sessionStorage.setItem(MODE_SESSION_KEY, "os");
    expect(getMode()).toBe("web");
  });
});
