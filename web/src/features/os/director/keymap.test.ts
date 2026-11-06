import { afterEach, describe, expect, it } from "vitest";
import { isDialogOpen, isHubPhase, isInputTarget, isInteractiveTarget, resolveKey, type KeyContext, type KeyEventLike } from "./keymap";
import type { Phase } from "./reducer";

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  phase: "hub",
  targetIsInput: false,
  targetIsInteractive: false,
  overlayOpen: false,
  ...over,
});
const k = (key: string, over: Partial<KeyEventLike> = {}): KeyEventLike => ({ key, ...over });

describe("resolveKey：控制室快速鍵", () => {
  it("←／→ 選頻道", () => {
    expect(resolveKey(k("ArrowLeft"), ctx())).toEqual({ type: "select-prev" });
    expect(resolveKey(k("ArrowRight"), ctx())).toEqual({ type: "select-next" });
  });
  it("←／→ 按住不放可重複；其他鍵不行", () => {
    expect(resolveKey(k("ArrowRight", { repeat: true }), ctx())).toEqual({ type: "select-next" });
    expect(resolveKey(k("Enter", { repeat: true }), ctx())).toBeNull();
    expect(resolveKey(k("3", { repeat: true }), ctx())).toBeNull();
    expect(resolveKey(k("n", { repeat: true }), ctx())).toBeNull();
    expect(resolveKey(k("/", { repeat: true }), ctx())).toBeNull();
  });
  it("Enter 進入選中的頻道", () => {
    expect(resolveKey(k("Enter"), ctx())).toEqual({ type: "enter-selected" });
  });
  it("Enter 的目標本身是 button／連結：不作用（原生啟用處理，避免雙重觸發）", () => {
    expect(resolveKey(k("Enter"), ctx({ targetIsInteractive: true }))).toBeNull();
  });
  it("1–7 直接進入（index 0–6）", () => {
    for (let i = 1; i <= 7; i++) expect(resolveKey(k(String(i)), ctx())).toEqual({ type: "enter-index", index: i - 1 });
  });
  it("0、8、9 與超過頻道數的數字不作用", () => {
    expect(resolveKey(k("0"), ctx())).toBeNull();
    expect(resolveKey(k("8"), ctx())).toBeNull();
    expect(resolveKey(k("9"), ctx())).toBeNull();
    expect(resolveKey(k("4"), ctx({ channelCount: 3 }))).toBeNull();
    expect(resolveKey(k("3"), ctx({ channelCount: 3 }))).toEqual({ type: "enter-index", index: 2 });
  });
  it("N（不分大小寫）進入新增", () => {
    expect(resolveKey(k("n"), ctx())).toEqual({ type: "enter-new" });
    expect(resolveKey(k("N"), ctx())).toEqual({ type: "enter-new" });
  });
  it("Shift+N 不作用", () => {
    expect(resolveKey(k("N", { shiftKey: true }), ctx())).toBeNull();
  });
  it("/ 開指令列（Shift 容許）", () => {
    expect(resolveKey(k("/"), ctx())).toEqual({ type: "open-palette" });
    expect(resolveKey(k("/", { shiftKey: true }), ctx())).toEqual({ type: "open-palette" });
  });
  it("M（不分大小寫）切換音效；Shift+M、按住不放不作用", () => {
    expect(resolveKey(k("m"), ctx())).toEqual({ type: "toggle-sound" });
    expect(resolveKey(k("M"), ctx())).toEqual({ type: "toggle-sound" });
    expect(resolveKey(k("M", { shiftKey: true }), ctx())).toBeNull();
    expect(resolveKey(k("m", { repeat: true }), ctx())).toBeNull();
  });
  it("M：輸入元件內、對話框開著、帶修飾鍵、組字中、工作站與轉場中都不作用；exiting-post 作用", () => {
    expect(resolveKey(k("m"), ctx({ targetIsInput: true }))).toBeNull();
    expect(resolveKey(k("m"), ctx({ overlayOpen: true }))).toBeNull();
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) expect(resolveKey(k("m", { [mod]: true }), ctx())).toBeNull();
    expect(resolveKey(k("m", { isComposing: true }), ctx())).toBeNull();
    for (const phase of ["boot", "station", "entering-pre", "entering-post", "exiting-pre", "switching-pre", "switching-post"] as Phase[]) expect(resolveKey(k("m"), ctx({ phase })), phase).toBeNull();
    expect(resolveKey(k("m"), ctx({ phase: "exiting-post" }))).toEqual({ type: "toggle-sound" });
  });
  it("其他鍵不作用", () => {
    expect(resolveKey(k("Escape"), ctx())).toBeNull();
    expect(resolveKey(k("a"), ctx())).toBeNull();
    expect(resolveKey(k(" "), ctx())).toBeNull();
  });
  it("Shift+方向鍵／Shift+數字不作用", () => {
    expect(resolveKey(k("ArrowLeft", { shiftKey: true }), ctx())).toBeNull();
    expect(resolveKey(k("1", { shiftKey: true }), ctx())).toBeNull();
  });
});

describe("resolveKey：不作用的條件", () => {
  it("焦點在輸入元件：全部不作用", () => {
    const c = ctx({ targetIsInput: true });
    for (const key of ["ArrowLeft", "ArrowRight", "Enter", "1", "n", "m", "/"]) expect(resolveKey(k(key), c), key).toBeNull();
  });
  it("有對話框／指令列開著：全部不作用", () => {
    const c = ctx({ overlayOpen: true });
    for (const key of ["ArrowLeft", "ArrowRight", "Enter", "1", "n", "m", "/"]) expect(resolveKey(k(key), c), key).toBeNull();
  });
  it("帶 Ctrl／Meta／Alt：不作用", () => {
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) {
      for (const key of ["ArrowLeft", "Enter", "1", "n", "m", "/"]) expect(resolveKey(k(key, { [mod]: true }), ctx()), `${mod} ${key}`).toBeNull();
    }
  });
  it("輸入法組字中：不作用", () => {
    expect(resolveKey(k("n", { isComposing: true }), ctx())).toBeNull();
    expect(resolveKey(k("k", { ctrlKey: true, isComposing: true }), ctx())).toBeNull();
  });
  it("工作站與轉場中（除 exiting-post）：單一字元快速鍵都不作用", () => {
    const phases: Phase[] = ["boot", "station", "entering-pre", "entering-post", "exiting-pre", "switching-pre", "switching-post"];
    for (const phase of phases) {
      for (const key of ["ArrowLeft", "ArrowRight", "Enter", "1", "n", "m", "/"]) expect(resolveKey(k(key), ctx({ phase })), `${phase} ${key}`).toBeNull();
    }
  });
  it("exiting-post（交接點後，輸入交給 HUD）：作用", () => {
    expect(resolveKey(k("ArrowRight"), ctx({ phase: "exiting-post" }))).toEqual({ type: "select-next" });
    expect(isHubPhase("exiting-post")).toBe(true);
    expect(isHubPhase("hub")).toBe(true);
    expect(isHubPhase("station")).toBe(false);
  });
});

describe("resolveKey：Ctrl+K", () => {
  it("控制室與工作站都開指令列", () => {
    for (const phase of ["hub", "station", "exiting-post", "entering-post", "switching-post"] as Phase[]) {
      expect(resolveKey(k("k", { ctrlKey: true }), ctx({ phase })), phase).toEqual({ type: "open-palette" });
    }
  });
  it("Meta+K 也行；大寫 K 也行", () => {
    expect(resolveKey(k("k", { metaKey: true }), ctx())).toEqual({ type: "open-palette" });
    expect(resolveKey(k("K", { ctrlKey: true }), ctx())).toEqual({ type: "open-palette" });
  });
  it("焦點在輸入框也有效", () => {
    expect(resolveKey(k("k", { ctrlKey: true }), ctx({ phase: "station", targetIsInput: true }))).toEqual({ type: "open-palette" });
  });
  it("對話框開著（含指令列自己）時不作用", () => {
    expect(resolveKey(k("k", { ctrlKey: true }), ctx({ overlayOpen: true }))).toBeNull();
  });
  it("轉場交接點之前與開機中不作用（輸入閘／開機畫面處理）", () => {
    for (const phase of ["boot", "entering-pre", "exiting-pre", "switching-pre"] as Phase[]) {
      expect(resolveKey(k("k", { ctrlKey: true }), ctx({ phase })), phase).toBeNull();
    }
  });
  it("Ctrl+Shift+K、Ctrl+Alt+K、按住不放不作用", () => {
    expect(resolveKey(k("K", { ctrlKey: true, shiftKey: true }), ctx())).toBeNull();
    expect(resolveKey(k("k", { ctrlKey: true, altKey: true }), ctx())).toBeNull();
    expect(resolveKey(k("k", { ctrlKey: true, repeat: true }), ctx())).toBeNull();
  });
  it("Ctrl+其他鍵不作用", () => {
    expect(resolveKey(k("j", { ctrlKey: true }), ctx())).toBeNull();
  });
});

describe("DOM 輔助（jsdom）", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  const mount = (html: string): HTMLElement => {
    document.body.innerHTML = html;
    return document.body;
  };

  it("isInputTarget：input／textarea／select／contenteditable／combobox／textbox", () => {
    mount(`
      <input id="text" /><input id="num" type="number" /><input id="chk" type="checkbox" /><input id="btn" type="button" />
      <textarea id="ta"></textarea><select id="sel"><option>a</option></select>
      <div id="ce" contenteditable="true"><span id="ce-child">x</span></div>
      <div id="ce2" contenteditable=""></div>
      <div id="ce-off" contenteditable="false"></div>
      <div id="cb" role="combobox" tabindex="0"></div><div id="tb" role="textbox" tabindex="0"></div><div id="sb" role="searchbox"></div>
      <button id="b">b</button><a id="a" href="/x">a</a><div id="plain"></div>`);
    const $ = (id: string) => document.getElementById(id);
    for (const id of ["text", "num", "chk", "ta", "sel", "ce", "ce-child", "ce2", "cb", "tb", "sb"]) expect(isInputTarget($(id)), id).toBe(true);
    for (const id of ["btn", "ce-off", "b", "a", "plain"]) expect(isInputTarget($(id)), id).toBe(false);
  });
  it("isInputTarget：null／window／document 安全", () => {
    expect(isInputTarget(null)).toBe(false);
    expect(isInputTarget(undefined)).toBe(false);
    expect(isInputTarget(window)).toBe(false);
    expect(isInputTarget(document)).toBe(false);
  });
  it("isInteractiveTarget：button／連結（含其內部）／role=button／summary", () => {
    mount(`
      <button id="b"><span id="in">x</span></button><a id="a" href="/x">a</a><a id="anchor">no href</a>
      <div id="rb" role="button" tabindex="0"></div><details><summary id="sum">s</summary></details>
      <input id="submit" type="submit" /><input id="text" /><div id="plain"></div>`);
    const $ = (id: string) => document.getElementById(id);
    for (const id of ["b", "in", "a", "rb", "sum", "submit"]) expect(isInteractiveTarget($(id)), id).toBe(true);
    for (const id of ["anchor", "text", "plain"]) expect(isInteractiveTarget($(id)), id).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });
  it("isDialogOpen：dialog／alertdialog", () => {
    mount("<div></div>");
    expect(isDialogOpen(document)).toBe(false);
    mount('<div role="dialog"></div>');
    expect(isDialogOpen(document)).toBe(true);
    mount('<div role="alertdialog"></div>');
    expect(isDialogOpen(document)).toBe(true);
  });
});
