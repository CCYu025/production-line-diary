import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootLoading, resetBootForTest } from "@/app/BootScreen";
import { applyTheme, getThemePreference, THEME_STORAGE_KEY } from "@/lib/theme";

const themeMock = vi.hoisted(() => ({ switchTheme: vi.fn() }));
vi.mock("@/lib/theme", async (orig) => ({ ...(await orig<typeof import("@/lib/theme")>()), switchTheme: themeMock.switchTheme }));
// 3D／WebGL 層在 jsdom 沒有意義：換成空殼
vi.mock("./hub/HubCanvas", () => ({ default: () => null, WebglFallback: () => null }));

import OsShell from "./OsShell";

let nav: ReturnType<typeof useNavigate>;
function Probe() {
  nav = useNavigate();
  return null;
}
function Records() {
  return <div>records-page</div>;
}
function Dash() {
  return <BootLoading skeleton={<div>skeleton</div>} />;
}

function Root() {
  return (
    <>
      <Probe />
      <OsShell />
    </>
  );
}

function mount(initial: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Root />,
        children: [
          { path: "dashboard", element: <Dash />, handle: { title: "儀表板" } },
          { path: "records", element: <Records />, handle: { title: "紀錄" } },
          { path: "calendar", element: <div>cal</div>, handle: { title: "日曆" } },
          { path: "os", element: null, handle: { title: "控制室" } },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  return render(<RouterProvider router={router} />);
}

const phase = () => document.documentElement.dataset.osPhase;
const hudButton = () => screen.getByRole("button", { name: /CH-02 紀錄/ });

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetBootForTest();
  document.documentElement.removeAttribute("data-theme");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  themeMock.switchTheme.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OsShell", () => {
  it("A9：不呼叫 switchTheme、不寫 pld.theme；data-theme 變 cyber，卸載後還原；掛上 data-mode", () => {
    const { unmount } = mount("/records");
    expect(themeMock.switchTheme).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("cyber");
    expect(document.documentElement.dataset.mode).toBe("os");
    unmount();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.mode).toBeUndefined();
    expect(document.documentElement.dataset.osPhase).toBeUndefined();
    expect(getThemePreference()).toBe("standard");
  });

  it("A9：偏好是 cyber 時卸載後回到 cyber", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "cyber");
    const { unmount } = mount("/records");
    unmount();
    expect(document.documentElement.dataset.theme).toBe("cyber");
  });

  it("A9：OS 模式下儀表板的 BootScreen（FX-01）不播放", () => {
    mount("/dashboard");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText(/連線本機伺服器/)).toBeNull();
  });

  it("別的分頁改了主題（重新套用標準）：OS 模式期間立刻維持 cyber", () => {
    mount("/records");
    act(() => applyTheme("standard"));
    expect(document.documentElement.dataset.theme).toBe("cyber");
  });

  it("冷啟動停在 /（index 路由）：直接是 hub，不播離開轉場", () => {
    mount("/");
    expect(phase()).toBe("hub");
  });

  it("直接載入頻道路徑：station，沒有轉場；有 main#main 與頁面", () => {
    mount("/records");
    expect(phase()).toBe("station");
    expect(document.querySelector("main#main")).not.toBeNull();
    expect(screen.getByText("records-page")).toBeInTheDocument();
    expect(document.title).toBe("紀錄｜產線日誌");
  });

  it("直接載入 /os：hub，HUD 按鈕可點、沒有工作站", () => {
    mount("/os");
    expect(phase()).toBe("hub");
    expect(document.querySelector('[data-os="station"]')).toBeNull();
    expect(hudButton()).toBeInTheDocument();
  });

  it("進入：點 HUD → entering-pre（工作站 inert＋隱藏）→ 875ms 交接 → 1200ms station；焦點在交接點移到 main", () => {
    mount("/os");
    act(() => {
      hudButton().click();
    });
    expect(phase()).toBe("entering-pre");
    const station = document.querySelector('[data-os="station"]')!;
    expect(station.hasAttribute("inert")).toBe(true);
    expect(station.getAttribute("data-hidden")).toBe("true");
    expect(document.querySelector('[data-os="hud"]')!.getAttribute("data-active")).toBe("false");
    expect(document.querySelector('[data-os="live"]')!.textContent).toBe("進入紀錄");
    act(() => {
      vi.advanceTimersByTime(874);
    });
    expect(phase()).toBe("entering-pre");
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(phase()).toBe("entering-post");
    expect(station.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(document.querySelector("main#main"));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(phase()).toBe("station");
  });

  it("進入：交接點前的第一次點擊 → 直接到 station 且不傳給下面；之後的點擊正常", () => {
    mount("/os");
    act(() => {
      hudButton().click();
    });
    const underneath = vi.fn();
    document.addEventListener("click", underneath);
    act(() => {
      for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        document.body.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
      }
    });
    expect(phase()).toBe("station");
    expect(underneath).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(underneath).toHaveBeenCalledTimes(1);
    document.removeEventListener("click", underneath);
  });

  it("離開：navigate 到 /os → exiting-pre，工作站立刻消失；300ms 交接、焦點到 HUD 按鈕；900ms hub", () => {
    mount("/records");
    act(() => {
      void nav("/os");
    });
    expect(phase()).toBe("exiting-pre");
    expect(document.querySelector('[data-os="station"]')).toBeNull();
    expect(document.querySelector('[data-os="hud"]')!.hasAttribute("inert")).toBe(true);
    expect(document.querySelector('[data-os="live"]')!.textContent).toBe("回到控制室");
    act(() => {
      vi.advanceTimersByTime(301);
    });
    expect(phase()).toBe("exiting-post");
    expect(document.activeElement).toBe(hudButton());
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(phase()).toBe("hub");
  });

  it("頻道之間（頻道 → 另一頻道）是即時切換，不播轉場", () => {
    mount("/records");
    act(() => {
      void nav("/calendar");
    });
    expect(phase()).toBe("station");
  });

  it("減少動態效果：進出都是直接切換", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    mount("/os");
    act(() => {
      hudButton().click();
    });
    expect(phase()).toBe("station");
    act(() => {
      void nav("/os");
    });
    expect(phase()).toBe("hub");
  });

  it("疊層：aria-hidden、無轉場時 data-active=false", () => {
    mount("/records");
    const overlay = document.getElementById("os-overlay")!;
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.getAttribute("data-active")).toBe("false");
  });
});
