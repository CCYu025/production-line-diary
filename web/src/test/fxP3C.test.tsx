import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Lightbox } from "@/components/Lightbox";
import { PhotoThumb } from "@/components/PhotoThumb";
import { applyTheme } from "@/lib/theme";
import { deferred, mockApi, renderForm } from "@/features/records/form/testUtils";
import { setViewportWidth } from "@/test/recordsHarness";

/*
 * Cyber 主題 P3 塊 C（前半）：FX-25 送出中進度條、FX-26 上傳掃描帶、FX-36 切換照片。
 * FX-11（:active 角框）與 FX-32（aria-busy ▮▯▯）是純 CSS，由 cyberCss.test.ts 的「P3 塊 C 守門」鎖定。
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

describe("FX-26 照片上傳掃描帶", () => {
  it("上傳中：覆蓋層帶 data-fx-scan；旋轉圖示與 sr-only「上傳中」都還在（掃描帶是 CSS 偽元素，不新增 DOM）", () => {
    const { container } = render(<PhotoThumb src="/a.jpg" alt="a" state="uploading" />);
    const overlay = container.querySelector("[data-fx-scan]")!;
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("上傳中")).toHaveClass("sr-only");
    expect(overlay.children).toHaveLength(2);
  });

  it("非上傳中沒有 data-fx-scan", () => {
    const a = render(<PhotoThumb src="/a.jpg" alt="a" />);
    expect(a.container.querySelector("[data-fx-scan]")).toBeNull();
    a.unmount();
    const b = render(<PhotoThumb src="/a.jpg" alt="a" state="error" />);
    expect(b.container.querySelector("[data-fx-scan]")).toBeNull();
    expect(screen.getByText("上傳失敗")).toBeInTheDocument();
  });
});

describe("FX-36 切換照片", () => {
  const photos = [
    { src: "/a.jpg", caption: "甲" },
    { src: "/b.jpg", caption: "乙" },
    { src: "/c.jpg" },
  ];
  function Harness({ onClose }: { onClose: () => void }) {
    const [i, setI] = React.useState<number | null>(0);
    return <Lightbox photos={photos} index={i} onIndexChange={setI} onClose={onClose} />;
  }

  it("換張照片 <img> 重新掛載（新節點），右鍵／左鍵照舊切換；焦點留在對話框、不會落到 <img>", async () => {
    render(<Harness onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("img", { name: "甲" });
    const focusBefore = document.activeElement;
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    const second = await screen.findByRole("img", { name: "乙" });
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(second).toHaveAttribute("src", "/b.jpg");
    expect(document.activeElement).not.toBe(second);
    expect(dialog.contains(document.activeElement) || document.activeElement === focusBefore).toBe(true);
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(await screen.findByRole("img", { name: "照片" })).toHaveAttribute("src", "/c.jpg");
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(await screen.findByRole("img", { name: "乙" })).toBeInTheDocument();
  });

  it("同一張（src 不變）不會重新掛載；Esc 照舊關閉", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Lightbox photos={photos} index={0} onIndexChange={() => {}} onClose={onClose} />);
    const img = screen.getByRole("img", { name: "甲" });
    rerender(<Lightbox photos={[...photos]} index={0} onIndexChange={() => {}} onClose={onClose} />);
    expect(screen.getByRole("img", { name: "甲" })).toBe(img);
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("FX-25 送出中 ASCII 進度條（RecordForm）", () => {
  async function submitSlowly() {
    const mocks = mockApi();
    const d = deferred<never>();
    mocks.createRecord.mockReturnValue(d.promise);
    const u = userEvent.setup();
    const view = renderForm();
    await screen.findByRole("form", { name: "新增紀錄" });
    await u.type(screen.getByRole("combobox", { name: /^設備/ }), "F3");
    await u.type(screen.getByLabelText(/^問題$/), "卡料");
    await u.type(screen.getByLabelText(/^耗時/), "7");
    await u.click(screen.getByRole("button", { name: /^新增紀錄/ }));
    const button = await screen.findByRole("button", { name: /送出中/ });
    await waitFor(() => expect(button).toBeDisabled());
    return { button, view, d };
  }

  it("標準主題：仍是旋轉圖示，沒有進度條 DOM", async () => {
    const { button } = await submitSlowly();
    expect(button.querySelector("[data-fx-progress]")).toBeNull();
    expect(button.querySelector("svg.animate-spin")).not.toBeNull();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("cyber：進度條 aria-hidden、取代旋轉圖示；按鈕文字、disabled、aria-busy 與標準相同；進度條裡沒有百分比數字", async () => {
    root.dataset.theme = "cyber";
    const { button } = await submitSlowly();
    const bar = button.querySelector("[data-fx-progress]")!;
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector("svg")).toBeNull();
    expect(bar.textContent).not.toMatch(/\d|%/);
    expect(button).toHaveAccessibleName("送出中…");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.className).toContain("md:min-w-36"); // 最小寬度不變，rect 不受進度條影響
  });
});

