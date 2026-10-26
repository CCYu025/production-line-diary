import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import { MobileTabBar } from "./MobileChrome";

function Nav() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/calendar")}>
      去日曆（模擬上一頁／程式導覽）
    </button>
  );
}

function setup() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="*" element={<Nav />} />
        </Routes>
        <MobileTabBar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("手機底部分頁列的「更多」面板", () => {
  it("開啟時焦點在第一個項目（列印報表），不是匯出 Excel", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "更多" }));
    const first = await screen.findByRole("link", { name: "列印報表" });
    await waitFor(() => expect(first).toHaveFocus());
  });

  it("按 Esc 關閉後，焦點回到「更多」按鈕", async () => {
    const user = userEvent.setup();
    setup();
    const more = screen.getByRole("button", { name: "更多" });
    await user.click(more);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(more).toHaveFocus());
  });

  it("按關閉鈕後，焦點回到「更多」按鈕", async () => {
    const user = userEvent.setup();
    setup();
    const more = screen.getByRole("button", { name: "更多" });
    await user.click(more);
    await user.click(await screen.findByRole("button", { name: "關閉" }));
    await waitFor(() => expect(more).toHaveFocus());
  });

  it("選了不換頁的項目（匯出 Excel）後，焦點回到「更多」按鈕", async () => {
    vi.spyOn(api, "exportXlsx").mockResolvedValue({ path: "x.xlsx" });
    const user = userEvent.setup();
    setup();
    const more = screen.getByRole("button", { name: "更多" });
    await user.click(more);
    await user.click(await screen.findByRole("button", { name: "匯出 Excel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(more).toHaveFocus());
  });

  it("換頁（例如瀏覽器上一頁）時面板自動關閉", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "更多" }));
    await screen.findByRole("dialog");
    // 面板開著時，用程式導覽模擬瀏覽器上一頁（Radix 的 modal 會把外面設成 aria-hidden，所以直接呼叫）
    const nav = screen.getByText("去日曆（模擬上一頁／程式導覽）");
    nav.click();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
