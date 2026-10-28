import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { notify } from "@/lib/feedback";
import { createQueryClient } from "@/lib/queryClient";
import { applyTheme, getThemePreference, switchTheme } from "@/lib/theme";
import { MobileTabBar } from "./MobileChrome";
import { Sidebar } from "./Sidebar";
import { THEME_TOGGLE } from "./themeToggle";

const root = document.documentElement;
const NAME = "CYBER 介面";

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  applyTheme("standard");
  delete root.dataset.theme;
  document.querySelectorAll('meta[name="color-scheme"]').forEach((m) => m.remove());
  window.localStorage.clear();
});

function renderShell(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/dashboard"]}>
          {ui}
          <main id="main" tabIndex={-1}>
            內容
          </main>
          <Toaster />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("共用定義", () => {
  it("名稱固定為「CYBER 介面」", () => {
    expect(THEME_TOGGLE.label).toBe(NAME);
  });
});

describe("桌面側欄／平板圖示列的切換按鈕", () => {
  it("是 button、可存取名稱固定、預設未按下，狀態標記為「關」且不影響名稱", () => {
    renderShell(<Sidebar />);
    const btn = screen.getByRole("button", { name: NAME });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveTextContent("關");
    expect(screen.getAllByRole("button", { name: NAME })).toHaveLength(1);
  });

  it("不在「主要導覽」landmark 裡（導覽的結構不變）", () => {
    renderShell(<Sidebar />);
    const nav = screen.getByRole("navigation", { name: "主要導覽" });
    expect(within(nav).queryByRole("button", { name: NAME })).toBeNull();
    // 既有導覽項目數不變：6 個頁面連結 ＋ 匯出按鈕
    expect(within(nav).getAllByRole("link")).toHaveLength(6);
    expect(within(nav).getAllByRole("button")).toHaveLength(1);
  });

  it("點擊：立刻切到 cyber、寫入偏好、狀態變「開」、名稱不變、同一個元素、焦點留在按鈕上、不跳 toast", async () => {
    const user = userEvent.setup();
    renderShell(<Sidebar />);
    const btn = screen.getByRole("button", { name: NAME });
    await user.click(btn);

    expect(root.dataset.theme).toBe("cyber");
    expect(getThemePreference()).toBe("cyber");
    expect(window.localStorage.getItem("pld.theme")).toBe("cyber");
    const after = screen.getByRole("button", { name: NAME });
    expect(after).toBe(btn); // 沒有 remount
    expect(after).toHaveAttribute("aria-pressed", "true");
    expect(after).toHaveTextContent("開");
    expect(after).toHaveFocus();
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  });

  it("再按一次：切回標準、移除 data-theme、偏好改為 standard", async () => {
    const user = userEvent.setup();
    renderShell(<Sidebar />);
    const btn = screen.getByRole("button", { name: NAME });
    await user.click(btn);
    await user.click(btn);
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem("pld.theme")).toBe("standard");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveTextContent("關");
    expect(btn).toHaveFocus();
  });

  it("鍵盤（Enter／空白）也能切換", async () => {
    const user = userEvent.setup();
    renderShell(<Sidebar />);
    screen.getByRole("button", { name: NAME }).focus();
    await user.keyboard("{Enter}");
    expect(root.dataset.theme).toBe("cyber");
    await user.keyboard(" ");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("別處切換主題（例如網址參數、另一個外殼）時，按鈕狀態即時跟著變", () => {
    renderShell(<Sidebar />);
    expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "false");
    act(() => switchTheme("cyber"));
    expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "true");
  });

  it("開機時已是 cyber：一開始就是按下狀態", () => {
    applyTheme("cyber");
    renderShell(<Sidebar />);
    expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("手機「更多」面板的切換按鈕", () => {
  async function openMore(user: ReturnType<typeof userEvent.setup>) {
    const more = screen.getByRole("button", { name: "更多" });
    await user.click(more);
    const dialog = await screen.findByRole("dialog");
    return { more, dialog };
  }

  it("在面板最後一列，名稱固定、aria-pressed 反映狀態，不在導覽清單（ul）裡", async () => {
    const user = userEvent.setup();
    renderShell(<MobileTabBar />);
    const { dialog } = await openMore(user);
    const btn = within(dialog).getByRole("button", { name: NAME });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveTextContent("關");
    expect(btn.closest("ul")).toBeNull();
    // 導覽清單項目數不變（列印報表、匯出 Excel、設備對照設定、回收桶）
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(4);
    // 排在所有導覽項目之後（最後一列）
    const listEl = dialog.querySelector("ul")!;
    expect(listEl.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("點擊：就地切換、面板不關閉、焦點留在按鈕上、不跳 toast", async () => {
    const user = userEvent.setup();
    renderShell(<MobileTabBar />);
    const { dialog } = await openMore(user);
    const btn = within(dialog).getByRole("button", { name: NAME });
    await user.click(btn);

    expect(root.dataset.theme).toBe("cyber");
    expect(window.localStorage.getItem("pld.theme")).toBe("cyber");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const after = within(screen.getByRole("dialog")).getByRole("button", { name: NAME });
    expect(after).toBe(btn);
    expect(after).toHaveAttribute("aria-pressed", "true");
    expect(after).toHaveTextContent("開");
    expect(after).toHaveFocus();
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  });

  it("切換之後 Esc 關閉面板，焦點仍回到「更多」按鈕（焦點規則沒被破壞）", async () => {
    const user = userEvent.setup();
    renderShell(<MobileTabBar />);
    const { more, dialog } = await openMore(user);
    await user.click(within(dialog).getByRole("button", { name: NAME }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(more).toHaveFocus());
    expect(root.dataset.theme).toBe("cyber");
  });

  it("開啟時焦點仍在第一個項目（列印報表），不是切換按鈕", async () => {
    const user = userEvent.setup();
    renderShell(<MobileTabBar />);
    await openMore(user);
    const first = await screen.findByRole("link", { name: "列印報表" });
    await waitFor(() => expect(first).toHaveFocus());
  });
});

describe("toast 的主題（sonner）", () => {
  it("cyber：傳 theme=dark；標準：維持預設（light）", async () => {
    renderShell(<div />);
    act(() => {
      notify.info("標準");
    });
    await screen.findByText("標準");
    expect(document.querySelector("[data-sonner-toaster]")).toHaveAttribute("data-sonner-theme", "light");

    act(() => switchTheme("cyber"));
    await waitFor(() => expect(document.querySelector("[data-sonner-toaster]")).toHaveAttribute("data-sonner-theme", "dark"));

    act(() => switchTheme("standard"));
    await waitFor(() => expect(document.querySelector("[data-sonner-toaster]")).toHaveAttribute("data-sonner-theme", "light"));
  });
});
