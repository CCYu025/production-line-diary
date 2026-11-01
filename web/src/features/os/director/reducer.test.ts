import { describe, expect, it } from "vitest";
import { endOf, initialState, isPreHandoff, phaseOf, placeOf, reduce, type DirectorEvent, type DirectorState, type Place } from "./reducer";

const HUB: DirectorState = { kind: "HUB" };
const ENT_PRE: DirectorState = { kind: "ENTERING", ch: "CH-02", handoff: false };
const ENT_POST: DirectorState = { kind: "ENTERING", ch: "CH-02", handoff: true };
const STA: DirectorState = { kind: "STATION", ch: "CH-02" };
const EXI_PRE: DirectorState = { kind: "EXITING", ch: "CH-02", handoff: false };
const EXI_POST: DirectorState = { kind: "EXITING", ch: "CH-02", handoff: true };

const toHub: Place = { kind: "hub" };
const toCh = (ch: "CH-01" | "CH-02" | "CH-03" | null): Place => ({ kind: "channel", ch });
const route = (to: Place, instant = false): DirectorEvent => ({ type: "ROUTE", to, instant });

describe("placeOf / initialState", () => {
  it("/os → hub；頻道路徑 → channel；未知路徑 → ch null", () => {
    expect(placeOf("/os")).toEqual(toHub);
    expect(placeOf("/records")).toEqual(toCh("CH-02"));
    expect(placeOf("/records/9/edit")).toEqual(toCh("CH-02"));
    expect(placeOf("/_ui")).toEqual(toCh(null));
  });
  it("初始狀態沒有轉場", () => {
    expect(initialState(toHub)).toEqual(HUB);
    expect(initialState(toCh("CH-02"))).toEqual(STA);
  });
});

describe("HUB", () => {
  it("/os → 頻道＝ENTERING（未到交接點）", () => expect(reduce(HUB, route(toCh("CH-02")))).toEqual(ENT_PRE));
  it("/os → /os 不變", () => expect(reduce(HUB, route(toHub))).toBe(HUB));
  it("減少動態效果：直接到 STATION", () => expect(reduce(HUB, route(toCh("CH-02"), true))).toEqual(STA));
  it("HANDOFF／DONE／INPUT 不做事", () => {
    expect(reduce(HUB, { type: "HANDOFF" })).toBe(HUB);
    expect(reduce(HUB, { type: "DONE" })).toBe(HUB);
    expect(reduce(HUB, { type: "INPUT" })).toBe(HUB);
  });
});

describe("ENTERING", () => {
  it("HANDOFF → 交接點之後", () => expect(reduce(ENT_PRE, { type: "HANDOFF" })).toEqual(ENT_POST));
  it("重複 HANDOFF 不變", () => expect(reduce(ENT_POST, { type: "HANDOFF" })).toBe(ENT_POST));
  it("DONE → STATION（交接前後皆然）", () => {
    expect(reduce(ENT_PRE, { type: "DONE" })).toEqual(STA);
    expect(reduce(ENT_POST, { type: "DONE" })).toEqual(STA);
  });
  it("交接點前輸入 → 跳到終點 STATION", () => expect(reduce(ENT_PRE, { type: "INPUT" })).toEqual(STA));
  it("交接點後輸入 → 不做事", () => expect(reduce(ENT_POST, { type: "INPUT" })).toBe(ENT_POST));
  it("轉場中換路由到 /os：先跳到 STATION，再 EXITING", () => {
    expect(reduce(ENT_PRE, route(toHub))).toEqual(EXI_PRE);
    expect(reduce(ENT_POST, route(toHub))).toEqual(EXI_PRE);
  });
  it("轉場中換到另一個頻道：跳到終點後即時切換", () => {
    expect(reduce(ENT_PRE, route(toCh("CH-01")))).toEqual({ kind: "STATION", ch: "CH-01" });
  });
  it("轉場中換到同一個頻道：跳到終點", () => expect(reduce(ENT_PRE, route(toCh("CH-02")))).toEqual(STA));
});

describe("STATION", () => {
  it("頻道 → /os ＝ EXITING", () => expect(reduce(STA, route(toHub))).toEqual(EXI_PRE));
  it("減少動態效果：直接 HUB", () => expect(reduce(STA, route(toHub, true))).toEqual(HUB));
  it("同一頻道內（/records → /records/63/edit）不播轉場", () => expect(reduce(STA, route(toCh("CH-02")))).toBe(STA));
  it("頻道 A → B 即時切換（X0 沒有 SWITCHING）", () => {
    expect(reduce(STA, route(toCh("CH-03")))).toEqual({ kind: "STATION", ch: "CH-03" });
  });
  it("未知路徑 → 頻道 null 的 STATION", () => expect(reduce(STA, route(toCh(null)))).toEqual({ kind: "STATION", ch: null }));
  it("HANDOFF／DONE／INPUT 不做事", () => {
    expect(reduce(STA, { type: "HANDOFF" })).toBe(STA);
    expect(reduce(STA, { type: "DONE" })).toBe(STA);
    expect(reduce(STA, { type: "INPUT" })).toBe(STA);
  });
});

describe("EXITING", () => {
  it("HANDOFF → 交接點之後", () => expect(reduce(EXI_PRE, { type: "HANDOFF" })).toEqual(EXI_POST));
  it("重複 HANDOFF 不變", () => expect(reduce(EXI_POST, { type: "HANDOFF" })).toBe(EXI_POST));
  it("DONE → HUB", () => {
    expect(reduce(EXI_PRE, { type: "DONE" })).toEqual(HUB);
    expect(reduce(EXI_POST, { type: "DONE" })).toEqual(HUB);
  });
  it("交接點前輸入 → 跳到 HUB", () => expect(reduce(EXI_PRE, { type: "INPUT" })).toEqual(HUB));
  it("交接點後輸入 → 不做事", () => expect(reduce(EXI_POST, { type: "INPUT" })).toBe(EXI_POST));
  it("轉場中換路由到頻道：先跳到 HUB，再 ENTERING", () => {
    expect(reduce(EXI_PRE, route(toCh("CH-03")))).toEqual({ kind: "ENTERING", ch: "CH-03", handoff: false });
    expect(reduce(EXI_POST, route(toCh("CH-02")))).toEqual(ENT_PRE);
  });
  it("轉場中又換到 /os：跳到 HUB 後維持 HUB", () => expect(reduce(EXI_PRE, route(toHub))).toEqual(HUB));
});

describe("輔助", () => {
  it("phaseOf", () => {
    expect([HUB, ENT_PRE, ENT_POST, STA, EXI_PRE, EXI_POST].map(phaseOf)).toEqual([
      "hub",
      "entering-pre",
      "entering-post",
      "station",
      "exiting-pre",
      "exiting-post",
    ]);
  });
  it("isPreHandoff／endOf", () => {
    expect([HUB, ENT_PRE, ENT_POST, STA, EXI_PRE, EXI_POST].map(isPreHandoff)).toEqual([false, true, false, false, true, false]);
    expect(endOf(ENT_POST)).toEqual(STA);
    expect(endOf(EXI_POST)).toEqual(HUB);
    expect(endOf(STA)).toBe(STA);
  });
  it("連按上一頁：進入中 → /os → 頻道，每一步都落在合法狀態", () => {
    let s = reduce(HUB, route(toCh("CH-02")));
    s = reduce(s, route(toHub));
    expect(s).toEqual(EXI_PRE);
    s = reduce(s, route(toCh("CH-02")));
    expect(s).toEqual(ENT_PRE);
  });
});
