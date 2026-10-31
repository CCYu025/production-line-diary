import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useReplayPhase } from "@/lib/fx";
import { HBarChart, SeverityDonut, TrendChart } from "./charts";

const root = document.documentElement;
const realMatchMedia = window.matchMedia;

beforeEach(() => {
  window.matchMedia = ((query: string) =>
    ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList) as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  delete root.dataset.theme;
});

const noop = () => {};
const rowsA = [
  { label: "A", count: 3, minutes: 0 },
  { label: "B", count: 1, minutes: 0 },
];
const rowsB = [
  { label: "A", count: 4, minutes: 0 },
  { label: "B", count: 1, minutes: 0 },
];
const trendA = [
  { date: "2026-10-01", count: 1, minutes: 0 },
  { date: "2026-10-02", count: 2, minutes: 0 },
];
const trendB = [
  { date: "2026-10-01", count: 1, minutes: 0 },
  { date: "2026-10-02", count: 5, minutes: 0 },
];
const sevA = [
  { label: "輕微" as const, count: 1, minutes: 0 },
  { label: "一般" as const, count: 2, minutes: 0 },
  { label: "嚴重" as const, count: 0, minutes: 0 },
  { label: "重大" as const, count: 0, minutes: 0 },
];
const sevB = sevA.map((s) => (s.label === "重大" ? { ...s, count: 1 } : s));

function Probe({ sig }: { sig: string }) {
  return <span data-testid="p" data-phase={useReplayPhase(sig) ?? "none"} />;
}

describe("useReplayPhase：不重掛的重播（資料簽名奇偶）", () => {
  it("標準主題：永遠沒有相位（不輸出屬性，DOM 與以前相同）", () => {
    const { getByTestId, rerender } = render(<Probe sig="x" />);
    expect(getByTestId("p").dataset.phase).toBe("none");
    rerender(<Probe sig="y" />);
    expect(getByTestId("p").dataset.phase).toBe("none");
  });

  it("cyber：簽名不變不翻面；簽名改變奇偶切換；換回舊簽名也算改變", () => {
    root.dataset.theme = "cyber";
    const { getByTestId, rerender } = render(<Probe sig="x" />);
    expect(getByTestId("p").dataset.phase).toBe("a");
    rerender(<Probe sig="x" />);
    expect(getByTestId("p").dataset.phase).toBe("a");
    rerender(<Probe sig="y" />);
    expect(getByTestId("p").dataset.phase).toBe("b");
    rerender(<Probe sig="y" />);
    expect(getByTestId("p").dataset.phase).toBe("b");
    rerender(<Probe sig="x" />);
    expect(getByTestId("p").dataset.phase).toBe("a");
  });
});

describe("長條／趨勢／甜甜圈：相位切換、DOM 節點不動", () => {
  it("HBarChart：簽名相同（新陣列、同內容）不重播；內容改變相位翻面；按鈕是同一個節點", () => {
    root.dataset.theme = "cyber";
    const { container, getAllByRole, rerender } = render(<HBarChart rows={rowsA} onSelect={noop} actionLabel="查看" />);
    const ul = container.querySelector("ul")!;
    const btn = getAllByRole("button")[0]!;
    expect(ul.dataset.fxPhase).toBe("a");
    rerender(<HBarChart rows={rowsA.map((r) => ({ ...r }))} onSelect={noop} actionLabel="查看" />);
    expect(ul.dataset.fxPhase).toBe("a");
    rerender(<HBarChart rows={rowsB} onSelect={noop} actionLabel="查看" />);
    expect(container.querySelector("ul")).toBe(ul);
    expect(getAllByRole("button")[0]).toBe(btn);
    expect(ul.dataset.fxPhase).toBe("b");
    btn.focus();
    rerender(<HBarChart rows={rowsA} onSelect={noop} actionLabel="查看" />);
    expect(ul.dataset.fxPhase).toBe("a");
    expect(document.activeElement).toBe(btn);
  });

  it("HBarChart 標準主題：沒有 data-fx-phase", () => {
    const { container } = render(<HBarChart rows={rowsA} onSelect={noop} actionLabel="查看" />);
    expect(container.querySelector("[data-fx-phase]")).toBeNull();
  });

  it("TrendChart：簽名相同不重播；改變翻面；焦點中的欄位按鈕是同一個節點", () => {
    root.dataset.theme = "cyber";
    const { container, getAllByRole, rerender } = render(<TrendChart trend={trendA} onSelect={noop} />);
    const ol = container.querySelector("ol")!;
    const btn = getAllByRole("button")[1]!;
    btn.focus();
    expect(ol.dataset.fxPhase).toBe("a");
    rerender(<TrendChart trend={trendA.map((t) => ({ ...t }))} onSelect={noop} />);
    expect(ol.dataset.fxPhase).toBe("a");
    rerender(<TrendChart trend={trendB} onSelect={noop} />);
    expect(container.querySelector("ol")).toBe(ol);
    expect(getAllByRole("button")[1]).toBe(btn);
    expect(document.activeElement).toBe(btn);
    expect(ol.dataset.fxPhase).toBe("b");
  });

  it("SeverityDonut：簽名相同不重播；改變翻面；容器與圖例按鈕不重掛", () => {
    root.dataset.theme = "cyber";
    const { container, getAllByRole, rerender } = render(<SeverityDonut counts={sevA} onSelect={noop} />);
    const wrap = container.querySelector<HTMLElement>("[data-fx-in='donut']")!;
    const btn = getAllByRole("button")[0]!;
    btn.focus();
    expect(wrap.dataset.fxPhase).toBe("a");
    rerender(<SeverityDonut counts={sevA.map((s) => ({ ...s }))} onSelect={noop} />);
    expect(wrap.dataset.fxPhase).toBe("a");
    rerender(<SeverityDonut counts={sevB} onSelect={noop} />);
    expect(container.querySelector("[data-fx-in='donut']")).toBe(wrap);
    expect(getAllByRole("button")[0]).toBe(btn);
    expect(document.activeElement).toBe(btn);
    expect(wrap.dataset.fxPhase).toBe("b");
  });
});
