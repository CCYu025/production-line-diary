import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { installEscapeRule, isEscapePhase, shouldLeaveOnEscape, snapshotEscapeContext } from "./escapeRule";
import type { Phase } from "./reducer";

let dispose: (() => void) | null = null;
let phase: Phase;
let onLeave: Mock<() => void>;

beforeEach(() => {
  phase = "station";
  onLeave = vi.fn<() => void>();
  dispose = installEscapeRule(window, { getPhase: () => phase, onLeave });
});
afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.innerHTML = "";
});

const flush = () => Promise.resolve();
const esc = (target: EventTarget = document.body, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe("shouldLeaveOnEscape（純函式）", () => {
  const free = { overlayOpen: false, inputFocused: false };
  it("station／entering-post／switching-post 且沒有浮層、焦點不在輸入元件 → 離開", () => {
    for (const p of ["station", "entering-post", "switching-post"] as Phase[]) {
      expect(shouldLeaveOnEscape(free, p), p).toBe(true);
      expect(isEscapePhase(p)).toBe(true);
    }
  });
  it("其他階段不離開（Esc 在控制室與轉場前半無效）", () => {
    for (const p of ["boot", "hub", "entering-pre", "exiting-pre", "exiting-post", "switching-pre"] as Phase[]) {
      expect(shouldLeaveOnEscape(free, p), p).toBe(false);
    }
  });
  it("有浮層或焦點在輸入元件 → 不離開", () => {
    expect(shouldLeaveOnEscape({ overlayOpen: true, inputFocused: false }, "station")).toBe(false);
    expect(shouldLeaveOnEscape({ overlayOpen: false, inputFocused: true }, "station")).toBe(false);
    expect(shouldLeaveOnEscape({ overlayOpen: true, inputFocused: true }, "station")).toBe(false);
  });
});

describe("snapshotEscapeContext", () => {
  const snap = (html: string, focusId?: string) => {
    document.body.innerHTML = html;
    if (focusId) document.getElementById(focusId)!.focus();
    return snapshotEscapeContext(document);
  };
  it("什麼都沒開", () => {
    expect(snap("<main><button id='b'>x</button></main>", "b")).toEqual({ overlayOpen: false, inputFocused: false });
  });
  it("各種浮層標記", () => {
    for (const marker of [
      '<div role="dialog"></div>',
      '<div role="alertdialog"></div>',
      "<div data-radix-popper-content-wrapper></div>",
      '<div role="tooltip"></div>',
      '<ul role="listbox"></ul>',
      '<button aria-haspopup="menu" aria-expanded="true">x</button>',
      '<button aria-haspopup="true" aria-expanded="true">x</button>',
      '<input role="combobox" aria-expanded="true" />',
      '<div data-fx="lightbox"></div>',
    ]) {
      expect(snap(marker).overlayOpen, marker).toBe(true);
    }
  });
  it("單純的 disclosure（aria-expanded=true、沒有 aria-haspopup）不擋 Esc", () => {
    expect(snap('<button aria-expanded="true">x</button>').overlayOpen).toBe(false);
    expect(snap('<button aria-haspopup="false" aria-expanded="true">x</button>').overlayOpen).toBe(false);
  });
  it("aria-expanded=false 不算", () => {
    expect(snap('<button aria-expanded="false">x</button>').overlayOpen).toBe(false);
  });
  it("焦點在 input／textarea／select／contenteditable／combobox", () => {
    expect(snap("<input id='f' />", "f").inputFocused).toBe(true);
    expect(snap("<textarea id='f'></textarea>", "f").inputFocused).toBe(true);
    expect(snap("<select id='f'><option>a</option></select>", "f").inputFocused).toBe(true);
    expect(snap("<div id='f' contenteditable='true' tabindex='0'></div>", "f").inputFocused).toBe(true);
    expect(snap("<div id='f' role='combobox' tabindex='0'></div>", "f").inputFocused).toBe(true);
  });
});

describe("installEscapeRule", () => {
  it("沒有浮層、焦點在一般元素：Esc 離開，恰好一次", async () => {
    document.body.innerHTML = "<button id='b'>x</button>";
    document.getElementById("b")!.focus();
    esc(document.getElementById("b")!);
    expect(onLeave).not.toHaveBeenCalled(); // 事件結束之後（microtask）才動作
    await flush();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("對話框開著：不離開", async () => {
    document.body.innerHTML = '<div role="dialog"><button id="b">x</button></div>';
    esc(document.getElementById("b")!);
    await flush();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("浮層在 Esc 處理途中關掉自己：仍不離開（以按下當下的快照為準，E6）", async () => {
    document.body.innerHTML = '<div id="dlg" role="dialog"><button id="b">x</button></div>';
    // 模擬 Radix：在 document 的 keydown 把自己移除（晚於 window capture、早於 window bubble）
    const closer = () => document.getElementById("dlg")?.remove();
    document.addEventListener("keydown", closer);
    esc(document.getElementById("b")!);
    document.removeEventListener("keydown", closer);
    await flush();
    expect(document.getElementById("dlg")).toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
    // 同一個浮層關掉之後，下一次 Esc 才離開
    esc();
    await flush();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("焦點在輸入框：不離開", async () => {
    document.body.innerHTML = "<input id='i' />";
    document.getElementById("i")!.focus();
    esc(document.getElementById("i")!);
    await flush();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("combobox 展開（aria-expanded=true）：不離開", async () => {
    document.body.innerHTML = '<input id="c" role="combobox" aria-expanded="true" /><ul role="listbox"></ul>';
    esc(document.getElementById("c")!);
    await flush();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("其他浮層標記（popper／tooltip／燈箱）：不離開", async () => {
    for (const marker of ["<div data-radix-popper-content-wrapper></div>", '<div role="tooltip"></div>', '<div data-fx="lightbox"></div>']) {
      document.body.innerHTML = marker;
      esc();
      await flush();
    }
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("在規定階段有效：station／entering-post／switching-post", async () => {
    for (const p of ["station", "entering-post", "switching-post"] as Phase[]) {
      phase = p;
      esc();
      await flush();
    }
    expect(onLeave).toHaveBeenCalledTimes(3);
  });

  it("其他階段無效：hub／boot／各 pre／exiting-post", async () => {
    for (const p of ["hub", "boot", "entering-pre", "exiting-pre", "exiting-post", "switching-pre"] as Phase[]) {
      phase = p;
      esc();
      await flush();
    }
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("階段在 microtask 執行時才讀：事件途中階段變了就以最新為準", async () => {
    esc();
    phase = "hub";
    await flush();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("其他鍵、按住不放、組字中：不動作", async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    esc(document.body, { repeat: true });
    esc(document.body, { isComposing: true });
    await flush();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("有元件 preventDefault 了這次 Esc：不離開", async () => {
    const handler = (e: Event) => e.preventDefault();
    document.addEventListener("keydown", handler);
    esc();
    document.removeEventListener("keydown", handler);
    await flush();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("有元件 stopPropagation（事件到不了 window bubble）：不離開，且不殘留舊快照", async () => {
    const stop = (e: Event) => e.stopPropagation();
    document.addEventListener("keydown", stop);
    esc();
    document.removeEventListener("keydown", stop);
    await flush();
    expect(onLeave).not.toHaveBeenCalled();
    esc();
    await flush();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("連按兩次 Esc 各自獨立判斷", async () => {
    esc();
    await flush();
    esc();
    await flush();
    expect(onLeave).toHaveBeenCalledTimes(2);
  });

  it("disposer 移除監聽器", async () => {
    dispose!();
    dispose = null;
    esc();
    await flush();
    expect(onLeave).not.toHaveBeenCalled();
  });
});
