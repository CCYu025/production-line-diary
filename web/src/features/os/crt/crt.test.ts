import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CRT_DEFAULT,
  CRT_STORAGE_KEY,
  getCrtLevel,
  parseCrtLevel,
  resetCrtForTest,
  setCrtLevel,
  subscribeCrt,
  useCrtLevel,
} from "./settings";
import { A_ZONE, bZoneVars, devicePxToCss, lowWidthFor, sanitizeDpr, scanPeriodDevicePx, stripePeriodDevicePx } from "./zones";

beforeEach(() => {
  window.localStorage.clear();
  resetCrtForTest();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetCrtForTest();
});

describe("CRT 設定 store", () => {
  it("預設標準", () => {
    expect(CRT_DEFAULT).toBe("std");
    expect(getCrtLevel()).toBe("std");
  });
  it("讀 localStorage pld.os.crt；不合法的值回到預設", () => {
    window.localStorage.setItem(CRT_STORAGE_KEY, "max");
    expect(getCrtLevel()).toBe("max");
    resetCrtForTest();
    window.localStorage.setItem(CRT_STORAGE_KEY, "ultra");
    expect(getCrtLevel()).toBe("std");
    expect(parseCrtLevel(null)).toBe("std");
    expect(parseCrtLevel("off")).toBe("off");
  });
  it("setCrtLevel 寫入並通知；沒變不通知、不寫入", () => {
    const fn = vi.fn();
    const off = subscribeCrt(fn);
    setCrtLevel("off");
    expect(window.localStorage.getItem(CRT_STORAGE_KEY)).toBe("off");
    expect(fn).toHaveBeenCalledTimes(1);
    const set = vi.spyOn(Storage.prototype, "setItem");
    setCrtLevel("off");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    off();
    setCrtLevel("max");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("localStorage 讀寫都丟例外：不丟、用預設、本次載入仍可切換", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getCrtLevel()).toBe("std");
    expect(() => setCrtLevel("max")).not.toThrow();
    expect(getCrtLevel()).toBe("max");
  });
  it("useCrtLevel：設定後重繪；別的分頁改了（storage 事件）也跟著", () => {
    const { result } = renderHook(() => useCrtLevel());
    expect(result.current).toBe("std");
    act(() => setCrtLevel("off"));
    expect(result.current).toBe("off");
    act(() => {
      window.localStorage.setItem(CRT_STORAGE_KEY, "max");
      window.dispatchEvent(new StorageEvent("storage", { key: CRT_STORAGE_KEY, newValue: "max" }));
    });
    expect(result.current).toBe("max");
  });
});

describe("A 區參數表（§4.7）", () => {
  it("關：640×360、沒有著色器效果", () => {
    expect(A_ZONE.off).toMatchObject({ lowWidth16x9: 640, lowHeight: 360, effects: false, bloom: 0, vignette: 0, barrel: 0 });
  });
  it("標準：640×360＋目前的效果（弧面 3%、暗角 25%）", () => {
    expect(A_ZONE.std).toMatchObject({ lowWidth16x9: 640, lowHeight: 360, effects: true, bloom: 1, vignette: 0.25, barrel: 0.03 });
  });
  it("濃：426×240，暈開／暗角／弧面各 1.5 倍", () => {
    expect(A_ZONE.max.lowWidth16x9).toBe(426);
    expect(A_ZONE.max.lowHeight).toBe(240);
    expect(A_ZONE.max.bloom).toBeCloseTo(A_ZONE.std.bloom * 1.5);
    expect(A_ZONE.max.vignette).toBeCloseTo(A_ZONE.std.vignette * 1.5);
    expect(A_ZONE.max.barrel).toBeCloseTo(A_ZONE.std.barrel * 1.5);
  });
  it("lowWidthFor：16:9 時剛好是 640／426", () => {
    expect(lowWidthFor("std", 16 / 9)).toBe(640);
    expect(lowWidthFor("off", 16 / 9)).toBe(640);
    expect(lowWidthFor("max", 16 / 9)).toBe(426);
    expect(lowWidthFor("std", 0)).toBe(16);
  });
});

describe("B 區條紋週期（整數裝置像素、不用固定 CSS 像素）", () => {
  const dprs = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 4];
  it("條紋週期永遠是 3 的倍數的整數裝置像素", () => {
    for (const d of dprs) {
      const p = stripePeriodDevicePx(d);
      expect(Number.isInteger(p), `dpr ${d}`).toBe(true);
      expect(p % 3, `dpr ${d}`).toBe(0);
      expect(p).toBeGreaterThanOrEqual(3);
    }
  });
  it("掃描線週期是偶數整數裝置像素", () => {
    for (const d of dprs) {
      const p = scanPeriodDevicePx(d);
      expect(Number.isInteger(p), `dpr ${d}`).toBe(true);
      expect(p % 2).toBe(0);
    }
  });
  it("Windows 常見縮放 100%／125%／150%／175%／200%", () => {
    expect([1, 1.25, 1.5, 1.75, 2].map(stripePeriodDevicePx)).toEqual([3, 3, 6, 6, 6]);
  });
  it("CSS 值乘回 dpr 剛好是整數裝置像素", () => {
    for (const d of dprs) {
      const css = devicePxToCss(stripePeriodDevicePx(d), d);
      expect(css * d).toBeCloseTo(stripePeriodDevicePx(d), 9);
    }
  });
  it("無效的 dpr 當 1", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(sanitizeDpr(bad)).toBe(1);
      expect(stripePeriodDevicePx(bad)).toBe(3);
    }
  });
  it("bZoneVars：關＝null；標準淡、濃加深；dpr 改變週期跟著變", () => {
    expect(bZoneVars("off", 1)).toBeNull();
    const std = bZoneVars("std", 1.5)!;
    const max = bZoneVars("max", 1.5)!;
    expect(Number(max["--os-crt-stripe-a"])).toBeGreaterThan(Number(std["--os-crt-stripe-a"]));
    expect(Number(max["--os-crt-scan-a"])).toBeGreaterThan(Number(std["--os-crt-scan-a"]));
    expect(std["--os-crt-stripe"]).toBe("4px"); // 6 裝置像素 / 1.5
    expect(bZoneVars("std", 2)!["--os-crt-stripe"]).toBe("3px");
    expect(bZoneVars("std", 1)!["--os-crt-stripe"]).toBe("3px");
  });
});
