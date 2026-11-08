/*
 * 懸停預覽的共用狀態（docs/holo-mode-spec.md §7.2；H0）：HUD 頻道鍵與 3D 螢幕雙向連動。
 * 懸停只是預覽——不改變選取、不進入頻道、不動 aria-current；HUD 鍵與 3D 螢幕各自只讀這個值來亮起。
 * 外部 store（不放在 OsShell 的 state 裡），懸停改變不會讓整個外殼重繪。每個 OsShell 自己建一個，不用模組層級的全域值。
 */
import * as React from "react";
import type { ChannelId } from "../channels";

export interface HoverStore {
  get(): ChannelId | null;
  set(id: ChannelId | null): void;
  subscribe(listener: () => void): () => void;
}

export function createHoverStore(): HoverStore {
  let value: ChannelId | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(id) {
      if (id === value) return;
      value = id;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
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
