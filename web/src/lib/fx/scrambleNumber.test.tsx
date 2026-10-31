import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrambleNumber, scrambleText } from "./ScrambleNumber";

const root = document.documentElement;
const realMatchMedia = window.matchMedia;

function mockReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
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
  vi.useRealTimers();
});

describe("scrambleText", () => {
  /** 依序吐出指定的數字（0～9） */
  const seq = (...ds: number[]) => {
    let i = 0;
    return () => ds[i++ % ds.length]! / 10;
  };
  it("progress 0：所有數字都換掉，非數字字元（逗號、小數點）原樣保留，長度不變", () => {
    expect(scrambleText("1,234.5", 0, seq(9, 8, 7, 6, 5))).toBe("9,876.5");
  });
  it("progress 1：等於原文", () => {
    expect(scrambleText("1,234.5", 1)).toBe("1,234.5");
  });
  it("由左到右依序鎖定", () => {
    // 4 個數字，progress .5 → 左邊 2 個鎖定
    expect(scrambleText("1234", 0.5, () => 0)).toBe("1200");
  });
  it("沒有數字的文字不變", () => {
    expect(scrambleText("—", 0)).toBe("—");
  });
});

describe("ScrambleNumber（FX-07 / A5）", () => {
  it("useFx() 為 false（jsdom 預設）：只輸出純文字，沒有亂碼層、沒有 sr-only", () => {
    const { container } = render(
      <span data-testid="host">
        <ScrambleNumber value="1,234" />
      </span>,
    );
    expect(container.querySelector("[aria-hidden]")).toBeNull();
    expect(container.querySelector(".sr-only")).toBeNull();
    expect(screen.getByTestId("host").innerHTML).toBe("1,234");
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("cyber 但開啟減少動態效果：同樣只輸出純文字", () => {
    mockReducedMotion(true);
    root.dataset.theme = "cyber";
    const { container } = render(<ScrambleNumber value={42} />);
    expect(container.querySelector("[aria-hidden]")).toBeNull();
    expect(container.textContent).toBe("42");
  });

  it("cyber：亂碼層 aria-hidden、真實數字在 sr-only（getByText 只找得到一個），結束後亂碼層移除、只剩純文字", () => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    root.dataset.theme = "cyber";
    const { container } = render(
      <span data-testid="host">
        <ScrambleNumber value="1,234" />
      </span>,
    );
    const hidden = container.querySelector("[aria-hidden='true']");
    expect(hidden).not.toBeNull();
    expect(hidden!.textContent).toHaveLength(5);
    expect(screen.getByText("1,234")).toHaveClass("sr-only");
    expect(screen.getAllByText("1,234")).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(500));
    expect(container.querySelector("[aria-hidden]")).toBeNull();
    expect(container.querySelector(".sr-only")).toBeNull();
    expect(screen.getByTestId("host").innerHTML).toBe("1,234");
  });

  it("數值改變會重播（切換範圍）；沒有數字的內容不播", () => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    root.dataset.theme = "cyber";
    const { container, rerender } = render(<ScrambleNumber value={10} />);
    act(() => void vi.advanceTimersByTime(500));
    expect(container.querySelector("[aria-hidden]")).toBeNull();
    rerender(<ScrambleNumber value={99} />);
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByText("99")).toHaveClass("sr-only");
    act(() => void vi.advanceTimersByTime(500));
    expect(container.textContent).toBe("99");
    rerender(<ScrambleNumber value="—" />);
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });

  it("卸載時清掉計時器", () => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    root.dataset.theme = "cyber";
    const { unmount } = render(<ScrambleNumber value={5} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
