import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBootForTest } from "@/app/BootScreen";
import { resetModeForTest, setMode } from "@/lib/mode";

/*
 * X4 音效：B1（PRESS ANY KEY）、第一次手勢啟用、狀態列按鈕、M 鍵、sound 指令、事件接線。
 * 3D 層換成空殼；AudioContext 換成假的（jsdom 沒有 Web Audio）。
 */
vi.mock("./hub/HubCanvas", () => ({ default: () => null, WebglFallback: () => null }));
const bootMock = vi.hoisted(() => ({ real: false }));
vi.mock("./director/boot", async (orig) => {
  const actual = await orig<typeof import("./director/boot")>();
  return {
    ...actual,
    decideBoot: (i: Parameters<typeof actual.decideBoot>[0]) => (bootMock.real ? actual.decideBoot(i) : null),
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
import { AudioEngine, setAudioEngineForTest } from "./audio/engine";
import { resetSoundForTest, SOUND_STORAGE_KEY } from "./audio/settings";
import { asContext, FakeAudioContext } from "./audio/testUtils";
import OsShell from "./OsShell";

let loc: ReturnType<typeof useLocation>;
function Root() {
  loc = useLocation();
  return <OsShell />;
}

let ctxs: FakeAudioContext[];
let allowRunning: boolean;
let engine: AudioEngine;
let plays: Array<{ id: string; delay: number; cancel: ReturnType<typeof vi.fn> }>;

function mount(initial: string) {
  const router = createMemoryRouter(
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
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const kd = (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, ...init }));
  });
const gesture = (key = "x") => {
  kd(key);
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keyup", { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true }));
  });
};
const b1 = () => document.querySelector('[data-os="b1"]');
const sndButton = () => document.querySelector<HTMLButtonElement>('[data-os="sound"]')!;
const ids = () => plays.map((p) => p.id);

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetBootForTest();
  resetModeForTest();
  resetCrtForTest();
  resetBootDoneForTest();
  resetAlertsForTest();
  resetSoundForTest();
  setMode("os");
  document.documentElement.removeAttribute("data-theme");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  bootMock.real = false;
  apiMock.list.mockReset();
  apiMock.list.mockResolvedValue([]);
  Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
  ctxs = [];
  allowRunning = true;
  engine = new AudioEngine({
    createContext: () => {
      const c = new FakeAudioContext();
      c.allowRunning = allowRunning;
      ctxs.push(c);
      return asContext(c);
    },
  });
  plays = [];
  setAudioEngineForTest(engine);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setAudioEngineForTest(null);
  Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
});

/** 之後的 play 只記錄、不真的播 */
const recordPlays = () =>
  vi.spyOn(engine, "play").mockImplementation((id, delay = 0) => {
    const cancel = vi.fn();
    plays.push({ id, delay, cancel });
    return { cancel };
  });

describe("B1：PRESS ANY KEY", () => {
  it("完整開機前出現：PRESS ANY KEY＋游標、sr-only 文字；等手勢（怎麼等都不開機）；沒有 AudioContext", () => {
    bootMock.real = true;
    mount("/os");
    expect(b1()).not.toBeNull();
    expect(b1()!.textContent).toContain("PRESS ANY KEY▮");
    expect(screen.getByText("PLD/OS 1995，按任意鍵開始")).toBeInTheDocument();
    expect(b1()!.querySelector("p")!.getAttribute("aria-hidden")).toBe("true");
    advance(20_000);
    expect(phase()).toBe("boot");
    expect(b1()).not.toBeNull();
    expect(ctxs).toHaveLength(0);
  });

  it("只按修飾鍵不算（也不啟用音效）；一般鍵算：啟用音效＋開始 B2，那次按鍵不傳給下面", () => {
    bootMock.real = true;
    mount("/os");
    for (const k of ["Shift", "Control", "Alt", "Meta"]) gesture(k);
    expect(b1()).not.toBeNull();
    expect(ctxs).toHaveLength(0);
    const underneath = vi.fn();
    document.addEventListener("keydown", underneath);
    gesture("a");
    document.removeEventListener("keydown", underneath);
    expect(b1()).toBeNull();
    expect(underneath).not.toHaveBeenCalled();
    expect(ctxs).toHaveLength(1);
    expect(engine.getSnapshot().status).toBe("running");
    // B2 開始：再按一次＝跳過
    advance(500);
    gesture("b");
    expect(phase()).toBe("hub");
  });

  it("點擊也算", () => {
    bootMock.real = true;
    mount("/os");
    act(() => {
      for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) document.body.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
    });
    expect(b1()).toBeNull();
    expect(ctxs).toHaveLength(1);
  });

  it("B2 開始時播開機音；跳過＝30ms 淡出（取消）", () => {
    bootMock.real = true;
    mount("/os");
    recordPlays();
    gesture("a");
    expect(ids()).toEqual(["boot"]);
    advance(500);
    gesture("b");
    expect(plays[0]!.cancel).toHaveBeenCalledWith(30);
    expect(ids()).toEqual(["boot"]);
  });

  it("Esc 算數；但 Chrome 不把 Esc 當使用者啟用：音效 pending（SND …），下一次手勢才出聲", () => {
    bootMock.real = true;
    allowRunning = false;
    mount("/os");
    gesture("Escape");
    expect(b1()).toBeNull();
    expect(engine.getSnapshot().status).toBe("pending");
    advance(4000);
    expect(phase()).toBe("hub");
    expect(sndButton().textContent).toBe("SND …");
    allowRunning = true;
    ctxs[0]!.allowRunning = true;
    gesture("z");
    expect(engine.getSnapshot().status).toBe("running");
    expect(sndButton().textContent).toBe("SND ON");
  });

  it("減少動態效果：B1 保留；手勢之後直接控制室（沒有 B2、沒有開機音）", () => {
    bootMock.real = true;
    vi.spyOn(window, "matchMedia").mockImplementation((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
    mount("/os");
    expect(b1()).not.toBeNull();
    recordPlays();
    gesture("a");
    expect(b1()).toBeNull();
    expect(phase()).toBe("hub");
    expect(ids()).not.toContain("boot");
  });

  it("短開機沒有 B1；第一次手勢（不被吞掉）才啟用音效", () => {
    bootMock.real = true;
    window.sessionStorage.setItem("pld.os.boot", "1");
    mount("/os");
    expect(b1()).toBeNull();
    expect(ctxs).toHaveLength(0);
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    gesture("a"); // 短開機被這次手勢跳過（輸入閘吃掉），但音效仍啟用
    document.removeEventListener("keydown", seen);
    expect(ctxs).toHaveLength(1);
    expect(phase()).toBe("hub");
  });

  it("深層連結（工作站）沒有 B1；第一次手勢啟用音效，按鍵照常傳下去", () => {
    bootMock.real = true;
    mount("/records");
    expect(b1()).toBeNull();
    expect(ctxs).toHaveLength(0);
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    gesture("a");
    document.removeEventListener("keydown", seen);
    expect(ctxs).toHaveLength(1);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("狀態列音效按鈕、M 鍵、sound 指令", () => {
  it("手勢前 SND …；手勢後 SND ON；aria-pressed 與中文 accessible name", () => {
    mount("/os");
    expect(sndButton().tagName).toBe("BUTTON");
    expect(sndButton().textContent).toBe("SND …");
    expect(sndButton().getAttribute("aria-pressed")).toBe("true");
    gesture("a");
    expect(sndButton().textContent).toBe("SND ON");
    expect(sndButton().getAttribute("aria-label")).toBe("音效：開啟，按下切換為靜音");
  });

  it("點按鈕切換：SND OFF（寫入 pld.os.sound）；靜音保留 context", () => {
    mount("/os");
    gesture("a");
    act(() => sndButton().click());
    expect(sndButton().textContent).toBe("SND OFF");
    expect(sndButton().getAttribute("aria-pressed")).toBe("false");
    expect(sndButton().getAttribute("aria-label")).toBe("音效：已靜音，按下開啟");
    expect(window.localStorage.getItem(SOUND_STORAGE_KEY)).toBe("off");
    expect(ctxs[0]!.closeCalls).toBe(0);
    act(() => sndButton().click());
    expect(sndButton().textContent).toBe("SND ON");
  });

  it("不支援：SND N/A（按鈕停用）", () => {
    setAudioEngineForTest(new AudioEngine({ createContext: null }));
    mount("/os");
    expect(sndButton().textContent).toBe("SND N/A");
    expect(sndButton().disabled).toBe(true);
  });

  it("M 在控制室切換；焦點在輸入元件、有對話框、帶修飾鍵時不作用", () => {
    mount("/os");
    gesture("a");
    kd("m");
    expect(sndButton().textContent).toBe("SND OFF");
    kd("M");
    expect(sndButton().textContent).toBe("SND ON");
    kd("m", { ctrlKey: true });
    kd("m", { altKey: true });
    expect(sndButton().textContent).toBe("SND ON");
    // 指令列開著（對話框＋輸入框）：M 不作用
    kd("k", { ctrlKey: true });
    const input = screen.getByRole("combobox");
    kd("m", {}, input);
    expect(sndButton().textContent).toBe("SND ON");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("M 在工作站內不作用", () => {
    mount("/records");
    advance(100);
    expect(phase()).toBe("station");
    kd("m");
    expect(window.localStorage.getItem(SOUND_STORAGE_KEY)).toBeNull();
  });

  it("sound off／on／sound（顯示狀態）；help 列出 sound", () => {
    mount("/os");
    kd("k", { ctrlKey: true });
    const input = () => screen.getByRole("combobox");
    const type = (v: string) =>
      act(() => {
        fireEvent.change(input(), { target: { value: v } });
      });
    type("sound");
    kd("Enter", {}, input());
    expect(screen.getByRole("alert").textContent).toContain("目前音效：開");
    type("sound off");
    kd("Enter", {}, input());
    expect(window.localStorage.getItem(SOUND_STORAGE_KEY)).toBe("off");
    expect(sndButton().textContent).toBe("SND OFF");
    kd("k", { ctrlKey: true });
    type("help");
    kd("Enter", {}, input());
    expect(document.querySelector('[data-os="palette-help"]')!.textContent).toContain("sound on|off");
  });

  it("未知指令：低音嗶一次（錯誤）；有效指令不響", () => {
    mount("/os");
    recordPlays();
    kd("k", { ctrlKey: true });
    const input = () => screen.getByRole("combobox");
    act(() => {
      fireEvent.change(input(), { target: { value: "zzz" } });
    });
    kd("Enter", {}, input());
    expect(ids()).toEqual(["error"]);
    act(() => {
      fireEvent.change(input(), { target: { value: "sound" } });
    });
    kd("Enter", {}, input());
    expect(ids()).toEqual(["error"]);
  });
});

describe("事件接線", () => {
  it("選頻道：←→ 各響一次繼電器；初次掛載不響", () => {
    mount("/os");
    recordPlays();
    expect(ids()).toEqual([]);
    kd("ArrowRight");
    kd("ArrowLeft");
    expect(ids()).toEqual(["relay", "relay"]);
  });

  it("進入：E1 rise（0）、E2 click（600ms）、E3 noise（750ms）各排一次；離開 X1 chirp（0）、X4 descend（300ms）", () => {
    mount("/os");
    recordPlays();
    act(() => {
      screen.getByRole("button", { name: /CH-02/ }).click();
    });
    // 選頻道本身（已是選中的 CH-02）不響繼電器
    expect(plays.map((p) => [p.id, Math.round(p.delay * 1000)])).toEqual([
      ["enterRise", 0],
      ["enterClick", 600],
      ["enterNoise", 750],
    ]);
    plays.length = 0;
    advance(1300);
    expect(phase()).toBe("station");
    act(() => {
      screen.getByRole("button", { name: "◀ HUB" }).click();
    });
    expect(plays.map((p) => [p.id, Math.round(p.delay * 1000)])).toEqual([
      ["exitChirp", 0],
      ["exitDescend", 300],
    ]);
  });

  it("跳過進入轉場：每個音效 30ms 淡出／取消，不再多排", () => {
    mount("/os");
    recordPlays();
    act(() => {
      screen.getByRole("button", { name: /CH-02/ }).click();
    });
    const entering = [...plays];
    advance(100);
    gesture("a"); // 輸入閘：跳到終點
    expect(phase()).toBe("station");
    for (const p of entering) expect(p.cancel).toHaveBeenCalledWith(30);
    expect(plays).toHaveLength(entering.length);
  });

  it("短轉場（工作站之間）：一個 150ms 雜訊", () => {
    mount("/records");
    recordPlays();
    act(() => {
      void 0;
    });
    // 在工作站用 Ctrl+K 輸入 new：換頻道＝短轉場
    kd("k", { ctrlKey: true });
    const input = screen.getByRole("combobox");
    act(() => {
      fireEvent.change(input, { target: { value: "new" } });
    });
    kd("Enter", {}, input);
    advance(300);
    expect(ids()).toContain("switchNoise");
    expect(ids().filter((i) => i === "switchNoise")).toHaveLength(1);
    expect(loc.pathname).toBe("/records/new");
  });

  it("減少動態效果的直接切換：只有一聲 cut 喀噠", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
    mount("/os");
    recordPlays();
    act(() => {
      screen.getByRole("button", { name: /CH-02/ }).click();
    });
    expect(phase()).toBe("station");
    expect(ids()).toEqual(["cut"]);
  });

  it("嗡聲：只在 HUB；進入轉場開始就淡出、回到 HUB 淡入", () => {
    const hum = vi.spyOn(engine, "setHum");
    mount("/os");
    expect(hum).toHaveBeenLastCalledWith(true);
    recordPlays();
    act(() => {
      screen.getByRole("button", { name: /CH-02/ }).click();
    });
    expect(hum).toHaveBeenLastCalledWith(false);
    advance(1300);
    act(() => {
      screen.getByRole("button", { name: "◀ HUB" }).click();
    });
    expect(hum).toHaveBeenLastCalledWith(false);
    advance(1000);
    expect(phase()).toBe("hub");
    expect(hum).toHaveBeenLastCalledWith(true);
  });

  it("第一次手勢之前：整個流程不建立 AudioContext", () => {
    mount("/os");
    act(() => {
      screen.getByRole("button", { name: /CH-02/ }).click();
    });
    // click 是 pointerdown 之外的合成事件；這裡只確認沒有任何路徑在手勢前建立 context
    expect(ctxs.length).toBeLessThanOrEqual(0);
  });
});
