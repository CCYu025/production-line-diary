import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTheme } from "../theme";
import { useFx } from "./useFx";

const root = document.documentElement;
const realMatchMedia = window.matchMedia;

/** 可控的 matchMedia：只處理 prefers-reduced-motion，其他查詢一律 false。 */
function mockReducedMotion(initial: boolean) {
  let reduced = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => {
    const isReduced = query.includes("prefers-reduced-motion");
    return {
      get matches() {
        return isReduced ? reduced : false;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => {
        if (isReduced) listeners.add(fn);
      },
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    set(next: boolean) {
      reduced = next;
      listeners.forEach((fn) => fn());
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  delete root.dataset.theme;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  delete root.dataset.theme;
});

function Probe() {
  return <p>{useFx() ? "fx-on" : "fx-off"}</p>;
}

describe("useFx", () => {
  it("沒有 data-theme（標準主題、jsdom 預設）：false", () => {
    mockReducedMotion(false);
    const { result } = renderHook(() => useFx());
    expect(result.current).toBe(false);
  });

  it("沒有 data-theme 而且沒有 matchMedia：一定是 false", () => {
    // @ts-expect-error 模擬沒有 matchMedia 的環境
    window.matchMedia = undefined;
    expect(renderHook(() => useFx()).result.current).toBe(false);
  });

  it("data-theme 是 light／dark（強制指定的標準主題）：false", () => {
    mockReducedMotion(false);
    root.dataset.theme = "dark";
    expect(renderHook(() => useFx()).result.current).toBe(false);
    root.dataset.theme = "light";
    expect(renderHook(() => useFx()).result.current).toBe(false);
  });

  it("cyber 但開啟減少動態效果：false", () => {
    mockReducedMotion(true);
    root.dataset.theme = "cyber";
    expect(renderHook(() => useFx()).result.current).toBe(false);
  });

  it("cyber 且沒有減少動態效果：true", () => {
    mockReducedMotion(false);
    root.dataset.theme = "cyber";
    expect(renderHook(() => useFx()).result.current).toBe(true);
  });

  it("cyber 而環境沒有 matchMedia：視為沒有減少動態的偏好，不拋錯", () => {
    // @ts-expect-error 模擬沒有 matchMedia 的環境
    window.matchMedia = undefined;
    root.dataset.theme = "cyber";
    expect(renderHook(() => useFx()).result.current).toBe(true);
  });

  it("主題切換即時更新（透過 applyTheme）", () => {
    mockReducedMotion(false);
    render(<Probe />);
    expect(screen.getByText("fx-off")).toBeInTheDocument();
    act(() => applyTheme("cyber"));
    expect(screen.getByText("fx-on")).toBeInTheDocument();
    act(() => applyTheme("standard"));
    expect(screen.getByText("fx-off")).toBeInTheDocument();
  });

  it("別處直接改 data-theme 屬性也會即時更新（MutationObserver）", async () => {
    mockReducedMotion(false);
    render(<Probe />);
    expect(screen.getByText("fx-off")).toBeInTheDocument();
    root.dataset.theme = "cyber";
    expect(await screen.findByText("fx-on")).toBeInTheDocument();
    delete root.dataset.theme;
    expect(await screen.findByText("fx-off")).toBeInTheDocument();
  });

  it("減少動態效果的設定改變時即時更新", () => {
    const motion = mockReducedMotion(false);
    root.dataset.theme = "cyber";
    render(<Probe />);
    expect(screen.getByText("fx-on")).toBeInTheDocument();
    act(() => motion.set(true));
    expect(screen.getByText("fx-off")).toBeInTheDocument();
    act(() => motion.set(false));
    expect(screen.getByText("fx-on")).toBeInTheDocument();
  });

  it("卸載後取消訂閱 matchMedia", () => {
    const motion = mockReducedMotion(false);
    const { unmount } = render(<Probe />);
    expect(motion.listenerCount()).toBe(1);
    unmount();
    expect(motion.listenerCount()).toBe(0);
  });
});
