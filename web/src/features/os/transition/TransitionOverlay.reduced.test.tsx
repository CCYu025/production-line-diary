/*
 * 疊層元件（X3）：減少動態效果＝一幀都不畫；執行中切換立即取消；連續快速的進入／離開不留下殘留的繪製器。
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTransitionDebugForTest } from "./debug";
import { TransitionOverlay, type TransitionOverlayProps } from "./TransitionOverlay";

interface Rec {
  fn: string;
}
const recs = new Map<string, Rec[]>();
function fakeCtx(id: string): CanvasRenderingContext2D {
  const list: Rec[] = recs.get(id) ?? [];
  recs.set(id, list);
  const state: Record<string, unknown> = {};
  return new Proxy({} as object, {
    get(_t, prop: string) {
      if (prop === "canvas") return { width: 1280, height: 720 };
      if (prop in state) return state[prop];
      if (prop === "measureText") return () => ({ width: 72, fontBoundingBoxAscent: 1, fontBoundingBoxDescent: 1 });
      return () => void list.push({ fn: prop });
    },
    set(_t, prop: string, v) {
      state[prop] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

let rafs: Map<number, FrameRequestCallback>;
let nextId: number;
const cancelled: number[] = [];

beforeEach(() => {
  recs.clear();
  cancelled.length = 0;
  rafs = new Map();
  nextId = 1;
  window.history.replaceState({}, "", "/");
  resetTransitionDebugForTest();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return (this.id ? fakeCtx(this.id) : null) as never;
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    rafs.set(nextId, cb);
    return nextId++;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    cancelled.push(id);
    rafs.delete(id);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetTransitionDebugForTest();
});

const base = (over: Partial<TransitionOverlayProps> = {}): TransitionOverlayProps => ({
  kind: "enter",
  gen: 1,
  clock: { start: performance.now() - 700, bootStart: null },
  cardText: "CH-02 RECORDS",
  channel: "CH-02",
  level: "std",
  reduced: false,
  ...over,
});
const overlay = () => document.getElementById("os-overlay") as HTMLCanvasElement;
const draws = (id = "os-overlay") => (recs.get(id) ?? []).filter((c) => c.fn !== "measureText");

describe("減少動態效果", () => {
  it("進入／離開／短轉場：疊層 0 幀（沒有 rAF、沒有任何繪製呼叫），畫布維持隱藏", () => {
    for (const kind of ["enter", "exit", "switch"] as const) {
      recs.clear();
      const r = render(<TransitionOverlay {...base({ kind, reduced: true })} />);
      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
      expect(draws()).toEqual([]);
      expect(draws("os-overlay-tag")).toEqual([]);
      expect(overlay().getAttribute("data-active")).toBe("false");
      r.unmount();
    }
  });
  it("執行中切換：下一次 commit 就取消繪製（cancelAnimationFrame、清空畫布）、隱藏，之後即使舊的 rAF 回呼被觸發也不再畫", () => {
    const r = render(<TransitionOverlay {...base()} />);
    expect(overlay().getAttribute("data-active")).toBe("true");
    expect(rafs.size).toBe(1);
    const pending = [...rafs.values()][0]!;
    r.rerender(<TransitionOverlay {...base({ reduced: true })} />);
    expect(overlay().getAttribute("data-active")).toBe("false");
    expect(cancelled.length).toBeGreaterThan(0);
    expect(rafs.size).toBe(0);
    expect(draws().filter((c) => c.fn === "clearRect").length).toBeGreaterThan(0);
    const after = draws().length;
    pending(performance.now());
    expect(draws().length).toBe(after);
  });
  it("reduced 打開之後再關掉：新的轉場照常畫（不卡在關閉狀態）", () => {
    const r = render(<TransitionOverlay {...base({ reduced: true })} />);
    r.rerender(<TransitionOverlay {...base({ reduced: false, gen: 2 })} />);
    expect(overlay().getAttribute("data-active")).toBe("true");
    expect(rafs.size).toBe(1);
  });
});

describe("連續快速操作（進入→離開→進入）", () => {
  it("每段轉場結束都取消繪製；10 輪之後只剩最後一段的一個 rAF，結束後 kind=null 全部清乾淨", () => {
    const fresh = () => ({ start: performance.now(), bootStart: null });
    const r = render(<TransitionOverlay {...base({ kind: null, gen: -1 })} />);
    for (let i = 0; i < 10; i++) {
      r.rerender(<TransitionOverlay {...base({ kind: "enter", gen: 2 * i + 1, clock: fresh() })} />);
      r.rerender(<TransitionOverlay {...base({ kind: "exit", gen: 2 * i + 2, clock: fresh() })} />);
    }
    expect(rafs.size).toBe(1);
    r.rerender(<TransitionOverlay {...base({ kind: null, gen: -1 })} />);
    expect(rafs.size).toBe(0);
    expect(overlay().getAttribute("data-active")).toBe("false");
    expect(document.getElementById("os-overlay-tag")!.getAttribute("data-active")).toBe("false");
  });
  it("同種類的轉場直接接上（gen 改變）：重新開始繪製，舊的 rAF 被取消", () => {
    const r = render(<TransitionOverlay {...base({ kind: "switch", gen: 1, clock: { start: performance.now(), bootStart: null } })} />);
    const first = [...rafs.keys()][0]!;
    r.rerender(<TransitionOverlay {...base({ kind: "switch", gen: 2, clock: { start: performance.now(), bootStart: null } })} />);
    expect(cancelled).toContain(first);
    expect(rafs.size).toBe(1);
  });
  it("兩個畫布都 aria-hidden 且不可聚焦（不接收輸入）", () => {
    render(<TransitionOverlay {...base()} />);
    for (const id of ["os-overlay", "os-overlay-tag"]) {
      const el = document.getElementById(id)!;
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect(el.tabIndex).toBe(-1);
    }
  });
});

describe("閒置預熱（控制室待機）", () => {
  it("沒有轉場時，每個閒置回呼畫一個代表幀，最後都清空；不排 rAF、不顯示畫布", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const r = render(<TransitionOverlay {...base({ kind: null, gen: -1 })} />);
      expect(draws()).toEqual([]);
      vi.advanceTimersByTime(200);
      const afterOne = draws().length;
      expect(afterOne).toBeGreaterThan(0);
      expect(draws()[draws().length - 1]!.fn).toBe("clearRect");
      vi.advanceTimersByTime(200 * 20);
      expect(draws().length).toBeGreaterThan(afterOne);
      const settled = draws().length;
      vi.advanceTimersByTime(5000);
      expect(draws().length).toBe(settled); // 預熱做完就停
      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
      expect(overlay().getAttribute("data-active")).toBe("false");
      r.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("轉場一開始就取消尚未跑的預熱；減少動態效果不預熱", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const r = render(<TransitionOverlay {...base({ kind: null, gen: -1, reduced: true })} />);
      vi.advanceTimersByTime(5000);
      expect(draws()).toEqual([]);
      r.unmount();
      recs.clear();
      const r2 = render(<TransitionOverlay {...base({ kind: null, gen: -1 })} />);
      vi.advanceTimersByTime(200);
      r2.rerender(<TransitionOverlay {...base({ kind: "exit", gen: 1, clock: { start: performance.now(), bootStart: null } })} />);
      const n = draws().length;
      vi.advanceTimersByTime(2000);
      expect(draws().length).toBe(n); // 轉場中沒有預熱幀再插進來（只有 rAF 排的繪製，而 rAF 是假的）
      r2.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
