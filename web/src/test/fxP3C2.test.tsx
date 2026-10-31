import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/Providers";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TrashPage } from "@/features/trash/TrashPage";
import { mockApi, renderForm } from "@/features/records/form/testUtils";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import { applyTheme } from "@/lib/theme";
import type { DiaryRecord } from "@/lib/types";
import { setViewportWidth } from "@/test/recordsHarness";

/*
 * Cyber 主題 P3 塊 C（後半）：FX-27 帶入閃爍、FX-28 嚴重度建議、FX-31 回收桶溶解。
 * 三項都是「純屬性＋CSS」的展示：表單值／驗證／API 時機不變（既有測試負責），這裡鎖定屬性行為與無障礙。
 */

const root = document.documentElement;

beforeEach(() => {
  setViewportWidth(1280);
});
afterEach(() => {
  applyTheme("standard");
  delete root.dataset.theme;
  vi.restoreAllMocks();
});

describe("FX-27 帶入閃爍（RecordForm）", () => {
  const field = (name: string) => document.querySelector(`[data-field="${name}"]`)!;

  it("沒有帶入時任何欄位都沒有 data-fx-copied", async () => {
    mockApi();
    renderForm();
    await screen.findByRole("form", { name: "新增紀錄" });
    expect(document.querySelectorAll("[data-fx-copied]")).toHaveLength(0);
  });

  it("?copy=：只有真的被填了值的欄位帶屬性（紀錄 1 沒有根本原因）；輸入框值照舊", async () => {
    mockApi();
    renderForm("/records/new?copy=1");
    await screen.findByTestId("copy-banner");
    for (const n of ["problem", "category", "duration", "action"]) expect(field(n)).toHaveAttribute("data-fx-copied", "a");
    expect(field("rootCause")).not.toHaveAttribute("data-fx-copied");
    expect(field("equipment")).not.toHaveAttribute("data-fx-copied"); // 設備被清空，不是「被填入」
    expect((screen.getByLabelText(/^問題$/) as HTMLInputElement).value).toBe("取料位置偏移");
  });

  it("再次帶入：屬性值在 a／b 之間交替（CSS 靠它重播），輸入框是同一個節點（沒有用 key 重新掛載，焦點不丟）", async () => {
    mockApi();
    const { router } = renderForm("/records/new?copy=1");
    await screen.findByTestId("copy-banner");
    const input = screen.getByLabelText(/^問題$/);
    input.focus();
    await act(async () => {
      await router.navigate("/records/new?copy=3");
    });
    await waitFor(() => expect(screen.getByTestId("copy-banner")).toHaveTextContent("半成品沾黏模具"));
    expect(field("problem")).toHaveAttribute("data-fx-copied", "b");
    expect(screen.getByLabelText(/^問題$/)).toBe(input);
  });

  it("〔清除帶入〕後屬性移除", async () => {
    mockApi();
    renderForm("/records/new?copy=1");
    await screen.findByTestId("copy-banner");
    await userEvent.setup().click(screen.getByRole("button", { name: "清除帶入" }));
    expect(document.querySelectorAll("[data-fx-copied]")).toHaveLength(0);
  });
});

describe("FX-28 嚴重度建議", () => {
  const OPTIONS = [
    { value: "a", label: "甲" },
    { value: "b", label: "乙" },
  ] as const;

  it("SegmentedControl：只有建議的選項帶 data-fx-suggested（值＝選項值）；沒給 prop 或 null 時都沒有；按鈕的無障礙名稱與 aria-pressed 不變", () => {
    const { rerender } = render(<SegmentedControl label="測試" value="a" onChange={() => {}} options={OPTIONS} />);
    expect(document.querySelectorAll("[data-fx-suggested]")).toHaveLength(0);
    rerender(<SegmentedControl label="測試" value="a" onChange={() => {}} options={OPTIONS} suggestedValue="b" />);
    const marked = document.querySelectorAll("[data-fx-suggested]");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAttribute("data-fx-suggested", "b");
    expect(screen.getByRole("button", { name: "乙" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "甲" })).toHaveAttribute("aria-pressed", "true");
    rerender(<SegmentedControl label="測試" value="a" onChange={() => {}} options={OPTIONS} suggestedValue={null} />);
    expect(document.querySelectorAll("[data-fx-suggested]")).toHaveLength(0);
  });

  it("RecordForm：依耗時建議的嚴重度帶屬性，耗時改變就換人；耗時不合法時沒有", async () => {
    mockApi();
    const u = userEvent.setup();
    renderForm();
    await screen.findByRole("form", { name: "新增紀錄" });
    const group = screen.getByRole("group", { name: "嚴重度" });
    const marked = () => [...group.querySelectorAll("[data-fx-suggested]")].map((e) => e.getAttribute("data-fx-suggested"));
    expect(marked()).toEqual([]);
    await u.type(screen.getByLabelText(/^耗時/), "5");
    expect(marked()).toEqual(["輕微"]);
    await u.clear(screen.getByLabelText(/^耗時/));
    await u.type(screen.getByLabelText(/^耗時/), "30");
    expect(marked()).toEqual(["重大"]);
    await u.clear(screen.getByLabelText(/^耗時/));
    expect(marked()).toEqual([]);
  });

  it("手動選了別的嚴重度後，建議標記仍跟著耗時（選擇本身與「改用建議」提示的行為不變）", async () => {
    mockApi();
    const u = userEvent.setup();
    renderForm();
    await screen.findByRole("form", { name: "新增紀錄" });
    await u.type(screen.getByLabelText(/^耗時/), "5");
    await u.click(screen.getByRole("button", { name: "重大" }));
    const group = screen.getByRole("group", { name: "嚴重度" });
    expect(within(group).getByRole("button", { name: "重大" })).toHaveAttribute("aria-pressed", "true");
    expect(group.querySelector("[data-fx-suggested]")).toHaveAttribute("data-fx-suggested", "輕微");
    expect(screen.getByText(/依耗時建議為「輕微」/)).toBeInTheDocument();
  });
});

describe("FX-31 回收桶溶解", () => {
  function rec(id: number, over: Partial<DiaryRecord> = {}): DiaryRecord {
    return {
      id,
      date: "2026-10-01",
      shift: "早",
      time: "08:00",
      duration: 10,
      equipment: "F3",
      category: "取料異常",
      problem: `問題 ${id}`,
      severity: "輕微",
      action: "",
      rootCause: null,
      status: "待處理",
      productCode: null,
      materialCategory: null,
      photos: [],
      updatedAt: null,
      deleted: true,
      deletedAt: "2026-10-20T06:30:00.000Z",
      ...over,
    };
  }
  function setup() {
    const store = [rec(1, { time: "08:00" }), rec(2, { time: "09:00" }), rec(3, { time: "10:00" })];
    vi.spyOn(api, "listRecords").mockImplementation(async () => store.map((r) => ({ ...r })));
    const restoreSpy = vi.spyOn(api, "restoreRecord").mockImplementation(async (id) => {
      const r = store.find((x) => x.id === id)!;
      r.deleted = false;
      return { ...r };
    });
    vi.spyOn(api, "purgeRecord").mockImplementation(async (id) => {
      store.splice(
        store.findIndex((x) => x.id === id),
        1,
      );
    });
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("min-width: 768px"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    render(
      <Providers client={createQueryClient()}>
        <MemoryRouter>
          <TrashPage />
        </MemoryRouter>
      </Providers>,
    );
    return { restoreSpy };
  }

  it("標準主題：復原後那一列立刻消失，從頭到尾沒有殘影節點", async () => {
    const { restoreSpy } = setup();
    await screen.findByRole("table");
    await userEvent.setup().click(screen.getByRole("button", { name: /^復原：.*問題 2/ }));
    expect(restoreSpy).toHaveBeenCalledWith(2);
    await waitFor(() => expect(screen.queryByText("問題 2")).toBeNull());
    expect(document.querySelectorAll("[data-fx-ghost]")).toHaveLength(0);
  });

  it("cyber：API 照常呼叫、資料立即更新；被移除的列留成 inert＋aria-hidden 殘影（不可聚焦、不在無障礙樹），≤ 250ms 後消失", async () => {
    root.dataset.theme = "cyber";
    const { restoreSpy } = setup();
    await screen.findByRole("table");
    await userEvent.setup().click(screen.getByRole("button", { name: /^復原：.*問題 2/ }));
    expect(restoreSpy).toHaveBeenCalledWith(2);
    await waitFor(() => expect(document.querySelectorAll("[data-fx-ghost]")).toHaveLength(1));
    const ghost = document.querySelector("[data-fx-ghost]")!;
    expect(ghost).toHaveAttribute("data-fx-ghost", "restore");
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost).toHaveAttribute("inert");
    expect(ghost.tagName).toBe("TR");
    // 殘影在原位置（三列的中間），可存取的列只剩 2 筆（加表頭）；殘影裡的按鈕不在無障礙樹
    expect(ghost.parentElement!.children[1]).toBe(ghost);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 2);
    expect(screen.queryByRole("button", { name: /^復原：.*問題 2/ })).toBeNull();
    await waitFor(() => expect(document.querySelectorAll("[data-fx-ghost]")).toHaveLength(0), { timeout: 600 });
    expect(screen.getAllByRole("row")).toHaveLength(1 + 2);
  });

  it("cyber：永久刪除的殘影 kind 為 purge（溶解方向與復原相反）", async () => {
    root.dataset.theme = "cyber";
    setup();
    await screen.findByRole("table");
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: /^永久刪除：.*問題 3/ }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "永久刪除" }));
    await waitFor(() => expect(document.querySelector('[data-fx-ghost="purge"]')).not.toBeNull());
  });
});
