import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/Providers";
import { api } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import { makeRecord } from "@/test/recordsHarness";
import type { DiaryRecord } from "@/lib/types";
import { ReportPage, resetLastReportRange } from "./ReportPage";

function Probe() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="loc">{loc.pathname + loc.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
      {/* 模擬側欄連結：不帶範圍 */}
      <button type="button" onClick={() => navigate("/report")}>
        to-report
      </button>
      <button type="button" onClick={() => navigate("/dashboard")}>
        to-dashboard
      </button>
    </>
  );
}

function setup(records: DiaryRecord[], entries: string[] = ["/report"]) {
  vi.spyOn(api, "listRecords").mockResolvedValue(records);
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="/report" element={<ReportPage />} />
          <Route path="*" element={<p>其他頁面</p>} />
        </Routes>
        <Probe />
      </MemoryRouter>
    </Providers>,
  );
}

const recs = [
  makeRecord({ id: 1, date: "2026-10-26", time: "08:00", problem: "今天的問題" }),
  makeRecord({ id: 2, date: "2026-10-25", time: "09:00", problem: "昨天的問題" }),
  makeRecord({ id: 3, date: "2026-10-26", time: "10:00", problem: "已刪除", deleted: true, deletedAt: "2026-10-26T11:00:00" }),
];

const startInput = () => screen.getByLabelText("起始日期") as HTMLInputElement;
const endInput = () => screen.getByLabelText("結束日期") as HTMLInputElement;
const generateBtn = () => screen.getByRole("button", { name: "產生報表" });

async function ready() {
  await waitFor(() => expect(generateBtn()).toBeEnabled());
}

beforeEach(() => {
  resetLastReportRange();
  // 只固定 Date（其餘計時器照常），今天 = 2026-10-26（台灣 00:30，UTC 還是 10/25——預設日期不能用 toISOString）
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 26, 0, 30) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ReportPage", () => {
  it("預設起迄日期＝今天的本地日期；還沒產生報表時列印／開新視窗不能按", async () => {
    setup(recs);
    await ready();
    expect(startInput().value).toBe("2026-10-26");
    expect(endInput().value).toBe("2026-10-26");
    expect(screen.getByRole("button", { name: "列印／另存 PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "開新視窗（方便截圖）" })).toBeDisabled();
    expect(document.querySelector("#report-output")).toBeNull();
  });

  it("產生報表：只含範圍內的有效紀錄，之後列印／開新視窗可按", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(recs);
    await ready();
    await user.click(generateBtn());
    const out = document.querySelector("#report-output") as HTMLElement;
    expect(out).not.toBeNull();
    expect(out.textContent).toContain("今天的問題");
    expect(out.textContent).not.toContain("昨天的問題");
    expect(out.textContent).not.toContain("已刪除"); // 軟刪除的不進報表
    expect(out.textContent).toContain("共 1 筆");
    expect(screen.getByRole("button", { name: "列印／另存 PDF" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "開新視窗（方便截圖）" })).toBeEnabled();
  });

  it("起始日期晚於結束日期：顯示錯誤訊息、不產生報表", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(recs);
    await ready();
    await user.clear(endInput());
    await user.type(endInput(), "2026-10-20");
    await user.click(generateBtn());
    expect(await screen.findByText("起始日期不能晚於結束日期")).toBeInTheDocument();
    expect(document.querySelector("#report-output")).toBeNull();
  });

  it("沒有選日期：提示請選擇起訖日期", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(recs);
    await ready();
    await user.clear(startInput());
    await user.click(generateBtn());
    expect(await screen.findByText("請選擇起訖日期")).toBeInTheDocument();
  });

  it("範圍內沒有紀錄：顯示空範圍訊息，列印／開新視窗維持不能按", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    setup(recs);
    await ready();
    await user.clear(startInput());
    await user.type(startInput(), "2026-01-01");
    await user.clear(endInput());
    await user.type(endInput(), "2026-01-02");
    await user.click(generateBtn());
    expect(document.querySelector(".report-empty")?.textContent).toBe("這段日期範圍內沒有紀錄");
    expect(screen.getByRole("button", { name: "列印／另存 PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "開新視窗（方便截圖）" })).toBeDisabled();
  });

  it("列印／另存 PDF 呼叫 window.print()", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    setup(recs);
    await ready();
    await user.click(generateBtn());
    await user.click(screen.getByRole("button", { name: "列印／另存 PDF" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("開新視窗：把報表 HTML 寫進新視窗（帶 base href）；被彈出視窗封鎖（null）要 toast 提示", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const write = vi.fn();
    const close = vi.fn();
    const open = vi
      .spyOn(window, "open")
      .mockReturnValueOnce({ document: { write, close } } as unknown as Window)
      .mockReturnValueOnce(null);
    setup(recs);
    await ready();
    await user.click(generateBtn());

    await user.click(screen.getByRole("button", { name: "開新視窗（方便截圖）" }));
    expect(open).toHaveBeenCalledTimes(1);
    const html = write.mock.calls[0]?.[0] as string;
    expect(html).toContain(`<base href="${window.location.origin}/">`);
    expect(html).toContain('id="report-output"');
    expect(html).toContain("今天的問題");
    expect(close).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "開新視窗（方便截圖）" }));
    expect(await screen.findByText("瀏覽器擋住了新視窗，請允許彈出視窗後再試一次")).toBeInTheDocument();
  });

  describe("範圍放在網址（離開再回來、上一頁都還原得了報表）", () => {
    const loc = () => screen.getByTestId("loc").textContent;

    it("網址有合法範圍：自動產生報表、輸入框跟著網址", async () => {
      setup(recs, ["/report?from=2026-10-25&to=2026-10-26"]);
      await waitFor(() => expect(document.querySelector("#report-output")).not.toBeNull());
      expect(startInput().value).toBe("2026-10-25");
      expect(endInput().value).toBe("2026-10-26");
      const out = document.querySelector("#report-output") as HTMLElement;
      expect(out.textContent).toContain("今天的問題");
      expect(out.textContent).toContain("昨天的問題");
      expect(screen.getByRole("button", { name: "列印／另存 PDF" })).toBeEnabled();
    });

    it("按「產生報表」把範圍寫進網址（push）；上一頁回到沒有報表的狀態", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      setup(recs);
      await ready();
      await user.click(generateBtn());
      expect(loc()).toBe("/report?from=2026-10-26&to=2026-10-26");
      expect(document.querySelector("#report-output")).not.toBeNull();
      await user.click(screen.getByRole("button", { name: "back" }));
      expect(loc()).toBe("/report");
      expect(document.querySelector("#report-output")).toBeNull();
    });

    it("產生兩份不同範圍後上一頁，還原前一份報表", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      setup(recs);
      await ready();
      await user.click(generateBtn()); // 10/26
      await user.clear(startInput());
      await user.type(startInput(), "2026-10-25");
      await user.click(generateBtn()); // 10/25 ～ 10/26
      expect((document.querySelector("#report-output") as HTMLElement).textContent).toContain("昨天的問題");
      await user.click(screen.getByRole("button", { name: "back" }));
      await waitFor(() => expect(startInput().value).toBe("2026-10-26"));
      const out = document.querySelector("#report-output") as HTMLElement;
      expect(out.textContent).toContain("今天的問題");
      expect(out.textContent).not.toContain("昨天的問題");
    });

    it("離開再從側欄（沒帶範圍的連結）回來：用最近一次的範圍還原報表，且不卡住上一頁", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      setup(recs, ["/dashboard"]);
      // 第一次進來：產生一份 10/25～10/26
      await user.click(screen.getByRole("button", { name: "to-report" }));
      await ready();
      await user.clear(startInput());
      await user.type(startInput(), "2026-10-25");
      await user.click(generateBtn());
      expect(loc()).toBe("/report?from=2026-10-25&to=2026-10-26");
      // 離開（側欄連結），再回來（沒帶範圍的連結）
      await user.click(screen.getByRole("button", { name: "to-dashboard" }));
      await waitFor(() => expect(loc()).toBe("/dashboard"));
      await user.click(screen.getByRole("button", { name: "to-report" }));
      await waitFor(() => expect(loc()).toBe("/report?from=2026-10-25&to=2026-10-26"));
      await waitFor(() => expect(document.querySelector("#report-output")).not.toBeNull());
      expect(startInput().value).toBe("2026-10-25");
      // replace：上一頁直接回到儀表板，不是又回到沒有範圍的 /report
      await user.click(screen.getByRole("button", { name: "back" }));
      await waitFor(() => expect(loc()).toBe("/dashboard"));
    });

    it("網址範圍不合法（起 > 迄、格式錯）：不自動產生", async () => {
      setup(recs, ["/report?from=2026-10-26&to=2026-10-20"]);
      await ready();
      expect(document.querySelector("#report-output")).toBeNull();
      expect(startInput().value).toBe("2026-10-26"); // 預設值（網址不合法就不採用）
    });

    it("重新按同一個範圍：重新產生但不新增瀏覽歷史", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      setup(recs, ["/report?from=2026-10-26&to=2026-10-26"]);
      await waitFor(() => expect(document.querySelector("#report-output")).not.toBeNull());
      await user.click(generateBtn());
      expect(loc()).toBe("/report?from=2026-10-26&to=2026-10-26");
      await user.click(screen.getByRole("button", { name: "back" }));
      // 只有一筆歷史（MemoryRouter 的 -1 到頭），網址不變
      expect(loc()).toBe("/report?from=2026-10-26&to=2026-10-26");
    });
  });
});
