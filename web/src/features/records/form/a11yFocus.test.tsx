import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderForm } from "./testUtils";

beforeEach(() => {
  mockApi();
});
afterEach(() => vi.restoreAllMocks());

const equipmentInput = () => screen.getByRole("combobox", { name: /^設備/ }) as HTMLInputElement;

describe("送出空表單：驗證聚焦首個無效 Combobox", () => {
  it("聚焦但不自動展開建議清單，ERR 訊息沒有被蓋住；使用者按 ↓ 才展開", async () => {
    const u = userEvent.setup();
    renderForm();
    await screen.findByRole("form", { name: "新增紀錄" });
    await u.click(screen.getByRole("button", { name: /^新增紀錄/ }));
    expect(await screen.findByText("請選擇或輸入設備")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(equipmentInput()));
    expect(equipmentInput()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();

    await u.keyboard("{ArrowDown}");
    expect(equipmentInput()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("使用者自己輸入會展開；Tab 離開再 Shift+Tab 回來（使用者自己聚焦）仍會展開", async () => {
    const u = userEvent.setup();
    renderForm();
    await screen.findByRole("form", { name: "新增紀錄" });
    await u.click(screen.getByRole("button", { name: /^新增紀錄/ }));
    await waitFor(() => expect(document.activeElement).toBe(equipmentInput()));
    await u.keyboard("F");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await u.keyboard("{Escape}");
    await u.tab();
    await u.tab({ shift: true });
    expect(document.activeElement).toBe(equipmentInput());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});
