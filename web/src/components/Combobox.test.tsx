import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { Combobox } from "./Combobox";

function Harness({ initial = "", options = ["F3", "F4", "G5", "原材區1"] }: { initial?: string; options?: string[] }) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <label htmlFor="eq">設備</label>
      <Combobox id="eq" value={value} onValueChange={setValue} options={options} />
      <button type="button">其他</button>
    </>
  );
}

const box = () => screen.getByRole("combobox", { name: "設備" }) as HTMLInputElement;

describe("Combobox（可輸入的下拉）", () => {
  it("聚焦時列出全部建議；打字後依輸入過濾", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(box());
    expect(screen.getAllByRole("option")).toHaveLength(4);
    await u.type(box(), "f");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(expect.arrayContaining(["F3", "F4", "新增「f」"]));
    expect(screen.queryByRole("option", { name: "G5" })).toBeNull();
  });

  it("輸入清單以外的新值：多一列「新增「…」」，值照常保留（free text）", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.type(box(), "RB2");
    expect(screen.getByRole("option", { name: "新增「RB2」" })).toBeInTheDocument();
    expect(box().value).toBe("RB2");
  });

  it("完全符合既有項目時不顯示「新增」", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.type(box(), "F3");
    expect(screen.queryByText(/^新增「/)).toBeNull();
  });

  it("↓↑ 循環移動、aria-activedescendant 跟著、Enter 選取", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(box());
    await u.keyboard("{ArrowDown}{ArrowDown}");
    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(box()).toHaveAttribute("aria-activedescendant", options[1]!.id);
    await u.keyboard("{ArrowUp}{ArrowUp}"); // 往上超過第一個 → 繞到最後一個
    expect(screen.getAllByRole("option")[3]).toHaveAttribute("aria-selected", "true");
    await u.keyboard("{Enter}");
    expect(box().value).toBe("原材區1");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Enter 沒有反白的建議時：不送出整張表單，只確認目前打的值並收起清單", async () => {
    const u = userEvent.setup();
    const submitted = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={submitted}>
        <Harness />
      </form>,
    );
    await u.type(box(), "RB2");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await u.keyboard("{Enter}");
    expect(submitted).not.toHaveBeenCalled();
    expect(box().value).toBe("RB2");
    expect(screen.queryByRole("listbox")).toBeNull();
    // 清單已收起、再按一次 Enter 也一樣不送出
    await u.keyboard("{Enter}");
    expect(submitted).not.toHaveBeenCalled();
    // 有反白的建議時 Enter 是「選它」，同樣不送出
    await u.clear(box());
    await u.keyboard("{ArrowDown}{Enter}");
    expect(box().value).toBe("F3");
    expect(submitted).not.toHaveBeenCalled();
  });

  it("Esc 收合、Tab 離開收合；點選項不會讓輸入框失焦", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(box());
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await u.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await u.tab();
    expect(screen.queryByRole("listbox")).toBeNull();

    await u.click(box());
    await u.click(screen.getByRole("option", { name: "G5" }));
    expect(box().value).toBe("G5");
    expect(box()).toHaveFocus();
  });

  it("aria 屬性：role=combobox、aria-expanded、aria-controls 指向 listbox", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    expect(box()).toHaveAttribute("aria-expanded", "false");
    await u.click(box());
    expect(box()).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(box().getAttribute("aria-controls")!)).toBe(screen.getByRole("listbox"));
  });
});

describe("Combobox：輸入法選字中的按鍵交給輸入法", () => {
  function setup() {
    const submitted = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={submitted}>
        <Harness />
      </form>,
    );
    return submitted;
  }
  const activeIndex = () => screen.getAllByRole("option").findIndex((o) => o.getAttribute("aria-selected") === "true");

  it("compositionstart 之後（isComposing）按 Enter：不選取、清單不收、值不變、不送出", async () => {
    const u = userEvent.setup();
    const submitted = setup();
    await u.click(box());
    await u.keyboard("{ArrowDown}");
    fireEvent.compositionStart(box());
    const ev = fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    expect(ev).toBe(false); // 有 preventDefault（Enter 永遠不隱式送出）
    expect(box().value).toBe("");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(submitted).not.toHaveBeenCalled();
  });

  it("keyCode 229 的 Enter 同上", async () => {
    const u = userEvent.setup();
    const submitted = setup();
    await u.click(box());
    await u.keyboard("{ArrowDown}");
    const ok = fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 });
    expect(ok).toBe(false); // 有 preventDefault
    expect(box().value).toBe("");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(submitted).not.toHaveBeenCalled();
  });

  it("選字中按 ↓／↑ 反白不移動；按 Esc 清單不收", async () => {
    const u = userEvent.setup();
    setup();
    await u.click(box());
    await u.keyboard("{ArrowDown}");
    const before = activeIndex();
    expect(before).toBe(0);
    fireEvent.keyDown(box(), { key: "ArrowDown", isComposing: true });
    expect(activeIndex()).toBe(before);
    fireEvent.keyDown(box(), { key: "ArrowUp", keyCode: 229 });
    expect(activeIndex()).toBe(before);
    const ok = fireEvent.keyDown(box(), { key: "Escape", isComposing: true });
    expect(ok).toBe(true);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("選字中 ↓／↑ 沒有 preventDefault（留給輸入法切換候選字）", async () => {
    const u = userEvent.setup();
    setup();
    await u.click(box());
    expect(fireEvent.keyDown(box(), { key: "ArrowDown", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(box(), { key: "ArrowUp", keyCode: 229 })).toBe(true);
  });

  it.each(["Process", "Unidentified", "Enter"])("在 <form> 裡：keydown key=%s（keyCode 229）之後的 keypress Enter 被 preventDefault，不隱式送出", async (key) => {
    const u = userEvent.setup();
    const submitted = setup();
    await u.click(box());
    fireEvent.keyDown(box(), { key, keyCode: 229 });
    const ok = fireEvent.keyPress(box(), { key: "Enter", code: "Enter", charCode: 13 });
    expect(ok).toBe(false);
    expect(submitted).not.toHaveBeenCalled();
    expect(box().value).toBe("");
  });

  it("在 <form> 裡：keypress 本身的 key 是 Process、charCode 13 也被 preventDefault，不隱式送出", async () => {
    const u = userEvent.setup();
    const submitted = setup();
    await u.click(box());
    const ok = fireEvent.keyPress(box(), { key: "Process", charCode: 13 });
    expect(ok).toBe(false);
    expect(submitted).not.toHaveBeenCalled();
    expect(box().value).toBe("");
  });

  it("compositionend 之後 Enter 照原本規則選取（迴歸）", async () => {
    const u = userEvent.setup();
    const submitted = setup();
    await u.click(box());
    await u.keyboard("{ArrowDown}");
    fireEvent.compositionStart(box());
    fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    expect(box().value).toBe("");
    fireEvent.compositionEnd(box());
    await u.keyboard("{Enter}");
    expect(box().value).toBe("F3");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(submitted).not.toHaveBeenCalled();
  });
});
