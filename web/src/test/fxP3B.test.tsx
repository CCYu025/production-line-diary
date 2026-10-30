import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootLoading, consumeBoot, resetBootForTest } from "@/app/BootScreen";
import { NavIndicator } from "@/app/NavIndicator";
import { Sidebar } from "@/app/Sidebar";
import { useThemeToggle } from "@/app/themeToggle";
import { PageHeader } from "@/components/PageHeader";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDrillTo } from "@/lib/drill";
import { titleTypeProps } from "@/lib/fx/titleType";
import { createQueryClient } from "@/lib/queryClient";
import { applyTheme } from "@/lib/theme";
import { setViewportWidth } from "@/test/recordsHarness";

/*
 * Cyber 主題 P3 塊 B：FX-01 開機畫面、FX-02 換頁 View Transitions、FX-03 標題打字、FX-04 nav-indicator、FX-38 主題切換。
 * 標準主題（jsdom 預設）DOM 與 P2 完全相同；cyber 且允許動態時才輸出新掛勾。
 * （recordsHarness 的 matchMedia 對 prefers-reduced-motion 一律回 false，所以 data-theme=cyber 就等於 useFx() 為 true。）
 */

const root = document.documentElement;
const realMatchMedia = window.matchMedia;
const vtHost = document as unknown as { startViewTransition?: unknown };

beforeEach(() => {
  setViewportWidth(1280);
  window.localStorage.clear();
  resetBootForTest();
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  applyTheme("standard");
  delete root.dataset.theme;
  delete root.dataset.vt;
  delete vtHost.startViewTransition;
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("FX-03 標題打字", () => {
  it("titleTypeProps：標準主題不輸出 style；cyber 輸出字數（1–16）", () => {
    expect(titleTypeProps("儀表板", false)).toEqual({});
    expect((titleTypeProps("儀表板", true).style as Record<string, unknown>)["--chars"]).toBe(3);
    expect((titleTypeProps("", true).style as Record<string, unknown>)["--chars"]).toBe(1);
    expect((titleTypeProps("一二三四五六七八九十一二三四五六七八", true).style as Record<string, unknown>)["--chars"]).toBe(16);
  });

  it("標準主題：標題的 DOM 與 P2 相同（沒有 style、沒有多餘子節點）", () => {
    render(<PageHeader title="儀表板" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "儀表板" });
    expect(h1.hasAttribute("style")).toBe(false);
    expect(h1.childNodes).toHaveLength(1);
    expect(h1).toHaveTextContent("儀表板");
  });

  it("cyber：文字仍完整在 DOM、可存取名稱不變；只多一個 --chars（游標是 CSS 偽元素，不進 DOM）", () => {
    root.dataset.theme = "cyber";
    render(<PageHeader title="儀表板" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "儀表板" });
    expect(h1.style.getPropertyValue("--chars")).toBe("3");
    expect(h1.textContent).toBe("儀表板");
    expect(h1.childNodes).toHaveLength(1);
  });
});

function renderSidebar(entry = "/dashboard", dataRouter = false) {
  const ui = (
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>{dataRouter ? null : <Sidebar />}</TooltipProvider>
    </QueryClientProvider>
  );
  if (!dataRouter) return render(<MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter>);
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <QueryClientProvider client={createQueryClient()}>
            <TooltipProvider>
              <Sidebar />
            </TooltipProvider>
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: [entry] },
  );
  return render(<RouterProvider router={router} />);
}

describe("FX-04 nav-indicator", () => {
  it("標準主題：不渲染（導覽 landmark 內的 DOM 與 P2 相同）", () => {
    const { container } = renderSidebar();
    expect(container.querySelector("[data-fx-indicator]")).toBeNull();
  });

  it("cyber：一個 aria-hidden、inert 的 span，放在導覽的最後；導覽連結數量與可存取名稱不變", () => {
    const standard = renderSidebar();
    const linksBefore = screen.getAllByRole("link").map((a) => a.textContent);
    standard.unmount();
    root.dataset.theme = "cyber";
    const { container } = renderSidebar();
    const el = container.querySelector("[data-fx-indicator]") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("inert");
    expect(el.parentElement).toBe(screen.getByRole("navigation", { name: "主要導覽" }));
    expect(el.parentElement!.lastElementChild).toBe(el);
    expect(el.textContent).toBe("");
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(linksBefore);
  });

  it("首次渲染：有 --nav-y 與 state=on 但沒有 data-ready（不播動畫）；下一個影格才啟用過渡", async () => {
    root.dataset.theme = "cyber";
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
    const { container } = renderSidebar("/calendar");
    const el = container.querySelector<HTMLElement>("[data-fx-indicator]")!;
    expect(el.dataset.state).toBe("on");
    expect(el.style.getPropertyValue("--nav-y")).toBe("0px"); // jsdom 沒有版面，offsetTop 為 0
    expect(el.dataset.ready).toBeUndefined();
    act(() => frames.forEach((cb) => cb(0)));
    expect(el.dataset.ready).toBe("true");
    vi.restoreAllMocks();
  });

  it("沒有目前頁（例如 /records/new）時 state=off", () => {
    root.dataset.theme = "cyber";
    const { container } = renderSidebar("/records/new");
    expect(container.querySelector<HTMLElement>("[data-fx-indicator]")!.dataset.state).toBe("off");
  });

  it("NavIndicator 單獨在標準主題回傳 null", () => {
    const { container } = render(
      <MemoryRouter>
        <nav>
          <NavIndicator />
        </nav>
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-fx-indicator]")).toBeNull();
  });
});

describe("FX-02 已移除：換頁不帶 View Transitions", () => {
  function spyStart() {
    const start = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), skipTransition: () => {} };
    });
    vtHost.startViewTransition = start;
    return start;
  }

  it.each([
    ["cyber", true],
    ["標準主題", false],
  ])("%s：點導覽連結照常換頁，且不呼叫 document.startViewTransition", async (_n, cyber) => {
    if (cyber) root.dataset.theme = "cyber";
    const start = spyStart();
    renderSidebar("/dashboard", true);
    await userEvent.click(screen.getByRole("link", { name: "日曆" }));
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "日曆" })).toHaveAttribute("aria-current", "page");
  });

  it("cyber：drill 帶篩選跳轉也不呼叫 startViewTransition", () => {
    root.dataset.theme = "cyber";
    const start = spyStart();
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: <DrillHarness />,
        },
      ],
      { initialEntries: ["/dashboard"] },
    );
    render(<RouterProvider router={router} />);
    act(() => void screen.getByRole("button", { name: "drill" }).click());
    expect(router.state.location.pathname).toBe("/records");
    expect(start).not.toHaveBeenCalled();
  });
});

function DrillHarness() {
  const drillTo = useDrillTo();
  return (
    <button type="button" onClick={() => drillTo("severity", "high")}>
      drill
    </button>
  );
}

function ToggleHarness() {
  const { isCyber, toggle } = useThemeToggle();
  return (
    <button type="button" onClick={toggle}>
      {isCyber ? "cyber" : "standard"}
    </button>
  );
}

describe("FX-38 主題切換", () => {
  function mockVt() {
    let seenVt: string | undefined;
    const start = vi.fn((cb: () => void) => {
      seenVt = root.dataset.vt;
      cb();
      return { finished: Promise.resolve() };
    });
    vtHost.startViewTransition = start;
    return { start, seen: () => seenVt };
  }

  it("切到 cyber：用 View Transitions 掃描一次（切換時 <html> 有 data-vt=theme，結束後移除），主題照常套用", async () => {
    const { start, seen } = mockVt();
    render(<ToggleHarness />);
    await userEvent.click(screen.getByRole("button"));
    expect(start).toHaveBeenCalledTimes(1);
    expect(seen()).toBe("theme");
    expect(root.dataset.theme).toBe("cyber");
    await act(async () => {});
    expect(root.dataset.vt).toBeUndefined();
  });

  it("切回標準：不播（不呼叫 startViewTransition）", async () => {
    applyTheme("cyber");
    const { start } = mockVt();
    render(<ToggleHarness />);
    await userEvent.click(screen.getByRole("button"));
    expect(start).not.toHaveBeenCalled();
    expect(root.dataset.theme).toBeUndefined();
  });

  it("減少動態效果：切到 cyber 也不播", async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes("prefers-reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
    const { start } = mockVt();
    render(<ToggleHarness />);
    await userEvent.click(screen.getByRole("button"));
    expect(start).not.toHaveBeenCalled();
    expect(root.dataset.theme).toBe("cyber");
  });

  it("瀏覽器不支援 View Transitions：直接切換", async () => {
    render(<ToggleHarness />);
    await userEvent.click(screen.getByRole("button"));
    expect(root.dataset.theme).toBe("cyber");
  });
});

describe("FX-01 開機畫面", () => {
  const SKELETON = <div data-testid="skeleton">骨架</div>;

  function renderBoot() {
    return render(<BootLoading skeleton={SKELETON} />);
  }

  it("標準主題：就是原本的骨架，沒有開機行", () => {
    renderBoot();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(document.querySelector("[data-fx-boot]")).toBeNull();
  });

  it("cyber：載入不到 150ms 完全不顯示開機行（只有載入狀態的無障礙文字）；資料到了（卸載）就算用掉", () => {
    vi.useFakeTimers();
    root.dataset.theme = "cyber";
    const { unmount } = renderBoot();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("載入中…");
    act(() => void vi.advanceTimersByTime(149));
    expect(document.querySelector("[data-fx-boot]")).toBeNull();
    unmount();
    // 下一次（換頁後回到儀表板）不再出現
    renderBoot();
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(document.querySelector("[data-fx-boot]")).toBeNull();
  });

  it("cyber：超過 150ms 才印開機行，整塊 aria-hidden；可存取結構與骨架一樣（role=status、aria-busy、載入中…）", () => {
    vi.useFakeTimers();
    root.dataset.theme = "cyber";
    renderBoot();
    act(() => void vi.advanceTimersByTime(150));
    const boot = document.querySelector("[data-fx-boot]") as HTMLElement;
    expect(boot).toHaveAttribute("aria-hidden", "true");
    const lines = boot.querySelectorAll<HTMLElement>("[data-fx-boot-line]");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect([...lines].map((l) => l.style.getPropertyValue("--i"))).toEqual(["0", "1"]);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("載入中…");
    expect(screen.queryByTestId("skeleton")).toBeNull();
  });

  it("按任意鍵跳過 → 改回骨架，而且這個分頁不再開機；那次按鍵沒有被吞掉", async () => {
    vi.useFakeTimers();
    root.dataset.theme = "cyber";
    const onKey = vi.fn();
    document.addEventListener("keydown", onKey);
    const { unmount } = renderBoot();
    act(() => void vi.advanceTimersByTime(200));
    expect(document.querySelector("[data-fx-boot]")).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    });
    expect(onKey).toHaveBeenCalled();
    expect(onKey.mock.calls[0]![0].defaultPrevented).toBe(false);
    expect(document.querySelector("[data-fx-boot]")).toBeNull();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    unmount();
    document.removeEventListener("keydown", onKey);
    renderBoot();
    act(() => void vi.advanceTimersByTime(500));
    expect(document.querySelector("[data-fx-boot]")).toBeNull();
  });

  it("點擊（pointerdown）也能跳過", () => {
    vi.useFakeTimers();
    root.dataset.theme = "cyber";
    renderBoot();
    act(() => void vi.advanceTimersByTime(200));
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(document.querySelector("[data-fx-boot]")).toBeNull();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  it("已用掉的分頁（sessionStorage）：直接是骨架", () => {
    root.dataset.theme = "cyber";
    consumeBoot();
    renderBoot();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });
});
