import { toISODate } from "@shared/aggregate";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { notify } from "@/lib/feedback";
import { makeRecord, mockApi, renderWithApp, sampleRecords, setViewportWidth } from "@/test/recordsHarness";

const loc = () => screen.getByTestId("loc").textContent ?? "";
const query = () => new URLSearchParams(loc().split("?")[1] ?? "");

beforeEach(() => setViewportWidth(1280));
afterEach(() => {
  notify.dismiss();
  vi.restoreAllMocks();
});

async function setup(records = sampleRecords(), path = "/dashboard") {
  mockApi(records);
  const user = userEvent.setup();
  renderWithApp(path);
  await screen.findByRole("heading", { name: "設備發生次數" });
  return user;
}

function card(title: string): HTMLElement {
  return screen.getByRole("region", { name: title });
}

describe("儀表板：KPI 兩級、用語", () => {
  it("主要 KPI（待處理、追蹤中＋待補根本原因）與次要 KPI（累計事件數、累計時間、平均處理耗時、照片建檔率）", async () => {
    await setup();
    // 5 筆有效：待處理 2、追蹤中 2、已解決 1；耗時 10+12+18+25+10 = 75；有照片 1 筆
    expect(screen.getByRole("button", { name: "待處理 2 筆，查看紀錄" })).toBeInTheDocument();
    const tracking = screen.getByRole("button", { name: "追蹤中 2 筆，查看紀錄" });
    // 待補根本原因 = 未解決且沒填根本原因：#1、#2、#4、#5
    expect(tracking).toHaveTextContent("4 筆待補根本原因");
    for (const label of ["累計事件數", "累計時間", "平均處理耗時", "照片建檔率"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("約 1.3 小時")).toBeInTheDocument();
    expect(screen.getByText("15.0")).toBeInTheDocument();
    expect(screen.getByText("1 / 5 筆附有照片")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("用語是「累計時間」，整個畫面不會出現「停機」", async () => {
    await setup();
    expect(document.body.textContent).not.toContain("停機");
    expect(screen.getByText("累計時間")).toBeInTheDocument();
  });

  it("舊紀錄沒有 photos 欄位也能算（照片建檔率 0%），不會當掉", async () => {
    const r = makeRecord({ id: 1 });
    delete (r as Partial<typeof r>).photos;
    await setup([r]);
    expect(screen.getByText("0 / 1 筆附有照片")).toBeInTheDocument();
  });

  it("0 筆的主要 KPI 不是按鈕（沒東西可看）", async () => {
    await setup([makeRecord({ id: 1, status: "已解決" })]);
    expect(screen.queryByRole("button", { name: "待處理 0 筆，查看紀錄" })).toBeNull();
    expect(screen.getAllByText("待處理").length).toBeGreaterThan(0);
  });
});

describe("儀表板：圖表（次數、不是分鐘）", () => {
  it("設備發生次數、問題分類發生次數都是「n 次」，依次數由多到少", async () => {
    await setup();
    const eq = within(card("設備發生次數"));
    const rows = eq.getAllByRole("button");
    expect(rows[0]).toHaveAccessibleName("查看設備：F3，3 次");
    expect(rows[0]).toHaveTextContent("3 次");
    const cat = within(card("問題分類發生次數"));
    expect(cat.getByRole("button", { name: "查看分類：取料異常，2 次" })).toBeInTheDocument();
    expect(cat.getByRole("button", { name: "查看分類：缺料，2 次" })).toBeInTheDocument();
  });

  it("五張圖表標題；設備與問題分類是不同維度（不重複）", async () => {
    await setup();
    for (const t of ["設備發生次數", "問題分類發生次數", "嚴重度分布", "處理狀態總覽", "每日異常次數趨勢"]) {
      expect(screen.getByRole("heading", { name: t })).toBeInTheDocument();
    }
    expect(within(card("設備發生次數")).queryByText("缺料")).toBeNull();
  });

  it("嚴重度是甜甜圈（SVG circle）；圖例有各嚴重度的次數", async () => {
    await setup();
    const donut = card("嚴重度分布");
    expect(donut.querySelector("svg circle[data-severity='重大']")).not.toBeNull();
    expect(within(donut).getByRole("img", { name: "嚴重度分布，共 5 次" })).toBeInTheDocument();
    expect(within(donut).getByRole("button", { name: /重大\s*1\s*次/ })).toBeInTheDocument();
  });

  it("沒有紀錄時圖表顯示空狀態、整頁提示新增第一筆", async () => {
    await setup([]);
    expect(screen.getByText("還沒有任何紀錄")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新增紀錄" })).toHaveAttribute("href", expect.stringContaining("/records/new"));
    expect(within(card("設備發生次數")).getByText("這個範圍還沒有紀錄")).toBeInTheDocument();
  });
});

describe("儀表板：點進紀錄列表（drillTo：先清掉舊條件，再帶入單一值）", () => {
  it("KPI：待處理／追蹤中", async () => {
    const user = await setup();
    await user.click(screen.getByRole("button", { name: "追蹤中 2 筆，查看紀錄" }));
    expect(loc()).toBe("/records?status=%E8%BF%BD%E8%B9%A4%E4%B8%AD");
    expect(query().get("status")).toBe("追蹤中");
  });

  it("設備長條：用鍵盤（Tab 到按鈕 → Enter）也能觸發", async () => {
    const user = await setup();
    const bar = within(card("設備發生次數")).getByRole("button", { name: /F3/ });
    bar.focus();
    await user.keyboard("{Enter}");
    expect(query().getAll("equipment")).toEqual(["F3"]);
    expect(loc().startsWith("/records?")).toBe(true);
  });

  it("分類長條、嚴重度圖例、狀態圖例、狀態堆疊條、趨勢柱", async () => {
    const user = await setup();
    await user.click(within(card("問題分類發生次數")).getByRole("button", { name: /缺料/ }));
    expect(loc()).toBe("/records?category=%E7%BC%BA%E6%96%99");
  });

  it("嚴重度圖例 → severity", async () => {
    const user = await setup();
    await user.click(within(card("嚴重度分布")).getByRole("button", { name: /重大/ }));
    expect(query().get("severity")).toBe("重大");
    expect([...query().keys()]).toEqual(["severity"]);
  });

  it("嚴重度甜甜圈的色塊（滑鼠）→ severity", async () => {
    const user = await setup();
    await user.click(card("嚴重度分布").querySelector("circle[data-severity='嚴重']") as Element);
    expect(query().get("severity")).toBe("嚴重");
  });

  it("狀態圖例與堆疊條 → status", async () => {
    const user = await setup();
    await user.click(within(card("處理狀態總覽")).getByRole("button", { name: /已解決\s*1\s*筆$/ }));
    expect(query().get("status")).toBe("已解決");
  });

  it("狀態堆疊條的色塊 → status", async () => {
    const user = await setup();
    await user.click(card("處理狀態總覽").querySelector("[data-status='待處理']") as Element);
    expect(query().get("status")).toBe("待處理");
  });

  it("趨勢圖的一天 → from = to（單日）", async () => {
    const user = await setup();
    await user.click(within(card("每日異常次數趨勢")).getByRole("button", { name: "2026-10-23，1 次，查看紀錄" }));
    expect(query().get("from")).toBe("2026-10-23");
    expect(query().get("to")).toBe("2026-10-23");
    expect([...query().keys()].sort()).toEqual(["from", "to"]);
  });

  it("設備名稱帶空白：點長條導到 equipment=F3%20，不 trim", async () => {
    const user = await setup([makeRecord({ id: 1, equipment: "F3 " })]);
    await user.click(within(card("設備發生次數")).getByRole("button", { name: /查看設備/ }));
    expect(loc()).toBe("/records?equipment=F3+");
  });

  it("舊資料設備是空字串：長條顯示「（未填）」，點下去仍精確篩到那些紀錄（equipment= 空值）", async () => {
    const user = await setup([makeRecord({ id: 1, equipment: "" }), makeRecord({ id: 2, equipment: "F3" })]);
    const bar = within(card("設備發生次數")).getByRole("button", { name: "查看設備：（未填），1 次" });
    expect(bar).toHaveTextContent("（未填）");
    await user.click(bar);
    expect(loc()).toBe("/records?equipment=");
  });

  it("舊資料分類是空字串：同樣顯示「（未填）」", async () => {
    await setup([makeRecord({ id: 1, category: "" })]);
    expect(within(card("問題分類發生次數")).getByRole("button", { name: "查看分類：（未填），1 次" })).toBeInTheDocument();
  });

  it("從「本週」範圍點進去：列表只帶那一個條件（不帶 range）", async () => {
    const today = toISODate(new Date());
    const user = await setup([makeRecord({ id: 1, date: today, status: "待處理" }), makeRecord({ id: 2, date: today, status: "追蹤中" })], "/dashboard?range=week");
    await user.click(screen.getByRole("button", { name: "待處理 1 筆，查看紀錄" }));
    expect(loc()).toContain("/records?status=");
    expect(query().has("range")).toBe(false);
  });
});

describe("儀表板：範圍切換（全部／本月／本週）", () => {
  it("切換範圍寫進網址（?range=）、用 aggregate(records, range) 重算；「全部」不寫", async () => {
    const today = toISODate(new Date());
    const user = await setup([
      makeRecord({ id: 1, date: today, duration: 10 }),
      makeRecord({ id: 2, date: "2000-01-01", duration: 30 }),
    ]);
    expect(screen.getByText(/檢視範圍：全部\s+共 2 筆紀錄/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "本週" }));
    expect(loc()).toBe("/dashboard?range=week");
    expect(screen.getByText(/檢視範圍：本週\s+共 1 筆紀錄/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本週" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "本月" }));
    expect(query().get("range")).toBe("month");
    await user.click(screen.getByRole("button", { name: "全部" }));
    expect(loc()).toBe("/dashboard");
    expect(screen.getByText(/共 2 筆紀錄/)).toBeInTheDocument();
  });

  it("從網址帶入範圍（重新整理、分享連結）", async () => {
    await setup(sampleRecords(), "/dashboard?range=month");
    expect(screen.getByRole("button", { name: "本月" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("儀表板：載入中與失敗", () => {
  it("載入中顯示骨架（aria-busy）", async () => {
    vi.spyOn(api, "listRecords").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(api, "getMeta").mockImplementation(() => new Promise(() => {}));
    renderWithApp("/dashboard");
    const status = (await screen.findAllByRole("status")).find((el) => el.getAttribute("aria-busy") === "true")!;
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("載入中");
  });

  it("載入失敗：顯示原因與〔重試〕，重試後恢復", async () => {
    const list = vi.spyOn(api, "listRecords").mockRejectedValueOnce(new Error("伺服器壞了"));
    vi.spyOn(api, "getMeta").mockResolvedValue({ schemaVersion: "1.2", equipment: [], categories: [], productCodes: [], materialCategories: [], equipmentMap: [] });
    const user = userEvent.setup();
    renderWithApp("/dashboard");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("載入紀錄失敗");
    expect(alert).toHaveTextContent("伺服器壞了");
    list.mockResolvedValue(sampleRecords());
    await user.click(within(alert).getByRole("button", { name: "重試" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "設備發生次數" })).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
