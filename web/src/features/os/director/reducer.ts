/*
 * 導演狀態機（docs/os-mode-spec.md §3.3），X0 子集：HUB、ENTERING(ch)、STATION(ch)、EXITING(ch)。
 * 純函式，沒有計時器：交接點與轉場結束由 useDirector 用計時器送 HANDOFF／DONE 事件進來。
 * （BOOT、SWITCHING 是 X1 的範圍：X0 頻道之間切換一律是即時切換。）
 */
import { channelForPath, isHubPath, type ChannelId } from "../channels";

/** 路由所在的位置：控制室，或某個頻道（ch 為 null＝不屬於任何頻道的路徑，例如開發用的 /_ui）。 */
export type Place = { kind: "hub" } | { kind: "channel"; ch: ChannelId | null };

export type DirectorState =
  | { kind: "HUB" }
  | { kind: "ENTERING"; ch: ChannelId | null; handoff: boolean }
  | { kind: "STATION"; ch: ChannelId | null }
  | { kind: "EXITING"; ch: ChannelId | null; handoff: boolean };

export type DirectorEvent =
  /** 路由變化；instant＝減少動態效果，不播轉場 */
  | { type: "ROUTE"; to: Place; instant?: boolean }
  /** 轉場到達交接點 */
  | { type: "HANDOFF" }
  /** 轉場播完 */
  | { type: "DONE" }
  /** 使用者輸入（按鍵或點擊）：交接點之前跳到終點，之後不做事 */
  | { type: "INPUT" };

export type Phase = "hub" | "entering-pre" | "entering-post" | "station" | "exiting-pre" | "exiting-post";

export function placeOf(pathname: string): Place {
  if (isHubPath(pathname)) return { kind: "hub" };
  return { kind: "channel", ch: channelForPath(pathname) };
}

/** 第一個路徑決定的初始狀態：直接載入不播轉場。 */
export function initialState(place: Place): DirectorState {
  return place.kind === "hub" ? { kind: "HUB" } : { kind: "STATION", ch: place.ch };
}

/** 轉場的終點（非轉場狀態原樣回傳）。 */
export function endOf(s: DirectorState): DirectorState {
  if (s.kind === "ENTERING") return { kind: "STATION", ch: s.ch };
  if (s.kind === "EXITING") return { kind: "HUB" };
  return s;
}

export function isTransition(s: DirectorState): s is Extract<DirectorState, { kind: "ENTERING" | "EXITING" }> {
  return s.kind === "ENTERING" || s.kind === "EXITING";
}

/** 交接點之前的轉場（輸入會被攔截並跳到終點）。 */
export function isPreHandoff(s: DirectorState): boolean {
  return isTransition(s) && !s.handoff;
}

export function phaseOf(s: DirectorState): Phase {
  switch (s.kind) {
    case "HUB":
      return "hub";
    case "STATION":
      return "station";
    case "ENTERING":
      return s.handoff ? "entering-post" : "entering-pre";
    case "EXITING":
      return s.handoff ? "exiting-post" : "exiting-pre";
  }
}

export function reduce(state: DirectorState, event: DirectorEvent): DirectorState {
  switch (event.type) {
    case "ROUTE": {
      // 轉場進行中又換路由：目前的轉場直接跳到終點，再依新的路由決定下一段
      const from = endOf(state);
      const to = event.to;
      if (from.kind === "HUB") {
        if (to.kind === "hub") return from;
        return event.instant ? { kind: "STATION", ch: to.ch } : { kind: "ENTERING", ch: to.ch, handoff: false };
      }
      if (from.kind !== "STATION") return from;
      if (to.kind === "hub") return event.instant ? { kind: "HUB" } : { kind: "EXITING", ch: from.ch, handoff: false };
      // 頻道之間（含同一頻道內）：X0 一律即時切換（SWITCHING 是 X1）
      return from.ch === to.ch ? from : { kind: "STATION", ch: to.ch };
    }
    case "HANDOFF":
      if (isTransition(state) && !state.handoff) return { ...state, handoff: true };
      return state;
    case "DONE":
      return endOf(state);
    case "INPUT":
      return isPreHandoff(state) ? endOf(state) : state;
  }
}
