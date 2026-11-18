// H2-0：keyCode 229 這條分支的單元測試（E2E 的 holo-ime.mjs 看不到它）。
// CDP 的 Input.dispatchKeyEvent 在選字中送出的 keydown，isComposing 一律是 true，所以 E2E 就算把
// `|| e.keyCode === 229` 拿掉也不會變紅（H2-0 L2-d 的 M2 突變）。Android 虛擬鍵盤等環境會送出
// keyCode 229 而 isComposing 為 false 的按鍵，這個檔案就是專門鎖「isComposing 為 false、只有 keyCode 229」的情況。
// 既有的 Combobox.test.tsx／RecordForm.test.tsx 已經測了 Enter 與 ↑，這裡補齊四個鍵（Enter／↓／↑／Esc）逐一單獨測。
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { CopyPicker } from "@/features/records/form/CopyPicker";
import type { DiaryRecord } from "@/lib/types";
import { Combobox } from "./Combobox";

const KEYS = ["Enter", "ArrowDown", "ArrowUp", "Escape"] as const;
// isComposing 明確是 false：只有 keyCode 229 能讓這個按鍵被當成輸入法的
const ime229 = (key: string) => ({ key, keyCode: 229, isComposing: false });

describe("Combobox：keyCode 229（isComposing 為 false）的 Enter／↓／↑／Esc 交給輸入法", () => {
  function Harness() {
    const [v, setV] = React.useState("");
    return <Combobox aria-label="設備" value={v} onValueChange={setV} options={["F3", "F4", "G5"]} />;
  }
  const box = () => screen.getByRole("combobox", { name: "設備" }) as HTMLInputElement;
  const activeIndex = () => screen.getAllByRole("option").findIndex((o) => o.getAttribute("aria-selected") === "true");

  it.each(KEYS)("%s：不選取、反白不動、清單不收、值不變", async (key) => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(box());
    await u.keyboard("{ArrowDown}"); // 先反白第一項，之後任何「動作」都看得出來
    expect(activeIndex()).toBe(0);
    fireEvent.keyDown(box(), ime229(key));
    expect(activeIndex()).toBe(0);
    expect(box().value).toBe("");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("↓／↑／Esc 沒有 preventDefault（留給輸入法）；Enter 有（永遠不隱式送出表單）", async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(box());
    expect(fireEvent.keyDown(box(), ime229("ArrowDown"))).toBe(true);
    expect(fireEvent.keyDown(box(), ime229("ArrowUp"))).toBe(true);
    expect(fireEvent.keyDown(box(), ime229("Escape"))).toBe(true);
    expect(fireEvent.keyDown(box(), ime229("Enter"))).toBe(false);
  });
});

describe("CopyPicker：keyCode 229（isComposing 為 false）的 Enter／↓／↑／Esc 交給輸入法", () => {
  const rec = (id: number, problem: string): DiaryRecord => ({
    id, date: `2026-10-${10 + id}`, shift: "早", time: "10:00", duration: 5, equipment: "F3", category: "機構", problem,
    severity: "輕微", action: "", rootCause: null, status: "待處理", productCode: null, materialCategory: null, photos: [],
    updatedAt: null, deleted: false, deletedAt: null,
  });
  const records = [rec(1, "第一個問題"), rec(2, "第二個問題"), rec(3, "第三個問題")];
  const box = () => screen.getByRole("combobox", { name: "搜尋過去紀錄" }) as HTMLInputElement;
  const activeIndex = () => screen.getAllByRole("option").findIndex((o) => o.getAttribute("aria-selected") === "true");

  it.each(KEYS)("%s：不帶入、反白不動、清單不收", async (key) => {
    const u = userEvent.setup();
    const onPick = vi.fn();
    render(<CopyPicker records={records} onPick={onPick} />);
    await u.click(box());
    await u.keyboard("{ArrowDown}");
    const before = activeIndex();
    expect(before).toBe(1);
    fireEvent.keyDown(box(), ime229(key));
    expect(activeIndex()).toBe(before);
    expect(onPick).not.toHaveBeenCalled();
    expect(box()).toHaveAttribute("aria-expanded", "true");
  });
});
