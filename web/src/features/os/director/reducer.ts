/*
 * 導演狀態機（docs/os-mode-spec.md §3.3）：BOOT、HUB、ENTERING(ch)、STATION(ch)、EXITING(ch)、SWITCHING(from,to)。
 * 純函式，沒有計時器：交接點與轉場結束由 useDirector 用計時器送 HANDOFF／DONE 事件進來。
 *
 * 世代計數（gen）：每個狀態都帶 gen。ROUTE 建立新轉場時 gen = 前一個狀態的 gen + 1；
 * HANDOFF／DONE 事件帶著「計時器建立時的 gen」，只有與目前轉場的 gen 相同才生效。
 * 所以舊轉場留下的計時器（已被新路由取代）永遠不會影響新轉場。
 *
 * BOOT（X2 起有持續時間：完整 ≤ 4s、短 ≤ 1s，計時器由 useDirector 送 DONE；是否開機由 boot.ts 決定）：BOOT 帶著目的地 dest；ROUTE 更新 dest；INPUT／DONE／HANDOFF 一律結束開機 → initialState(dest)。
 */
import { channelForPath, isHubPath, type ChannelId } from "../channels";

/** 路由所在的位置：控制室，或某個頻道（ch 為 null＝不屬於任何頻道的路徑，例如開發用的 /_ui）。 */
export type Place = { kind: "hub" } | { kind: "channel"; ch: ChannelId | null };

export type DirectorState =
  /** short＝短開機（只有 B3＋B4，≤ 1s）；省略或 false＝完整開機（≤ 4s）。見 boot.ts／transition/timing.ts */
  | { kind: "BOOT"; dest: Place; gen: number; short?: boolean }
  | { kind: "HUB"; gen: number }
  | { kind: "ENTERING"; ch: ChannelId | null; handoff: boolean; gen: number }
  | { kind: "STATION"; ch: ChannelId | null; gen: number }
  | { kind: "EXITING"; ch: ChannelId | null; handoff: boolean; gen: number }
  | { kind: "SWITCHING"; from: ChannelId | null; to: ChannelId | null; handoff: boolean; gen: number };

export type DirectorEvent =
  /** 路由變化；instant＝減少動態效果，不播轉場 */
  | { type: "ROUTE"; to: Place; instant?: boolean }
  /** 轉場到達交接點；gen＝計時器建立時的世代，與目前轉場不同就忽略 */
  | { type: "HANDOFF"; gen: number }
  /** 轉場播完；gen 同上 */
  | { type: "DONE"; gen: number }
  /**
   * 使用者輸入（按鍵或點擊）：交接點之前跳到終點，之後不做事。
   * swallowed＝輸入閘已經把這次輸入攔下來了（閘是以「已提交的畫面」為準，HANDOFF 的更新可能剛好排在它前面）：
   * 這次輸入已經被吃掉，所以不管交接旗標，一律跳到終點，不讓使用者的點擊「既被吞掉、轉場又沒跳」。
   */
  | { type: "INPUT"; swallowed?: boolean };

export type Phase =
  | "boot"
  | "hub"
  | "entering-pre"
  | "entering-post"
  | "station"
  | "exiting-pre"
  | "exiting-post"
  | "switching-pre"
  | "switching-post";

export type TransitionKind = "enter" | "exit" | "switch";

export type TransitionState = Extract<DirectorState, { kind: "ENTERING" | "EXITING" | "SWITCHING" }>;

export function placeOf(pathname: string): Place {
  if (isHubPath(pathname)) return { kind: "hub" };
  return { kind: "channel", ch: channelForPath(pathname) };
}

/** 第一個路徑決定的初始狀態：直接載入不播轉場。 */
export function initialState(place: Place, gen = 0): DirectorState {
  return place.kind === "hub" ? { kind: "HUB", gen } : { kind: "STATION", ch: place.ch, gen };
}

/** 開機狀態（X2：控制室第一次顯示時由 boot.ts 的 decideBoot 決定是否進入）。 */
export function bootState(dest: Place, gen = 0, short = false): DirectorState {
  return short ? { kind: "BOOT", dest, gen, short: true } : { kind: "BOOT", dest, gen };
}

/**
 * 輸入閘是否該啟動：轉場在交接點之前，或開機中（X2）。
 * 開機中的第一次按鍵／點擊＝跳過開機，而且那次輸入被閘吃掉、不會傳給下面的畫面。
 */
export function isGateActive(s: DirectorState): boolean {
  return s.kind === "BOOT" || isPreHandoff(s);
}

/** 轉場的終點（非轉場狀態原樣回傳；BOOT 的終點是它的目的地）。 */
export function endOf(s: DirectorState): DirectorState {
  switch (s.kind) {
    case "ENTERING":
      return { kind: "STATION", ch: s.ch, gen: s.gen };
    case "EXITING":
      return { kind: "HUB", gen: s.gen };
    case "SWITCHING":
      return { kind: "STATION", ch: s.to, gen: s.gen };
    case "BOOT":
      return initialState(s.dest, s.gen);
    default:
      return s;
  }
}

export function isTransition(s: DirectorState): s is TransitionState {
  return s.kind === "ENTERING" || s.kind === "EXITING" || s.kind === "SWITCHING";
}

/** 交接點之前的轉場（輸入會被攔截並跳到終點）。BOOT 不算（它沒有輸入閘，由 INPUT 直接結束）。 */
export function isPreHandoff(s: DirectorState): boolean {
  return isTransition(s) && !s.handoff;
}

/** 轉場種類（疊層與計時用）；非轉場回傳 null。 */
export function transitionKindOf(s: DirectorState): TransitionKind | null {
  switch (s.kind) {
    case "ENTERING":
      return "enter";
    case "EXITING":
      return "exit";
    case "SWITCHING":
      return "switch";
    default:
      return null;
  }
}

/** 與狀態相關的工作站頻道：STATION／ENTERING／EXITING 的 ch，SWITCHING 的目的地；HUB／BOOT 為 null。 */
export function stationChOf(s: DirectorState): ChannelId | null {
  switch (s.kind) {
    case "STATION":
    case "ENTERING":
    case "EXITING":
      return s.ch;
    case "SWITCHING":
      return s.to;
    default:
      return null;
  }
}

export function phaseOf(s: DirectorState): Phase {
  switch (s.kind) {
    case "BOOT":
      return "boot";
    case "HUB":
      return "hub";
    case "STATION":
      return "station";
    case "ENTERING":
      return s.handoff ? "entering-post" : "entering-pre";
    case "EXITING":
      return s.handoff ? "exiting-post" : "exiting-pre";
    case "SWITCHING":
      return s.handoff ? "switching-post" : "switching-pre";
  }
}

function samePlace(a: Place, b: Place): boolean {
  return a.kind === "hub" ? b.kind === "hub" : b.kind === "channel" && a.ch === b.ch;
}

export function reduce(state: DirectorState, event: DirectorEvent): DirectorState {
  switch (event.type) {
    case "ROUTE": {
      // 開機中：只更新目的地
      if (state.kind === "BOOT") return samePlace(state.dest, event.to) ? state : { ...state, dest: event.to };
      // 轉場進行中又換路由：目前的轉場直接跳到終點（gen 不變），再依新的路由決定下一段（gen + 1）
      const from = endOf(state);
      const to = event.to;
      if (from.kind === "HUB") {
        if (to.kind === "hub") return from;
        return event.instant
          ? { kind: "STATION", ch: to.ch, gen: from.gen }
          : { kind: "ENTERING", ch: to.ch, handoff: false, gen: from.gen + 1 };
      }
      if (from.kind !== "STATION") return from; // endOf 之後不會發生；保險
      if (to.kind === "hub") {
        return event.instant ? { kind: "HUB", gen: from.gen } : { kind: "EXITING", ch: from.ch, handoff: false, gen: from.gen + 1 };
      }
      // 頻道之間：同一頻道（含兩邊都是 null）不播轉場；不同頻道（含 null）＝短轉場
      if (from.ch === to.ch) return from;
      return event.instant
        ? { kind: "STATION", ch: to.ch, gen: from.gen }
        : { kind: "SWITCHING", from: from.ch, to: to.ch, handoff: false, gen: from.gen + 1 };
    }
    case "HANDOFF":
      if (state.kind === "BOOT") return initialState(state.dest, state.gen);
      if (isTransition(state) && !state.handoff && state.gen === event.gen) return { ...state, handoff: true };
      return state;
    case "DONE":
      if (state.kind === "BOOT") return initialState(state.dest, state.gen);
      return isTransition(state) && state.gen === event.gen ? endOf(state) : state;
    case "INPUT":
      if (state.kind === "BOOT") return initialState(state.dest, state.gen);
      return event.swallowed || isPreHandoff(state) ? endOf(state) : state;
  }
}
