import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "@/lib/feedback";
import { mockApi, renderWithApp, sampleRecords, setViewportWidth } from "@/test/recordsHarness";
import { recurringCount } from "./recurring";

beforeEach(() => setViewportWidth(1280));
afterEach(() => {
  notify.dismiss();
  vi.restoreAllMocks();
});

describe("詳情面板的「重複發生 ×N」隨切換的紀錄重算", () => {
  it("同一個面板上一筆／下一筆：最高頻問題的紀錄有標籤，換到別的問題就消失，換回來又出現", async () => {
    mockApi(sampleRecords());
    const user = userEvent.setup();
    renderWithApp("/records?open=3");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("重複發生 ×3")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "下一筆" }));
    await within(dialog).findByRole("heading", { name: "感測器誤判" });
    expect(within(dialog).queryByText(/重複發生/)).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "上一筆" }));
    await within(dialog).findByRole("heading", { name: "取料位置偏移" });
    expect(within(dialog).getByText("重複發生 ×3")).toBeInTheDocument();
  });
});

describe("recurringCount（以 top 為輸入的比對）", () => {
  it("top 為 null → 0；次數 2 → 0；問題不同 → 0；次數 3 且相同 → 3", () => {
    expect(recurringCount(null, { problem: "A" })).toBe(0);
    expect(recurringCount({ label: "A", count: 2 }, { problem: "A" })).toBe(0);
    expect(recurringCount({ label: "A", count: 3 }, { problem: "B" })).toBe(0);
    expect(recurringCount({ label: "A", count: 3 }, { problem: "A" })).toBe(3);
  });
});
