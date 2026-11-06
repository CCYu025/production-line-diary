import { toISODate } from "@shared/aggregate";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBootForTest } from "@/app/BootScreen";
import { resetModeForTest, setMode } from "@/lib/mode";
import type { DiaryRecord } from "@/lib/types";

/*
 * X2 控制室：即時訊號標籤、新異常公告、CRT 切換、螢幕點選、待機巡視、開機屬性。
 * 3D 層換成空殼（記下收到的 props）；紀錄查詢換成可控的替身。
 */
const hubMock = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
vi.mock("./hub/HubCanvas", () => ({
  default: (props: Record<string, unknown>) => {
    hubMock.props = props;
    return null;
  },
  WebglFallback: () => null,
}));
const bootMock = vi.hoisted(() => ({ real: false }));
vi.mock("./director/boot", async (orig) => {
  const actual = await orig<typeof import("./director/boot")>();
  return {
    ...actual,
    decideBoot: (i: Parameters<typeof actual.decideBoot>[0]) => (bootMock.real ? actual.decideBoot(i) : null),
    // B1（X4）：和開機一起預設關閉（bootMock.real 打開時才有）
    decideB1: (i: Parameters<typeof actual.decideB1>[0]) => (bootMock.real ? actual.decideB1(i) : false),
  };
});
vi.mock("@/app/useExportAction", () => ({ useExportAction: () => ({ run: vi.fn(), pending: false }) }));
vi.mock("./webgl", async (orig) => ({ ...(await orig<typeof import("./webgl")>()), webglAvailable: () => true }));
const apiMock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, listRecords: apiMock.list } };
});

import { resetAlertsForTest } from "./hub/alerts";
import { resetCrtForTest } from "./crt/settings";
import { resetBootDoneForTest } from "./director/boot";
import OsShell from "./OsShell";

let loc: ReturnType<typeof useLocation>;
function Root() {
  loc = useLocation();
  return <OsShell />;
}

let nextId = 1;
function rec(over: Partial<DiaryRecord> = {}): DiaryRecord {
  return {
    id: nextId++,
    date: toISODate(new Date()),
    shift: "早",
    time: "08:00",
    duration: 5,
    equipment: "F1",
    category: "機械",
    problem: "卡料",
    severity: "輕微",
    action: "",
    rootCause: null,
    status: "已解決",
    productCode: null,
    materialCategory: null,
    photos: [],
    updatedAt: null,
    deleted: false,
    deletedAt: null,
    ...over,
  } as DiaryRecord;
}

let router: ReturnType<typeof createMemoryRouter>;
function mount(initial: string) {
  router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Root />,
        children: [
          { path: "dashboard", element: <div>dash</div> },
          { path: "records", element: <div>records</div> },
          { path: "records/new", element: <div>new</div> },
          { path: "report", element: <div>report</div> },
          { path: "os", element: null },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const phase = () => document.documentElement.dataset.osPhase;
const flush = (ms = 20) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const key = (k: string) =>
  act(() => {
    fireEvent.keyDown(document.body, { key: k });
  });
const hudButton = (name: string) => screen.getByRole("button", { name });
/** 通過 B1（PRESS ANY KEY）：一次完整的按鍵手勢（keydown＋keyup） */
const passB1 = () =>
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "x", code: "KeyX", bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "x", code: "KeyX", bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetBootForTest();
  resetModeForTest();
  resetCrtForTest();
  resetBootDoneForTest();
  resetAlertsForTest();
  setMode("os");
  document.documentElement.removeAttribute("data-theme");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  hubMock.props = null;
  bootMock.real = false;
  apiMock.list.mockReset();
  apiMock.list.mockResolvedValue([]);
  Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
});

describe("HUD 頻道按鈕：即時訊號", () => {
  it("資料載入後，按鈕文字與 accessible name 是「CH-02 紀錄 · 今日 N」", async () => {
    apiMock.list.mockResolvedValue([
      rec({ status: "待處理" }),
      rec({ status: "已解決", equipment: "F2" }),
      rec({ deleted: true }),
      rec({ date: "2020-01-01" }),
    ]);
    mount("/os");
    await flush();
    expect(hudButton("CH-01 儀表板 · 待處理 1")).toBeInTheDocument();
    expect(hudButton("CH-02 紀錄 · 今日 2")).toBeInTheDocument();
    expect(hudButton("CH-03 新增 · READY")).toBeInTheDocument();
    expect(hudButton(`CH-04 日曆 · 今日 2`)).toBeInTheDocument();
    expect(hudButton("CH-06 回收桶 · 1 筆")).toBeInTheDocument();
    expect(hudButton("CH-07 設定 · 2 台")).toBeInTheDocument();
  });

  it("窄版（< 1440px）的精簡文字「CH-02 紀錄 2」與完整文字都在按鈕裡（CSS 擇一顯示）；accessible name 永遠是完整的", async () => {
    apiMock.list.mockResolvedValue([rec(), rec({ equipment: "F2" })]);
    mount("/os");
    await flush();
    const b = hudButton("CH-02 紀錄 · 今日 2");
    expect(b.querySelector(".os-hud-full")!.textContent).toBe("CH-02 紀錄 · 今日 2");
    expect(b.querySelector(".os-hud-compact")!.textContent).toBe("CH-02 紀錄 2");
    expect(b.querySelector(".os-hud-compact")!.textContent).not.toContain("今日");
    expect(b.getAttribute("aria-label")).toBe("CH-02 紀錄 · 今日 2");
  });

  it("資料還沒載入：只有名稱", () => {
    apiMock.list.mockReturnValue(new Promise(() => {}));
    mount("/os");
    expect(hudButton("CH-02 紀錄")).toBeInTheDocument();
    expect(hudButton("CH-05 報表")).toBeInTheDocument();
  });

  it("數字是週期性更新的：HUD 內沒有任何 aria-live", async () => {
    apiMock.list.mockResolvedValue([rec({ status: "待處理" })]);
    mount("/os");
    await flush();
    expect(document.querySelector('[data-os="hud"] [aria-live]')).toBeNull();
    for (const b of document.querySelectorAll('[data-os="hud-ch"]')) expect(b.closest("[aria-live]")).toBeNull();
  });

  it("3D 層收到同一份訊號（螢幕貼圖內容）", async () => {
    apiMock.list.mockResolvedValue([rec({ status: "待處理" })]);
    mount("/os");
    await flush();
    expect(hubMock.props?.signals["CH-01"].big).toBe("1");
    expect(hubMock.props?.blips).toHaveLength(1);
  });
});

describe("新異常公告", () => {
  it("專用的 aria-live polite 區域；進入 HUB 時既有的紀錄不算，之後新增的才公告", async () => {
    apiMock.list.mockResolvedValue([rec({ id: 1, equipment: "F1" })]);
    mount("/os");
    await flush();
    const region = document.querySelector('[data-os="anomaly-live"]')!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    expect(hubMock.props?.alerts).toEqual([]);

    apiMock.list.mockResolvedValue([rec({ id: 1, equipment: "F1" }), rec({ id: 2, equipment: "F3", severity: "嚴重", status: "待處理" })]);
    await flush(30_000);
    expect(region.textContent).toBe("新紀錄：F3（嚴重）");
    expect(hubMock.props?.alerts).toEqual([{ id: 2, machine: "F3", severity: "嚴重" }]);
    // 一般的轉場宣告區域不被異常公告污染
    expect(document.querySelector('[data-os="live"]')!.textContent).not.toContain("新紀錄");
  });

  it("只在 HUB 且分頁可見時才重抓（離開控制室後停止）", async () => {
    mount("/os");
    await flush();
    const before = apiMock.list.mock.calls.length;
    await flush(30_000);
    expect(apiMock.list.mock.calls.length).toBeGreaterThan(before);
    act(() => {
      key("2");
    });
    await flush(1500);
    expect(phase()).toBe("station");
    const atStation = apiMock.list.mock.calls.length;
    await flush(90_000);
    expect(apiMock.list.mock.calls.length).toBe(atStation);
  });
});

describe("未確認的新異常警示", () => {
  const withNew = async () => {
    apiMock.list.mockResolvedValue([rec({ id: 1, equipment: "F1" })]);
    mount("/os");
    await flush();
    expect(hubMock.props?.alerts).toEqual([]); // 第一次載入不算
    apiMock.list.mockResolvedValue([rec({ id: 1, equipment: "F1" }), rec({ id: 2, equipment: "F3", severity: "重大", status: "待處理" })]);
    await flush(30_000);
    expect(hubMock.props?.alerts).toHaveLength(1);
  };

  it("進入 CH-03 不確認；回到控制室警示仍在，公告不重複", async () => {
    await withNew();
    act(() => {
      key("3");
    });
    await flush(1500);
    expect(phase()).toBe("station");
    expect(hubMock.props?.alerts).toHaveLength(1);
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    await flush(2500);
    expect(phase()).toBe("hub");
    expect(hubMock.props?.alerts).toHaveLength(1);
    expect(document.querySelector('[data-os="anomaly-live"]')!.textContent).toBe("");
  });

  it("進入 CH-02 確認；回到控制室警示消失", async () => {
    await withNew();
    act(() => {
      key("2");
    });
    await flush(1500);
    expect(hubMock.props?.alerts).toEqual([]);
  });

  it("進入 CH-01 確認", async () => {
    await withNew();
    act(() => {
      key("1");
    });
    await flush(1500);
    expect(hubMock.props?.alerts).toEqual([]);
  });
});

describe("CRT 三段切換", () => {
  it("狀態列有標示的群組與三個真正的按鈕（aria-pressed）；點選立即生效並寫入", () => {
    mount("/os");
    const group = screen.getByRole("group", { name: "CRT 強度" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["關", "標準", "濃"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    expect(group.closest('[data-os="statusbar"]')).not.toBeNull();
    const root = document.querySelector('[data-os="root"]') as HTMLElement;
    expect(root.dataset.crt).toBe("std");
    expect(root.style.getPropertyValue("--os-crt-stripe")).not.toBe("");

    act(() => buttons[2]!.click());
    expect(window.localStorage.getItem("pld.os.crt")).toBe("max");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    expect(root.dataset.crt).toBe("max");
    expect(hubMock.props?.level).toBe("max");

    act(() => buttons[0]!.click());
    expect(root.dataset.crt).toBe("off");
    expect(root.style.getPropertyValue("--os-crt-stripe")).toBe("");
    expect(hubMock.props?.level).toBe("off");
  });
});

describe("螢幕點選（只在 HUB）", () => {
  it("點到螢幕＝和 HUD 按鈕同一路徑：選取＋進入", () => {
    mount("/os");
    expect(hubMock.props?.pickable).toBe(true);
    act(() => hubMock.props!.onPick("CH-05"));
    expect(loc.pathname).toBe("/report");
    expect(phase()).toBe("entering-pre");
    expect(hubMock.props?.channel.id).toBe("CH-05");
  });

  it("工作站、轉場中、開機中不可點選", () => {
    mount("/os");
    act(() => hubMock.props!.onPick("CH-02"));
    expect(hubMock.props?.pickable).toBe(false);
    advance(1300);
    expect(phase()).toBe("station");
    expect(hubMock.props?.pickable).toBe(false);
  });

  it("離開轉場過了交接點（exiting-post）：和 HUD 鍵一樣可以點螢幕", () => {
    mount("/records");
    act(() => {
      void router.navigate("/os");
    });
    expect(phase()).toBe("exiting-pre");
    expect(hubMock.props?.pickable).toBe(false);
    advance(300);
    expect(phase()).toBe("exiting-post");
    expect(hubMock.props?.pickable).toBe(true);
    act(() => hubMock.props!.onPick("CH-05"));
    expect(loc.pathname).toBe("/report");
  });

  it("開機中不可點選", () => {
    bootMock.real = true;
    mount("/os");
    expect(phase()).toBe("boot");
    expect(hubMock.props?.pickable).toBe(false);
  });
});

describe("待機巡視（60 秒無輸入）", () => {
  it("60 秒後 patrolling；任何按鍵立刻結束，而且那次按鍵照常作用（不被吞掉）", () => {
    mount("/os");
    advance(59_999);
    expect(hubMock.props?.patrolling).toBe(false);
    advance(1);
    expect(hubMock.props?.patrolling).toBe(true);
    key("ArrowRight");
    expect(hubMock.props?.patrolling).toBe(false);
    // 選取也移動了（→ CH-03）：輸入沒有被吞掉
    expect(hudButton("CH-03 新增").getAttribute("aria-current")).toBe("true");
  });

  it("巡視中點 HUD 按鈕：照常進入頻道", () => {
    mount("/os");
    advance(60_000);
    expect(hubMock.props?.patrolling).toBe(true);
    act(() => hudButton("CH-02 紀錄").click());
    expect(hubMock.props?.patrolling).toBe(false);
    expect(loc.pathname).toBe("/records");
    expect(phase()).toBe("entering-pre");
  });

  it("滾輪也結束巡視", () => {
    mount("/os");
    advance(60_000);
    act(() => {
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    });
    expect(hubMock.props?.patrolling).toBe(false);
  });

  it("只在 HUB：工作站裡不巡視", () => {
    mount("/records");
    advance(120_000);
    expect(hubMock.props?.patrolling).toBe(false);
  });

  it("減少動態效果：不巡視", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    mount("/os");
    advance(120_000);
    expect(hubMock.props?.patrolling).toBe(false);
    expect(hubMock.props?.reduced).toBe(true);
  });
});

describe("開機：輸入與減少動態效果", () => {
  it("跳過開機的那次 keydown 與它的 keyup 都不傳給下面", () => {
    bootMock.real = true;
    mount("/os");
    passB1();
    const seen: string[] = [];
    const on = (e: Event) => seen.push(e.type);
    document.addEventListener("keydown", on);
    document.addEventListener("keyup", on);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "3", code: "Digit3", bubbles: true, cancelable: true }));
    });
    expect(phase()).toBe("hub");
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "3", code: "Digit3", bubbles: true, cancelable: true }));
    });
    // 之後的按鍵照常傳遞
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "3", code: "Digit3", bubbles: true, cancelable: true }));
    });
    document.removeEventListener("keydown", on);
    document.removeEventListener("keyup", on);
    expect(seen).toEqual(["keyup"]);
  });

  it("開機中打開「減少動態效果」：直接跳到結束，不吞輸入、寫入開機 key", () => {
    bootMock.real = true;
    let reduce = false;
    const listeners = new Set<() => void>();
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          get matches() {
            return q.includes("reduce") && reduce;
          },
          media: q,
          addEventListener: (_: string, fn: () => void) => listeners.add(fn),
          removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
        }) as unknown as MediaQueryList,
    );
    mount("/os");
    expect(phase()).toBe("boot");
    passB1();
    const seen: string[] = [];
    const on = (e: Event) => seen.push(e.type);
    document.addEventListener("keydown", on);
    reduce = true;
    act(() => Array.from(listeners).forEach((l) => l()));
    expect(phase()).toBe("hub");
    expect(window.sessionStorage.getItem("pld.os.boot")).toBe("1");
    // 輸入閘沒有被啟動：之後的按鍵正常傳遞
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "x", code: "KeyX", bubbles: true, cancelable: true }));
    });
    document.removeEventListener("keydown", on);
    expect(seen).toEqual(["keydown"]);
  });
});

describe("開機：3D 層的屬性", () => {
  it("完整開機帶真實計數；播完後 boot 變 null", async () => {
    bootMock.real = true;
    apiMock.list.mockResolvedValue([rec({ equipment: "F1" }), rec({ equipment: "F2" }), rec({ equipment: "F2" }), rec({ deleted: true, equipment: "F9" })]);
    mount("/os");
    await flush();
    passB1();
    expect(hubMock.props?.boot).toBe("full");
    expect(hubMock.props?.bootCounts).toEqual({ machines: 2, records: 3 });
    await flush(4000);
    expect(phase()).toBe("hub");
    expect(hubMock.props?.boot).toBeNull();
  });

  it("再次掛載＝短開機", () => {
    bootMock.real = true;
    window.sessionStorage.setItem("pld.os.boot", "1");
    mount("/os");
    expect(hubMock.props?.boot).toBe("short");
  });

  it("減少動態效果：沒有開機", () => {
    bootMock.real = true;
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    mount("/os");
    // B1 保留（啟用音效）；手勢之後沒有 B2，直接控制室
    expect(phase()).toBe("boot");
    expect(document.querySelector('[data-os="b1"]')).not.toBeNull();
    passB1();
    expect(phase()).toBe("hub");
    expect(hubMock.props?.boot).toBeNull();
    expect(window.sessionStorage.getItem("pld.os.boot")).toBeNull();
  });
});
