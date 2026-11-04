/*
 * A1（X2）：導演在開機與待機巡視的行為，用真正的 useDirector＋useInputGate＋usePatrol（不含 3D）。
 */
import { act, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOT_FULL, BOOT_SHORT, PATROL_IDLE_MS } from "../transition/timing";
import { BOOT_STORAGE_KEY, markBootDone, resetBootDoneForTest } from "./boot";
import { phaseOf, type DirectorState, type Place } from "./reducer";
import { useDirector } from "./useDirector";
import { useInputGate } from "./useInputGate";
import { usePatrol } from "./usePatrol";

const hub: Place = { kind: "hub" };
const station: Place = { kind: "channel", ch: "CH-02" };

let state: DirectorState;
let patrolling = false;
let underneath: ReturnType<typeof vi.fn>;
let setPlace: (p: Place) => void;

function Harness({ initial, reduced }: { initial: Place; reduced: boolean }) {
  const [place, setP] = React.useState(initial);
  setPlace = setP;
  const d = useDirector(place, reduced);
  state = d.state;
  useInputGate(d.gateActive, d.skip);
  patrolling = usePatrol(d.state.kind === "HUB" && !reduced);
  return (
    <button data-testid="under" onClick={underneath as never} onKeyDown={underneath as never}>
      x
    </button>
  );
}

const mount = (initial: Place, reduced = false) => render(<Harness initial={initial} reduced={reduced} />);
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const phase = () => phaseOf(state);
const under = () => document.querySelector("[data-testid=under]")!;

function clickGesture(target: Element) {
  const evs = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].map((t) => new MouseEvent(t, { bubbles: true, cancelable: true }));
  act(() => {
    for (const e of evs) target.dispatchEvent(e);
  });
  return evs;
}
function keyPress(target: Element, key = "a") {
  const down = new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true });
  const up = new KeyboardEvent("keyup", { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(down);
    target.dispatchEvent(up);
  });
  return [down, up];
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  resetBootDoneForTest();
  patrolling = false;
  underneath = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  resetBootDoneForTest();
});

describe("A1：開機", () => {
  it("第一次顯示控制室：完整 BOOT，播完（≤ 4000ms）進 HUB 並寫 key", () => {
    mount(hub);
    expect(state.kind).toBe("BOOT");
    expect(state.kind === "BOOT" && state.short).toBeFalsy();
    expect(window.sessionStorage.getItem(BOOT_STORAGE_KEY)).toBeNull();
    advance(BOOT_FULL.total - 1);
    expect(phase()).toBe("boot");
    advance(1);
    expect(phase()).toBe("hub");
    expect(window.sessionStorage.getItem(BOOT_STORAGE_KEY)).toBe("1");
  });

  it("key 已寫：短開機（≤ 1000ms）", () => {
    markBootDone();
    mount(hub);
    expect(state.kind === "BOOT" && state.short).toBe(true);
    advance(BOOT_SHORT.total - 1);
    expect(phase()).toBe("boot");
    advance(1);
    expect(phase()).toBe("hub");
  });

  it("按鍵跳過：跳到 HUB、key 已寫、那次按鍵（keydown＋keyup）不傳給下面", () => {
    mount(hub);
    const evs = keyPress(under());
    expect(phase()).toBe("hub");
    expect(window.sessionStorage.getItem(BOOT_STORAGE_KEY)).toBe("1");
    expect(underneath).not.toHaveBeenCalled();
    expect(evs.every((e) => e.defaultPrevented)).toBe(true);
  });

  it("點擊跳過：跳到 HUB、整個手勢（含 click）不傳給下面", () => {
    mount(hub);
    clickGesture(under());
    expect(phase()).toBe("hub");
    expect(window.sessionStorage.getItem(BOOT_STORAGE_KEY)).toBe("1");
    expect(underneath).not.toHaveBeenCalled();
  });

  it("跳過之後的下一次輸入照常傳到下面（不多吞）", () => {
    mount(hub);
    clickGesture(under());
    advance(700);
    clickGesture(under());
    expect(underneath).toHaveBeenCalledTimes(1);
  });

  it("短開機同樣可被跳過，輸入被吃掉", () => {
    markBootDone();
    mount(hub);
    keyPress(under());
    expect(phase()).toBe("hub");
    expect(underneath).not.toHaveBeenCalled();
  });

  it("深層連結（第一個畫面是工作站）：沒有開機，key 不寫", () => {
    mount(station);
    expect(phase()).toBe("station");
    advance(5000);
    expect(window.sessionStorage.getItem(BOOT_STORAGE_KEY)).toBeNull();
  });

  it("減少動態效果：沒有開機，直接 HUB", () => {
    mount(hub, true);
    expect(phase()).toBe("hub");
  });

  it("從工作站回控制室：走離開轉場，不開機（即使 key 已寫）", () => {
    markBootDone();
    mount(station);
    act(() => setPlace(hub));
    expect(phase()).toBe("exiting-pre");
    advance(1000);
    expect(phase()).toBe("hub");
  });

  it("開機中路由改成工作站：結束後直接到工作站（沒有轉場）", () => {
    mount(hub);
    act(() => setPlace(station));
    advance(BOOT_FULL.total);
    expect(phase()).toBe("station");
  });
});

describe("A1：待機巡視", () => {
  it("開機中不計時；HUB 之後無輸入 60 秒才巡視", () => {
    markBootDone();
    mount(hub);
    advance(BOOT_SHORT.total);
    expect(phase()).toBe("hub");
    advance(PATROL_IDLE_MS - 1);
    expect(patrolling).toBe(false);
    advance(1);
    expect(patrolling).toBe(true);
  });

  it("巡視中按鍵或點擊：立刻結束，而且輸入不被吞掉", () => {
    markBootDone();
    mount(hub);
    advance(BOOT_SHORT.total);
    advance(PATROL_IDLE_MS);
    expect(patrolling).toBe(true);
    const evs = keyPress(under());
    expect(patrolling).toBe(false);
    expect(underneath).toHaveBeenCalled();
    expect(evs[0]!.defaultPrevented).toBe(false);

    underneath.mockClear();
    advance(PATROL_IDLE_MS);
    expect(patrolling).toBe(true);
    clickGesture(under());
    expect(patrolling).toBe(false);
    expect(underneath).toHaveBeenCalledTimes(1);
  });

  it("進入工作站：巡視結束；回控制室後從頭計時", () => {
    markBootDone();
    mount(hub);
    advance(BOOT_SHORT.total);
    advance(PATROL_IDLE_MS);
    expect(patrolling).toBe(true);
    act(() => setPlace(station));
    expect(patrolling).toBe(false);
    advance(2000);
    act(() => setPlace(hub));
    advance(900); // 離開轉場 900ms 後才是 HUB，這時才開始計時
    expect(phase()).toBe("hub");
    advance(PATROL_IDLE_MS - 1);
    expect(patrolling).toBe(false);
    advance(1);
    expect(patrolling).toBe(true);
  });
});
