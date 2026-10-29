import { aggregate } from "@shared/aggregate";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { HBarChart, SeverityDonut, TrendChart } from "@/features/dashboard/charts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KpiCards } from "@/features/dashboard/KpiCards";
import { RecordList } from "@/features/records/RecordList";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import type { Aggregate } from "@/lib/types";
import { makeRecord, sampleRecords, setViewportWidth } from "@/test/recordsHarness";

/*
 * Cyber 主題 P3 塊 A：FX-07／09／12／13／16 的 JS 掛勾。
 * 標準主題（jsdom 預設）DOM 與 P2 完全相同——沒有任何 data-fx-in；cyber 且允許動態時才輸出。
 * （recordsHarness 的 matchMedia 對 prefers-reduced-motion 一律回 false，所以 data-theme=cyber 就等於 useFx() 為 true。）
 */

const root = document.documentElement;
const realMatchMedia = window.matchMedia;

function enableCyber(width = 1280) {
  setViewportWidth(width);
  root.dataset.theme = "cyber";
}

beforeEach(() => setViewportWidth(1280));
afterEach(() => {
  window.matchMedia = realMatchMedia;
  delete root.dataset.theme;
  vi.useRealTimers();
});

const ranked = Array.from({ length: 25 }, (_, i) => ({ label: `機台${i}`, count: 25 - i, minutes: 0 }));

describe("FX-09 橫條圖", () => {
  it("標準主題：沒有 data-fx-in／--i，長條寬度與 P2 相同", () => {
    render(<HBarChart rows={ranked.slice(0, 3)} onSelect={() => {}} actionLabel="查看設備" />);
    const bars = document.querySelectorAll<HTMLElement>('[data-fx="bar"]');
    expect(bars).toHaveLength(3);
    for (const b of bars) {
      expect(b.hasAttribute("data-fx-in")).toBe(false);
      expect(b.style.getPropertyValue("--i")).toBe("");
    }
    expect(bars[0]!.style.width).toBe("100%");
  });

  it("cyber：前 20 條有 data-fx-in 與 --i（依序），第 21 條起沒有；寬度計算不變", () => {
    enableCyber();
    render(<HBarChart rows={ranked} onSelect={() => {}} actionLabel="查看設備" />);
    const bars = [...document.querySelectorAll<HTMLElement>('[data-fx="bar"]')];
    expect(bars).toHaveLength(25);
    expect(bars.filter((b) => b.hasAttribute("data-fx-in"))).toHaveLength(20);
    expect(bars[0]!.style.getPropertyValue("--i")).toBe("0");
    expect(bars[19]!.style.getPropertyValue("--i")).toBe("19");
    expect(bars[20]!.hasAttribute("data-fx-in")).toBe(false);
    expect(bars[0]!.style.width).toBe("100%");
    expect(bars[1]!.style.width).toBe(`${Math.round((24 / 25) * 100)}%`);
  });

  it("cyber 手機（< 768）：上限 10 條", () => {
    enableCyber(375);
    render(<HBarChart rows={ranked} onSelect={() => {}} actionLabel="查看設備" />);
    expect(document.querySelectorAll('[data-fx="bar"][data-fx-in]')).toHaveLength(10);
  });

  it("cyber：資料改變（切換範圍）時重新掛載，長條元素是新的（重播進場）；資料沒變則不重掛", () => {
    enableCyber();
    const rows1 = ranked.slice(0, 3);
    const { rerender } = render(<HBarChart rows={rows1} onSelect={() => {}} actionLabel="查看設備" />);
    const before = document.querySelector('[data-fx="bar"]');
    rerender(<HBarChart rows={rows1.map((r) => ({ ...r }))} onSelect={() => {}} actionLabel="查看設備" />);
    expect(document.querySelector('[data-fx="bar"]')).toBe(before);
    rerender(<HBarChart rows={ranked.slice(0, 2)} onSelect={() => {}} actionLabel="查看設備" />);
    expect(document.querySelector('[data-fx="bar"]')).not.toBe(before);
  });

  it("標準主題：資料改變不重新掛載（key 為 undefined，行為與 P2 相同）", () => {
    const { rerender } = render(<HBarChart rows={ranked.slice(0, 3)} onSelect={() => {}} actionLabel="查看設備" />);
    const before = document.querySelector('[data-fx="bar"]');
    rerender(<HBarChart rows={ranked.slice(0, 2)} onSelect={() => {}} actionLabel="查看設備" />);
    expect(document.querySelector('[data-fx="bar"]')).toBe(before);
  });
});

describe("FX-12 趨勢柱", () => {
  const trend = Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, count: (i % 5) + 1, minutes: 0 }));
  it("標準主題：沒有 data-fx-in", () => {
    render(<TrendChart trend={trend} onSelect={() => {}} />);
    expect(document.querySelectorAll('[data-fx="trend-bar"][data-fx-in]')).toHaveLength(0);
  });
  it("cyber：最新（最右邊）的 20 根由左往右依序（--i 0..19），更早的直接出現；柱高不變", () => {
    enableCyber();
    render(<TrendChart trend={trend} onSelect={() => {}} />);
    const bars = [...document.querySelectorAll<HTMLElement>('[data-fx="trend-bar"]')];
    expect(bars).toHaveLength(30);
    expect(bars.slice(0, 10).some((b) => b.hasAttribute("data-fx-in"))).toBe(false);
    expect(bars[10]!.style.getPropertyValue("--i")).toBe("0");
    expect(bars[29]!.style.getPropertyValue("--i")).toBe("19");
    expect(bars[29]!.style.height).toBe("96px"); // 最大值（count 5）= TREND_MAX_PX
  });
});

describe("FX-13 甜甜圈", () => {
  const counts = [
    { label: "輕微", count: 1, minutes: 0 },
    { label: "一般", count: 2, minutes: 0 },
    { label: "嚴重", count: 3, minutes: 0 },
    { label: "重大", count: 4, minutes: 0 },
  ] satisfies Aggregate["severityCounts"];
  it("標準主題：沒有 data-fx-in", () => {
    render(<SeverityDonut counts={counts} onSelect={() => {}} />);
    expect(document.querySelector("[data-fx-in]")).toBeNull();
  });
  it("cyber：容器有 data-fx-in=donut，可存取名稱不變", () => {
    enableCyber();
    render(<SeverityDonut counts={counts} onSelect={() => {}} />);
    expect(document.querySelector('[data-fx-in="donut"]')).not.toBeNull();
    expect(screen.getByRole("img", { name: "嚴重度分布，共 10 次" })).toBeInTheDocument();
  });
});

describe("FX-07 KPI 數字", () => {
  const agg = aggregate(sampleRecords());
  it("標準主題：kpi-num 只有純文字（沒有 sr-only／aria-hidden 的子層）", () => {
    render(<KpiCards agg={agg} onDrill={() => {}} />);
    const nums = document.querySelectorAll('[data-fx="kpi-num"]');
    expect(nums.length).toBe(6);
    for (const n of nums) expect(n.children).toHaveLength(0);
  });
  it("cyber：亂跳期間真實數字仍在 sr-only、亂碼層 aria-hidden；結束後回到純文字", () => {
    vi.useFakeTimers();
    enableCyber();
    render(<KpiCards agg={agg} onDrill={() => {}} />);
    const first = document.querySelectorAll('[data-fx="kpi-num"]')[0]!;
    expect(first.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(first.querySelector(".sr-only")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(500));
    for (const n of document.querySelectorAll('[data-fx="kpi-num"]')) expect(n.children).toHaveLength(0);
  });
});

describe("FX-16 紀錄列表", () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => makeRecord({ id: i + 1 }));
  const renderList = (n: number) =>
    render(
      <MemoryRouter>
        <TooltipProvider>
          <RecordList rows={make(n)} sortDesc onToggleSort={() => {}} onOpen={() => {}} onCopy={() => {}} />
        </TooltipProvider>
      </MemoryRouter>,
    );
  it("標準主題：列沒有 data-fx-in", () => {
    setViewportWidth(1280);
    renderList(5);
    expect(document.querySelectorAll('tr[data-fx="row"]')).toHaveLength(5);
    expect(document.querySelectorAll("[data-fx-in]")).toHaveLength(0);
  });
  it("cyber 桌面：前 20 列依序，第 21 列起沒有；列仍可聚焦（tabIndex 0）", () => {
    enableCyber();
    renderList(25);
    const rows = [...document.querySelectorAll<HTMLElement>('tr[data-fx="row"]')];
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => r.hasAttribute("data-fx-in"))).toHaveLength(20);
    expect(rows[19]!.style.getPropertyValue("--i")).toBe("19");
    expect(rows[20]!.hasAttribute("data-fx-in")).toBe(false);
    expect(rows.every((r) => r.tabIndex === 0)).toBe(true);
  });
  it("cyber 手機卡片：前 10 張", () => {
    enableCyber(375);
    renderList(25);
    expect(document.querySelectorAll('button[data-fx="row"]')).toHaveLength(25);
    expect(document.querySelectorAll('button[data-fx="row"][data-fx-in]')).toHaveLength(10);
  });
});

describe("FX-14 日曆", () => {
  function setup() {
    vi.spyOn(api, "listRecords").mockResolvedValue([makeRecord({ id: 1, date: "2026-10-20" })]);
    const router = createMemoryRouter([{ path: "/calendar", element: <CalendarPage /> }], { initialEntries: ["/calendar?month=2026-10"] });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }
  it("標準主題：格子與表格都沒有 data-fx-in", async () => {
    setup();
    await screen.findByRole("button", { name: /10 月 20 日/ });
    expect(document.querySelectorAll("[data-fx-in]")).toHaveLength(0);
  });
  it("cyber：每格依「列 + 欄」對角線序號進場；第一次載入不 glitch，換月才在整張表格上 glitch 一次", async () => {
    enableCyber();
    setup();
    await screen.findByRole("button", { name: /10 月 20 日/ });
    const cells = [...document.querySelectorAll<HTMLElement>('[data-fx="cal-cell"]')];
    expect(cells.length).toBe(31);
    expect(cells.every((c) => c.hasAttribute("data-fx-in"))).toBe(true);
    const idx = cells.map((c) => Number(c.style.getPropertyValue("--i")));
    expect(Math.max(...idx)).toBeLessThanOrEqual(11);
    // 2026-10-01 是星期四、日曆週日在最左：第 1 列、第 5 欄（索引 0 + 4）
    expect(idx[0]).toBe(4);
    expect(document.querySelector('table[data-fx-in="glitch"]')).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "下個月" }));
    expect(await screen.findByRole("table", { name: "2026 年 11 月" })).toHaveAttribute("data-fx-in", "glitch");
  });
});
