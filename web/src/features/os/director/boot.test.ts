import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOT_STORAGE_KEY, decideBoot, markBootDone, readBootDone, resetBootDoneForTest } from "./boot";
import type { Place } from "./reducer";

const hub: Place = { kind: "hub" };
const station: Place = { kind: "channel", ch: "CH-02" };

afterEach(() => {
  vi.restoreAllMocks();
  resetBootDoneForTest();
});

describe("decideBoot（§5.5、D3）", () => {
  it("第一次顯示控制室：完整開機", () => expect(decideBoot({ place: hub, reduced: false, done: false })).toBe("full"));
  it("之後再掛載控制室：短開機", () => expect(decideBoot({ place: hub, reduced: false, done: true })).toBe("short"));
  it("深層連結（第一個畫面是工作站）：不開機，不論 key", () => {
    expect(decideBoot({ place: station, reduced: false, done: false })).toBeNull();
    expect(decideBoot({ place: station, reduced: false, done: true })).toBeNull();
    expect(decideBoot({ place: { kind: "channel", ch: null }, reduced: false, done: false })).toBeNull();
  });
  it("減少動態效果：不開機", () => {
    expect(decideBoot({ place: hub, reduced: true, done: false })).toBeNull();
    expect(decideBoot({ place: hub, reduced: true, done: true })).toBeNull();
  });
});

describe("sessionStorage pld.os.boot", () => {
  it("沒有 key＝沒開過；markBootDone 寫 '1'", () => {
    expect(readBootDone()).toBe(false);
    markBootDone();
    expect(window.sessionStorage.getItem(BOOT_STORAGE_KEY)).toBe("1");
    expect(readBootDone()).toBe(true);
  });
  it("key 已存在（別的載入寫的）＝開過", () => {
    window.sessionStorage.setItem(BOOT_STORAGE_KEY, "1");
    expect(readBootDone()).toBe(true);
  });
  it("sessionStorage 丟例外：讀回 false、寫入不丟、本次載入靠記憶體", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readBootDone()).toBe(false);
    expect(() => markBootDone()).not.toThrow();
    expect(readBootDone()).toBe(true);
  });
});
