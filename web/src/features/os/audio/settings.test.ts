import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSoundPref,
  isSoundEnabled,
  parseSoundPref,
  resetSoundForTest,
  setSoundEnabled,
  setSoundPref,
  SOUND_DEFAULT,
  SOUND_STORAGE_KEY,
  subscribeSound,
  toggleSound,
} from "./settings";

beforeEach(() => {
  window.localStorage.clear();
  resetSoundForTest();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetSoundForTest();
});

describe("pld.os.sound", () => {
  it("key 名稱與預設（on）", () => {
    expect(SOUND_STORAGE_KEY).toBe("pld.os.sound");
    expect(SOUND_DEFAULT).toBe("on");
    expect(getSoundPref()).toBe("on");
    expect(isSoundEnabled()).toBe(true);
  });
  it("讀：on／off 有效，其他一律預設", () => {
    expect(parseSoundPref("off")).toBe("off");
    expect(parseSoundPref("on")).toBe("on");
    for (const bad of [null, undefined, "", "OFF", "1", "mute", 3]) expect(parseSoundPref(bad)).toBe("on");
  });
  it("從 localStorage 載入；寫入後可再讀；沒變不通知", () => {
    window.localStorage.setItem(SOUND_STORAGE_KEY, "off");
    expect(getSoundPref()).toBe("off");
    const fn = vi.fn();
    subscribeSound(fn);
    setSoundPref("off");
    expect(fn).not.toHaveBeenCalled();
    setSoundEnabled(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(SOUND_STORAGE_KEY)).toBe("on");
    toggleSound();
    expect(getSoundPref()).toBe("off");
    expect(window.localStorage.getItem(SOUND_STORAGE_KEY)).toBe("off");
  });
  it("讀取失敗（localStorage 丟例外）：當作預設，不拋出", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => getSoundPref()).not.toThrow();
    expect(getSoundPref()).toBe("on");
  });
  it("寫入失敗：這次載入仍然有效，不拋出", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setSoundPref("off")).not.toThrow();
    expect(getSoundPref()).toBe("off");
    expect(window.localStorage.getItem(SOUND_STORAGE_KEY)).toBeNull();
  });
  it("別的分頁改了（storage 事件）會同步", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { useSoundPref } = await import("./settings");
    const { result } = renderHook(() => useSoundPref());
    expect(result.current).toBe("on");
    act(() => {
      window.localStorage.setItem(SOUND_STORAGE_KEY, "off");
      window.dispatchEvent(new StorageEvent("storage", { key: SOUND_STORAGE_KEY, newValue: "off" }));
    });
    expect(result.current).toBe("off");
  });
});
