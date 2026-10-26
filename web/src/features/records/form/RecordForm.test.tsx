import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { deferred, fileOf, mockApi, renderForm, type Mocks } from "./testUtils";

const NOW = new Date(2026, 9, 26, 14, 5);

let mocks: Mocks;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks = mockApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const user = () => userEvent.setup();
const dateInput = () => screen.getByLabelText(/^日期/) as HTMLInputElement;
const timeInput = () => screen.getByLabelText(/^時間/) as HTMLInputElement;
const shiftSelect = () => screen.getByLabelText(/^班別/) as HTMLSelectElement;
const equipmentInput = () => screen.getByRole("combobox", { name: /^設備/ }) as HTMLInputElement;
const problemInput = () => screen.getByLabelText(/^問題$/) as HTMLInputElement;
const categoryInput = () => screen.getByRole("combobox", { name: /^問題分類/ }) as HTMLInputElement;
const durationInput = () => screen.getByLabelText(/^耗時/) as HTMLInputElement;
const actionInput = () => screen.getByLabelText(/^處理$/) as HTMLTextAreaElement;
const rootCauseInput = () => screen.getByLabelText(/^根本原因/) as HTMLTextAreaElement;
const fileInput = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: /^(新增紀錄|儲存變更|照片上傳中)/ });
const summary = () => screen.getByTestId("date-summary").textContent;

async function waitForNewForm() {
  await screen.findByRole("form", { name: "新增紀錄" });
}

/** 等「過去紀錄」載入完（選擇器與「常見」chips 的資料來源） */
async function waitForHistory() {
  await screen.findAllByRole("button", { name: /×\d/ });
}

/** 把表單填到可以送出的最小狀態 */
async function fillMinimum(u: ReturnType<typeof userEvent.setup>, equipment = "F3") {
  await u.type(equipmentInput(), equipment);
  await u.type(problemInput(), "卡料");
  await u.type(durationInput(), "7");
}

describe("欄位順序與預設值", () => {
  it("設備 → 問題 → 問題分類 → 耗時（含嚴重度）→ 處理 → 根本原因 → 處理狀態 → 照片", async () => {
    const { container } = renderForm();
    await waitForNewForm();
    const severity = screen.getByRole("group", { name: "嚴重度" });
    const status = screen.getByRole("group", { name: "處理狀態" });
    const sequence = [
      equipmentInput(),
      problemInput(),
      categoryInput(),
      durationInput(),
      severity,
      actionInput(),
      rootCauseInput(),
      status,
      fileInput(container),
    ];
    for (let i = 0; i < sequence.length - 1; i++) {
      const follows = sequence[i]!.compareDocumentPosition(sequence[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(follows, `第 ${i} 個欄位應在第 ${i + 1} 個之前`).toBeTruthy();
    }
    // 日期／時間摘要在整個表單最上面
    expect(screen.getByTestId("date-summary").compareDocumentPosition(equipmentInput()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("日期／時間／班別預設現在，收合成一行摘要；點〔修改〕展開、〔收合〕收起", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    expect(summary()).toBe("2026/10/26 14:05・早班");
    expect(dateInput()).not.toBeVisible();
    expect(screen.getByRole("button", { name: "修改" })).toHaveAttribute("aria-expanded", "false");

    await u.click(screen.getByRole("button", { name: "修改" }));
    expect(dateInput()).toBeVisible();
    expect(dateInput().value).toBe("2026-10-26");
    expect(timeInput().value).toBe("14:05");
    expect(shiftSelect().value).toBe("早");

    fireEvent.change(timeInput(), { target: { value: "21:40" } });
    await u.selectOptions(shiftSelect(), "晚");
    expect(summary()).toBe("2026/10/26 21:40・晚班");
    await u.click(screen.getByRole("button", { name: "收合" }));
    expect(dateInput()).not.toBeVisible();
  });

  it("沒有「請確認」標記（沒有帶入時）", async () => {
    renderForm();
    await waitForNewForm();
    expect(screen.queryByText("請確認")).toBeNull();
  });
});

describe("驗證與欄位錯誤", () => {
  it("空白送出：錯誤顯示在欄位旁，不呼叫 API，焦點移到第一個有錯的欄位", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    await u.click(submitButton());
    expect(await screen.findByText("請選擇或輸入設備")).toBeInTheDocument();
    expect(screen.getByText("請描述發生的問題")).toBeInTheDocument();
    expect(screen.getByText("請輸入耗時（分鐘）")).toBeInTheDocument();
    expect(equipmentInput()).toHaveAttribute("aria-invalid", "true");
    expect(equipmentInput()).toHaveAccessibleDescription(/請選擇或輸入設備/);
    await waitFor(() => expect(equipmentInput()).toHaveFocus());
    expect(mocks.createRecord).not.toHaveBeenCalled();
  });

  it("耗時：7 可以送出；7.5 與 0 被擋下並顯示說明", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    await u.type(equipmentInput(), "F3");
    await u.type(problemInput(), "卡料");

    await u.type(durationInput(), "7.5");
    await u.click(submitButton());
    expect(await screen.findByText("耗時請輸入 1 以上的整數（分鐘）")).toBeInTheDocument();
    expect(mocks.createRecord).not.toHaveBeenCalled();

    await u.clear(durationInput());
    await u.type(durationInput(), "0");
    await u.click(submitButton());
    expect(await screen.findByText("耗時請輸入 1 以上的整數（分鐘）")).toBeInTheDocument();
    expect(mocks.createRecord).not.toHaveBeenCalled();

    await u.clear(durationInput());
    await u.type(durationInput(), "7");
    expect(screen.queryByText("耗時請輸入 1 以上的整數（分鐘）")).toBeNull(); // 改動後錯誤就消失
    await u.click(submitButton());
    await waitFor(() => expect(mocks.createRecord).toHaveBeenCalledTimes(1));
    expect(mocks.createRecord.mock.calls[0]![0]).toMatchObject({ duration: 7, equipment: "F3", problem: "卡料" });
  });

  it("日期錯誤時自動展開日期區塊", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    fireEvent.change(dateInput(), { target: { value: "" } });
    await fillMinimum(u);
    await u.click(submitButton());
    expect(await screen.findByText("請選擇日期")).toBeVisible();
    expect(dateInput()).toBeVisible();
  });

  it("伺服器的 errors[] 盡量對到欄位，對不到的顯示在表單下方並跳 toast", async () => {
    const u = user();
    mocks.createRecord.mockRejectedValueOnce(
      new ApiError({ status: 400, kind: "http", errors: ["duration 須為正整數（分鐘）", "照片與日期不一致：a.jpg"] }),
    );
    renderForm();
    await waitForNewForm();
    await fillMinimum(u);
    await u.click(submitButton());
    expect(await screen.findByText("耗時 須為正整數（分鐘）")).toBeInTheDocument();
    expect(within(screen.getByTestId("form-errors")).getByText("照片與日期不一致：a.jpg")).toBeInTheDocument();
    // 錯誤後可以再送一次
    await u.click(submitButton());
    await waitFor(() => expect(mocks.createRecord).toHaveBeenCalledTimes(2));
  });

  it("每次送出一開始就清掉上一次的欄位錯誤與整體錯誤，舊錯誤不會和新錯誤混在一起", async () => {
    const u = user();
    mocks.createRecord
      .mockRejectedValueOnce(new ApiError({ status: 400, kind: "http", errors: ["duration 須為正整數（分鐘）", "第一次的整體錯誤"] }))
      .mockRejectedValueOnce(new ApiError({ status: 400, kind: "http", errors: ["problem 為必填"] }));
    renderForm();
    await waitForNewForm();
    await fillMinimum(u);
    await u.click(submitButton());
    expect(await screen.findByText("耗時 須為正整數（分鐘）")).toBeInTheDocument();
    expect(screen.getByText("第一次的整體錯誤")).toBeInTheDocument();

    await u.click(submitButton());
    expect(await screen.findByText("問題 為必填")).toBeInTheDocument();
    expect(screen.queryByText("耗時 須為正整數（分鐘）")).toBeNull();
    expect(screen.queryByText("第一次的整體錯誤")).toBeNull();
  });
});

describe("嚴重度建議", () => {
  it("依耗時自動建議（≤10 輕微、≤15 一般、≤20 嚴重、>20 重大）", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    const sev = (name: string) => screen.getByRole("button", { name, pressed: true });
    await u.type(durationInput(), "12");
    expect(sev("一般")).toBeInTheDocument();
    await u.clear(durationInput());
    await u.type(durationInput(), "18");
    expect(sev("嚴重")).toBeInTheDocument();
    await u.clear(durationInput());
    await u.type(durationInput(), "25");
    expect(sev("重大")).toBeInTheDocument();
    await u.clear(durationInput());
    await u.type(durationInput(), "5");
    expect(sev("輕微")).toBeInTheDocument();
  });

  it("使用者手動選了嚴重度就不再被耗時覆蓋，並提供〔改用建議〕", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    await u.type(durationInput(), "12");
    await u.click(screen.getByRole("button", { name: "嚴重" }));
    await u.clear(durationInput());
    await u.type(durationInput(), "25");
    expect(screen.getByRole("button", { name: "嚴重", pressed: true }));
    expect(screen.getByText(/依耗時建議為「重大」/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "改用建議" }));
    expect(screen.getByRole("button", { name: "重大", pressed: true }));
  });

  it("送出的嚴重度就是畫面上選的值", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    await fillMinimum(u);
    await u.click(screen.getByRole("button", { name: "重大" }));
    await u.click(submitButton());
    await waitFor(() => expect(mocks.createRecord).toHaveBeenCalled());
    expect(mocks.createRecord.mock.calls[0]![0]).toMatchObject({ severity: "重大", duration: 7 });
  });
});

describe("設備對照：新增畫面的品號／原料類別是唯讀預覽", () => {
  it("選到有對照的設備才顯示預覽（沒有可編輯欄位）；沒有對照的設備不顯示", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    expect(screen.queryByTestId("mapping-preview")).toBeNull();

    await u.type(equipmentInput(), "F3");
    const preview = await screen.findByTestId("mapping-preview");
    expect(preview).toHaveTextContent("品號 P-300");
    expect(preview).toHaveTextContent("原料 膠料A");
    // 很長的品號（沒有空白可斷行）在 320 寬不能撐出畫面：容器 min-w-0／max-w-full、文字 overflow-wrap:anywhere
    expect(preview.querySelector("div")).toHaveClass("min-w-0", "max-w-full");
    expect(within(preview).getByText(/品號 P-300/)).toHaveClass("[overflow-wrap:anywhere]");
    expect(screen.queryByRole("combobox", { name: /品號/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /品號|原料/ })).toBeNull();

    await u.clear(equipmentInput());
    await u.type(equipmentInput(), "F4"); // 對照表有這台，但品號與原料都是空的
    expect(screen.queryByTestId("mapping-preview")).toBeNull();
    await u.clear(equipmentInput());
    await u.type(equipmentInput(), "全新機台");
    expect(screen.queryByTestId("mapping-preview")).toBeNull();
  });

  it("送出時帶上對照表的快照", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    await fillMinimum(u, "F3");
    await u.click(submitButton());
    await waitFor(() => expect(mocks.createRecord).toHaveBeenCalled());
    expect(mocks.createRecord.mock.calls[0]![0]).toMatchObject({ productCode: "P-300", materialCategory: "膠料A" });
  });

  it("設備沒有對照 → 快照是 null", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    await fillMinimum(u, "全新機台");
    await u.click(submitButton());
    await waitFor(() => expect(mocks.createRecord).toHaveBeenCalled());
    expect(mocks.createRecord.mock.calls[0]![0]).toMatchObject({ productCode: null, materialCategory: null });
  });
});

describe("設備／分類 Combobox", () => {
  it("建議 = 預設 ∪ 資料；可直接輸入新值並送出", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    await u.click(equipmentInput());
    const options = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["F3", "F7", "原材區1", "示範機台A"]));
    await u.keyboard("{Escape}");

    await u.type(equipmentInput(), "CCD機台");
    await u.type(categoryInput(), "CCD異常");
    expect(screen.getAllByText(/新增「CCD/).length).toBeGreaterThan(0);
    await u.type(problemInput(), "取像失敗");
    await u.type(durationInput(), "3");
    await u.click(submitButton());
    await waitFor(() => expect(mocks.createRecord).toHaveBeenCalled());
    expect(mocks.createRecord.mock.calls[0]![0]).toMatchObject({ equipment: "CCD機台", category: "CCD異常" });
  });

  it("方向鍵 + Enter 選取建議；沒有高亮時 Enter 不會被吃掉", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    await u.type(equipmentInput(), "F");
    await u.keyboard("{ArrowDown}{Enter}");
    expect(equipmentInput().value).toMatch(/^F/);
    expect(equipmentInput().value.length).toBeGreaterThan(0);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("清除", () => {
  it("清除之後日期／時間回到「現在」（舊版是空白），欄位清空，日期區塊收合", async () => {
    const u = user();
    renderForm();
    await waitForNewForm();
    await u.click(screen.getByRole("button", { name: "修改" }));
    fireEvent.change(dateInput(), { target: { value: "2025-01-02" } });
    fireEvent.change(timeInput(), { target: { value: "" } });
    await fillMinimum(u);
    expect(summary()).toBe("2025/01/02 --:--・早班");

    vi.setSystemTime(new Date(2026, 9, 26, 15, 30));
    await u.click(screen.getByRole("button", { name: "清除" }));
    expect(summary()).toBe("2026/10/26 15:30・早班");
    expect(dateInput().value).toBe("2026-10-26");
    expect(timeInput().value).toBe("15:30");
    expect(equipmentInput().value).toBe("");
    expect(problemInput().value).toBe("");
    expect(durationInput().value).toBe("");
    expect(dateInput()).not.toBeVisible();
  });
});

describe("成功送出", () => {
  it("新增成功：失效查詢、導向儀表板、不再問「離開？」", async () => {
    const u = user();
    const { client, router } = renderForm();
    await waitForNewForm();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await fillMinimum(u);
    await u.type(actionInput(), "清潔後重啟");
    await u.click(submitButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["records"]', '["aggregate"]', '["meta"]']));
    expect(mocks.createRecord.mock.calls[0]![0]).toMatchObject({
      date: "2026-10-26",
      time: "14:05",
      shift: "早",
      action: "清潔後重啟",
      rootCause: null,
      status: "待處理",
      category: "其他",
      photos: [],
    });
  });

  it("送出中不能重複送出", async () => {
    const u = user();
    const d = deferred<never>();
    mocks.createRecord.mockReturnValue(d.promise);
    renderForm();
    await waitForNewForm();
    await fillMinimum(u);
    await u.click(submitButton());
    await waitFor(() => expect(screen.getByRole("button", { name: /送出中/ })).toBeDisabled());
    fireEvent.submit(screen.getByRole("form", { name: "新增紀錄" }));
    expect(mocks.createRecord).toHaveBeenCalledTimes(1);
  });
});

describe("複製既有紀錄", () => {
  it("?copy=<id>：只帶入白名單欄位；狀態重設為待處理；設備清空；不複製照片；日期時間回到現在並標「請確認」", async () => {
    renderForm("/records/new?copy=3"); // 紀錄 3 有照片 a.jpg、狀態已解決、品號 P-OLD
    const banner = await screen.findByTestId("copy-banner");
    expect(banner).toHaveTextContent("已帶入自");
    expect(banner).toHaveTextContent("10/20 F3・半成品沾黏模具");
    expect(banner).toHaveTextContent("處理與根本原因是沿用舊紀錄的內容，請確認是否適用這次事件");
    expect(screen.getByRole("button", { name: "清除帶入" })).toBeInTheDocument();

    expect(problemInput().value).toBe("半成品沾黏模具");
    expect(categoryInput().value).toBe("沾模");
    expect(durationInput().value).toBe("12");
    expect(screen.getByRole("button", { name: "一般", pressed: true }));
    expect(actionInput().value).toBe("清潔模具後重啟");
    expect(rootCauseInput().value).toBe("脫模劑濃度不足"); // 根本原因會複製
    expect(screen.getByRole("button", { name: "待處理", pressed: true })); // 來源是已解決
    expect(equipmentInput().value).toBe("");
    expect(screen.queryByTestId("mapping-preview")).toBeNull();
    // 不複製照片
    expect(screen.queryByRole("list", { name: "已加入的照片" })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();

    // 日期區塊展開、回到現在，並標「請確認」：日期、班別、時間、耗時、設備
    expect(dateInput()).toBeVisible();
    expect(summary()).toBe("2026/10/26 14:05・早班");
    expect(screen.getAllByText("請確認")).toHaveLength(5);
    expect(screen.getByTestId("review-pending")).toHaveTextContent("還有 5 個欄位待確認（不會擋住送出）");
  });

  it("動過的欄位就不再標「請確認」；剩下的標記不擋送出；品號／原料依新設備重新帶入", async () => {
    const u = user();
    renderForm("/records/new?copy=3");
    await screen.findByTestId("copy-banner");
    await u.type(equipmentInput(), "F3");
    expect(screen.getAllByText("請確認")).toHaveLength(4);
    fireEvent.change(timeInput(), { target: { value: "16:00" } });
    expect(screen.getAllByText("請確認")).toHaveLength(3);
    expect(screen.getByTestId("mapping-preview")).toHaveTextContent("品號 P-300"); // 不是來源紀錄的 P-OLD

    await u.click(submitButton()); // 還有 3 個「請確認」，照樣送出
    await waitFor(() => expect(mocks.createRecord).toHaveBeenCalled());
    expect(mocks.createRecord.mock.calls[0]![0]).toMatchObject({
      equipment: "F3",
      problem: "半成品沾黏模具",
      rootCause: "脫模劑濃度不足",
      status: "待處理",
      productCode: "P-300",
      materialCategory: "膠料A",
      time: "16:00",
      photos: [],
      photoCaptions: {},
    });
  });

  it("〔清除帶入〕清掉帶入的內容與標記，保留已選的設備", async () => {
    const u = user();
    renderForm("/records/new?copy=3");
    await screen.findByTestId("copy-banner");
    await u.type(equipmentInput(), "F4");
    await u.click(screen.getByRole("button", { name: "清除帶入" }));
    expect(screen.queryByTestId("copy-banner")).toBeNull();
    expect(screen.queryByText("請確認")).toBeNull();
    expect(problemInput().value).toBe("");
    expect(rootCauseInput().value).toBe("");
    expect(durationInput().value).toBe("");
    expect(equipmentInput().value).toBe("F4");
  });

  it("同一個畫面上 ?copy= 換成另一筆時重新帶入", async () => {
    const { router } = renderForm("/records/new?copy=1");
    expect(await screen.findByTestId("copy-banner")).toHaveTextContent("10/18 F4・取料位置偏移");
    await act(async () => {
      await router.navigate("/records/new?copy=3");
    });
    await waitFor(() => expect(screen.getByTestId("copy-banner")).toHaveTextContent("10/20 F3・半成品沾黏模具"));
    expect(problemInput().value).toBe("半成品沾黏模具");
  });

  it("找不到（或已刪除）的 copy id：照常顯示空白表單", async () => {
    renderForm("/records/new?copy=4"); // 4 已軟刪除
    await waitForNewForm();
    expect(screen.queryByTestId("copy-banner")).toBeNull();
    expect(problemInput().value).toBe("");
  });

  describe("頂端「從過去紀錄帶入」選擇器", () => {
    it("最近紀錄：新到舊、不含已刪除；Enter 帶入第一筆", async () => {
      const u = user();
      renderForm();
      await waitForNewForm();
      await waitForHistory();
      await u.click(screen.getByRole("combobox", { name: "搜尋過去紀錄" }));
      const opts = screen.getAllByRole("option");
      expect(opts).toHaveLength(3);
      expect(opts[0]).toHaveTextContent("半成品沾黏模具");
      expect(opts[0]).toHaveTextContent("10/20 10:30・F3・沾模");
      expect(screen.queryByText("已刪除的那筆")).toBeNull();
      await u.keyboard("{ArrowDown}{ArrowUp}{Enter}");
      expect(await screen.findByTestId("copy-banner")).toHaveTextContent("10/20 F3");
      expect(problemInput().value).toBe("半成品沾黏模具");
      expect(screen.queryByRole("listbox", { name: "最近紀錄" })).toBeNull(); // 選完收起（焦點移到設備欄，設備自己的建議清單會開）
      expect(equipmentInput()).toHaveFocus();
    });

    it("方向鍵移動、Enter 帶入第二筆", async () => {
      const u = user();
      renderForm();
      await waitForNewForm();
      await waitForHistory();
      await u.click(screen.getByRole("combobox", { name: "搜尋過去紀錄" }));
      await u.keyboard("{ArrowDown}{Enter}");
      expect(await screen.findByTestId("copy-banner")).toHaveTextContent("10/19 F3");
    });

    it("常見問題分頁依「分類＋問題」歸併、顯示累計次數；搜尋涵蓋根本原因", async () => {
      const u = user();
      renderForm();
      await waitForNewForm();
      await waitForHistory();
      const box = screen.getByRole("combobox", { name: "搜尋過去紀錄" });
      await u.click(box);
      await u.click(screen.getByRole("tab", { name: "常見問題" }));
      const opts = screen.getAllByRole("option");
      expect(opts[0]).toHaveTextContent("半成品沾黏模具");
      expect(opts[0]).toHaveTextContent("累計 2 次");
      expect(opts[1]).toHaveTextContent("累計 1 次");

      await u.click(screen.getByRole("tab", { name: "最近紀錄" }));
      await u.type(box, "脫模劑"); // 只出現在根本原因
      expect(screen.getAllByRole("option")).toHaveLength(2);
      await u.clear(box);
      await u.type(box, "查無此事");
      expect(screen.getByText("找不到符合的紀錄，直接在下方手動填寫即可")).toBeInTheDocument();
    });

    it("「常見」chips 只出現在頂端（整個畫面只有一處），點下去帶入最近一筆當範本", async () => {
      const u = user();
      renderForm();
      await waitForNewForm();
      await waitForHistory();
      const chips = screen.getAllByRole("button", { name: /×\d/ });
      expect(chips).toHaveLength(2);
      expect(chips[0]).toHaveTextContent("半成品沾黏模具×2");
      // 問題欄下方不再有第二列建議
      expect(screen.getAllByText("常見：")).toHaveLength(1);
      await u.click(chips[0]!);
      expect(await screen.findByTestId("copy-banner")).toHaveTextContent("10/20 F3");
    });

    it("Tab 離開輸入框與分頁鈕、到下方「常見」chips 時下拉收起；清單本身不是 Tab 停靠點", async () => {
      const u = user();
      renderForm();
      await waitForNewForm();
      await waitForHistory();
      await u.click(screen.getByRole("combobox", { name: "搜尋過去紀錄" }));
      const listbox = screen.getByRole("listbox", { name: "最近紀錄" });
      expect(listbox).toHaveAttribute("tabindex", "-1");
      await u.tab(); // 最近紀錄 分頁鈕
      expect(screen.getByRole("tab", { name: "最近紀錄" })).toHaveFocus();
      expect(screen.queryByRole("listbox")).not.toBeNull(); // 還在選擇器內，不收
      await u.tab(); // 常見問題 分頁鈕
      expect(screen.getByRole("tab", { name: "常見問題" })).toHaveFocus();
      await u.tab(); // 下方的 chip：已離開選擇器
      expect(document.activeElement).not.toBe(listbox);
      expect(document.activeElement).toHaveTextContent("×");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("已上傳照片時套用複製：日期／時間／班別不變（照片依當時日期存放）", async () => {
      const u = user();
      const { container } = renderForm();
      await waitForNewForm();
      await waitForHistory();
      await u.click(screen.getByRole("button", { name: "修改" }));
      fireEvent.change(dateInput(), { target: { value: "2026-10-20" } });
      fireEvent.change(timeInput(), { target: { value: "08:15" } });
      await u.selectOptions(shiftSelect(), "中");
      await u.upload(fileInput(container), fileOf("a.jpg"));
      await waitFor(() => expect(dateInput()).toBeDisabled());
      expect(mocks.uploadPhoto).toHaveBeenCalledWith("2026-10-20", expect.any(File));

      await u.click(screen.getByRole("combobox", { name: "搜尋過去紀錄" }));
      await u.click(screen.getAllByRole("option")[1]!);
      expect(await screen.findByTestId("copy-banner")).toBeInTheDocument();
      expect(problemInput().value).toBe("半成品沾黏模具");
      expect(dateInput().value).toBe("2026-10-20");
      expect(timeInput().value).toBe("08:15");
      expect(shiftSelect().value).toBe("中");
      expect(summary()).toBe("2026/10/20 08:15・中班");
      // 已上傳的照片還在、也沒有多出複製來的照片
      expect(screen.getAllByRole("listitem").filter((li) => li.querySelector("img"))).toHaveLength(1);
      // 日期鎖住，所以不標它「請確認」；其他四個仍標
      expect(screen.getAllByText("請確認")).toHaveLength(4);
    });
  });
});

describe("照片：選檔立刻上傳、鎖日期、放棄清理", () => {
  async function selectSlowFiles(u: ReturnType<typeof userEvent.setup>, container: HTMLElement, names: string[]) {
    const calls: Array<{ name: string; date: string; argCount: number; d: ReturnType<typeof deferred<string>> }> = [];
    mocks.uploadPhoto.mockImplementation((...args: unknown[]) => {
      const [date, file] = args as [string, File];
      const d = deferred<string>();
      calls.push({ name: file.name, date, argCount: args.length, d });
      return d.promise;
    });
    await u.upload(fileInput(container), names.map((n) => fileOf(n)));
    return calls;
  }

  it("選檔後立刻上傳（date 在 photo 前由 API 層保證）；縮圖顯示上傳中；完成後日期鎖住並顯示提示", async () => {
    const u = user();
    const { container } = renderForm();
    await waitForNewForm();
    const calls = await selectSlowFiles(u, container, ["a.jpg"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.date).toBe("2026-10-26");
    expect(screen.getByText("上傳中…")).toBeInTheDocument();
    expect(dateInput()).toBeDisabled();
    expect(screen.getByTestId("date-lock-hint")).toHaveTextContent("已上傳照片，要改日期請先移除照片");

    await act(async () => calls[0]!.d.resolve("a.jpg"));
    expect(screen.queryByText("上傳中…")).toBeNull();
    expect(dateInput()).toBeDisabled(); // 已上傳未送出，仍鎖
    expect(screen.getByTestId("date-lock-hint")).toBeInTheDocument();
  });

  it("移除已上傳的照片：DELETE，日期解鎖", async () => {
    const u = user();
    const { container } = renderForm();
    await waitForNewForm();
    await u.upload(fileInput(container), fileOf("a.jpg"));
    await waitFor(() => expect(dateInput()).toBeDisabled());
    await u.click(screen.getByRole("button", { name: /移除新照片 a\.jpg/ }));
    expect(mocks.deletePhoto).toHaveBeenCalledWith("2026-10-26", "a.jpg");
    expect(dateInput()).not.toBeDisabled();
    expect(screen.queryByTestId("date-lock-hint")).toBeNull();
  });

  it("上傳失敗的照片不鎖日期；可以移除", async () => {
    const u = user();
    mocks.uploadPhoto.mockRejectedValue(new ApiError({ status: 500, kind: "http", errors: ["磁碟已滿"] }));
    const { container } = renderForm();
    await waitForNewForm();
    await u.upload(fileInput(container), fileOf("a.jpg"));
    expect(await screen.findByText(/上傳失敗：磁碟已滿/)).toBeInTheDocument();
    expect(dateInput()).not.toBeDisabled();
    expect(mocks.deletePhoto).not.toHaveBeenCalled();
  });

  it("上傳中不能送出：按鈕停用、顯示「照片上傳中…」，上傳完成後恢復", async () => {
    const u = user();
    const { container } = renderForm();
    await waitForNewForm();
    await fillMinimum(u);
    const calls = await selectSlowFiles(u, container, ["a.jpg"]);
    const btn = screen.getByRole("button", { name: "照片上傳中…" });
    expect(btn).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "新增紀錄" }));
    expect(mocks.createRecord).not.toHaveBeenCalled();

    await act(async () => calls[0]!.d.resolve("a.jpg"));
    expect(screen.getByRole("button", { name: "新增紀錄" })).toBeEnabled();
  });

  it("送出：已上傳的檔名與說明一起送出；成功後離開頁面不會把檔案刪掉", async () => {
    const u = user();
    const { container, router } = renderForm();
    await waitForNewForm();
    await fillMinimum(u);
    await u.upload(fileInput(container), [fileOf("a.jpg"), fileOf("b.jpg")]);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    await u.type(screen.getByRole("textbox", { name: "新照片 1 的圖片說明" }), "模具上的沾黏");
    await u.click(submitButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(mocks.createRecord.mock.calls[0]![0]).toMatchObject({
      photos: ["a.jpg", "b.jpg"],
      photoCaptions: { "a.jpg": "模具上的沾黏" },
    });
    expect(mocks.deletePhoto).not.toHaveBeenCalled();
  });

  it("圖片說明最多 100 字", async () => {
    const u = user();
    const { container } = renderForm();
    await waitForNewForm();
    await u.upload(fileInput(container), fileOf("a.jpg"));
    const cap = await screen.findByRole("textbox", { name: "新照片 1 的圖片說明" });
    expect(cap).toHaveAttribute("maxlength", "100");
  });

  it("一次選 3 張、第 1 張還在上傳時按「清除」：只發出 1 次請求、不中止、沒有殘留縮圖、日期立刻解鎖", async () => {
    const u = user();
    const { container } = renderForm();
    await waitForNewForm();
    const calls = await selectSlowFiles(u, container, ["a.jpg", "b.jpg", "c.jpg"]);
    expect(dateInput()).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "清除" }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.argCount).toBe(2); // 不帶 AbortSignal
    expect(screen.queryByRole("list", { name: "已加入的照片" })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(dateInput()).not.toBeDisabled();
    expect(screen.queryByTestId("date-lock-hint")).toBeNull();
    await act(async () => {});
    expect(calls).toHaveLength(1);
  });

  it("「清除」時伺服器已存好、回應在清除之後才到：用回傳的檔名補刪那個檔案，畫面上不再出現", async () => {
    const u = user();
    const { container } = renderForm();
    await waitForNewForm();
    const calls = await selectSlowFiles(u, container, ["a.jpg", "b.jpg", "c.jpg"]);
    await u.click(screen.getByRole("button", { name: "清除" }));
    await act(async () => calls[0]!.d.resolve("a-1.jpg"));
    expect(mocks.deletePhoto).toHaveBeenCalledWith("2026-10-26", "a-1.jpg");
    expect(calls).toHaveLength(1);
    expect(screen.queryByRole("img")).toBeNull();
    expect(dateInput()).not.toBeDisabled();
  });

  it("「清除」會刪除已上傳未送出的照片", async () => {
    const u = user();
    const { container } = renderForm();
    await waitForNewForm();
    await u.upload(fileInput(container), [fileOf("a.jpg"), fileOf("b.jpg")]);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    await u.click(screen.getByRole("button", { name: "清除" }));
    expect(mocks.deletePhoto.mock.calls).toEqual([
      ["2026-10-26", "a.jpg"],
      ["2026-10-26", "b.jpg"],
    ]);
  });

  it("移除「上傳中」的縮圖：立刻消失、不中止、剩下的不再上傳、回應到了補刪", async () => {
    const u = user();
    const { container } = renderForm();
    await waitForNewForm();
    const calls = await selectSlowFiles(u, container, ["a.jpg", "b.jpg"]);
    await u.click(screen.getByRole("button", { name: /移除新照片 a\.jpg/ }));
    expect(calls[0]!.argCount).toBe(2);
    expect(screen.queryByRole("list", { name: "已加入的照片" })).toBeNull();
    expect(dateInput()).not.toBeDisabled();
    await act(async () => calls[0]!.d.resolve("a.jpg"));
    expect(mocks.deletePhoto).toHaveBeenCalledWith("2026-10-26", "a.jpg");
    expect(calls).toHaveLength(1);
  });

  describe("離開頁面", () => {
    it("有未送出的內容：先問；選「離開」才離開，並清掉已上傳的照片、上傳中的回應到了補刪", async () => {
      const u = user();
      const { container, router } = renderForm();
      await waitForNewForm();
      await u.type(problemInput(), "卡料");
      const calls = await selectSlowFiles(u, container, ["a.jpg", "b.jpg"]);
      await act(async () => calls[0]!.d.resolve("a.jpg")); // a 已上傳，b 上傳中

      await act(async () => {
        void router.navigate("/dashboard");
      });
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent("離開這個頁面？");
      expect(router.state.location.pathname).toBe("/records/new"); // 還沒離開
      expect(mocks.deletePhoto).not.toHaveBeenCalled();

      await u.click(within(dialog).getByRole("button", { name: "離開" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
      await waitFor(() => expect(mocks.deletePhoto).toHaveBeenCalledWith("2026-10-26", "a.jpg"));
      expect(calls[1]!.argCount).toBe(2);
      // b 的回應晚到也補刪
      await act(async () => calls[1]!.d.resolve("b.jpg"));
      expect(mocks.deletePhoto).toHaveBeenCalledWith("2026-10-26", "b.jpg");
    });

    it("選「繼續填寫」留在表單，內容與照片都還在", async () => {
      const u = user();
      const { container, router } = renderForm();
      await waitForNewForm();
      await u.type(problemInput(), "卡料");
      await u.upload(fileInput(container), fileOf("a.jpg"));
      await waitFor(() => expect(dateInput()).toBeDisabled());
      await act(async () => {
        void router.navigate("/dashboard");
      });
      await u.click(await screen.findByRole("button", { name: "繼續填寫" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(router.state.location.pathname).toBe("/records/new");
      expect(problemInput().value).toBe("卡料");
      expect(mocks.deletePhoto).not.toHaveBeenCalled();
    });

    it("選「繼續填寫」後，焦點回到原本在填的欄位（不是留在觸發離開的連結上）", async () => {
      const u = user();
      const { router } = renderForm();
      await waitForNewForm();
      await u.type(problemInput(), "卡料");
      (document.activeElement as HTMLElement).blur(); // 模擬點了側欄連結：焦點已不在表單裡
      await act(async () => {
        void router.navigate("/dashboard");
      });
      await u.click(await screen.findByRole("button", { name: "繼續填寫" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      await waitFor(() => expect(problemInput()).toHaveFocus());
    });

    it("什麼都沒動就離開：不問", async () => {
      const { router } = renderForm();
      await waitForNewForm();
      await act(async () => {
        await router.navigate("/dashboard");
      });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(router.state.location.pathname).toBe("/dashboard");
    });

    it("只選了照片沒填別的，離開也要問（照片已經上傳了）", async () => {
      const u = user();
      const { container, router } = renderForm();
      await waitForNewForm();
      await u.upload(fileInput(container), fileOf("a.jpg"));
      await waitFor(() => expect(dateInput()).toBeDisabled());
      await act(async () => {
        void router.navigate("/dashboard");
      });
      expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    });
  });
});

describe("編輯模式", () => {
  it("找不到（或已軟刪除）的紀錄：顯示說明與回列表的連結", async () => {
    renderForm("/records/999/edit");
    expect(await screen.findByText("找不到這筆紀錄")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回紀錄列表" })).toBeInTheDocument();
  });
  it("已刪除的紀錄不能編輯", async () => {
    renderForm("/records/4/edit");
    expect(await screen.findByText("找不到這筆紀錄")).toBeInTheDocument();
  });

  it("帶出原本的值：含根本原因與處理狀態；品號／原料類別是可編輯的輸入框；沒有唯讀預覽；沒有「從過去紀錄帶入」", async () => {
    renderForm("/records/3/edit");
    await screen.findByRole("form", { name: "編輯紀錄" });
    expect(equipmentInput().value).toBe("F3");
    expect(problemInput().value).toBe("半成品沾黏模具");
    expect(rootCauseInput().value).toBe("脫模劑濃度不足");
    expect(screen.getByRole("button", { name: "已解決", pressed: true }));
    expect(screen.getByRole("button", { name: "一般", pressed: true }));
    expect(durationInput().value).toBe("12");
    expect(summary()).toBe("2026/10/20 10:30・中班");
    expect(screen.getByRole("combobox", { name: /^品號/ })).toHaveValue("P-OLD");
    expect(screen.getByRole("combobox", { name: /^原料類別/ })).toHaveValue("舊原料");
    expect(screen.queryByTestId("mapping-preview")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "搜尋過去紀錄" })).toBeNull();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "儲存變更" })).toBeInTheDocument();
  });

  it("編輯時改耗時不會動嚴重度（那是當初存下的值）", async () => {
    const u = user();
    renderForm("/records/3/edit");
    await screen.findByRole("form", { name: "編輯紀錄" });
    await u.clear(durationInput());
    await u.type(durationInput(), "40");
    expect(screen.getByRole("button", { name: "一般", pressed: true }));
  });

  it("清空根本原因存成 null；改處理狀態；儲存後回到 #/records?open=<id>", async () => {
    const u = user();
    const { router } = renderForm("/records/3/edit");
    await screen.findByRole("form", { name: "編輯紀錄" });
    await u.clear(rootCauseInput());
    await u.click(screen.getByRole("button", { name: "追蹤中" }));
    await u.click(submitButton());
    await waitFor(() => expect(mocks.updateRecord).toHaveBeenCalledTimes(1));
    const [id, input] = mocks.updateRecord.mock.calls[0]!;
    expect(id).toBe(3);
    expect(input).toMatchObject({ rootCause: null, status: "追蹤中", photos: ["a.jpg"], photoCaptions: { "a.jpg": "模具上的沾黏" } });
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe("/records?open=3"));
    // replace：儲存後按上一頁不會回到編輯表單
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("品號／原料類別可以修改，清空存 null", async () => {
    const u = user();
    renderForm("/records/3/edit");
    await screen.findByRole("form", { name: "編輯紀錄" });
    await u.clear(screen.getByRole("combobox", { name: /^品號/ }));
    await u.clear(screen.getByRole("combobox", { name: /^原料類別/ }));
    await u.type(screen.getByRole("combobox", { name: /^原料類別/ }), "新料");
    await u.click(submitButton());
    await waitFor(() => expect(mocks.updateRecord).toHaveBeenCalled());
    expect(mocks.updateRecord.mock.calls[0]![1]).toMatchObject({ productCode: null, materialCategory: "新料" });
  });

  it("編輯也只接受正整數耗時", async () => {
    const u = user();
    renderForm("/records/3/edit");
    await screen.findByRole("form", { name: "編輯紀錄" });
    await u.clear(durationInput());
    await u.type(durationInput(), "0");
    await u.click(submitButton());
    expect(await screen.findByText("耗時請輸入 1 以上的整數（分鐘）")).toBeInTheDocument();
    await u.clear(durationInput());
    await u.type(durationInput(), "7.5");
    await u.click(submitButton());
    expect(await screen.findByText("耗時請輸入 1 以上的整數（分鐘）")).toBeInTheDocument();
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });

  it("既有照片的縮圖一律用紀錄原本的日期，改日期欄也不變", async () => {
    const u = user();
    renderForm("/records/3/edit");
    await screen.findByRole("form", { name: "編輯紀錄" });
    const img = screen.getByRole("img", { name: "既有照片 1" });
    expect(img).toHaveAttribute("src", "/photos/20261020/a.jpg");
    await u.click(screen.getByRole("button", { name: "修改" }));
    fireEvent.change(dateInput(), { target: { value: "2026-10-25" } });
    expect(screen.getByRole("img", { name: "既有照片 1" })).toHaveAttribute("src", "/photos/20261020/a.jpg");
  });

  it("新加的照片傳到「目前」的日期（鎖住），既有照片不影響鎖定", async () => {
    const u = user();
    const { container } = renderForm("/records/3/edit");
    await screen.findByRole("form", { name: "編輯紀錄" });
    expect(dateInput()).not.toBeDisabled(); // 只有既有照片時不鎖
    await u.click(screen.getByRole("button", { name: "修改" }));
    fireEvent.change(dateInput(), { target: { value: "2026-10-25" } });
    await u.upload(fileInput(container), fileOf("n.jpg"));
    await waitFor(() => expect(mocks.uploadPhoto).toHaveBeenCalledWith("2026-10-25", expect.any(File)));
    await waitFor(() => expect(dateInput()).toBeDisabled());
    await u.click(submitButton());
    await waitFor(() => expect(mocks.updateRecord).toHaveBeenCalled());
    expect(mocks.updateRecord.mock.calls[0]![1]).toMatchObject({ date: "2026-10-25", photos: ["a.jpg", "n.jpg"] });
  });

  it("移除既有照片只是放掉參照（不呼叫 DELETE，由伺服器存檔時處理）", async () => {
    const u = user();
    renderForm("/records/3/edit");
    await screen.findByRole("form", { name: "編輯紀錄" });
    await u.click(screen.getByRole("button", { name: /移除既有照片 a\.jpg/ }));
    expect(mocks.deletePhoto).not.toHaveBeenCalled();
    await u.click(submitButton());
    await waitFor(() => expect(mocks.updateRecord).toHaveBeenCalled());
    expect(mocks.updateRecord.mock.calls[0]![1]).toMatchObject({ photos: [], photoCaptions: {} });
  });

  it("取消：沒改動直接回詳情；有改動先問，放棄時刪掉新上傳的照片", async () => {
    const u = user();
    const { container, router } = renderForm("/records/3/edit");
    await screen.findByRole("form", { name: "編輯紀錄" });
    await u.upload(fileInput(container), fileOf("n.jpg"));
    await waitFor(() => expect(dateInput()).toBeDisabled());
    await u.click(screen.getByRole("button", { name: "取消" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("本次新上傳但未儲存的照片也會一併刪除");
    await u.click(within(dialog).getByRole("button", { name: "離開" }));
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe("/records?open=3"));
    await waitFor(() => expect(mocks.deletePhoto).toHaveBeenCalledWith("2026-10-20", "n.jpg"));
    expect(mocks.updateRecord).not.toHaveBeenCalled();
  });

  it("取消（沒有任何改動）：不問，直接回詳情", async () => {
    const u = user();
    const { router } = renderForm("/records/3/edit");
    await screen.findByRole("form", { name: "編輯紀錄" });
    await u.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(router.state.location.search).toBe("?open=3"));
    expect(router.state.historyAction).toBe("REPLACE"); // 取消後上一頁也不要回到編輯表單
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
