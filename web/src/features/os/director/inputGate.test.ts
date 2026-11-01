import { afterEach, describe, expect, it, vi } from "vitest";
import { armInputGate, GATE_SAFETY_MS } from "./inputGate";

function mouse(type: string, target: EventTarget = window, init: MouseEventInit = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
function key(type: "keydown" | "keyup", code: string, k = code, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, code, key: k, ...init });
  document.body.dispatchEvent(e);
  return e;
}

function setup() {
  const btn = document.createElement("button");
  document.body.appendChild(btn);
  const seen: string[] = [];
  for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "keydown", "keyup"]) {
    btn.addEventListener(t, () => seen.push(t));
    document.addEventListener(t, () => seen.push("doc:" + t));
  }
  const onSkip = vi.fn();
  return { btn, seen, onSkip };
}

function gesture(btn: Element) {
  const evs = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].map((t) => mouse(t, btn));
  return evs;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("inputGate", () => {
  it("第一個滑鼠手勢：跳過一次，整個手勢（含 click）都不傳給下面；preventDefault", () => {
    const { btn, seen, onSkip } = setup();
    armInputGate(window, onSkip);
    const evs = gesture(btn);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
    expect(evs.every((e) => e.defaultPrevented)).toBe(true);
  });

  it("手勢結束後閘完全移除：第二個手勢直接命中目標", () => {
    const { btn, seen, onSkip } = setup();
    armInputGate(window, onSkip);
    gesture(btn);
    seen.length = 0;
    gesture(btn);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(seen).toContain("click");
    expect(seen).toContain("pointerdown");
  });

  it("手勢中途 release()（轉場因這次輸入結束）仍攔到 click", () => {
    const { btn, seen, onSkip } = setup();
    const gate = armInputGate(window, onSkip);
    mouse("pointerdown", btn);
    mouse("mousedown", btn);
    gate.release();
    mouse("pointerup", btn);
    mouse("mouseup", btn);
    mouse("click", btn);
    expect(seen).toEqual([]);
    gesture(btn);
    expect(seen).toContain("click");
  });

  it("沒有手勢就 release()：完全沒有監聽器（之後的點擊直接通過、不跳過）", () => {
    const { btn, seen, onSkip } = setup();
    armInputGate(window, onSkip).release();
    gesture(btn);
    expect(onSkip).not.toHaveBeenCalled();
    expect(seen).toContain("click");
  });

  it("安全逾時：手勢沒收尾（沒有 click）也會在 600ms 後解除", () => {
    vi.useFakeTimers();
    const { btn, seen, onSkip } = setup();
    armInputGate(window, onSkip);
    mouse("pointerdown", btn);
    mouse("mousedown", btn);
    vi.advanceTimersByTime(GATE_SAFETY_MS + 1);
    mouse("click", btn);
    expect(seen).toContain("click");
  });

  it("鍵盤：Enter 的 keydown（含按住重複）與 keyup 被攔，之後恢復", () => {
    const { seen, onSkip } = setup();
    armInputGate(window, onSkip);
    const d = key("keydown", "Enter");
    key("keydown", "Enter", "Enter", { repeat: true });
    const u = key("keyup", "Enter");
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
    expect(d.defaultPrevented && u.defaultPrevented).toBe(true);
    key("keydown", "Enter");
    key("keyup", "Enter");
    expect(seen).toContain("doc:keydown");
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("鍵盤：Space 的 keyup 也被攔（按鈕在 keyup 才啟動）", () => {
    const { seen, onSkip } = setup();
    armInputGate(window, onSkip);
    key("keydown", "Space", " ");
    key("keyup", "Space", " ");
    expect(seen).toEqual([]);
  });

  it("單獨的修飾鍵與含 Ctrl／Alt／Meta 的組合不算輸入", () => {
    const { onSkip } = setup();
    armInputGate(window, onSkip);
    key("keydown", "ShiftLeft", "Shift");
    key("keydown", "KeyR", "r", { ctrlKey: true });
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("滾輪不是輸入", () => {
    const { onSkip } = setup();
    armInputGate(window, onSkip);
    window.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true }));
    expect(onSkip).not.toHaveBeenCalled();
  });
});
