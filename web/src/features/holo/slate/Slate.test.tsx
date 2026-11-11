import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Slate } from "./Slate";

/*
 * 終端板內容（與 WebGL 解耦：直接 render 元件）。設計決定：holo 自己寫的元素一律不加 data-fx／data-variant；
 * 只有原封 import 的共用元件（Combobox）保留它自己的掛勾，外觀由 holo.css 在 .holo-slate 內蓋回。
 */
const SHARED_FX = new Set(["combobox", "pop"]);

describe("Slate", () => {
  it("holo 自有元素沒有 data-fx／data-variant；共用元件的掛勾只限 Combobox 的 combobox 與 pop", () => {
    const { container, getByLabelText } = render(<Slate />);
    fireEvent.focus(getByLabelText("設備▸")); // 展開建議清單，pop 也要檢查
    const all = Array.from(container.querySelectorAll("*"));
    expect(all.length).toBeGreaterThan(8);
    const fx = all.filter((el) => el.hasAttribute("data-fx"));
    expect(fx.length).toBeGreaterThan(0); // 掛勾確實存在（測試有在看真的 DOM）
    for (const el of fx) expect(SHARED_FX.has(el.getAttribute("data-fx")!), el.outerHTML.slice(0, 80)).toBe(true);
    // 掛勾只在 Combobox 外層（combobox）與它的建議清單（pop）上，holo 自己的元素（holo-* class、form、label、button）都沒有
    const owned = all.filter((el) => /\bholo-/.test(el.getAttribute("class") ?? "") || ["FORM", "HEADER", "LABEL", "BUTTON"].includes(el.tagName));
    expect(owned.length).toBeGreaterThan(5);
    for (const el of owned) {
      expect(el.hasAttribute("data-fx"), el.outerHTML.slice(0, 80)).toBe(false);
      expect(el.hasAttribute("data-variant"), el.outerHTML.slice(0, 80)).toBe(false);
    }
    // 問題與處理這兩個純 input／textarea 也不帶
    expect(container.querySelector("#holo-problem")!.hasAttribute("data-fx")).toBe(false);
    expect(container.querySelector("#holo-action")!.hasAttribute("data-fx")).toBe(false);
  });
});
