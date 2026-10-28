import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileTabBar, MobileTopBar } from "@/app/MobileChrome";
import { Providers } from "@/app/Providers";
import { Sidebar } from "@/app/Sidebar";
import { Combobox } from "@/components/Combobox";
import { useConfirm } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { PageHeader } from "@/components/PageHeader";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SeverityBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { Field } from "@/features/records/form/fields";
import { renderForm, mockApi as mockFormApi } from "@/features/records/form/testUtils";
import { ReportPage, resetLastReportRange } from "@/features/report/ReportPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { TrashPage } from "@/features/trash/TrashPage";
import { api } from "@/lib/api";
import { notify } from "@/lib/feedback";
import { createQueryClient } from "@/lib/queryClient";
import type { DiaryRecord } from "@/lib/types";
import { makeMeta, makeRecord, mockApi, renderWithApp, sampleRecords, setViewportWidth } from "@/test/recordsHarness";

/*
 * Cyber 主題 P1：data-fx 掛勾（docs/cyber-theme-spec.md §3.3）。
 * data-fx 是純屬性：這裡只驗證「掛勾在哪裡、值是什麼」，標準主題的行為由既有測試負責（它們一個都沒改）。
 */

const fx = (name: string, root: ParentNode = document) => Array.from(root.querySelectorAll(`[data-fx="${name}"]`));

beforeEach(() => setViewportWidth(1280));
afterEach(() => {
  notify.dismiss();
  vi.restoreAllMocks();
});

describe("Button：data-fx=button＋data-variant", () => {
  it("沒傳 variant 時用 defaultVariants 的 secondary；有傳就用傳入的", () => {
    render(
      <>
        <Button>預設</Button>
        <Button variant="primary">主要</Button>
        <Button variant="destructive">刪除</Button>
        <Button variant="ghost">幽靈</Button>
        <Button variant="link">連結</Button>
      </>,
    );
    const v = (name: string) => screen.getByRole("button", { name });
    expect(v("預設")).toHaveAttribute("data-fx", "button");
    expect(v("預設")).toHaveAttribute("data-variant", "secondary");
    expect(v("主要")).toHaveAttribute("data-variant", "primary");
    expect(v("刪除")).toHaveAttribute("data-variant", "destructive");
    expect(v("幽靈")).toHaveAttribute("data-variant", "ghost");
    expect(v("連結")).toHaveAttribute("data-variant", "link");
  });

  it("asChild：屬性經 Slot 傳到子元素（真正的 <a>），沒有多一層 DOM", () => {
    render(
      <MemoryRouter>
        <Button asChild variant="primary">
          <a href="#/x">前往</a>
        </Button>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "前往" });
    expect(link).toHaveAttribute("data-fx", "button");
    expect(link).toHaveAttribute("data-variant", "primary");
    expect(link.parentElement?.querySelectorAll("[data-fx]")).toHaveLength(1);
  });

  it("呼叫端自己傳的屬性優先（可以覆寫 data-fx，例如送出鈕用 submit）", () => {
    render(
      <Button type="submit" data-fx="submit" variant="primary">
        送出
      </Button>,
    );
    const b = screen.getByRole("button", { name: "送出" });
    expect(b).toHaveAttribute("data-fx", "submit");
    expect(b).toHaveAttribute("data-variant", "primary");
    expect(b).toHaveAttribute("type", "submit");
  });
});

describe("彈出層：sheet／dialog／pop／tooltip", () => {
  it("SheetContent：data-fx=sheet，data-side 是 right／bottom", () => {
    render(
      <Sheet open>
        <SheetContent side="bottom" aria-describedby={undefined}>
          <SheetTitle>標題</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const sheet = document.querySelector('[data-fx="sheet"]');
    expect(sheet).not.toBeNull();
    expect(sheet).toHaveAttribute("data-side", "bottom");
    expect(sheet).toHaveAttribute("role", "dialog");
  });

  it("PopoverContent：data-fx=pop", () => {
    render(
      <Popover open>
        <PopoverTrigger>開</PopoverTrigger>
        <PopoverContent>內容</PopoverContent>
      </Popover>,
    );
    expect(document.querySelector('[data-fx="pop"]')).toHaveTextContent("內容");
  });

  it("TooltipContent：data-fx=tooltip", async () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>觸發</TooltipTrigger>
          <TooltipContent>提示文字</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await waitFor(() => expect(fx("tooltip").length).toBeGreaterThan(0));
    expect(fx("tooltip")[0]).toHaveTextContent("提示文字");
  });

  function ConfirmButton({ destructive }: { destructive: boolean }) {
    const confirm = useConfirm();
    return (
      <button type="button" onClick={() => void confirm({ title: "確定嗎？", destructive })}>
        問
      </button>
    );
  }

  it("確認對話框：data-fx=dialog；按鈕帶 data-fx=button；只有破壞性對話框有 data-variant=destructive", async () => {
    const user = userEvent.setup();
    render(
      <Providers client={createQueryClient()}>
        <ConfirmButton destructive={false} />
      </Providers>,
    );
    await user.click(screen.getByRole("button", { name: "問" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAttribute("data-fx", "dialog");
    expect(dialog).not.toHaveAttribute("data-variant");
    expect(screen.getByRole("button", { name: "取消" })).toHaveAttribute("data-variant", "secondary");
    expect(screen.getByRole("button", { name: "確認" })).toHaveAttribute("data-variant", "primary");
    expect(screen.getByRole("button", { name: "確認" })).toHaveAttribute("data-fx", "button");
  });

  it("破壞性確認對話框：dialog 上有 data-variant=destructive，確認鈕也是 destructive", async () => {
    const user = userEvent.setup();
    render(
      <Providers client={createQueryClient()}>
        <ConfirmButton destructive />
      </Providers>,
    );
    await user.click(screen.getByRole("button", { name: "問" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAttribute("data-fx", "dialog");
    expect(dialog).toHaveAttribute("data-variant", "destructive");
    expect(screen.getByRole("button", { name: "確認" })).toHaveAttribute("data-variant", "destructive");
  });
});

describe("toast：sonner 沒有辦法在 toast 元素上加自訂屬性，穩定選擇器是 [data-sonner-toast][data-type]", () => {
  it("success／error／info／loading 的 data-type 值", async () => {
    render(<Providers client={createQueryClient()}>{null}</Providers>);
    act(() => {
      notify.success("成功了");
      notify.error("失敗了");
      notify.info("提醒");
    });
    await screen.findByText("成功了");
    const typeOf = (text: string) => screen.getByText(text).closest("[data-sonner-toast]")?.getAttribute("data-type");
    expect(typeOf("成功了")).toBe("success");
    expect(typeOf("失敗了")).toBe("error");
    expect(typeOf("提醒")).toBe("info");
    // 容器
    expect(document.querySelector("[data-sonner-toaster]")).not.toBeNull();
  });
});

describe("Skeleton／ErrorState／PageHeader／SeverityBadge", () => {
  it("skeleton、error、page-title", () => {
    render(
      <>
        <Skeleton className="h-4 w-4" />
        <ErrorState error={new Error("壞了")} />
        <PageHeader title="儀表板" />
      </>,
    );
    expect(fx("skeleton")).toHaveLength(1);
    expect(fx("error")).toHaveLength(1);
    expect(fx("error")[0]).toHaveAttribute("role", "alert");
    expect(screen.getByRole("heading", { name: "儀表板" })).toHaveAttribute("data-fx", "page-title");
  });

  it("SeverityBadge：色條是 data-fx=sev，並帶 data-severity（光暈要用來判斷顏色）", () => {
    const { container } = render(
      <>
        <SeverityBadge severity="輕微" />
        <SeverityBadge severity="重大" compact />
      </>,
    );
    const bars = fx("sev", container);
    expect(bars.map((b) => b.getAttribute("data-severity"))).toEqual(["輕微", "重大"]);
    for (const b of bars) expect(b).toHaveAttribute("aria-hidden", "true");
  });
});

describe("SegmentedControl：seg＋選中狀態", () => {
  it("容器是 data-fx=seg；選中的按鈕 aria-pressed=true（CSS 用這個選），其餘 false；點了會換", async () => {
    const user = userEvent.setup();
    function Demo() {
      const [v, setV] = React.useState<"a" | "b">("a");
      return (
        <SegmentedControl
          label="範圍"
          value={v}
          onChange={setV}
          options={[
            { value: "a", label: "甲" },
            { value: "b", label: "乙" },
          ]}
        />
      );
    }
    render(<Demo />);
    const group = screen.getByRole("group", { name: "範圍" });
    expect(group).toHaveAttribute("data-fx", "seg");
    expect(within(group).getByRole("button", { name: "甲" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "乙" })).toHaveAttribute("aria-pressed", "false");
    await user.click(within(group).getByRole("button", { name: "乙" }));
    expect(group.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
    expect(within(group).getByRole("button", { name: "乙" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("表單：field／combobox／error-msg／check", () => {
  it("Field 外層是 field；錯誤訊息文字（不是整個 <p>）是 error-msg，role=alert 在 <p> 上", () => {
    render(
      <Field name="problem" label="問題" error="請填寫問題">
        {(p) => <input {...p} />}
      </Field>,
    );
    const field = fx("field")[0] as HTMLElement;
    expect(field).toHaveAttribute("data-field", "problem");
    const msg = fx("error-msg", field)[0] as HTMLElement;
    expect(msg.tagName).toBe("SPAN");
    expect(msg).toHaveTextContent("請填寫問題");
    expect(msg.closest('[role="alert"]')).not.toBeNull();
    expect(fx("error-msg")).toHaveLength(1);
  });

  it("Field 沒有錯誤時沒有 error-msg", () => {
    render(
      <Field name="problem" label="問題">
        {(p) => <input {...p} />}
      </Field>,
    );
    expect(fx("error-msg")).toHaveLength(0);
  });

  it("Combobox：外層是 combobox，展開的建議清單是 pop", async () => {
    const user = userEvent.setup();
    render(<Combobox aria-label="設備" value="" onValueChange={() => {}} options={["F3", "F4"]} />);
    expect(fx("combobox")).toHaveLength(1);
    expect(fx("pop")).toHaveLength(0);
    await user.click(screen.getByRole("combobox", { name: "設備" }));
    const list = await screen.findByRole("listbox");
    expect(list).toHaveAttribute("data-fx", "pop");
  });

  it("多選下拉的勾選方塊：data-fx=check，data-state 是 on／off，aria-hidden", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectFilter label="設備" options={["F3", "F4"]} counts={{ F3: 1, F4: 2 }} selected={["F3"]} onChange={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: /設備/ }));
    await waitFor(() => expect(fx("check")).toHaveLength(2));
    const checks = fx("check");
    expect(checks.map((c) => c.getAttribute("data-state"))).toEqual(["on", "off"]);
    for (const c of checks) expect(c).toHaveAttribute("aria-hidden", "true");
    // 項目本身仍帶 data-checked（已選時 CSS 也可以從父層接）
    expect(checks[0]?.closest("[data-checked]")).toHaveAttribute("data-checked", "true");
    expect(fx("pop")).toHaveLength(1);
  });

  it("新增紀錄表單：送出鈕是 submit（仍是 primary）、欄位是 field、嚴重度與狀態是 seg；驗證失敗出現 error-msg", async () => {
    mockFormApi();
    const user = userEvent.setup();
    renderForm("/records/new");
    const form = await screen.findByRole("form", { name: "新增紀錄" });
    const submit = within(form).getByRole("button", { name: "新增紀錄" });
    expect(submit).toHaveAttribute("data-fx", "submit");
    expect(submit).toHaveAttribute("data-variant", "primary");
    expect(fx("field", form).length).toBeGreaterThanOrEqual(6);
    expect(fx("combobox", form).length).toBeGreaterThanOrEqual(2);
    expect(fx("seg", form).map((s) => s.getAttribute("aria-label"))).toEqual(["嚴重度", "處理狀態"]);
    // 嚴重度選項前的色塊
    expect(fx("sev", form).map((s) => s.getAttribute("data-severity"))).toEqual(["輕微", "一般", "嚴重", "重大"]);
    expect(fx("error-msg", form)).toHaveLength(0);
    await user.click(submit);
    await waitFor(() => expect(fx("error-msg", form).length).toBeGreaterThan(0));
    for (const m of fx("error-msg", form)) expect(m.closest('[role="alert"]')).not.toBeNull();
  });
});

describe("導覽：nav-item／brand／nav-group／fab／topbar／aria-current", () => {
  function shell(ui: React.ReactNode, path = "/dashboard") {
    return render(
      <QueryClientProvider client={createQueryClient()}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  }

  it("側欄：每個導覽項目（含匯出）與主題切換都是 nav-item；目前頁有 aria-current=page；品牌、群組小標", () => {
    vi.spyOn(api, "listRecords").mockResolvedValue([]);
    shell(<Sidebar />, "/records");
    const nav = screen.getByRole("navigation", { name: "主要導覽" });
    // 6 個頁面連結＋匯出 Excel
    expect(fx("nav-item", nav)).toHaveLength(7);
    expect(fx("nav-item", nav).filter((e) => e.getAttribute("aria-current") === "page").map((e) => e.textContent)).toEqual(["紀錄列表"]);
    // 主題切換不在 nav landmark 裡，但同樣是 nav-item
    expect(screen.getByRole("button", { name: "CYBER 介面" })).toHaveAttribute("data-fx", "nav-item");
    expect(fx("nav-item")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "匯出 Excel" })).toHaveAttribute("data-fx", "nav-item");
    expect(fx("brand")).toHaveLength(1);
    expect(fx("nav-group").map((e) => e.textContent)).toEqual(["檢視", "輸出", "管理"]);
    // 「新增紀錄」維持一般的 primary 按鈕（沒有被當成 nav-item）
    const add = screen.getByRole("link", { name: "新增紀錄" });
    expect(add).toHaveAttribute("data-fx", "button");
    expect(add).toHaveAttribute("data-variant", "primary");
  });

  it("手機底部分頁列：四個分頁＋「更多」都是 nav-item，中央新增鈕的圓形是 fab，目前頁有 aria-current", () => {
    vi.spyOn(api, "listRecords").mockResolvedValue([]);
    shell(<MobileTabBar />, "/calendar");
    const nav = screen.getByRole("navigation", { name: "底部導覽" });
    expect(fx("nav-item", nav)).toHaveLength(5);
    expect(fx("fab", nav)).toHaveLength(1);
    expect(fx("fab", nav)[0]?.closest("a")).toHaveAttribute("href", "/records/new");
    expect(fx("nav-item", nav).filter((e) => e.getAttribute("aria-current") === "page").map((e) => e.textContent)).toEqual(["日曆"]);
  });

  it("手機頂欄：topbar 與標題（page-title）", () => {
    shell(<MobileTopBar title="儀表板" />);
    expect(fx("topbar")).toHaveLength(1);
    expect(fx("page-title", fx("topbar")[0]!)[0]).toHaveTextContent("儀表板");
  });
});

describe("儀表板：panel／panel-cut／data-fx-alert／kpi-num／bar／trend-col／sev", () => {
  async function dashboard(records: DiaryRecord[]) {
    mockApi(records);
    renderWithApp("/dashboard");
    await screen.findByRole("heading", { name: "設備發生次數" });
  }

  it("待處理 > 0：兩張主要 KPI 都是 panel-cut，只有「待處理」有 data-fx-alert；可點的卡片是 <button>", async () => {
    await dashboard(sampleRecords());
    const cut = fx("panel-cut");
    expect(cut).toHaveLength(2);
    expect(cut.map((c) => c.tagName)).toEqual(["BUTTON", "BUTTON"]);
    const alerts = document.querySelectorAll("[data-fx-alert]");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toBe(cut[0]);
    expect(alerts[0]).toHaveAccessibleName("待處理 2 筆，查看紀錄");
    expect(cut[1]).not.toHaveAttribute("data-fx-alert");
  });

  it("待處理 = 0：整個 data-fx-alert 屬性都不輸出；0 筆的卡片是 <div>（仍是 panel-cut）", async () => {
    await dashboard([makeRecord({ id: 1, status: "追蹤中" }), makeRecord({ id: 2, status: "已解決" })]);
    expect(document.querySelectorAll("[data-fx-alert]")).toHaveLength(0);
    const cut = fx("panel-cut");
    expect(cut).toHaveLength(2);
    expect(cut[0]?.tagName).toBe("DIV");
    expect(cut[1]?.tagName).toBe("BUTTON");
  });

  it("面板、KPI 數字、長條、趨勢柱、嚴重度色塊、範圍切換", async () => {
    await dashboard(sampleRecords());
    // 4 張次要 KPI ＋ 5 張 ChartCard
    expect(fx("panel")).toHaveLength(9);
    // 2 主要＋4 次要
    expect(fx("kpi-num")).toHaveLength(6);
    const equipmentCard = screen.getByRole("region", { name: "設備發生次數" });
    expect(fx("bar-row", equipmentCard).length).toBeGreaterThan(0);
    expect(fx("bar", equipmentCard)).toHaveLength(fx("bar-row", equipmentCard).length);
    expect(fx("bar", equipmentCard)[0]?.closest('[data-fx="bar-row"]')).not.toBeNull();
    expect(fx("trend-col").length).toBeGreaterThan(0);
    expect(fx("trend-bar")).toHaveLength(fx("trend-col").length);
    // 甜甜圈四種嚴重度的弧＋圖例色塊
    expect(fx("sev").length).toBeGreaterThanOrEqual(8);
    expect(fx("seg")).toHaveLength(1);
    expect(fx("page-title")).toHaveLength(1);
  });

  it("載入中的骨架：panel／panel-cut／skeleton", async () => {
    vi.spyOn(api, "listRecords").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(api, "getMeta").mockResolvedValue(makeMeta([]));
    renderWithApp("/dashboard");
    await screen.findByText("載入中…");
    expect(fx("panel-cut")).toHaveLength(2);
    expect(fx("panel").length).toBeGreaterThan(0);
    expect(fx("skeleton").length).toBeGreaterThan(0);
  });
});

describe("紀錄列表：panel／row／sev", () => {
  it("桌面表格：外框 panel、每個 <tr> 是 row", async () => {
    mockApi(sampleRecords());
    renderWithApp("/records");
    await screen.findByRole("table");
    expect(fx("panel")).toHaveLength(1);
    const rows = fx("row");
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.tagName === "TR")).toBe(true);
    // 表格裡的嚴重度是 SeverityBadge 的色條
    expect(fx("sev", fx("panel")[0]!)).toHaveLength(5);
  });

  it("手機卡片：每張卡片（<button>）是 row，左側嚴重度色條是 sev", async () => {
    setViewportWidth(375);
    mockApi(sampleRecords());
    renderWithApp("/records");
    await waitFor(() => expect(fx("row")).toHaveLength(5));
    expect(fx("row").every((r) => r.tagName === "BUTTON")).toBe(true);
    expect(fx("sev", fx("row")[0]!)).toHaveLength(1);
    expect(fx("sev", fx("row")[0]!)[0]).toHaveAttribute("data-severity");
  });

  it("篩選列的分段按鈕是 seg，嚴重度選項前面的色塊是 sev", async () => {
    mockApi(sampleRecords());
    renderWithApp("/records");
    await screen.findByRole("table");
    expect(fx("seg").map((s) => s.getAttribute("aria-label"))).toEqual(["處理狀態", "嚴重度"]);
    expect(fx("sev", screen.getByRole("group", { name: "嚴重度" }))).toHaveLength(4);
  });
});

describe("其他頁面：calendar／trash／settings／report", () => {
  function page(ui: React.ReactNode, path: string) {
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    // 資料路由器：設備對照設定頁用了 useBlocker
    const router = createMemoryRouter([{ path: "*", element: ui }], { initialEntries: [path] });
    return render(
      <Providers client={client}>
        <RouterProvider router={router} />
      </Providers>,
    );
  }

  it("日曆：外框 panel；有紀錄的格子（<button>）與無紀錄的格子（<div>）都是 cal-cell", async () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    vi.spyOn(api, "listRecords").mockResolvedValue([makeRecord({ id: 1, date: iso })]);
    page(<CalendarPage />, "/calendar");
    await waitFor(() => expect(fx("cal-cell").length).toBeGreaterThan(27));
    expect(fx("panel")).toHaveLength(1);
    const tags = new Set(fx("cal-cell").map((c) => c.tagName));
    expect(tags).toEqual(new Set(["BUTTON", "DIV"]));
    expect(fx("cal-cell").filter((c) => c.tagName === "BUTTON")).toHaveLength(1);
  });

  it("回收桶：桌面表格外框與手機卡片都是 panel", async () => {
    vi.spyOn(api, "listRecords").mockResolvedValue([makeRecord({ id: 1, deleted: true, deletedAt: "2026-10-26T09:00:00" })]);
    const { unmount } = page(<TrashPage />, "/trash");
    await screen.findByRole("table");
    expect(fx("panel")).toHaveLength(1);
    unmount();
    setViewportWidth(375);
    page(<TrashPage />, "/trash");
    await screen.findByRole("list");
    expect(fx("panel")).toHaveLength(1);
    expect(fx("panel")[0]?.tagName).toBe("LI");
  });

  it("設備對照設定：表單外框 panel、儲存鈕 submit、欄位 field", async () => {
    vi.spyOn(api, "getMeta").mockResolvedValue(makeMeta([]));
    page(<SettingsPage />, "/settings");
    const save = await screen.findByRole("button", { name: "儲存對照表" });
    expect(save).toHaveAttribute("data-fx", "submit");
    expect(save).toHaveAttribute("data-variant", "primary");
    expect(save.closest("form")).toHaveAttribute("data-fx", "panel");
    expect(fx("field").length).toBeGreaterThan(0);
  });

  describe("列印報表頁", () => {
    beforeEach(() => resetLastReportRange());

    it("控制列有 cyber 掛勾（panel、submit、button），但報表本體 #report-output 內一個都沒有", async () => {
      const user = userEvent.setup();
      vi.spyOn(api, "listRecords").mockResolvedValue([
        makeRecord({ id: 1, severity: "重大", status: "待處理" }),
        makeRecord({ id: 2, severity: "輕微", status: "已解決", photos: ["a.jpg"] }),
      ]);
      page(<ReportPage />, "/report?from=2026-10-01&to=2026-10-31");
      const generate = await screen.findByRole("button", { name: "產生報表" });
      await waitFor(() => expect(generate).toBeEnabled());
      expect(generate).toHaveAttribute("data-fx", "submit");
      expect(screen.getByRole("button", { name: /列印／另存 PDF/ })).toHaveAttribute("data-fx", "button");
      expect(generate.closest("form")).toHaveAttribute("data-fx", "panel");
      await user.click(generate);
      const output = await waitFor(() => {
        const el = document.getElementById("report-output");
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      expect(output.querySelectorAll(".rr-sev i").length).toBeGreaterThan(0);
      expect(output.matches("[data-fx], [data-variant], [data-fx-alert]")).toBe(false);
      expect(output.querySelectorAll("[data-fx], [data-variant], [data-fx-alert]")).toHaveLength(0);
    });
  });
});

describe("回收桶：永久刪除按鈕的 data-fx-tone（Cyber 設計審查）", () => {
  const DELETED = makeRecord({ id: 1, deleted: true, deletedAt: "2026-10-26T09:00:00" });

  function renderTrash() {
    vi.spyOn(api, "listRecords").mockResolvedValue([DELETED]);
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    const router = createMemoryRouter([{ path: "*", element: <TrashPage /> }], { initialEntries: ["/trash"] });
    return render(
      <Providers client={client}>
        <RouterProvider router={router} />
      </Providers>,
    );
  }

  it("桌面表格與手機卡片的「永久刪除」都帶 data-fx-tone=\"danger\"（純屬性，variant 仍是 secondary，「復原」沒有）", async () => {
    const { unmount } = renderTrash();
    await screen.findByRole("table");
    const purge = screen.getByRole("button", { name: /^永久刪除/ });
    expect(purge).toHaveAttribute("data-fx-tone", "danger");
    expect(purge).toHaveAttribute("data-variant", "secondary");
    expect(screen.getByRole("button", { name: /^復原/ })).not.toHaveAttribute("data-fx-tone");
    unmount();
    setViewportWidth(375);
    renderTrash();
    await screen.findByRole("list");
    expect(screen.getByRole("button", { name: /^永久刪除/ })).toHaveAttribute("data-fx-tone", "danger");
  });

  it("確認對話框內的確認鈕本來就是 destructive variant（不需要 data-fx-tone）", async () => {
    renderTrash();
    await screen.findByRole("table");
    await userEvent.setup().click(screen.getByRole("button", { name: /^永久刪除/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "永久刪除" });
    expect(confirm).toHaveAttribute("data-variant", "destructive");
    expect(confirm).not.toHaveAttribute("data-fx-tone");
  });
});
