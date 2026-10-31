import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STAGGER_CAP_DESKTOP, STAGGER_CAP_MOBILE, useStagger, useStaggerCap } from "./useStagger";

const root = document.documentElement;
const realMatchMedia = window.matchMedia;

function mockMedia(opts: { reduced?: boolean; wide?: boolean }) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion") ? !!opts.reduced : query.includes("min-width: 768px") ? !!opts.wide : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  delete root.dataset.theme;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  delete root.dataset.theme;
});

describe("useStagger（§3.5）", () => {
  it("useFx() 為 false（標準主題／jsdom）：每一項都是空物件，DOM 與沒有這個 hook 時相同", () => {
    mockMedia({});
    const { result } = renderHook(() => useStagger(5, 20));
    for (let i = 0; i < 5; i++) expect(result.current(i)).toEqual({});
  });

  it("cyber 但開啟減少動態效果：空物件", () => {
    mockMedia({ reduced: true });
    root.dataset.theme = "cyber";
    const { result } = renderHook(() => useStagger(5, 20));
    expect(result.current(0)).toEqual({});
  });

  it("cyber：前 min(count, cap) 項輸出 data-fx-in 與 --i，超過上限、負數、非整數的直接沒有屬性（不排隊）", () => {
    mockMedia({});
    root.dataset.theme = "cyber";
    const { result } = renderHook(() => useStagger(30, 20));
    expect(result.current(0)).toEqual({ "data-fx-in": "", style: { "--i": 0 } });
    expect(result.current(19)).toEqual({ "data-fx-in": "", style: { "--i": 19 } });
    expect(result.current(20)).toEqual({});
    expect(result.current(-1)).toEqual({});
    expect(result.current(1.5)).toEqual({});
    const few = renderHook(() => useStagger(3, 20)).result;
    expect(few.current(2)).toEqual({ "data-fx-in": "", style: { "--i": 2 } });
    expect(few.current(3)).toEqual({});
  });
});

describe("useStaggerCap", () => {
  it("桌面（≥ 768）20 項，手機 10 項", () => {
    mockMedia({ wide: true });
    expect(renderHook(() => useStaggerCap()).result.current).toBe(STAGGER_CAP_DESKTOP);
    expect(STAGGER_CAP_DESKTOP).toBe(20);
    mockMedia({ wide: false });
    expect(renderHook(() => useStaggerCap()).result.current).toBe(STAGGER_CAP_MOBILE);
    expect(STAGGER_CAP_MOBILE).toBe(10);
  });
});
