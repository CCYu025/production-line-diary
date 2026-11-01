import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider, useBlocker, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/queryClient";
import { getMode, resetModeForTest, setMode } from "@/lib/mode";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// 網頁外殼換成最小替身（真正的 AppShell 需要整套資料層）；OsShell 用真的，只把 3D 與 WebGL 偵測換掉
vi.mock("./AppShell", () => ({
  AppShell: () => (
    <div data-testid="web-shell">
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  ),
}));
vi.mock("@/features/os/hub/HubCanvas", () => ({ default: () => null, WebglFallback: () => null }));
vi.mock("@/features/os/webgl", async (orig) => ({ ...(await orig<typeof import("@/features/os/webgl")>()), webglAvailable: () => true }));
// 開機（X2）在這些測試不是重點：關掉，維持「抵達即控制室」
vi.mock("@/features/os/director/boot", async (orig) => ({ ...(await orig<typeof import("@/features/os/director/boot")>()), decideBoot: () => null }));

import { ENTER_OS_STATE } from "./osEntry";
import { IndexRedirect, ModeShell, OsRouteElement } from "./ModeShell";

let nav: ReturnType<typeof useNavigate>;
let loc: ReturnType<typeof useLocation>;
function Probe() {
  nav = useNavigate();
  loc = useLocation();
  return null;
}
function BlockedPage() {
  const blocker = useBlocker(true);
  return (
    <div>
      <span data-testid="blocker">{blocker.state}</span>
      {blocker.state === "blocked" ? <button onClick={() => blocker.reset()}>留下</button> : null}
    </div>
  );
}

function mount(initial: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <Probe />
            <ModeShell />
          </>
        ),
        children: [
          { index: true, element: <IndexRedirect /> },
          { path: "dashboard", element: <div>dashboard-page</div>, handle: { title: "儀表板" } },
          { path: "records", element: <div>records-page</div>, handle: { title: "紀錄" } },
          { path: "form", element: <BlockedPage />, handle: { title: "表單" } },
          { path: "os", element: <OsRouteElement />, handle: { title: "控制室" } },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function renderWith(router: ReturnType<typeof createMemoryRouter>) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const phase = () => document.documentElement.dataset.osPhase;

beforeEach(() => {
  window.localStorage.clear();
  resetModeForTest();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  resetModeForTest();
});

describe("ModeShell", () => {
  it("網頁模式：AppShell，沒有 data-mode；/ → /dashboard；/os → /dashboard", async () => {
    mount("/");
    expect(screen.getByTestId("web-shell")).toBeInTheDocument();
    await waitFor(() => expect(loc.pathname).toBe("/dashboard"));
    act(() => void nav("/os"));
    await waitFor(() => expect(loc.pathname).toBe("/dashboard"));
    expect(document.documentElement.dataset.mode).toBeUndefined();
  });

  it("OS 模式：延遲載入 OsShell；/ → /os（控制室）", async () => {
    setMode("os");
    mount("/");
    // "/" 一抵達就是控制室（phase=hub）；網址整理成 /os 在同一個 commit 的 passive effect，所以兩者一起等
    await waitFor(() => {
      expect(phase()).toBe("hub");
      expect(loc.pathname).toBe("/os");
    });
    expect(screen.queryByTestId("web-shell")).toBeNull();
    expect(document.documentElement.dataset.mode).toBe("os");
  });

  it("執行期切換（不重新載入、路由保留）：web → os → web；回到網頁模式時還原主題偏好並把焦點移到 #main", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "standard");
    mount("/records");
    expect(screen.getByTestId("web-shell")).toBeInTheDocument();
    const marker = document.body as HTMLElement & { __kept?: number };
    marker.__kept = 1;

    act(() => setMode("os"));
    await waitFor(() => expect(phase()).toBe("station"));
    expect(document.documentElement.dataset.theme).toBe("cyber");
    expect(loc.pathname).toBe("/records");
    expect(screen.queryByTestId("web-shell")).toBeNull();

    act(() => setMode("web"));
    await waitFor(() => expect(screen.getByTestId("web-shell")).toBeInTheDocument());
    expect(document.documentElement.dataset.mode).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(loc.pathname).toBe("/records");
    expect(document.activeElement).toBe(document.getElementById("main"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("standard");
    expect(marker.__kept).toBe(1);
  });

  it("回到網頁模式時 pld.theme 是 cyber → 維持 cyber", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "cyber");
    setMode("os");
    mount("/records");
    await waitFor(() => expect(phase()).toBe("station"));
    act(() => setMode("web"));
    await waitFor(() => expect(screen.getByTestId("web-shell")).toBeInTheDocument());
    expect(document.documentElement.dataset.theme).toBe("cyber");
  });

  it("OS 模式離開（控制室）：先到 /dashboard（replace），再換回網頁外殼", async () => {
    setMode("os");
    mount("/os");
    await waitFor(() => expect(phase()).toBe("hub"));
    act(() => screen.getByRole("button", { name: "EXIT TO WEB" }).click());
    await waitFor(() => expect(screen.getByTestId("web-shell")).toBeInTheDocument());
    expect(loc.pathname).toBe("/dashboard");
    expect(getMode()).toBe("web");
    expect(document.activeElement).toBe(document.getElementById("main"));
  });
});

describe("側欄入口的導覽（ENTER_OS_STATE）", () => {
  it("web 模式導覽到 /os 並帶 state：抵達後切換為 OS 模式（寫入 pld.mode），停在控制室，焦點在選中的頻道按鈕", async () => {
    mount("/records");
    act(() => void nav("/os", { state: ENTER_OS_STATE }));
    await waitFor(() => expect(phase()).toBe("hub"));
    expect(getMode()).toBe("os");
    expect(window.localStorage.getItem("pld.mode")).toBe("os");
    expect(loc.pathname).toBe("/os");
    expect(document.activeElement).toBe(document.querySelector('[data-os="hud-ch"][aria-current="true"]'));
  });

  it("沒帶 state 的 /os：仍導向 /dashboard，模式不變", async () => {
    mount("/records");
    act(() => void nav("/os"));
    await waitFor(() => expect(loc.pathname).toBe("/dashboard"));
    expect(getMode()).toBe("web");
  });

  it("頁面有 useBlocker（未儲存變更）：先被攔下、模式不變、頁面沒有被卸載；留下後仍是網頁模式", async () => {
    mount("/form");
    act(() => void nav("/os", { state: ENTER_OS_STATE }));
    await waitFor(() => expect(screen.getByTestId("blocker").textContent).toBe("blocked"));
    expect(getMode()).toBe("web");
    expect(loc.pathname).toBe("/form");
    act(() => screen.getByRole("button", { name: "留下" }).click());
    await waitFor(() => expect(screen.getByTestId("blocker").textContent).toBe("unblocked"));
    expect(getMode()).toBe("web");
    expect(loc.pathname).toBe("/form");
  });

  it("上一頁（POP）回到帶 enterOs 的舊紀錄：不切換模式（導向儀表板）；切換成功後 state 已被清掉", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <>
              <Probe />
              <ModeShell />
            </>
          ),
          children: [
            { path: "dashboard", element: <div>dashboard-page</div> },
            { path: "records", element: <div>records-page</div> },
            { path: "os", element: <OsRouteElement /> },
          ],
        },
      ],
      { initialEntries: ["/records", { pathname: "/os", state: ENTER_OS_STATE }, "/records"], initialIndex: 2 },
    );
    renderWith(router);
    act(() => void router.navigate(-1));
    await waitFor(() => expect(loc.pathname).toBe("/dashboard"));
    expect(getMode()).toBe("web");
  });

  it("成功進入後 location.state 被清掉", async () => {
    mount("/records");
    act(() => void nav("/os", { state: ENTER_OS_STATE }));
    await waitFor(() => expect(phase()).toBe("hub"));
    await waitFor(() => expect(loc.state).toBeNull());
  });
});

describe("從工作站離開 OS 模式（整合）", () => {
  it("OS 模式在工作站：palette exit → 網頁外殼、同一路徑、焦點在 #main、pld.mode=web", async () => {
    setMode("os");
    mount("/records");
    await waitFor(() => expect(phase()).toBe("station"));
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "exit" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("web-shell")).toBeInTheDocument());
    expect(loc.pathname).toBe("/records");
    expect(getMode()).toBe("web");
    expect(document.activeElement).toBe(document.getElementById("main"));
  });
});

describe("歷史紀錄（上一頁）", () => {
  function routerAt(entries: string[], index?: number) {
    return createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <>
              <Probe />
              <ModeShell />
            </>
          ),
          children: [
            { path: "dashboard", element: <div>dashboard-page</div> },
            { path: "records", element: <div>records-page</div> },
            { path: "os", element: <OsRouteElement /> },
          ],
        },
      ],
      { initialEntries: entries, ...(index !== undefined ? { initialIndex: index } : {}) },
    );
  }

  it("/dashboard → 側欄進入 OS 模式 → /os；上一頁一次回到 /dashboard，而且不會切換模式", async () => {
    const router = routerAt(["/dashboard"]);
    renderWith(router);
    act(() => void nav("/os", { state: ENTER_OS_STATE }));
    await waitFor(() => expect(phase()).toBe("hub"));
    expect(router.state.location.pathname).toBe("/os");
    act(() => void router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(getMode()).toBe("os");
    // 再上一頁已經沒有歷史了：只有 /dashboard → /os 兩筆，沒有多出來的重複紀錄
    expect(router.state.historyAction).toBe("POP");
  });

  it("工作站 /records 離開 OS 模式：歷史淨結果不變，上一頁回到進入 /records 之前（不是 /records 自己）", async () => {
    setMode("os");
    const router = routerAt(["/dashboard", "/records"], 1);
    renderWith(router);
    await waitFor(() => expect(phase()).toBe("station"));
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "exit" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("web-shell")).toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/records");
    act(() => void router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(getMode()).toBe("web");
  });
});
