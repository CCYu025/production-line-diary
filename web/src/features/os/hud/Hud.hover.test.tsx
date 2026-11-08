import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHoverStore } from "../hub/hover";
import { computeSignals } from "../hub/signals";
import { Hud } from "./Hud";

/*
 * H0：HUD 控制台——DOM 結構與無障礙不變、雙向 hover 連動、引線。
 * （版面數字在 jsdom 都是 0，所以引線用假的矩形驗證；實際位置由 leader.test.ts 與瀏覽器驗證負責。）
 */
const signals = computeSignals(undefined, new Date(2026, 10, 8, 12, 0, 0));

function mount(over: Partial<React.ComponentProps<typeof Hud>> = {}) {
  const hover = createHoverStore();
  const onEnter = vi.fn();
  const utils = render(<Hud selected="CH-02" signals={signals} active onEnter={onEnter} onExit={() => {}} hover={hover} {...over} />);
  return { hover, onEnter, ...utils };
}
const keys = () => [...document.querySelectorAll<HTMLButtonElement>('[data-os="hud-ch"]')];
const key = (id: string) => document.querySelector<HTMLButtonElement>(`[data-os="hud-ch"][data-ch="${id}"]`)!;

afterEach(() => vi.restoreAllMocks());

describe("控制台 DOM 結構不變（H0 §7.2）", () => {
  it("仍是 nav > ul[data-os=hud-list] > li > button[data-os=hud-ch]；7 個真的 <button>、roving tabindex、aria-current、aria-label 取完整名稱", () => {
    mount();
    const nav = screen.getByRole("navigation", { name: "頻道" });
    const list = nav.querySelector('ul[data-os="hud-list"]')!;
    expect(list).not.toBeNull();
    expect(list.querySelectorAll(":scope > li")).toHaveLength(7);
    expect(keys()).toHaveLength(7);
    for (const b of keys()) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.parentElement!.tagName).toBe("LI");
      expect(b.tabIndex).toBe(b.dataset.ch === "CH-02" ? 0 : -1);
      expect(b.getAttribute("aria-label")).toBe(signals[b.dataset.ch as "CH-01"].name);
    }
    expect(document.querySelectorAll('[data-os="hud-ch"][aria-current="true"]')).toHaveLength(1);
    expect(key("CH-02")).toHaveAttribute("aria-current", "true");
  });

  it("按鈕的視覺文字：CH 代號獨立一排（.os-hud-id），textContent 與原本相同；視覺文字整塊 aria-hidden", () => {
    mount();
    const b = key("CH-02");
    const full = b.querySelector(".os-hud-full")!;
    expect(full.textContent).toBe(signals["CH-02"].name);
    expect(full.querySelector(".os-hud-id")!.textContent).toBe("CH-02");
    expect(b.querySelector(".os-hud-compact")!.textContent).toBe(signals["CH-02"].compact);
    expect(full.getAttribute("aria-hidden")).toBe("true");
    expect(b.querySelector(".os-hud-compact")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("H0 不輸出 HOLO 切換鈕的節點（只在版面預留位置）", () => {
    mount();
    expect(document.querySelector('[data-os="hud-holo"]')).toBeNull();
    expect(screen.queryByText(/HOLO/)).toBeNull();
  });

  it("新增的視覺元素（引線）aria-hidden、不可聚焦", () => {
    mount();
    const lead = document.querySelector('[data-os="hud-lead"]')!;
    expect(lead.getAttribute("aria-hidden")).toBe("true");
    expect(lead.getAttribute("focusable")).toBe("false");
    expect(lead.querySelectorAll("a,button,[tabindex]")).toHaveLength(0);
  });
});

describe("雙向 hover 連動", () => {
  it("HUD 鍵懸停 → hover store 寫入；離開 → 清掉；不改選取（aria-current、tabindex 不變）、不進入頻道", () => {
    const { hover, onEnter } = mount();
    fireEvent.pointerEnter(key("CH-05"));
    expect(hover.get()).toBe("CH-05");
    expect(key("CH-02")).toHaveAttribute("aria-current", "true");
    expect(key("CH-05")).not.toHaveAttribute("aria-current");
    expect(key("CH-05").tabIndex).toBe(-1);
    expect(onEnter).not.toHaveBeenCalled();
    fireEvent.pointerLeave(key("CH-05"));
    expect(hover.get()).toBeNull();
  });

  it("從一個鍵移到另一個鍵：舊鍵的 leave 不會把新鍵的懸停清掉", () => {
    const { hover } = mount();
    fireEvent.pointerEnter(key("CH-05"));
    fireEvent.pointerEnter(key("CH-06"));
    fireEvent.pointerLeave(key("CH-05"));
    expect(hover.get()).toBe("CH-06");
  });

  it("3D 螢幕懸停（store 被外部寫入）→ 對應的鍵得到 data-hover，其他鍵沒有；aria-current 不動", () => {
    const { hover } = mount();
    expect(document.querySelectorAll("[data-hover]")).toHaveLength(0);
    act(() => hover.set("CH-06"));
    expect(key("CH-06")).toHaveAttribute("data-hover", "true");
    expect(document.querySelectorAll("[data-hover]")).toHaveLength(1);
    expect(key("CH-02")).toHaveAttribute("aria-current", "true");
    expect(key("CH-06")).not.toHaveAttribute("aria-current");
    act(() => hover.set(null));
    expect(document.querySelectorAll("[data-hover]")).toHaveLength(0);
  });

  it("HUD 變成不作用（轉場、進入工作站）時清掉懸停；沒有 store 時也不會出錯", () => {
    const { hover, rerender } = mount();
    act(() => hover.set("CH-03"));
    rerender(<Hud selected="CH-02" signals={signals} active={false} onEnter={() => {}} onExit={() => {}} hover={hover} />);
    expect(hover.get()).toBeNull();
    const { container } = render(<Hud selected="CH-02" signals={signals} active onEnter={() => {}} onExit={() => {}} />);
    fireEvent.pointerEnter(container.querySelector('[data-ch="CH-04"]')!);
    expect(container.querySelector("[data-hover]")).toBeNull();
  });
});

describe("引線", () => {
  function fakeRects() {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const isKey = this.dataset?.os === "hud-ch";
      return (isKey ? { left: 500, top: 1000, width: 150, height: 44, right: 650, bottom: 1044, x: 500, y: 1000, toJSON() {} } : { left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, x: 0, y: 0, toJSON() {} }) as DOMRect;
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1080 });
  }

  it("settled 時畫一條線，下端在選中鍵的上緣正中央；沒有 settled（巡視、轉場）不畫", () => {
    fakeRects();
    const { rerender } = mount({ settled: true });
    const line = document.querySelector('[data-os="hud-lead"] line')!;
    expect(line).not.toBeNull();
    expect(Number(line.getAttribute("x2"))).toBeCloseTo(575, 3);
    expect(Number(line.getAttribute("y2"))).toBeCloseTo(997, 3);
    rerender(<Hud selected="CH-02" signals={signals} active settled={false} onEnter={() => {}} onExit={() => {}} />);
    expect(document.querySelector('[data-os="hud-lead"] line')).toBeNull();
  });

  it("選取改變後引線先隱藏（等鏡頭偏航到位），過了 SELECT_YAW_MS 才顯示；減少動態效果時立即顯示", () => {
    vi.useFakeTimers();
    try {
      fakeRects();
      const hover = createHoverStore();
      const props = { signals, active: true, onEnter: () => {}, onExit: () => {}, hover, settled: true } as const;
      const { rerender } = render(<Hud selected="CH-02" {...props} />);
      const lead = () => document.querySelector('[data-os="hud-lead"]')!;
      expect(lead().getAttribute("data-ready")).toBe("true");
      rerender(<Hud selected="CH-03" {...props} />);
      expect(lead().getAttribute("data-ready")).toBe("false");
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(lead().getAttribute("data-ready")).toBe("true");
      rerender(<Hud selected="CH-04" reduced {...props} />);
      expect(lead().getAttribute("data-ready")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });
});
