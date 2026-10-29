import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/Providers";
import { ErrorState } from "@/components/ErrorState";
import { Lightbox } from "@/components/Lightbox";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { api } from "@/lib/api";
import { notify } from "@/lib/feedback";
import { createQueryClient } from "@/lib/queryClient";
import { makeMeta, mockApi, renderWithApp, sampleRecords, setViewportWidth } from "@/test/recordsHarness";

/*
 * Cyber 主題 P2：新增的 data-fx 掛勾（docs/cyber-theme-spec.md §3.3 之後補列）。
 * 都是純屬性：這裡只驗證「掛勾在哪裡」，標準主題的行為由既有測試負責。
 */

const fx = (name: string, root: ParentNode = document) => Array.from(root.querySelectorAll(`[data-fx="${name}"]`));

beforeEach(() => setViewportWidth(1280));
afterEach(() => {
  notify.dismiss();
  vi.restoreAllMocks();
});

describe("P2 掛勾：chip（篩選 chip）", () => {
  it("網址帶篩選條件時，每個 chip（<button>）都是 data-fx=chip，可存取名稱不變", async () => {
    mockApi(sampleRecords());
    renderWithApp("/records?equipment=F3&category=%E7%BC%BA%E6%96%99");
    await screen.findByTestId("result-count");
    const bar = screen.getByTestId("active-filters");
    const chips = fx("chip", bar);
    expect(chips).toHaveLength(2);
    for (const c of chips) expect(c.tagName).toBe("BUTTON");
    expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual(["移除 設備：F3", "移除 分類：缺料"]);
  });
});

describe("P2 掛勾：bar-track（長條軌道）", () => {
  it("橫條圖每一列的軌道（aria-hidden）是 bar-track，裡面放 bar", async () => {
    mockApi(sampleRecords());
    renderWithApp("/dashboard");
    const card = await screen.findByRole("region", { name: "設備發生次數" });
    const tracks = fx("bar-track", card);
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks).toHaveLength(fx("bar-row", card).length);
    for (const t of tracks) {
      expect(t).toHaveAttribute("aria-hidden", "true");
      expect(fx("bar", t)).toHaveLength(1);
    }
  });
});

describe("P2 掛勾：detail-body（詳情面板的內容區塊）", () => {
  it("只包住可捲動的內容區塊：標題、標籤列在裡面；上一筆／下一筆與關閉鈕在外面", async () => {
    mockApi(sampleRecords());
    renderWithApp("/records?open=3");
    const dialog = await screen.findByRole("dialog");
    const body = fx("detail-body", dialog);
    expect(body).toHaveLength(1);
    const el = body[0] as HTMLElement;
    expect(el.querySelector("h2, [role='heading'], [id]")).not.toBeNull();
    expect(within(el).getByText("日期")).toBeInTheDocument();
    for (const name of ["上一筆", "下一筆", "關閉"]) {
      expect(el.contains(within(dialog).getByRole("button", { name }))).toBe(false);
    }
  });
});

describe("P2 掛勾：lightbox（燈箱）", () => {
  it("燈箱內容是 data-fx=lightbox（Radix Dialog.Content，不是遮罩）", () => {
    render(<Lightbox photos={[{ src: "/a.jpg", caption: "A" }]} index={0} onIndexChange={() => {}} onClose={() => {}} />);
    const lb = fx("lightbox");
    expect(lb).toHaveLength(1);
    expect(lb[0]).toHaveAttribute("role", "dialog");
    expect(lb[0]).toHaveAttribute("data-state", "open");
  });
});

describe("P2 掛勾：error-title（錯誤狀態的標題）", () => {
  it("ErrorState 的標題 <p> 是 error-title，在 error 容器裡；訊息文字不是", () => {
    render(<ErrorState title="載入紀錄失敗" error={new Error("壞了")} />);
    const title = fx("error-title");
    expect(title).toHaveLength(1);
    expect(title[0]).toHaveTextContent("載入紀錄失敗");
    expect(title[0]?.closest('[data-fx="error"]')).not.toBeNull();
    expect(screen.getByText("壞了")).not.toHaveAttribute("data-fx");
  });
});

describe("P2 掛勾：unsaved（設備對照設定的「未儲存」提示）", () => {
  function renderSettings() {
    vi.spyOn(api, "getMeta").mockResolvedValue(makeMeta([]));
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    const router = createMemoryRouter([{ path: "*", element: <SettingsPage /> }], { initialEntries: ["/settings"] });
    return render(
      <Providers client={client}>
        <RouterProvider router={router} />
      </Providers>,
    );
  }

  it("只有「有未儲存的變更」這個條件分支輸出 unsaved；其他提示（預設列尚未儲存、已儲存）沒有", async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole("button", { name: "儲存對照表" });
    expect(fx("unsaved")).toHaveLength(0);
    await user.type(screen.getAllByPlaceholderText("品號")[0]!, "P-1");
    await waitFor(() => expect(fx("unsaved")).toHaveLength(1));
    expect(fx("unsaved")[0]).toHaveTextContent("有未儲存的變更");
  });
});
