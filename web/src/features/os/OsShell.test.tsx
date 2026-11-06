import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useBlocker, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootLoading, resetBootForTest } from "@/app/BootScreen";
import { notify } from "@/lib/feedback";
import { getMode, resetModeForTest, setMode } from "@/lib/mode";
import { applyTheme, getThemePreference, THEME_STORAGE_KEY } from "@/lib/theme";

const themeMock = vi.hoisted(() => ({ switchTheme: vi.fn() }));
vi.mock("@/lib/theme", async (orig) => ({ ...(await orig<typeof import("@/lib/theme")>()), switchTheme: themeMock.switchTheme }));

// 3D／WebGL 層在 jsdom 沒有意義：換成空殼（記下收到的 props，測試可以呼叫 onFailure）
const hubMock = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("./hub/HubCanvas", () => ({
  default: (props: Record<string, unknown>) => {
    hubMock.props = props;
    return null;
  },
  WebglFallback: () => null,
}));

// 開機（X2）：預設關閉，讓既有測試維持「直接進入控制室」；開機本身的測試用 bootMock.real 打開（見「開機」區塊）
const bootMock = vi.hoisted(() => ({ real: false }));
vi.mock("./director/boot", async (orig) => {
  const actual = await orig<typeof import("./director/boot")>();
  return { ...actual, decideBoot: (i: Parameters<typeof actual.decideBoot>[0]) => (bootMock.real ? actual.decideBoot(i) : null) };
});

// 控制室資料（X2）：紀錄查詢換成可控的替身（預設空清單）
const apiMock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, listRecords: apiMock.list } };
});

const exportMock = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/app/useExportAction", () => ({ useExportAction: () => ({ run: exportMock.run, pending: false }) }));

const webglMock = vi.hoisted(() => ({ available: vi.fn(() => true) }));
vi.mock("./webgl", async (orig) => ({ ...(await orig<typeof import("./webgl")>()), webglAvailable: webglMock.available }));

import { resetCrtForTest } from "./crt/settings";
import { resetBootDoneForTest } from "./director/boot";
import { COMMANDS } from "./hud/commands";
import OsShell, { CUT_DONE_DELAY_MS, cutAnnouncement, FOCUS_RETRY_FRAMES, STATION_PREP_MS } from "./OsShell";
import { shouldKeepCyberOnExit, WEBGL_FALLBACK_TEXT } from "./webgl";

let nav: ReturnType<typeof useNavigate>;
let loc: ReturnType<typeof useLocation>;
function Probe() {
  nav = useNavigate();
  loc = useLocation();
  return null;
}
const page = (name: string) => <div>{name}-page</div>;
function Dash() {
  return <BootLoading skeleton={<div>skeleton</div>} />;
}
/** 帶 useBlocker 的頁面（模擬有未儲存變更的表單／設定頁） */
function BlockedPage() {
  const blocker = useBlocker(true);
  return (
    <div>
      <span data-testid="blocker">{blocker.state}</span>
      {blocker.state === "blocked" ? (
        <>
          <button onClick={() => blocker.reset()}>留下</button>
          <button onClick={() => blocker.proceed()}>離開</button>
        </>
      ) : null}
      <input aria-label="欄位" />
    </div>
  );
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
          { path: "records", element: page("records"), handle: { title: "紀錄" } },
          { path: "records/new", element: page("new"), handle: { title: "新增紀錄" } },
          { path: "records/:id/edit", element: page("edit"), handle: { title: "編輯紀錄" } },
          { path: "calendar", element: page("cal"), handle: { title: "日曆" } },
          { path: "report", element: page("report"), handle: { title: "報表" } },
          { path: "form", element: <BlockedPage />, handle: { title: "表單" } },
          { path: "os", element: null, handle: { title: "控制室" } },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const phase = () => document.documentElement.dataset.osPhase;
const hudButton = (name = "CH-02 紀錄") => screen.getByRole("button", { name });
const station = () => document.querySelector('[data-os="station"]');
const live = () => document.querySelector('[data-os="live"]')!.textContent;
const key = (k: string, init: KeyboardEventInit = {}, target: Element | Window = document.body) => {
  act(() => {
    fireEvent.keyDown(target, { key: k, ...init });
  });
};
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const click = (el: HTMLElement) =>
  act(() => {
    el.click();
  });
const go = (to: string) =>
  act(() => {
    void nav(to);
  });
/** 等轉場跑完 */
const settle = () => advance(1300);

function setViewport(w: number, h: number) {
  act(() => {
    Object.assign(window, { innerWidth: w, innerHeight: h });
    window.dispatchEvent(new Event("resize"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetBootForTest();
  resetModeForTest();
  setMode("os");
  document.documentElement.removeAttribute("data-theme");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  themeMock.switchTheme.mockClear();
  webglMock.available.mockReset();
  webglMock.available.mockReturnValue(true);
  hubMock.props = null;
  apiMock.list.mockReset();
  apiMock.list.mockResolvedValue([]);
  window.localStorage.removeItem("pld.os.crt");
  resetCrtForTest();
  bootMock.real = false;
  resetBootDoneForTest();
  exportMock.run.mockReset();
  Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
});

describe("OsShell：基本與 A9", () => {
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

  it("A9：整段操作（進入、指令列切換、離開、離開 OS 模式）都不呼叫 switchTheme、不寫 pld.theme", () => {
    mount("/os");
    click(hudButton());
    settle();
    key("k", { ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cal" } });
    key("Enter", {}, screen.getByRole("combobox"));
    advance(500);
    settle();
    go("/os");
    settle();
    click(screen.getByRole("button", { name: "EXIT TO WEB" }));
    expect(themeMock.switchTheme).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("A9：OS 模式下儀表板的 BootScreen（FX-01）不播放", () => {
    mount("/dashboard");
    advance(500);
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

  it("直接載入頻道路徑：station，沒有轉場；有 main#main 與頁面；不搶焦點；沒有宣告", () => {
    mount("/records");
    expect(phase()).toBe("station");
    expect(document.querySelector("main#main")).not.toBeNull();
    expect(screen.getByText("records-page")).toBeInTheDocument();
    expect(document.title).toBe("紀錄｜產線日誌");
    expect(document.activeElement).toBe(document.body);
    expect(live()).toBe("");
  });

  it("直接載入 /os：hub，沒有工作站；焦點在選中的頻道按鈕；沒有宣告", () => {
    mount("/os");
    expect(phase()).toBe("hub");
    expect(station()).toBeNull();
    expect(hudButton()).toHaveAttribute("aria-current", "true");
    expect(document.activeElement).toBe(hudButton());
    expect(live()).toBe("");
    expect(document.title).toBe("控制室｜產線日誌");
  });

  it("疊層：aria-hidden、無轉場時 data-active=false", () => {
    mount("/records");
    const overlay = document.getElementById("os-overlay")!;
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.getAttribute("data-active")).toBe("false");
  });

  it("跳到主要內容連結把焦點移到 #main", () => {
    mount("/records");
    click(screen.getByRole("button", { name: "跳到主要內容" }));
    expect(document.activeElement).toBe(document.getElementById("main"));
  });
});

describe("OsShell：HUD", () => {
  it("狀態列（PLD/OS 1995、時鐘、EXIT TO WEB）與 7 個頻道按鈕；roving tabindex、aria-current", () => {
    mount("/os");
    const bar = document.querySelector('[data-os="statusbar"]') as HTMLElement;
    expect(within(bar).getByText("PLD/OS 1995")).toBeInTheDocument();
    expect(document.querySelector('[data-os="clock"]')!.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(document.querySelector('[data-os="exit"]')!.textContent).toBe("EXIT TO WEB");
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-os="hud-ch"]')];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "CH-01 儀表板",
      "CH-02 紀錄",
      "CH-03 新增",
      "CH-04 日曆",
      "CH-05 報表",
      "CH-06 回收桶",
      "CH-07 設定",
    ]);
    expect(buttons.map((b) => b.getAttribute("data-ch"))).toEqual(["CH-01", "CH-02", "CH-03", "CH-04", "CH-05", "CH-06", "CH-07"]);
    expect(buttons.filter((b) => b.getAttribute("aria-current") === "true").map((b) => b.dataset.ch)).toEqual(["CH-02"]);
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1, -1]);
    expect(hubMock.props?.channel).toMatchObject({ id: "CH-02", code: "RECORDS" });
  });

  it("時鐘每秒更新（setInterval）", () => {
    vi.setSystemTime(new Date(2026, 10, 1, 8, 30, 15));
    mount("/os");
    const clock = () => document.querySelector('[data-os="clock"]')!.textContent;
    expect(clock()).toBe("08:30:15");
    advance(2000);
    expect(clock()).toBe("08:30:17");
  });

  it("←/→ 移動選中（含環繞）、焦點在清單內時焦點跟著走，3D 螢幕貼圖的頻道同步", () => {
    mount("/os");
    key("ArrowRight", {}, hudButton());
    expect(hudButton("CH-03 新增")).toHaveAttribute("aria-current", "true");
    expect(document.activeElement).toBe(hudButton("CH-03 新增"));
    expect(hudButton("CH-03 新增").tabIndex).toBe(0);
    expect(hudButton("CH-02 紀錄").tabIndex).toBe(-1);
    expect(hubMock.props?.channel).toMatchObject({ id: "CH-03", code: "NEW" });
    key("ArrowLeft");
    key("ArrowLeft");
    expect(hudButton("CH-01 儀表板")).toHaveAttribute("aria-current", "true");
    key("ArrowLeft");
    expect(hudButton("CH-07 設定")).toHaveAttribute("aria-current", "true");
    key("ArrowRight");
    expect(hudButton("CH-01 儀表板")).toHaveAttribute("aria-current", "true");
  });

  it("焦點不在清單內時，←/→ 只改選擇、不搶焦點", () => {
    mount("/os");
    act(() => (document.activeElement as HTMLElement).blur());
    key("ArrowRight");
    expect(hudButton("CH-03 新增")).toHaveAttribute("aria-current", "true");
    expect(document.activeElement).toBe(document.body);
  });

  it("Enter：焦點在按鈕上時交給原生啟用（不雙重觸發）；事件目標不是按鈕時進入選中的頻道", () => {
    mount("/os");
    key("Enter", {}, hudButton());
    expect(phase()).toBe("hub");
    key("Enter");
    expect(phase()).toBe("entering-pre");
    expect(loc.pathname).toBe("/records");
  });

  it("點頻道按鈕進入該頻道；數字鍵與 N 直接進入", () => {
    mount("/os");
    click(hudButton("CH-05 報表"));
    expect(loc.pathname).toBe("/report");
    expect(phase()).toBe("entering-pre");
    expect(live()).toBe("進入報表");
    settle();
    expect(phase()).toBe("station");
    go("/os");
    settle();
    expect(phase()).toBe("hub");
    key("4");
    expect(loc.pathname).toBe("/calendar");
    settle();
    go("/os");
    settle();
    key("N");
    expect(loc.pathname).toBe("/records/new");
    expect(phase()).toBe("entering-pre");
  });

  it("控制室記住最後造訪的頻道：回到控制室時選中它，焦點回到它的按鈕", () => {
    mount("/os");
    click(hudButton("CH-05 報表"));
    settle();
    go("/os");
    expect(phase()).toBe("exiting-pre");
    advance(301);
    expect(phase()).toBe("exiting-post");
    expect(hudButton("CH-05 報表")).toHaveAttribute("aria-current", "true");
    expect(document.activeElement).toBe(hudButton("CH-05 報表"));
    advance(700);
    expect(phase()).toBe("hub");
    expect(hubMock.props?.channel).toMatchObject({ id: "CH-05", code: "REPORT" });
  });

  it("離開轉場交接點之後（exiting-post）控制室快速鍵已可用", () => {
    mount("/records");
    go("/os");
    advance(301);
    expect(phase()).toBe("exiting-post");
    key("ArrowRight");
    expect(hudButton("CH-03 新增")).toHaveAttribute("aria-current", "true");
  });

  it("工作站裡單一字元快速鍵不作用", () => {
    mount("/records");
    key("ArrowRight");
    key("n");
    key("3");
    key("/");
    expect(phase()).toBe("station");
    expect(loc.pathname).toBe("/records");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("OsShell：指令列", () => {
  const openPalette = () => key("k", { ctrlKey: true });
  const input = () => screen.getByRole("combobox");
  const type = (text: string) => {
    act(() => {
      fireEvent.change(input(), { target: { value: text } });
    });
  };
  const enter = () => key("Enter", {}, input());

  it("Ctrl+K 任何地方開啟並 preventDefault；/ 在控制室開啟", () => {
    mount("/os");
    const ev = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-os="palette"]')).not.toBeNull();
    key("Escape", {}, input());
    advance(10);
    expect(document.querySelector('[data-os="palette"]')).toBeNull();
    key("/");
    expect(document.querySelector('[data-os="palette"]')).not.toBeNull();
  });

  it("工作站：/ 不開（輸入框內也不開）；Ctrl+K 開（焦點在表單欄位內也開）", () => {
    mount("/form");
    key("/");
    expect(document.querySelector('[data-os="palette"]')).toBeNull();
    const field = screen.getByLabelText("欄位");
    act(() => field.focus());
    key("/", {}, field);
    expect(document.querySelector('[data-os="palette"]')).toBeNull();
    key("k", { ctrlKey: true }, field);
    expect(document.querySelector('[data-os="palette"]')).not.toBeNull();
  });

  it("combobox／listbox 的 ARIA；↑↓ 選取、Tab 補完", () => {
    mount("/os");
    openPalette();
    expect(document.activeElement).toBe(input());
    const list = document.querySelector('[data-os="palette-list"]') as HTMLElement;
    expect(list).toHaveAttribute("role", "listbox");
    expect(input()).toHaveAttribute("aria-controls", list.id);
    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    const options = within(list).getAllByRole("option");
    expect(options.length).toBe(COMMANDS.length);
    key("ArrowDown", {}, input());
    expect(input()).toHaveAttribute("aria-activedescendant", options[0]!.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    key("ArrowDown", {}, input());
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    key("ArrowUp", {}, input());
    key("ArrowUp", {}, input());
    expect(options.at(-1)).toHaveAttribute("aria-selected", "true");
    type("ca");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["cal日曆"]);
    key("Tab", {}, input());
    expect((input() as HTMLInputElement).value).toBe("cal");
    type("zzz");
    expect(input()).toHaveAttribute("aria-expanded", "false");
  });

  it("指令導覽：先關閉指令列，再走 router（控制室 → 進入轉場；工作站 → 短轉場）", () => {
    mount("/os");
    openPalette();
    type("cal");
    enter();
    advance(300);
    expect(document.querySelector('[data-os="palette"]')).toBeNull();
    expect(loc.pathname).toBe("/calendar");
    expect(phase()).toBe("entering-pre");
    settle();

    openPalette();
    type("rep");
    enter();
    advance(300);
    expect(loc.pathname).toBe("/report");
    expect(phase()).toBe("switching-pre");
    expect(live()).toBe("切換到報表");
  });

  it("rec <id> → /records?open=<id>；new → /records/new", () => {
    mount("/os");
    openPalette();
    type("rec 63");
    enter();
    advance(300);
    expect(loc.pathname + loc.search).toBe("/records?open=63");
    settle();
    openPalette();
    type("new");
    enter();
    advance(300);
    expect(loc.pathname).toBe("/records/new");
  });

  it("未知指令與無效 rec 編號：行內錯誤（palette-error、role=alert），指令列保持開啟、不導覽", () => {
    mount("/os");
    openPalette();
    type("foo");
    enter();
    const err = document.querySelector('[data-os="palette-error"]')!;
    expect(err).toHaveAttribute("role", "alert");
    expect(err.textContent).toContain("foo");
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(document.querySelector('[data-os="palette"]')).not.toBeNull();
    expect(loc.pathname).toBe("/os");
    type("rec abc");
    enter();
    expect(document.querySelector('[data-os="palette-error"]')!.textContent).toContain("abc");
    type("rec 0");
    enter();
    expect(document.querySelector('[data-os="palette-error"]')).not.toBeNull();
    type("rec 7");
    expect(document.querySelector('[data-os="palette-error"]')).toBeNull();
  });

  it("help 在指令列內列出所有指令；空白 Enter 不做事", () => {
    mount("/os");
    openPalette();
    enter();
    type("help");
    enter();
    const help = document.querySelector('[data-os="palette-help"]') as HTMLElement;
    for (const name of ["dash", "rec", "rec <id>", "new", "cal", "rep", "trash", "set", "export", "exit", "help"]) {
      expect(within(help).getByText(name)).toBeInTheDocument();
    }
    expect(document.querySelector('[data-os="palette"]')).not.toBeNull();
  });

  it("Esc 只關指令列，不離開工作站；再一次 Esc 才離開", async () => {
    mount("/records");
    openPalette();
    await act(async () => {
      fireEvent.keyDown(input(), { key: "Escape" });
    });
    advance(10);
    expect(document.querySelector('[data-os="palette"]')).toBeNull();
    expect(phase()).toBe("station");
    expect(loc.pathname).toBe("/records");
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(loc.pathname).toBe("/os");
    expect(phase()).toBe("exiting-pre");
  });

  it("指令列關閉後焦點回到原本的元素", () => {
    mount("/os");
    const before = hudButton();
    openPalette();
    key("Escape", {}, input());
    advance(10);
    expect(document.activeElement).toBe(before);
  });

  it("exit：離開 OS 模式（setMode web、寫入 pld.mode），工作站保留目前路徑", () => {
    mount("/records");
    openPalette();
    type("exit");
    enter();
    advance(300);
    expect(getMode()).toBe("web");
    expect(window.localStorage.getItem("pld.mode")).toBe("web");
    expect(loc.pathname).toBe("/records");
  });

  it("export 與「匯出」：先關閉指令列，再執行與側欄相同的匯出動作；停在原處", () => {
    mount("/records");
    for (const cmd of ["export", "匯出"]) {
      openPalette();
      type(cmd);
      enter();
      advance(300);
      expect(document.querySelector('[data-os="palette"]')).toBeNull();
    }
    expect(exportMock.run).toHaveBeenCalledTimes(2);
    expect(loc.pathname).toBe("/records");
    expect(phase()).toBe("station");
  });

  it("指令列開著時，控制室快速鍵不作用", () => {
    mount("/os");
    openPalette();
    key("ArrowRight", {}, input());
    key("n", {}, input());
    expect(document.querySelector('[data-ch="CH-02"]')).toHaveAttribute("aria-current", "true");
    expect(loc.pathname).toBe("/os");
  });
});

describe("OsShell：轉場", () => {
  it("進入：點 HUD → entering-pre（工作站 inert＋隱藏）→ 875ms 交接 → 1200ms station；焦點在交接點移到 main；宣告開始與完成", () => {
    mount("/os");
    click(hudButton());
    expect(phase()).toBe("entering-pre");
    const st = station()!;
    expect(st.hasAttribute("inert")).toBe(true);
    expect(st.getAttribute("data-hidden")).toBe("true");
    expect(document.querySelector('[data-os="hud"]')!.getAttribute("data-active")).toBe("false");
    expect(live()).toBe("進入紀錄");
    advance(874);
    expect(phase()).toBe("entering-pre");
    advance(2);
    expect(phase()).toBe("entering-post");
    expect(st.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(document.querySelector("main#main"));
    advance(400);
    expect(phase()).toBe("station");
    expect(live()).toBe("已進入紀錄");
  });

  it("進入：交接點前的第一次點擊 → 直接到 station 且不傳給下面；之後的點擊正常", () => {
    mount("/os");
    click(hudButton());
    const underneath = vi.fn();
    document.addEventListener("click", underneath);
    act(() => {
      for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        document.body.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
      }
    });
    expect(phase()).toBe("station");
    expect(underneath).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.querySelector("main#main"));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(underneath).toHaveBeenCalledTimes(1);
    document.removeEventListener("click", underneath);
  });

  it("離開：navigate 到 /os → exiting-pre，工作站立刻消失；300ms 交接、焦點到 HUD 按鈕；900ms hub；宣告", () => {
    mount("/records");
    go("/os");
    expect(phase()).toBe("exiting-pre");
    expect(station()).toBeNull();
    expect(document.querySelector('[data-os="hud"]')!.hasAttribute("inert")).toBe(true);
    expect(live()).toBe("回到控制室");
    advance(301);
    expect(phase()).toBe("exiting-post");
    expect(document.activeElement).toBe(hudButton());
    advance(700);
    expect(phase()).toBe("hub");
    expect(live()).toBe("已回到控制室");
  });

  it("SWITCHING：頻道之間是短轉場（75ms 交接、300ms 結束）；工作站預先隱藏＋inert，控制室不顯示；焦點在交接點移到 main；宣告開始與完成", () => {
    mount("/records");
    go("/calendar");
    expect(phase()).toBe("switching-pre");
    const st = station()!;
    expect(st.hasAttribute("inert")).toBe(true);
    expect(st.getAttribute("data-hidden")).toBe("true");
    expect(document.querySelector('[data-os="hub"]')!.getAttribute("data-visible")).toBe("false");
    expect(document.querySelector('[data-os="hud"]')!.getAttribute("data-active")).toBe("false");
    expect(document.getElementById("os-overlay")!.getAttribute("data-active")).toBe("true");
    expect(live()).toBe("切換到日曆");
    expect(hubMock.props?.running).toBe(false);
    expect(hubMock.props?.mode).toBe("station");
    advance(74);
    expect(phase()).toBe("switching-pre");
    advance(2);
    expect(phase()).toBe("switching-post");
    expect(st.hasAttribute("inert")).toBe(false);
    expect(st.getAttribute("data-hidden")).toBe("false");
    expect(document.activeElement).toBe(document.querySelector("main#main"));
    advance(300);
    expect(phase()).toBe("station");
    expect(live()).toBe("已切換到日曆");
    expect(document.getElementById("os-overlay")!.getAttribute("data-active")).toBe("false");
    // 控制室選中的頻道＝最後顯示的工作站
    go("/os");
    advance(1000);
    expect(hudButton("CH-04 日曆")).toHaveAttribute("aria-current", "true");
  });

  it("SWITCHING：交接點前的輸入跳到終點並被吞掉", () => {
    mount("/records");
    go("/calendar");
    const underneath = vi.fn();
    document.addEventListener("click", underneath);
    act(() => {
      for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        document.body.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
      }
    });
    expect(phase()).toBe("station");
    expect(underneath).not.toHaveBeenCalled();
    document.removeEventListener("click", underneath);
  });

  it("同一頻道內換頁（/records → /records/63/edit）：沒有轉場，焦點移到 #main", () => {
    mount("/records");
    expect(document.activeElement).toBe(document.body);
    go("/records/63/edit");
    expect(phase()).toBe("station");
    expect(document.activeElement).toBe(document.querySelector("main#main"));
    expect(live()).toBe("");
  });

  it("減少動態效果：進出都是直接切換；焦點仍移到目的地", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    mount("/os");
    click(hudButton());
    expect(phase()).toBe("station");
    expect(document.activeElement).toBe(document.querySelector("main#main"));
    go("/os");
    expect(phase()).toBe("hub");
    expect(document.activeElement).toBe(hudButton());
  });
});

/** 可在測試中途切換的 prefers-reduced-motion（只有 reduce 這個 query 會變） */
function controllableReducedMotion() {
  let reduced = false;
  const listeners = new Set<() => void>();
  vi.spyOn(window, "matchMedia").mockImplementation(
    (q: string) =>
      ({
        get matches() {
          return q.includes("reduce") ? reduced : false;
        },
        media: q,
        addEventListener: (_t: string, l: () => void) => {
          if (q.includes("reduce")) listeners.add(l);
        },
        removeEventListener: (_t: string, l: () => void) => void listeners.delete(l),
      }) as unknown as MediaQueryList,
  );
  return (on: boolean) =>
    act(() => {
      reduced = on;
      listeners.forEach((l) => l());
    });
}

describe("OsShell：轉場進行中切換減少動態效果（X3 修正）", () => {
  it("進入：交接點之前切換 → 直接到 station，焦點移到 main#main（與一般交接點相同的規則）", () => {
    const setReduced = controllableReducedMotion();
    mount("/os");
    click(hudButton());
    advance(150);
    expect(phase()).toBe("entering-pre");
    setReduced(true);
    expect(phase()).toBe("station");
    advance(0);
    expect(document.activeElement).toBe(document.querySelector("main#main"));
  });

  it("切換（短轉場）：交接點之前切換 → 焦點移到 main#main", () => {
    const setReduced = controllableReducedMotion();
    mount("/records");
    go("/calendar");
    expect(phase()).toBe("switching-pre");
    setReduced(true);
    expect(phase()).toBe("station");
    expect(document.activeElement).toBe(document.querySelector("main#main"));
  });

  it("離開：交接點之前切換 → 直接到 hub，焦點在選中的頻道按鈕", () => {
    const setReduced = controllableReducedMotion();
    mount("/records");
    go("/os");
    expect(phase()).toBe("exiting-pre");
    advance(100);
    setReduced(true);
    expect(phase()).toBe("hub");
    expect(document.activeElement).toBe(hudButton());
  });

  it("交接點之後切換：焦點維持在 main#main", () => {
    const setReduced = controllableReducedMotion();
    mount("/os");
    click(hudButton());
    advance(1000);
    expect(phase()).toBe("entering-post");
    setReduced(true);
    expect(phase()).toBe("station");
    expect(document.activeElement).toBe(document.querySelector("main#main"));
  });
});

describe("OsShell：減少動態效果的直接切換也要宣告（§6.5）", () => {
  const reducedFromStart = () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
  };
  it("進入：開始「進入紀錄」，稍後「已進入紀錄」", () => {
    reducedFromStart();
    mount("/os");
    expect(live()).toBe("");
    click(hudButton());
    expect(phase()).toBe("station");
    expect(live()).toBe("進入紀錄");
    advance(CUT_DONE_DELAY_MS + 1);
    expect(live()).toBe("已進入紀錄");
  });
  it("離開：「回到控制室」→「已回到控制室」", () => {
    reducedFromStart();
    mount("/records");
    expect(live()).toBe("");
    go("/os");
    expect(phase()).toBe("hub");
    expect(live()).toBe("回到控制室");
    advance(CUT_DONE_DELAY_MS + 1);
    expect(live()).toBe("已回到控制室");
  });
  it("頻道之間切換：「切換到行事曆」→「已切換到行事曆」", () => {
    reducedFromStart();
    mount("/records");
    go("/calendar");
    expect(live()).toBe("切換到日曆");
    advance(CUT_DONE_DELAY_MS + 1);
    expect(live()).toBe("已切換到日曆");
  });
  it("連續操作：舊的完成宣告不會蓋掉新的開始宣告", () => {
    reducedFromStart();
    mount("/os");
    click(hudButton());
    advance(50);
    go("/os");
    expect(live()).toBe("回到控制室");
    advance(CUT_DONE_DELAY_MS + 1);
    expect(live()).toBe("已回到控制室");
  });
  it("cutAnnouncement：只有 HUB／STATION 之間與換頻道才有；開機結束、轉場狀態、沒有變化都沒有", () => {
    const hub = { kind: "HUB", gen: 0 } as const;
    const st = (ch: "CH-02" | "CH-03") => ({ kind: "STATION", ch, gen: 0 }) as const;
    expect(cutAnnouncement(hub, st("CH-02"))).toEqual({ start: "進入紀錄", done: "已進入紀錄" });
    expect(cutAnnouncement(st("CH-02"), hub)).toEqual({ start: "回到控制室", done: "已回到控制室" });
    expect(cutAnnouncement(st("CH-02"), st("CH-03"))?.start).toMatch(/^切換到/);
    expect(cutAnnouncement(st("CH-02"), st("CH-02"))).toBeNull();
    expect(cutAnnouncement(hub, hub)).toBeNull();
    expect(cutAnnouncement({ kind: "BOOT", dest: { kind: "hub" }, short: false, gen: 0 } as never, hub)).toBeNull();
    expect(cutAnnouncement(hub, { kind: "ENTERING", ch: "CH-02", handoff: false, gen: 1 })).toBeNull();
  });
  it("有轉場時的宣告不受影響（開始、完成各一次）", () => {
    mount("/os");
    click(hudButton());
    expect(live()).toBe("進入紀錄");
    settle();
    expect(live()).toBe("已進入紀錄");
  });
});

describe("OsShell：進入時工作站的掛載與預先畫好（X3 修正）", () => {
  it("點擊後工作站仍是隱藏＋inert 地掛上（與先前相同的可觀察行為）；沒有預先畫好的旗標", () => {
    mount("/os");
    click(hudButton());
    const st = station()!;
    expect(st).not.toBeNull();
    expect(st.getAttribute("data-hidden")).toBe("true");
    expect(st.hasAttribute("inert")).toBe(true);
    expect(st.getAttribute("data-prep")).toBe("false");
    expect(document.querySelector("main#main")).not.toBeNull();
  });
  it(`${STATION_PREP_MS}ms 後預先畫好（data-prep=true，仍然 hidden＋inert）；交接點後旗標消失、inert 移除`, () => {
    mount("/os");
    click(hudButton());
    const st = station()!;
    advance(STATION_PREP_MS - 1);
    expect(st.getAttribute("data-prep")).toBe("false");
    advance(2);
    expect(st.getAttribute("data-prep")).toBe("true");
    expect(st.getAttribute("data-hidden")).toBe("true");
    expect(st.hasAttribute("inert")).toBe(true);
    advance(830);
    expect(phase()).toBe("entering-post");
    expect(st.getAttribute("data-hidden")).toBe("false");
    expect(st.getAttribute("data-prep")).toBe("true"); // 合成層維持到進入轉場結束
    expect(st.hasAttribute("inert")).toBe(false);
    advance(400);
    expect(phase()).toBe("station");
    expect(st.getAttribute("data-prep")).toBe("false");
  });
  it("預先畫好之前被輸入跳到終點：旗標不會殘留", () => {
    mount("/os");
    click(hudButton());
    advance(100);
    act(() => {
      fireEvent.pointerDown(document.body);
      fireEvent.click(document.body);
    });
    advance(STATION_PREP_MS + 50);
    expect(station()!.getAttribute("data-prep")).toBe("false");
    expect(station()!.getAttribute("data-hidden")).toBe("false");
  });
  it("短轉場與離開不經過預先畫好", () => {
    mount("/records");
    go("/calendar");
    advance(60);
    expect(station()!.getAttribute("data-prep")).toBe("false");
  });
  it("os.css：預先畫好的規則只在 hidden＋prep 同時成立時才把 visibility 設回 visible，opacity 仍由 hidden 規則維持 0", () => {
    const css = fs.readFileSync(path.join(__dirname, "os.css"), "utf8");
    expect(css).toMatch(/\.os-station\[data-hidden="true"\]\[data-prep="true"\]\s*\{[^}]*visibility:\s*visible/);
    expect(css).toMatch(/\.os-station\[data-hidden="true"\]\s*\{[^}]*opacity:\s*0/);
    expect(css).not.toMatch(/\.os-station\[data-hidden="true"\]\[data-prep="true"\]\s*\{[^}]*opacity:\s*[1-9]/);
  });
});

describe("OsShell：抵達後焦點若掉到 body 會在下一幀補上（X3 修正）", () => {
  it("進入交接點：焦點被別人（模擬瀏覽器還沒讓目的地可聚焦）弄到 body → 下一幀移到 main#main", () => {
    mount("/os");
    click(hudButton());
    advance(876);
    expect(document.activeElement).toBe(document.querySelector("main#main"));
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    advance(20);
    expect(document.activeElement).toBe(document.querySelector("main#main"));
  });
  it("焦點已被使用者移到別處就不搶", () => {
    mount("/os");
    click(hudButton());
    advance(876);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    advance(20);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
  it("目的地過幾幀才可聚焦（模擬 visibility:hidden 一陣子）：逐幀重試，直到焦點真的在 main#main", () => {
    const setReduced = controllableReducedMotion();
    mount("/os");
    click(hudButton());
    advance(100);
    const main = document.querySelector("main#main") as HTMLElement;
    const real = main.focus.bind(main);
    let hiddenFrames = 6;
    vi.spyOn(main, "focus").mockImplementation((o) => {
      if (hiddenFrames > 0) return; // 瀏覽器：hidden 的元素不能聚焦，focus() 默默失敗
      real(o);
    });
    const tick = () => {
      hiddenFrames--;
      advance(17);
    };
    (document.activeElement as HTMLElement | null)?.blur(); // 真實瀏覽器：HUD 變 inert 時焦點掉到 body
    setReduced(true);
    expect(document.activeElement).toBe(document.body);
    for (let i = 0; i < 4; i++) tick();
    expect(document.activeElement).toBe(document.body);
    for (let i = 0; i < 6; i++) tick();
    expect(document.activeElement).toBe(main);
  });
  it("頻道之間切換：交接點（抵達 station）之後幾毫秒又被跳到 STATION（沒有抵達事件），重試不會被 effect cleanup 取消（r4）", () => {
    const setReduced = controllableReducedMotion();
    mount("/records");
    go("/calendar");
    advance(74);
    expect(phase()).toBe("switching-pre");
    const main = document.querySelector("main#main") as HTMLElement;
    const real = main.focus.bind(main);
    let hiddenFrames = 8;
    vi.spyOn(main, "focus").mockImplementation((o) => {
      if (hiddenFrames > 0) return; // 交接那一刻 main 仍 hidden，focus() 默默失敗
      real(o);
    });
    (document.activeElement as HTMLElement | null)?.blur();
    advance(2); // 交接點：抵達 station，排好逐幀重試
    expect(phase()).toBe("switching-post");
    setReduced(true); // 重試的第一幀之前，被跳到終點 STATION（此次沒有抵達事件）
    expect(phase()).toBe("station");
    for (let i = 0; i < 14; i++) {
      hiddenFrames--;
      advance(17);
    }
    expect(document.activeElement).toBe(main);
  });
  it("重試有上限（永遠不可聚焦就停，不無限排 rAF）", () => {
    const setReduced = controllableReducedMotion();
    mount("/os");
    click(hudButton());
    advance(100);
    const main = document.querySelector("main#main") as HTMLElement;
    const spy = vi.spyOn(main, "focus").mockImplementation(() => {});
    (document.activeElement as HTMLElement | null)?.blur();
    setReduced(true);
    advance(17 * 100);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(FOCUS_RETRY_FRAMES + 2);
  });
  it("離開交接點：焦點掉到 body → 下一幀回到選中的頻道按鈕", () => {
    mount("/records");
    go("/os");
    advance(301);
    expect(document.activeElement).toBe(hudButton());
    (document.activeElement as HTMLElement).blur();
    advance(20);
    expect(document.activeElement).toBe(hudButton());
  });
});

describe("OsShell：離開確認（useBlocker，E2）", () => {
  it("Esc：被攔下時路由不變、phase 維持 station、不播轉場；留下之後仍是 station；離開才播離開轉場", async () => {
    mount("/form");
    expect(phase()).toBe("station");
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(screen.getByTestId("blocker").textContent).toBe("blocked");
    expect(loc.pathname).toBe("/form");
    expect(phase()).toBe("station");
    click(screen.getByRole("button", { name: "留下" }));
    expect(loc.pathname).toBe("/form");
    expect(phase()).toBe("station");
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    click(screen.getByRole("button", { name: "離開" }));
    expect(loc.pathname).toBe("/os");
    expect(phase()).toBe("exiting-pre");
  });

  it("◀ HUB 與指令列導覽同樣先被攔下", () => {
    mount("/form");
    click(document.querySelector<HTMLElement>('[data-os="back"]')!);
    expect(screen.getByTestId("blocker").textContent).toBe("blocked");
    expect(loc.pathname).toBe("/form");
    expect(phase()).toBe("station");
    click(screen.getByRole("button", { name: "留下" }));

    key("k", { ctrlKey: true });
    act(() => {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "dash" } });
    });
    key("Enter", {}, screen.getByRole("combobox"));
    advance(300);
    expect(document.querySelector('[data-os="palette"]')).toBeNull();
    expect(screen.getByTestId("blocker").textContent).toBe("blocked");
    expect(loc.pathname).toBe("/form");
    expect(phase()).toBe("station");
  });
});

describe("OsShell：離開 OS 模式（D5）", () => {
  it("控制室的 EXIT TO WEB：setMode web、寫入 pld.mode、導向 /dashboard", () => {
    mount("/os");
    click(screen.getByRole("button", { name: "EXIT TO WEB" }));
    expect(getMode()).toBe("web");
    expect(window.localStorage.getItem("pld.mode")).toBe("web");
    expect(loc.pathname).toBe("/dashboard");
  });
});

describe("OsShell：從工作站離開 OS 模式一定先經過 router（紅線 4）", () => {
  const exitCmd = () => {
    key("k", { ctrlKey: true });
    act(() => {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "exit" } });
    });
    key("Enter", {}, screen.getByRole("combobox"));
    advance(300);
  };

  it("指令 exit：先導覽到 /os（被 useBlocker 攔下 → 取消＝模式不變、路由不變、沒有轉場）", () => {
    mount("/form");
    exitCmd();
    expect(screen.getByTestId("blocker").textContent).toBe("blocked");
    expect(getMode()).toBe("os");
    expect(loc.pathname).toBe("/form");
    expect(phase()).toBe("station");
    click(screen.getByRole("button", { name: "留下" }));
    advance(1000);
    expect(getMode()).toBe("os");
    expect(loc.pathname).toBe("/form");
    expect(phase()).toBe("station");
  });

  it("指令 exit：放行 → setMode web，回到原路徑（含 query），state 已清除", async () => {
    mount("/form");
    exitCmd();
    await act(async () => {
      screen.getByRole("button", { name: "離開" }).click();
    });
    expect(getMode()).toBe("web");
    expect(window.localStorage.getItem("pld.mode")).toBe("web");
    expect(loc.pathname).toBe("/form");
    expect(loc.state).toBeNull();
  });

  it("沒有 blocker 的頁面：保留路徑與 query", () => {
    mount("/records");
    go("/records?open=5");
    settle();
    exitCmd();
    expect(getMode()).toBe("web");
    expect(loc.pathname + loc.search).toBe("/records?open=5");
  });

  it("上一頁（POP）回到帶 exitToWeb 的 /os 紀錄：不切換模式", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <Root />,
          children: [
            { path: "records", element: page("records") },
            { path: "os", element: null },
          ],
        },
      ],
      { initialEntries: ["/records", { pathname: "/os", state: { exitToWeb: { to: "/records" } } }, "/records"], initialIndex: 2 },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    act(() => void router.navigate(-1));
    expect(loc.pathname).toBe("/os");
    expect(getMode()).toBe("os");
    expect(phase()).not.toBeUndefined();
  });
});

describe("OsShell：裝置門檻（§7）", () => {
  const gate = () => document.querySelector('[data-os="device-gate"]');
  const host = () => document.querySelector('[data-os="stage-host"]') as HTMLElement | null;

  it("寬度 < 1024 或高度 < 600：終端機訊息與「改用網頁模式」蓋在上面；舞台保留但隱藏＋inert", () => {
    mount("/records");
    expect(gate()).toBeNull();
    for (const [w, h] of [
      [1000, 700],
      [1280, 500],
      [1023, 768],
    ] as const) {
      setViewport(w, h);
      expect(gate(), `${w}x${h}`).not.toBeNull();
      expect(gate()!.textContent).toContain("PLD/OS 需要桌面終端機（≥1024×600）");
      expect(host()).not.toBeNull();
      expect(host()!.hidden).toBe(true);
      expect(host()!.hasAttribute("inert")).toBe(true);
      expect(host()!.getAttribute("aria-hidden")).toBe("true");
    }
    setViewport(1024, 600);
    expect(gate()).toBeNull();
    expect(host()!.hidden).toBe(false);
    expect(host()!.hasAttribute("inert")).toBe(false);
    expect(phase()).toBe("station");
  });

  it("縮小再放大：表單內容與頁面實例都還在（同一個 DOM 節點）；3D 暫停（running=false）、快速鍵不作用", () => {
    mount("/form");
    const field = screen.getByLabelText("欄位") as HTMLInputElement;
    act(() => {
      fireEvent.change(field, { target: { value: "未儲存的內容" } });
    });
    setViewport(900, 700);
    expect(screen.getByLabelText("欄位")).toBe(field);
    key("k", { ctrlKey: true });
    expect(document.querySelector('[data-os="palette"]')).toBeNull();
    setViewport(1440, 900);
    expect(screen.getByLabelText("欄位")).toBe(field);
    expect(field.value).toBe("未儲存的內容");
    expect(phase()).toBe("station");
  });

  it("縮小時關閉開著的指令列、暫停 3D", () => {
    mount("/os");
    key("k", { ctrlKey: true });
    expect(document.querySelector('[data-os="palette"]')).not.toBeNull();
    setViewport(900, 700);
    expect(document.querySelector('[data-os="palette"]')).toBeNull();
    expect(hubMock.props?.running).toBe(false);
    key("ArrowRight");
    setViewport(1440, 900);
    expect(document.querySelector('[data-ch="CH-02"]')).toHaveAttribute("aria-current", "true");
  });

  it("冷啟動就太小：舞台完全不掛載；放大後直接落在目前路徑的狀態（沒有轉場）", () => {
    setViewport(900, 700);
    mount("/records");
    expect(gate()).not.toBeNull();
    expect(host()).toBeNull();
    expect(document.querySelector("main#main")).toBeNull();
    expect(screen.queryByText("records-page")).toBeNull();
    expect(hubMock.props).toBeNull();
    setViewport(1440, 900);
    expect(phase()).toBe("station");
    expect(screen.getByText("records-page")).toBeInTheDocument();
    expect(station()!.getAttribute("data-hidden")).toBe("false");
  });

  it("控制室路徑被門檻擋住、放大後直接是 hub 並聚焦選中的按鈕", () => {
    setViewport(900, 700);
    mount("/os");
    setViewport(1440, 900);
    expect(phase()).toBe("hub");
    expect(document.activeElement).toBe(hudButton());
  });

  it("「改用網頁模式」（乾淨頁面）：走 route-first 的 exitToWeb，模式 web、停在同一路徑", () => {
    mount("/records");
    setViewport(900, 700);
    click(document.querySelector<HTMLElement>('[data-os="device-gate-web"]')!);
    expect(getMode()).toBe("web");
    expect(window.localStorage.getItem("pld.mode")).toBe("web");
    expect(loc.pathname).toBe("/records");
  });

  it("「改用網頁模式」（在控制室）：導向 /dashboard", () => {
    mount("/os");
    setViewport(900, 700);
    click(document.querySelector<HTMLElement>('[data-os="device-gate-web"]')!);
    expect(getMode()).toBe("web");
    expect(loc.pathname).toBe("/dashboard");
  });

  it("「改用網頁模式」（未儲存的表單）：先出現確認；取消 → 門檻與表單都還在、模式不變；離開 → 切換", async () => {
    mount("/form");
    setViewport(900, 700);
    click(document.querySelector<HTMLElement>('[data-os="device-gate-web"]')!);
    expect(screen.getByTestId("blocker").textContent).toBe("blocked");
    expect(getMode()).toBe("os");
    expect(gate()).not.toBeNull();
    click(screen.getByRole("button", { name: "留下", hidden: true }));
    expect(getMode()).toBe("os");
    expect(loc.pathname).toBe("/form");
    expect(gate()).not.toBeNull();
    expect(screen.getByLabelText("欄位", { selector: "input" })).toBeInTheDocument();
    click(document.querySelector<HTMLElement>('[data-os="device-gate-web"]')!);
    await act(async () => {
      screen.getByRole("button", { name: "離開", hidden: true }).click();
    });
    expect(getMode()).toBe("web");
    expect(loc.pathname).toBe("/form");
  });
});

describe("OsShell：WebGL 後備（§7）", () => {
  it("不支援（從工作站載入）：toast、setMode web（寫入 pld.mode=web）、路徑不變、這次載入維持 cyber（旗標）、不寫 pld.theme", () => {
    webglMock.available.mockReturnValue(false);
    const spy = vi.spyOn(notify, "error");
    mount("/records");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(WEBGL_FALLBACK_TEXT);
    expect(getMode()).toBe("web");
    expect(window.localStorage.getItem("pld.mode")).toBe("web");
    expect(loc.pathname).toBe("/records");
    expect(shouldKeepCyberOnExit()).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(themeMock.switchTheme).not.toHaveBeenCalled();
  });

  it("不支援（從控制室載入）：同上，並導向 /dashboard", () => {
    webglMock.available.mockReturnValue(false);
    mount("/os");
    expect(getMode()).toBe("web");
    expect(loc.pathname).toBe("/dashboard");
  });

  it("卸載時：旗標為 true 維持 cyber（不寫 pld.theme）；下一次正常掛載重設旗標、卸載後依偏好還原", () => {
    webglMock.available.mockReturnValue(false);
    const a = mount("/records");
    a.unmount();
    expect(document.documentElement.dataset.theme).toBe("cyber");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    webglMock.available.mockReturnValue(true);
    const b = mount("/records");
    expect(shouldKeepCyberOnExit()).toBe(false);
    b.unmount();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("3D 層回報失敗（初始化失敗／context 遺失沒恢復）：同樣的後備，只會觸發一次", () => {
    const spy = vi.spyOn(notify, "error");
    mount("/os");
    expect(typeof hubMock.props?.onFailure).toBe("function");
    act(() => (hubMock.props!.onFailure as () => void)());
    act(() => (hubMock.props!.onFailure as () => void)());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getMode()).toBe("web");
    expect(loc.pathname).toBe("/dashboard");
    expect(shouldKeepCyberOnExit()).toBe(true);
  });
});

describe("OsShell：開機（X2）", () => {
  it("直接載入控制室：先開機（phase=boot、HUD 未啟用）；播完（4s）進控制室並寫 pld.os.boot", () => {
    bootMock.real = true;
    mount("/os");
    expect(phase()).toBe("boot");
    expect(window.sessionStorage.getItem("pld.os.boot")).toBeNull();
    advance(3899);
    expect(phase()).toBe("boot");
    advance(1);
    expect(phase()).toBe("hub");
    expect(window.sessionStorage.getItem("pld.os.boot")).toBe("1");
    expect(document.activeElement).toBe(hudButton());
  });

  it("開機中第一次按鍵＝跳過：進控制室，那次按鍵不傳給下面", () => {
    bootMock.real = true;
    mount("/os");
    const underneath = vi.fn();
    document.addEventListener("keydown", underneath);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "3", code: "Digit3", bubbles: true, cancelable: true }));
    });
    document.removeEventListener("keydown", underneath);
    expect(phase()).toBe("hub");
    expect(underneath).not.toHaveBeenCalled();
    expect(loc.pathname).toBe("/os");
    expect(window.sessionStorage.getItem("pld.os.boot")).toBe("1");
  });

  it("深層連結（直接載入工作站）：沒有開機、不寫 key；之後回控制室也不開機", () => {
    bootMock.real = true;
    mount("/records");
    expect(phase()).toBe("station");
    expect(window.sessionStorage.getItem("pld.os.boot")).toBeNull();
    go("/os");
    expect(phase()).toBe("exiting-pre");
    settle();
    expect(phase()).toBe("hub");
  });

  it("已開過機的分頁再掛載控制室：短開機（1s）", () => {
    bootMock.real = true;
    window.sessionStorage.setItem("pld.os.boot", "1");
    mount("/os");
    expect(phase()).toBe("boot");
    advance(1000);
    expect(phase()).toBe("hub");
  });
});

describe("OsShell：crt 指令", () => {
  it("crt max 立刻生效並寫入 pld.os.crt；crt（無參數）顯示目前強度", () => {
    mount("/os");
    key("k", { ctrlKey: true });
    const input = () => screen.getByRole("combobox");
    act(() => {
      fireEvent.change(input(), { target: { value: "crt" } });
    });
    key("Enter", {}, input());
    expect(screen.getByRole("alert").textContent).toContain("標準");
    act(() => {
      fireEvent.change(input(), { target: { value: "crt max" } });
    });
    key("Enter", {}, input());
    expect(window.localStorage.getItem("pld.os.crt")).toBe("max");
    window.localStorage.removeItem("pld.os.crt");
  });
});
