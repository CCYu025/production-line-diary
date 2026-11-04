import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATROL_IDLE_MS } from "../transition/timing";
import { createIdlePatrol, PATROL_INPUT_EVENTS } from "./patrol";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function make(target?: Window) {
  const changes: boolean[] = [];
  const p = createIdlePatrol({ onChange: (v) => changes.push(v), target });
  return { p, changes };
}

describe("createIdlePatrol：計時", () => {
  it("資格成立後 60 秒無輸入才進入巡視（59.999 秒還沒）", () => {
    const { p, changes } = make();
    p.setEligible(true);
    vi.advanceTimersByTime(PATROL_IDLE_MS - 1);
    expect(p.isPatrolling()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(p.isPatrolling()).toBe(true);
    expect(changes).toEqual([true]);
  });
  it("沒有資格（不在 HUB）永遠不巡視", () => {
    const { p } = make();
    vi.advanceTimersByTime(PATROL_IDLE_MS * 3);
    expect(p.isPatrolling()).toBe(false);
  });
  it("輸入重新計時", () => {
    const { p } = make();
    p.setEligible(true);
    vi.advanceTimersByTime(PATROL_IDLE_MS - 1000);
    p.notifyInput();
    vi.advanceTimersByTime(PATROL_IDLE_MS - 1);
    expect(p.isPatrolling()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(p.isPatrolling()).toBe(true);
  });
  it("巡視中輸入：立刻結束，並重新開始 60 秒計時", () => {
    const { p, changes } = make();
    p.setEligible(true);
    vi.advanceTimersByTime(PATROL_IDLE_MS);
    p.notifyInput();
    expect(p.isPatrolling()).toBe(false);
    vi.advanceTimersByTime(PATROL_IDLE_MS);
    expect(changes).toEqual([true, false, true]);
  });
  it("離開 HUB（資格消失）：立刻結束巡視並停表；回到 HUB 從頭算", () => {
    const { p, changes } = make();
    p.setEligible(true);
    vi.advanceTimersByTime(PATROL_IDLE_MS);
    p.setEligible(false);
    expect(p.isPatrolling()).toBe(false);
    vi.advanceTimersByTime(PATROL_IDLE_MS * 2);
    expect(changes).toEqual([true, false]);
    p.setEligible(true);
    vi.advanceTimersByTime(PATROL_IDLE_MS - 1);
    expect(p.isPatrolling()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(p.isPatrolling()).toBe(true);
  });
  it("dispose 後不再巡視", () => {
    const { p } = make();
    p.setEligible(true);
    p.dispose();
    vi.advanceTimersByTime(PATROL_IDLE_MS * 2);
    expect(p.isPatrolling()).toBe(false);
  });
});

describe("createIdlePatrol：輸入不被吞掉", () => {
  it("巡視中的 key／click／wheel 都結束巡視，事件照常傳到下面的元素、沒有 preventDefault", () => {
    const { p } = make(window);
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    const seen: string[] = [];
    for (const t of ["keydown", "click", "wheel"]) btn.addEventListener(t, () => seen.push(t));
    p.setEligible(true);

    for (const e of [
      new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }),
      new MouseEvent("click", { bubbles: true, cancelable: true }),
      new WheelEvent("wheel", { bubbles: true, cancelable: true }),
    ]) {
      vi.advanceTimersByTime(PATROL_IDLE_MS);
      expect(p.isPatrolling()).toBe(true);
      btn.dispatchEvent(e);
      expect(p.isPatrolling()).toBe(false);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(seen).toEqual(["keydown", "click", "wheel"]);
    p.dispose();
  });
  it("監聽 key／click／wheel；dispose 移除全部監聽器", () => {
    for (const t of ["keydown", "click", "wheel"]) expect(PATROL_INPUT_EVENTS).toContain(t);
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { p } = make(window);
    const count = (spy: typeof add) => spy.mock.calls.filter((c) => (PATROL_INPUT_EVENTS as readonly string[]).includes(c[0])).length;
    expect(count(add)).toBe(PATROL_INPUT_EVENTS.length);
    p.dispose();
    expect(count(remove as typeof add)).toBe(PATROL_INPUT_EVENTS.length);
  });
});
