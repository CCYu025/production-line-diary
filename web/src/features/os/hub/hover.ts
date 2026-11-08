/*
 * 懸停預覽的共用狀態（docs/holo-mode-spec.md §7.2；H0）：HUD 頻道鍵與 3D 螢幕雙向連動。
 * 懸停只是預覽——不改變選取、不進入頻道、不動 aria-current；HUD 鍵與 3D 螢幕各自只讀這個值來亮起。
 * 外部 store（不放在 OsShell 的 state 裡），懸停改變不會讓整個外殼重繪。每個 OsShell 自己建一個，不用模組層級的全域值。
 */
import * as React from "react";
import type { ChannelId } from "../channels";

/** 懸停的來源：HUD 頻道鍵，或 3D 螢幕。兩邊各自的「離開」只清掉自己來源的懸停（指標從畫布移到鍵時，事件順序是鍵的 enter 先、畫布的 leave 後）。 */
export type HoverSource = "hud" | "3d";

export interface HoverStore {
  get(): ChannelId | null;
  getSource(): HoverSource | null;
  /** 設定懸停（覆蓋任何來源）；id 為 null 等於 clear() */
  set(id: ChannelId | null, source?: HoverSource): void;
  /** 只在目前懸停的來源是 source 時清除（可再指定必須是這個頻道） */
  release(source: HoverSource, id?: ChannelId): void;
  /** 無條件清除（HUD 變成不作用時） */
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export function createHoverStore(): HoverStore {
  let value: ChannelId | null = null;
  let src: HoverSource | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  const store: HoverStore = {
    get: () => value,
    getSource: () => src,
    set(id, source = "hud") {
      const nextSrc = id === null ? null : source;
      if (id === value && nextSrc === src) return;
      const changed = id !== value;
      value = id;
      src = nextSrc;
      if (changed) notify();
    },
    release(source, id) {
      if (src === source && (id === undefined || id === value)) store.set(null);
    },
    clear: () => store.set(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return store;
}

/** 目前懸停的頻道（沒有 store 時永遠是 null）。 */
export function useHovered(store: HoverStore | undefined): ChannelId | null {
  return React.useSyncExternalStore(
    React.useCallback((l) => (store ? store.subscribe(l) : () => {}), [store]),
    () => (store ? store.get() : null),
    () => null,
  );
}

export interface HoverProbeOptions {
  /** 螢幕座標 → 打到的頻道（射線；呼叫端負責桶狀弧面反算） */
  hit: (clientX: number, clientY: number) => ChannelId | null;
  /** 射線結果出來後（每幀最多一次） */
  onResult: (ch: ChannelId | null) => void;
  schedule: (cb: () => void) => number;
  cancel: (handle: number) => void;
}

/**
 * 3D 螢幕懸停的射線節流（H0）：指標移動只記下最新座標，每個動畫幀最多算一次射線（一幀內來再多 pointermove 也只算最後一個）。
 * leave／dispose 會取消尚未執行的排程，並讓呼叫端清掉懸停。
 */
export function createHoverProbe(opts: HoverProbeOptions) {
  let pending: { x: number; y: number } | null = null;
  let handle = 0;
  const flush = () => {
    handle = 0;
    if (!pending) return;
    const { x, y } = pending;
    pending = null;
    opts.onResult(opts.hit(x, y));
  };
  const clear = () => {
    pending = null;
    if (handle) opts.cancel(handle);
    handle = 0;
  };
  return {
    move(x: number, y: number) {
      pending = { x, y };
      if (!handle) handle = opts.schedule(flush);
    },
    leave() {
      clear();
      opts.onResult(null);
    },
    dispose() {
      clear();
    },
  };
}

export interface CanvasHoverOptions {
  hit: (clientX: number, clientY: number) => ChannelId | null;
  hover: () => HoverStore | undefined;
  /** 游標：有打到且可點時為 "pointer"，否則 "" */
  setCursor: (cursor: string) => void;
  pickable: () => boolean;
  schedule: (cb: () => void) => number;
  cancel: (handle: number) => void;
}

/** 把 3D 畫布的 pointermove／pointerleave 接上懸停 store（來源 "3d"）。回傳解除函式。 */
export function bindCanvasHover(el: HTMLElement, o: CanvasHoverOptions): () => void {
  const probe = createHoverProbe({
    hit: o.hit,
    schedule: o.schedule,
    cancel: o.cancel,
    onResult: (ch) => {
      o.setCursor(o.pickable() && ch ? "pointer" : "");
      const h = o.hover();
      if (ch) h?.set(ch, "3d");
      else h?.release("3d");
    },
  });
  const onMove = (e: Event) => {
    const pe = e as PointerEvent;
    probe.move(pe.clientX, pe.clientY);
  };
  const onLeave = () => {
    probe.leave();
    o.setCursor("");
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);
  return () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerleave", onLeave);
    probe.dispose();
    o.setCursor("");
    o.hover()?.release("3d");
  };
}
