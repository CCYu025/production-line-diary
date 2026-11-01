/*
 * Esc 規則（docs/os-mode-spec.md §5.4、brief 第 10 項、E6）：一次 Esc 只做一件事。
 * 只有在「按下的那一刻」沒有任何浮層開著、焦點也不在輸入元件上，Esc 才算「離開工作站」。
 * 做法：window 的 capture 階段先記錄按下時的環境（此時浮層還沒處理這次 Esc）；
 * 事件冒泡到 window（bubble 階段）時，若沒有人 preventDefault／stopPropagation，才在 microtask 裡判斷並離開。
 * （浮層會在事件處理途中關掉自己，所以不能等事件結束後才看 DOM，必須用 capture 階段的快照。）
 * 只在工作站相關階段有效：station／entering-post／switching-post。
 */
import { isInputTarget } from "./keymap";
import type { Phase } from "./reducer";

/**
 * 任何一個符合的元素存在，就視為有浮層開著：
 * 對話框（含指令列、燈箱，皆為 Radix Dialog）、Radix 彈出層（popover／select／dropdown 的 popper wrapper）、tooltip、
 * listbox（Combobox 展開的清單）、任何 aria-expanded="true" 的觸發元件，以及燈箱的標記 [data-fx="lightbox"]。
 */
export const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  "[data-radix-popper-content-wrapper]",
  '[role="tooltip"]',
  '[role="listbox"]',
  '[aria-expanded="true"]',
  '[data-fx="lightbox"]',
].join(", ");

export interface EscapeSnapshot {
  overlayOpen: boolean;
  inputFocused: boolean;
}

/** 目前的環境快照：有沒有浮層開著、焦點是否在輸入元件上。 */
export function snapshotEscapeContext(doc: Document): EscapeSnapshot {
  return {
    overlayOpen: doc.querySelector(OVERLAY_SELECTOR) !== null,
    inputFocused: isInputTarget(doc.activeElement),
  };
}

/** Esc 在哪些階段算「離開工作站」。 */
export function isEscapePhase(phase: Phase): boolean {
  return phase === "station" || phase === "entering-post" || phase === "switching-post";
}

export function shouldLeaveOnEscape(snapshot: EscapeSnapshot, phase: Phase): boolean {
  return isEscapePhase(phase) && !snapshot.overlayOpen && !snapshot.inputFocused;
}

export interface EscapeRuleOptions {
  /** 目前的導演階段（離開時才讀，所以永遠是最新的） */
  getPhase: () => Phase;
  /** 離開工作站（例如 navigate("/os")） */
  onLeave: () => void;
}

/** 安裝 Esc 規則；回傳移除函式。win 通常是 window。 */
export function installEscapeRule(win: Window, { getPhase, onLeave }: EscapeRuleOptions): () => void {
  let snapshot: EscapeSnapshot | null = null;
  let snapshotFor: Event | null = null;

  const onCapture = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (e.key !== "Escape" || e.repeat || e.isComposing) return;
    snapshot = snapshotEscapeContext(win.document);
    snapshotFor = ev;
  };

  const onBubble = (ev: Event) => {
    if (ev !== snapshotFor || !snapshot) return;
    const snap = snapshot;
    snapshot = null;
    snapshotFor = null;
    if (ev.defaultPrevented) return; // 有元件已經處理了這次 Esc
    queueMicrotask(() => {
      if (shouldLeaveOnEscape(snap, getPhase())) onLeave();
    });
  };

  win.addEventListener("keydown", onCapture, true);
  win.addEventListener("keydown", onBubble, false);
  return () => {
    win.removeEventListener("keydown", onCapture, true);
    win.removeEventListener("keydown", onBubble, false);
  };
}
