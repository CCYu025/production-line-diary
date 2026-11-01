/*
 * 快速鍵對應（docs/os-mode-spec.md §5.4、brief 第 9 項、驗收 A6）：純函式，不碰 DOM 事件（呼叫端把事件與環境整理成參數）。
 *
 * 規則：
 * - Ctrl+K（或 Meta+K）：任何地方開指令列；焦點在輸入框也有效。但交接點之前（輸入閘會攔）、開機中、
 *   或已有對話框／指令列開著時不作用（不在別的對話框上疊指令列）。
 * - 其餘單一字元快速鍵只在控制室有效（phase 為 hub，或離開轉場過了交接點的 exiting-post：輸入交給 HUD）：
 *   ←／→ 選頻道、Enter 進入選中的頻道、1–7 直接進入、N 進入 CH-03 新增、/ 開指令列。
 * - 焦點在輸入框／文字區／下拉選單／可編輯內容／combobox／textbox，或有任何對話框開著，或帶 Ctrl／Meta／Alt，或輸入法組字中：全部不作用。
 * - Shift 只容許在 `/`（部分鍵盤配置要用 Shift 打）；字母 N 不分大小寫但不接受 Shift（CapsLock 開著時 key 是 "N"，仍算）。
 * - Enter 在事件目標本身是 button／連結時不作用（原生啟用會處理，避免 HUD 按鈕或 EXIT 按鈕雙重觸發）。
 * - 按住不放（repeat）時只有 ←／→ 會重複作用。
 * `M`（靜音）是 X4，這裡不處理。
 */
import type { Phase } from "./reducer";

export type KeyAction =
  | { type: "select-prev" }
  | { type: "select-next" }
  | { type: "enter-selected" }
  | { type: "enter-index"; index: number }
  | { type: "enter-new" }
  | { type: "open-palette" };

/** KeyboardEvent 中用得到的欄位（測試可以用純物件）。 */
export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export interface KeyContext {
  phase: Phase;
  /** 焦點（事件目標）在輸入元件上，見 isInputTarget */
  targetIsInput: boolean;
  /** 事件目標本身是 button／連結等原生可啟用元件，見 isInteractiveTarget */
  targetIsInteractive: boolean;
  /** 任何對話框（含指令列）開著：`[role=dialog],[role=alertdialog]` 存在 */
  overlayOpen: boolean;
  /** 頻道數（預設 7），數字鍵超出範圍時不作用 */
  channelCount?: number;
}

/** 控制室的快速鍵是否有效：控制室，或離開轉場過了交接點（輸入已交給 HUD）。 */
export function isHubPhase(phase: Phase): boolean {
  return phase === "hub" || phase === "exiting-post";
}

/** Ctrl+K 可用的階段：轉場交接點之前與開機中，輸入閘／開機畫面會處理輸入。 */
function paletteAllowedPhase(phase: Phase): boolean {
  return phase !== "boot" && phase !== "entering-pre" && phase !== "exiting-pre" && phase !== "switching-pre";
}

export function resolveKey(e: KeyEventLike, ctx: KeyContext): KeyAction | null {
  if (e.isComposing) return null;
  const key = e.key;
  const ctrlOrMeta = !!(e.ctrlKey || e.metaKey);

  // Ctrl+K：任何地方（含輸入框內）
  if (ctrlOrMeta && !e.altKey && !e.shiftKey && (key === "k" || key === "K")) {
    if (e.repeat || ctx.overlayOpen || !paletteAllowedPhase(ctx.phase)) return null;
    return { type: "open-palette" };
  }

  if (ctrlOrMeta || e.altKey) return null;
  if (!isHubPhase(ctx.phase)) return null;
  if (ctx.targetIsInput || ctx.overlayOpen) return null;
  if (e.shiftKey && key !== "/") return null;

  switch (key) {
    case "ArrowLeft":
      return { type: "select-prev" };
    case "ArrowRight":
      return { type: "select-next" };
  }
  if (e.repeat) return null;
  switch (key) {
    case "Enter":
      return ctx.targetIsInteractive ? null : { type: "enter-selected" };
    case "/":
      return { type: "open-palette" };
    case "n":
    case "N":
      return { type: "enter-new" };
  }
  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    return index < (ctx.channelCount ?? 7) ? { type: "enter-index", index } : null;
  }
  return null;
}

// ---- DOM 輔助 ----

type MaybeElement = EventTarget | Element | null | undefined;

function asElement(t: MaybeElement): Element | null {
  return t && typeof (t as Element).closest === "function" ? (t as Element) : null;
}

const NON_TEXT_INPUT_TYPES = new Set(["button", "submit", "reset", "image"]);

const INPUT_ROLE_SELECTOR = '[role="combobox"], [role="textbox"], [role="searchbox"], [role="spinbutton"]';

/** 焦點是否在輸入元件：input（按鈕型除外）、textarea、select、contenteditable、role=combobox／textbox／searchbox／spinbutton（含其內部）。 */
export function isInputTarget(t: MaybeElement): boolean {
  const el = asElement(t);
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") return !NON_TEXT_INPUT_TYPES.has(((el as HTMLInputElement).type || "").toLowerCase());
  if (tag === "textarea" || tag === "select") return true;
  const editable = el.closest("[contenteditable]");
  if (editable && editable.getAttribute("contenteditable")?.toLowerCase() !== "false") return true;
  return el.closest(INPUT_ROLE_SELECTOR) !== null;
}

const INTERACTIVE_SELECTOR =
  'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input[type="button"], input[type="submit"], input[type="reset"], input[type="image"]';

/** 事件目標本身（或其祖先）是 button／連結等原生可啟用元件：Enter 交給原生啟用處理。 */
export function isInteractiveTarget(t: MaybeElement): boolean {
  const el = asElement(t);
  return !!el && el.closest(INTERACTIVE_SELECTOR) !== null;
}

/** 任何對話框開著（含指令列，它是 Radix Dialog）。 */
export const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

export function isDialogOpen(doc: Document): boolean {
  return doc.querySelector(DIALOG_SELECTOR) !== null;
}
