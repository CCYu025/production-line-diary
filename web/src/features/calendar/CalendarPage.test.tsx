import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import type { DiaryRecord } from "@/lib/types";
import { CalendarPage } from "./CalendarPage";

let nextId = 1;
function rec(date: string, over: Partial<DiaryRecord> = {}): DiaryRecord {
  return {
    id: nextId++,
    date,
    shift: "早",
    time: "08:00",
    duration: 10,
    equipment: "F3",
    category: "取料異常",
    problem: "卡料",
    severity: "輕微",
    action: "",
    rootCause: null,
    status: "待處理",
    productCode: null,
    materialCategory: null,
    photos: [],
    updatedAt: null,
    deleted: false,
    deletedAt: null,
    ...over,
  };
}
const many = (date: string, n: number, over: Partial<DiaryRecord> = {}) =>
  Array.from({ length: n }, () => rec(date, over));

function Probe() {
  const { pathname, search } = useLocation();
  return <output data-testid="loc">{pathname + search}</output>;
}

function setup(initial = "/calendar", records: DiaryRecord[] = []) {
  vi.spyOn(api, "listRecords").mockResolvedValue(records);
  const router = createMemoryRouter(
    [
      {
        path: "/calendar",
        element: (
          <>
            <CalendarPage />
            <Probe />
          </>
        ),
      },
      { path: "/records", element: <Probe /> },
    ],
    { initialEntries: [initial] },
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const loc = () => screen.getByTestId("loc").textContent;
const dayButton = (name: RegExp | string) => screen.findByRole("button", { name });

beforeEach(() => {
  // 只假造 Date：「本月」是 2026 年 10 月；react-query 與 user-event 的計時器維持真實
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 10, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// 全部資料中單日最大次數是 10/6 的 5 次
const DATA = () => [
  ...many("2026-10-05", 1),
  ...many("2026-10-06", 5),
  ...many("2026-10-08", 3), // 0.6 → 中
  ...many("2026-10-14", 4), // 0.8 → 深
  ...many("2026-10-07", 9, { deleted: true, deletedAt: "2026-10-07T01:00:00Z" }), // 回收桶的不算
  ...many("2026-09-10", 2), // 2/5 = 0.4 → 淺（若只看當月最大值會變成最深）
];

describe("日曆：次數與顏色", () => {
  it("每天顯示事件「次數」（不是分鐘），顏色依與全部資料最大次數的比例", async () => {
    setup("/calendar", DATA());
    expect(await screen.findByRole("heading", { name: "2026 年 10 月" })).toBeInTheDocument();

    const b5 = await dayButton(/10 月 5 日.*1 筆/);
    const b6 = await dayButton(/10 月 6 日.*5 筆/);
    const b8 = await dayButton(/10 月 8 日.*3 筆/);
    const b14 = await dayButton(/10 月 14 日.*4 筆/);
    expect(b5).toHaveAttribute("data-step", "1");
    expect(b8).toHaveAttribute("data-step", "2");
    expect(b14).toHaveAttribute("data-step", "3");
    expect(b6).toHaveAttribute("data-step", "3");
    expect(b6).toHaveTextContent("5");
    expect(b6.className).toContain("bg-seq-600");
    expect(b6.className).toContain("text-accent-ink");
    expect(b5.className).toContain("bg-seq-300");
    expect(b5.className).toContain("text-ink-1");
  });

  it("已刪除的紀錄不計入；沒有紀錄的日子不是按鈕", async () => {
    setup("/calendar", DATA());
    await dayButton(/10 月 6 日/);
    expect(screen.queryByRole("button", { name: /10 月 7 日/ })).toBeNull();
    expect(screen.getByLabelText("10 月 7 日，無紀錄")).toBeInTheDocument();
    expect(screen.getByLabelText("10 月 9 日，無紀錄").tagName).toBe("DIV");
    // 今天（10/26）標示
    expect(screen.getByLabelText(/10 月 26 日（今天）/)).toHaveAttribute("aria-current", "date");
  });

  it("色階以「全部資料」的最大次數為準，切到別的月份不會重新正規化", async () => {
    setup("/calendar?month=2026-09", DATA());
    const b = await dayButton(/9 月 10 日.*2 筆/);
    expect(b).toHaveAttribute("data-step", "1");
  });

  it("有星期標題（日一二三四五六）與圖例", async () => {
    setup("/calendar", DATA());
    await dayButton(/10 月 6 日/);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["日", "一", "二", "三", "四", "五", "六"]);
    for (const t of ["無紀錄", "較少", "較多"]) expect(screen.getByText(t)).toBeInTheDocument();
  });
});

describe("日曆：點格子進紀錄列表", () => {
  it("點有紀錄的日子 → #/records?from=<d>&to=<d>（只帶單日）", async () => {
    const user = userEvent.setup();
    setup("/calendar?month=2026-10", DATA());
    await user.click(await dayButton(/10 月 6 日/));
    expect(loc()).toBe("/records?from=2026-10-06&to=2026-10-06");
  });

  it("鍵盤：Enter 與空白鍵都能開啟", async () => {
    const user = userEvent.setup();
    const router = setup("/calendar", DATA());
    const b = await dayButton(/10 月 14 日/);
    b.focus();
    await user.keyboard("{Enter}");
    expect(loc()).toBe("/records?from=2026-10-14&to=2026-10-14");

    await router.navigate(-1);
    const b2 = await dayButton(/10 月 8 日/);
    b2.focus();
    await user.keyboard(" ");
    expect(loc()).toBe("/records?from=2026-10-08&to=2026-10-08");
  });

  it("沒有紀錄的日子點了沒反應", async () => {
    const user = userEvent.setup();
    setup("/calendar", DATA());
    await dayButton(/10 月 6 日/);
    await user.click(screen.getByLabelText("10 月 9 日，無紀錄"));
    expect(loc()).toBe("/calendar");
  });
});

describe("日曆：換月（月份在網址 ?month=）", () => {
  it("上個月／下個月／本月，網址跟著變，上一頁回到前一個月", async () => {
    const user = userEvent.setup();
    const router = setup("/calendar", DATA());
    expect(await screen.findByRole("heading", { name: "2026 年 10 月" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本月" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "上個月" }));
    expect(loc()).toBe("/calendar?month=2026-09");
    expect(screen.getByRole("heading", { name: "2026 年 9 月" })).toBeInTheDocument();
    await dayButton(/9 月 10 日/);

    await user.click(screen.getByRole("button", { name: "下個月" }));
    await user.click(screen.getByRole("button", { name: "下個月" }));
    expect(loc()).toBe("/calendar?month=2026-11");

    await user.click(screen.getByRole("button", { name: "本月" }));
    expect(loc()).toBe("/calendar"); // 預設的本月不寫進網址
    expect(screen.getByRole("heading", { name: "2026 年 10 月" })).toBeInTheDocument();

    await router.navigate(-1); // 瀏覽器上一頁
    expect(await screen.findByRole("heading", { name: "2026 年 11 月" })).toBeInTheDocument();
  });

  it("從網址直接打開指定月份", async () => {
    setup("/calendar?month=2025-12", DATA());
    expect(await screen.findByRole("heading", { name: "2025 年 12 月" })).toBeInTheDocument();
  });

  it("壞掉的 month 參數 → 本月", async () => {
    setup("/calendar?month=garbage", DATA());
    expect(await screen.findByRole("heading", { name: "2026 年 10 月" })).toBeInTheDocument();
  });

  it("1 月按上個月 → 前一年 12 月", async () => {
    const user = userEvent.setup();
    setup("/calendar?month=2026-01", []);
    await user.click(await screen.findByRole("button", { name: "上個月" }));
    expect(loc()).toBe("/calendar?month=2025-12");
  });
});

describe("日曆：載入狀態", () => {
  it("載入失敗顯示錯誤與重試", async () => {
    vi.spyOn(api, "listRecords").mockRejectedValue(new Error("壞了"));
    const router = createMemoryRouter([{ path: "/calendar", element: <CalendarPage /> }], {
      initialEntries: ["/calendar"],
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const alert = await screen.findByRole("alert", {}, { timeout: 4000 }); // 查詢失敗會先自動重試一次
    expect(within(alert).getByRole("button", { name: "重試" })).toBeInTheDocument();
  });
});
