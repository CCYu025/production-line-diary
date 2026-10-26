import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it } from "vitest";
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
