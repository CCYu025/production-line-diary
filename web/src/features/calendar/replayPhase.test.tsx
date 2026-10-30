import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import type { DiaryRecord } from "@/lib/types";
import { CalendarPage } from "./CalendarPage";

const root = document.documentElement;
const realMatchMedia = window.matchMedia;

function rec(id: number, date: string): DiaryRecord {
  return {
    id, date, shift: "早", time: "08:00", duration: 10, equipment: "F3", category: "取料異常", problem: "卡料", severity: "輕微",
    action: "", rootCause: null, status: "待處理", productCode: null, materialCategory: null, photos: [], updatedAt: null, deleted: false, deletedAt: null,
  };
}

beforeEach(() => {
  window.matchMedia = ((query: string) =>
    ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList) as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  delete root.dataset.theme;
  vi.restoreAllMocks();
});

function setup() {
  vi.spyOn(api, "listRecords").mockResolvedValue([rec(1, "2026-10-05"), rec(2, "2026-09-07")]);
  const router = createMemoryRouter([{ path: "/calendar", element: <CalendarPage /> }], { initialEntries: ["/calendar?month=2026-10"] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("日曆換月：不重掛的重播", () => {
  it("cyber：換月只翻面 data-fx-phase，table 與有焦點的日期按鈕是同一個 DOM 節點；上一頁再翻回", async () => {
    root.dataset.theme = "cyber";
    const user = userEvent.setup();
    setup();
    const table = await screen.findByRole("table");
    const day = await within(table).findByRole("button", { name: /10 月 5 日/ });
    day.focus();
    expect(table.dataset.fxPhase).toBe("a");
    await user.click(screen.getByRole("button", { name: "上個月" }));
    expect(screen.getByRole("table")).toBe(table);
    expect(table.dataset.fxPhase).toBe("b");
    await user.click(screen.getByRole("button", { name: "下個月" }));
    expect(screen.getByRole("table")).toBe(table);
    expect(table.dataset.fxPhase).toBe("a");
  });

  it("標準主題：沒有 data-fx-phase，換月 table 節點也不重建（所以 cyber 不需要 key）", async () => {
    const user = userEvent.setup();
    setup();
    const table = await screen.findByRole("table");
    expect(table.hasAttribute("data-fx-phase")).toBe(false);
    await user.click(screen.getByRole("button", { name: "上個月" }));
    expect(screen.getByRole("table")).toBe(table);
  });
});
