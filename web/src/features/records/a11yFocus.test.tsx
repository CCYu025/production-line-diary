import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "@/lib/feedback";
import { mockApi, renderWithApp, sampleRecords, setViewportWidth } from "@/test/recordsHarness";

afterEach(() => {
  notify.dismiss();
  vi.restoreAllMocks();
});

async function setup(path: string) {
  mockApi(sampleRecords());
  const user = userEvent.setup();
  renderWithApp(path);
  await screen.findByTestId("result-count");
  return { user };
}

describe("詳情面板：上一筆／下一筆之後焦點留在被按的按鈕", () => {
  beforeEach(() => setViewportWidth(1280));

  it("按〔下一筆〕後，焦點仍在〔下一筆〕（內容換成下一筆）", async () => {
    const { user } = await setup("/records?open=3");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "下一筆" }));
    await within(dialog).findByRole("heading", { name: "感測器誤判" });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "下一筆" })));
  });

  it("按〔上一筆〕後，焦點仍在〔上一筆〕", async () => {
    const { user } = await setup("/records?open=3");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "上一筆" }));
    await within(dialog).findByText("2 / 5");
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "上一筆" })));
  });

  it("鍵盤連按〔下一筆〕走到最後一筆：焦點移到另一個方向的按鈕〔上一筆〕", async () => {
    const { user } = await setup("/records?open=4");
    const dialog = await screen.findByRole("dialog");
    within(dialog).getByRole("button", { name: "下一筆" }).focus();
    await user.keyboard("{Enter}");
    await within(dialog).findByText("5 / 5");
    expect(within(dialog).getByRole("button", { name: "下一筆" })).toBeDisabled();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "上一筆" })));
  });

  it("走到第一筆也一樣：焦點移到〔下一筆〕", async () => {
    const { user } = await setup("/records?open=2");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "上一筆" }));
    await within(dialog).findByText("1 / 5");
    expect(within(dialog).getByRole("button", { name: "上一筆" })).toBeDisabled();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "下一筆" })));
  });
});

describe("375 寬的底部 Sheet（ResponsivePopover）：焦點進入面板、鎖在面板內、Esc 後回到觸發按鈕", () => {
  beforeEach(() => setViewportWidth(375));

  it("多選：開啟後焦點在面板內第一個可聚焦項；Tab 不會跑出面板；Esc 回到觸發按鈕", async () => {
    const { user } = await setup("/records");
    const trigger = screen.getByRole("button", { name: "設備" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    // 焦點在面板本身（不是搜尋框，避免手機彈出軟鍵盤）；下一個 Tab 才到搜尋框
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(dialog).toHaveAccessibleName("選擇設備");
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole("combobox", { name: "搜尋設備" }));
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `Tab 第 ${i + 1} 次`).toBe(true);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("日期：開啟後焦點在面板內第一個快捷鈕；Esc 回到觸發按鈕", async () => {
    const { user } = await setup("/records");
    const trigger = screen.getByRole("button", { name: "日期" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    await user.tab();
    const firstPreset = within(dialog)
      .getAllByRole("button")
      .find((b) => b.hasAttribute("aria-pressed"));
    expect(document.activeElement).toBe(firstPreset);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

describe("桌面 popover 行為不變", () => {
  beforeEach(() => setViewportWidth(1280));

  it("開啟後有搜尋框，Esc 關閉後回到觸發按鈕", async () => {
    const { user } = await setup("/records");
    const trigger = screen.getByRole("button", { name: "設備" });
    await user.click(trigger);
    expect(await screen.findByRole("combobox", { name: "搜尋設備" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "搜尋設備" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
