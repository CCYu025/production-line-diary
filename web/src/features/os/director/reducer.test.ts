import { describe, expect, it } from "vitest";
import {
  bootState,
  endOf,
  initialState,
  isPreHandoff,
  isTransition,
  phaseOf,
  placeOf,
  reduce,
  stationChOf,
  transitionKindOf,
  type DirectorEvent,
  type DirectorState,
  type Phase,
  type Place,
} from "./reducer";

type C = "CH-01" | "CH-02" | "CH-03" | "CH-05" | null;
const G = 3; // 測試用的目前世代

const toHub: Place = { kind: "hub" };
const toCh = (ch: C): Place => ({ kind: "channel", ch });
const route = (to: Place, instant = false): DirectorEvent => ({ type: "ROUTE", to, instant });

const BOOT_HUB: DirectorState = { kind: "BOOT", dest: toHub, gen: G };
const BOOT_CH: DirectorState = { kind: "BOOT", dest: toCh("CH-02"), gen: G };
const HUB: DirectorState = { kind: "HUB", gen: G };
const ENT_PRE: DirectorState = { kind: "ENTERING", ch: "CH-02", handoff: false, gen: G };
const ENT_POST: DirectorState = { kind: "ENTERING", ch: "CH-02", handoff: true, gen: G };
const STA: DirectorState = { kind: "STATION", ch: "CH-02", gen: G };
const EXI_PRE: DirectorState = { kind: "EXITING", ch: "CH-02", handoff: false, gen: G };
const EXI_POST: DirectorState = { kind: "EXITING", ch: "CH-02", handoff: true, gen: G };
const SW_PRE: DirectorState = { kind: "SWITCHING", from: "CH-02", to: "CH-03", handoff: false, gen: G };
const SW_POST: DirectorState = { kind: "SWITCHING", from: "CH-02", to: "CH-03", handoff: true, gen: G };

const ALL: Record<string, DirectorState> = { BOOT_HUB, BOOT_CH, HUB, ENT_PRE, ENT_POST, STA, EXI_PRE, EXI_POST, SW_PRE, SW_POST };

const STA_AT = (ch: C, gen = G): DirectorState => ({ kind: "STATION", ch, gen });
const ENT = (ch: C, gen: number): DirectorState => ({ kind: "ENTERING", ch, handoff: false, gen });
const EXI = (ch: C, gen: number): DirectorState => ({ kind: "EXITING", ch, handoff: false, gen });
const SW = (from: C, to: C, gen: number): DirectorState => ({
  kind: "SWITCHING",
  from,
  to,
  handoff: false,
  gen,
});
const HUB_AT = (gen = G): DirectorState => ({ kind: "HUB", gen });

describe("placeOf / initialState / bootState", () => {
  it("/os → hub；頻道路徑 → channel；未知路徑 → ch null", () => {
    expect(placeOf("/os")).toEqual(toHub);
    expect(placeOf("/")).toEqual(toHub);
    expect(placeOf("/records")).toEqual(toCh("CH-02"));
    expect(placeOf("/records/9/edit")).toEqual(toCh("CH-02"));
    expect(placeOf("/_ui")).toEqual(toCh(null));
  });
  it("初始狀態沒有轉場、gen 預設 0", () => {
    expect(initialState(toHub)).toEqual({ kind: "HUB", gen: 0 });
    expect(initialState(toCh("CH-02"))).toEqual({ kind: "STATION", ch: "CH-02", gen: 0 });
    expect(initialState(toCh(null), 7)).toEqual({ kind: "STATION", ch: null, gen: 7 });
  });
  it("bootState 帶目的地", () => {
    expect(bootState(toHub, 2)).toEqual({ kind: "BOOT", dest: toHub, gen: 2 });
  });
});

/* ------------------------------------------------------------------------------------------------
 * 每個狀態 × ROUTE（hub／同頻道／另一頻道／null 頻道；一般與 instant）
 * ---------------------------------------------------------------------------------------------- */
describe("ROUTE 對照表（§3.3）", () => {
  interface Row {
    name: string;
    state: DirectorState;
    hub: DirectorState;
    hubI: DirectorState;
    same: DirectorState;
    other: DirectorState;
    otherI: DirectorState;
    nul: DirectorState;
    nulI: DirectorState;
  }
  // state 的終點之後再套路由：HUB 類（從控制室出發）
  const fromHub = (s: DirectorState, name: string): Row => ({
    name,
    state: s,
    hub: HUB_AT(),
    hubI: HUB_AT(),
    same: ENT("CH-02", G + 1), // 控制室 → 任何頻道都是 ENTERING（「同頻道」在控制室沒有意義）
    other: ENT("CH-03", G + 1),
    otherI: STA_AT("CH-03"),
    nul: ENT(null, G + 1),
    nulI: STA_AT(null),
  });
  // 從頻道 CH-02 的工作站出發
  const fromSta02 = (s: DirectorState, name: string): Row => ({
    name,
    state: s,
    hub: EXI("CH-02", G + 1),
    hubI: HUB_AT(),
    same: STA_AT("CH-02"),
    other: SW("CH-02", "CH-03", G + 1),
    otherI: STA_AT("CH-03"),
    nul: SW("CH-02", null, G + 1),
    nulI: STA_AT(null),
  });
  // 從 SWITCHING(CH-02→CH-03) 出發：終點是 STATION(CH-03)
  const fromSw = (s: DirectorState, name: string): Row => ({
    name,
    state: s,
    hub: EXI("CH-03", G + 1),
    hubI: HUB_AT(),
    same: SW("CH-03", "CH-02", G + 1), // 路由回到 CH-02（原本的來源）＝CH-03 → CH-02 的新短轉場
    other: STA_AT("CH-03"), // 路由落在 CH-03 ＝與目前轉場終點相同頻道：跳到終點
    otherI: STA_AT("CH-03"),
    nul: SW("CH-03", null, G + 1),
    nulI: STA_AT(null),
  });

  const rows: Row[] = [
    fromHub(HUB, "HUB"),
    fromHub(EXI_PRE, "EXITING pre"),
    fromHub(EXI_POST, "EXITING post"),
    fromSta02(STA, "STATION"),
    fromSta02(ENT_PRE, "ENTERING pre"),
    fromSta02(ENT_POST, "ENTERING post"),
    fromSw(SW_PRE, "SWITCHING pre"),
    fromSw(SW_POST, "SWITCHING post"),
  ];

  for (const r of rows) {
    describe(r.name, () => {
      it("→ /os", () => {
        expect(reduce(r.state, route(toHub))).toEqual(r.hub);
        expect(reduce(r.state, route(toHub, true))).toEqual(r.hubI);
      });
      it("→ 另一個頻道（一般 / instant）", () => {
        expect(reduce(r.state, route(toCh("CH-03")))).toEqual(r.other);
        expect(reduce(r.state, route(toCh("CH-03"), true))).toEqual(r.otherI);
      });
      it("→ CH-02（STATION／ENTERING＝同一頻道不播轉場；SWITCHING＝回到來源頻道的新短轉場；控制室＝進入）", () => {
        expect(reduce(r.state, route(toCh("CH-02")))).toEqual(r.same);
      });
      it("→ 不屬於任何頻道的路徑（ch null）", () => {
        expect(reduce(r.state, route(toCh(null)))).toEqual(r.nul);
        expect(reduce(r.state, route(toCh(null), true))).toEqual(r.nulI);
      });
    });
  }

  it("STATION → 同一頻道、同一個 ROUTE 回傳同一個物件（無狀態變化、不重繪）", () => {
    expect(reduce(STA, route(toCh("CH-02")))).toBe(STA);
    expect(reduce(STA, route(toCh("CH-02"), true))).toBe(STA);
    expect(reduce(HUB, route(toHub))).toBe(HUB);
  });
  it("STATION(null) → 另一個 null 路徑＝同頻道，不播轉場", () => {
    const s = STA_AT(null);
    expect(reduce(s, route(toCh(null)))).toBe(s);
  });
  it("頻道 A → B 是 SWITCHING（含 from／to），instant 時直接 STATION", () => {
    expect(reduce(STA, route(toCh("CH-05")))).toEqual(SW("CH-02", "CH-05", G + 1));
    expect(reduce(STA, route(toCh("CH-05"), true))).toEqual({ kind: "STATION", ch: "CH-05", gen: G });
  });
  it("ROUTE 缺 instant 欄位等同一般路由", () => {
    expect(reduce(STA, { type: "ROUTE", to: toHub })).toEqual(EXI("CH-02", G + 1));
  });
});

describe("BOOT", () => {
  it("ROUTE 只更新目的地、不離開 BOOT、gen 不變", () => {
    expect(reduce(BOOT_HUB, route(toCh("CH-03")))).toEqual({ kind: "BOOT", dest: toCh("CH-03"), gen: G });
    expect(reduce(BOOT_CH, route(toHub))).toEqual({ kind: "BOOT", dest: toHub, gen: G });
    expect(reduce(BOOT_CH, route(toCh(null), true))).toEqual({ kind: "BOOT", dest: toCh(null), gen: G });
  });
  it("ROUTE 到同一個目的地回傳同一個物件", () => {
    expect(reduce(BOOT_HUB, route(toHub))).toBe(BOOT_HUB);
    expect(reduce(BOOT_CH, route(toCh("CH-02")))).toBe(BOOT_CH);
  });
  it("INPUT（含 swallowed）→ initialState(dest)", () => {
    expect(reduce(BOOT_HUB, { type: "INPUT" })).toEqual(HUB_AT());
    expect(reduce(BOOT_CH, { type: "INPUT" })).toEqual(STA_AT("CH-02"));
    expect(reduce(BOOT_CH, { type: "INPUT", swallowed: true })).toEqual(STA_AT("CH-02"));
  });
  it("DONE／HANDOFF → initialState(dest)（不看 gen：BOOT 不是計時轉場）", () => {
    expect(reduce(BOOT_HUB, { type: "DONE", gen: G })).toEqual(HUB_AT());
    expect(reduce(BOOT_CH, { type: "HANDOFF", gen: 0 })).toEqual(STA_AT("CH-02"));
  });
  it("ROUTE 改了目的地之後結束 BOOT，落在新目的地", () => {
    const s = reduce(BOOT_HUB, route(toCh("CH-03")));
    expect(reduce(s, { type: "INPUT" })).toEqual(STA_AT("CH-03"));
  });
  it("輔助：phase boot、不是轉場、不是 pre-handoff、endOf＝initialState(dest)", () => {
    expect(phaseOf(BOOT_HUB)).toBe("boot");
    expect(isTransition(BOOT_HUB)).toBe(false);
    expect(isPreHandoff(BOOT_HUB)).toBe(false);
    expect(endOf(BOOT_CH)).toEqual(STA_AT("CH-02"));
    expect(transitionKindOf(BOOT_HUB)).toBeNull();
    expect(stationChOf(BOOT_CH)).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------------
 * 每個狀態 × HANDOFF／DONE／INPUT
 * ---------------------------------------------------------------------------------------------- */
describe("HANDOFF（gen 相符）", () => {
  const h = (gen = G): DirectorEvent => ({ type: "HANDOFF", gen });
  it("ENTERING／EXITING／SWITCHING pre → post", () => {
    expect(reduce(ENT_PRE, h())).toEqual(ENT_POST);
    expect(reduce(EXI_PRE, h())).toEqual(EXI_POST);
    expect(reduce(SW_PRE, h())).toEqual(SW_POST);
  });
  it("已經 post：原樣", () => {
    expect(reduce(ENT_POST, h())).toBe(ENT_POST);
    expect(reduce(EXI_POST, h())).toBe(EXI_POST);
    expect(reduce(SW_POST, h())).toBe(SW_POST);
  });
  it("HUB／STATION：原樣", () => {
    expect(reduce(HUB, h())).toBe(HUB);
    expect(reduce(STA, h())).toBe(STA);
  });
});

describe("DONE（gen 相符）", () => {
  const d = (gen = G): DirectorEvent => ({ type: "DONE", gen });
  it("ENTERING → STATION（交接前後皆然）", () => {
    expect(reduce(ENT_PRE, d())).toEqual(STA);
    expect(reduce(ENT_POST, d())).toEqual(STA);
  });
  it("EXITING → HUB", () => {
    expect(reduce(EXI_PRE, d())).toEqual(HUB);
    expect(reduce(EXI_POST, d())).toEqual(HUB);
  });
  it("SWITCHING → STATION(to)", () => {
    expect(reduce(SW_PRE, d())).toEqual(STA_AT("CH-03"));
    expect(reduce(SW_POST, d())).toEqual(STA_AT("CH-03"));
  });
  it("HUB／STATION：原樣", () => {
    expect(reduce(HUB, d())).toBe(HUB);
    expect(reduce(STA, d())).toBe(STA);
  });
});

describe("INPUT", () => {
  it("交接點之前：跳到終點（ENTERING／EXITING／SWITCHING）", () => {
    expect(reduce(ENT_PRE, { type: "INPUT" })).toEqual(STA);
    expect(reduce(EXI_PRE, { type: "INPUT" })).toEqual(HUB);
    expect(reduce(SW_PRE, { type: "INPUT" })).toEqual(STA_AT("CH-03"));
  });
  it("交接點之後：不做事", () => {
    expect(reduce(ENT_POST, { type: "INPUT" })).toBe(ENT_POST);
    expect(reduce(EXI_POST, { type: "INPUT" })).toBe(EXI_POST);
    expect(reduce(SW_POST, { type: "INPUT" })).toBe(SW_POST);
  });
  it("HUB／STATION：不做事", () => {
    expect(reduce(HUB, { type: "INPUT" })).toBe(HUB);
    expect(reduce(STA, { type: "INPUT" })).toBe(STA);
  });
  it("swallowed：輸入已被閘吃掉，即使 HANDOFF 剛好排在前面也跳到終點", () => {
    expect(reduce(ENT_POST, { type: "INPUT", swallowed: true })).toEqual(STA);
    expect(reduce(EXI_POST, { type: "INPUT", swallowed: true })).toEqual(HUB);
    expect(reduce(SW_POST, { type: "INPUT", swallowed: true })).toEqual(STA_AT("CH-03"));
    expect(reduce(ENT_PRE, { type: "INPUT", swallowed: true })).toEqual(STA);
    expect(reduce(STA, { type: "INPUT", swallowed: true })).toBe(STA);
    expect(reduce(HUB, { type: "INPUT", swallowed: true })).toBe(HUB);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 世代計數：過期計時器永遠不會動作
 * ---------------------------------------------------------------------------------------------- */
describe("gen（過期計時器回歸）", () => {
  it("ROUTE 建立轉場時 gen = 前一個 gen + 1", () => {
    const a = reduce(HUB_AT(0), route(toCh("CH-02")));
    expect(a).toEqual(ENT("CH-02", 1));
    const b = reduce(reduce(a, { type: "DONE", gen: 1 }), route(toHub));
    expect(b).toEqual(EXI("CH-02", 2));
    const c = reduce(reduce(b, { type: "DONE", gen: 2 }), route(toCh("CH-01")));
    expect(c).toEqual(ENT("CH-01", 3));
  });

  it("舊 gen 的 DONE／HANDOFF 在新轉場開始後不做事", () => {
    // 進入（gen 1）進行到一半，使用者連按：回到 /os（EXITING gen 2）
    const entering = reduce(HUB_AT(0), route(toCh("CH-02")));
    const exiting = reduce(entering, route(toHub));
    expect(exiting).toEqual(EXI("CH-02", 2));
    expect(reduce(exiting, { type: "DONE", gen: 1 })).toBe(exiting); // 舊進入的 DONE
    expect(reduce(exiting, { type: "HANDOFF", gen: 1 })).toBe(exiting); // 舊進入的 HANDOFF
    // 新轉場自己的計時器照常生效
    expect(reduce(exiting, { type: "HANDOFF", gen: 2 })).toEqual({ ...exiting, handoff: true });
    expect(reduce(exiting, { type: "DONE", gen: 2 })).toEqual(HUB_AT(2));
  });

  it("同種轉場連續兩次（A→B、B→C）：第一段的計時器不影響第二段", () => {
    const first = reduce(STA_AT("CH-01", 0), route(toCh("CH-02")));
    expect(first).toEqual(SW("CH-01", "CH-02", 1));
    const second = reduce(first, route(toCh("CH-03")));
    expect(second).toEqual(SW("CH-02", "CH-03", 2));
    expect(reduce(second, { type: "DONE", gen: 1 })).toBe(second);
    expect(reduce(second, { type: "HANDOFF", gen: 1 })).toBe(second);
    expect(reduce(second, { type: "DONE", gen: 2 })).toEqual(STA_AT("CH-03", 2));
  });

  it("未來的 gen 也不生效", () => {
    expect(reduce(ENT_PRE, { type: "DONE", gen: G + 1 })).toBe(ENT_PRE);
    expect(reduce(SW_PRE, { type: "HANDOFF", gen: G + 1 })).toBe(SW_PRE);
  });

  it("轉場被 INPUT 跳到終點後，原本的計時器（同 gen）再來也不做事", () => {
    const sta = reduce(ENT_PRE, { type: "INPUT" });
    expect(reduce(sta, { type: "HANDOFF", gen: G })).toBe(sta);
    expect(reduce(sta, { type: "DONE", gen: G })).toBe(sta);
  });

  it("instant 路由不增加 gen（沒有轉場、沒有計時器）", () => {
    expect(reduce(HUB_AT(4), route(toCh("CH-02"), true))).toEqual(STA_AT("CH-02", 4));
    expect(reduce(STA_AT("CH-02", 4), route(toHub, true))).toEqual(HUB_AT(4));
  });

  it("轉場中的 instant 路由：跳到終點、不增加 gen；舊計時器之後不做事", () => {
    const next = reduce(ENT_PRE, route(toHub, true));
    expect(next).toEqual(HUB_AT());
    expect(reduce(next, { type: "DONE", gen: G })).toBe(next);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 轉場中換路由（連按上一頁）
 * ---------------------------------------------------------------------------------------------- */
describe("轉場進行中又換路由", () => {
  it("ENTERING 中回到 /os：先跳到 STATION，再 EXITING（新 gen）", () => {
    expect(reduce(ENT_PRE, route(toHub))).toEqual(EXI("CH-02", G + 1));
    expect(reduce(ENT_POST, route(toHub))).toEqual(EXI("CH-02", G + 1));
  });
  it("EXITING 中再進頻道：先跳到 HUB，再 ENTERING", () => {
    expect(reduce(EXI_PRE, route(toCh("CH-03")))).toEqual(ENT("CH-03", G + 1));
    expect(reduce(EXI_POST, route(toCh("CH-02")))).toEqual(ENT("CH-02", G + 1));
  });
  it("EXITING 中又到 /os：跳到 HUB 後維持 HUB", () => {
    expect(reduce(EXI_PRE, route(toHub))).toEqual(HUB_AT());
  });
  it("SWITCHING 中離開到 /os：以 to 為頻道 EXITING", () => {
    expect(reduce(SW_PRE, route(toHub))).toEqual(EXI("CH-03", G + 1));
  });
  it("連按上一頁：進入中 → /os → 頻道，每一步都落在合法狀態", () => {
    let s = reduce(HUB_AT(0), route(toCh("CH-02")));
    s = reduce(s, route(toHub));
    expect(s).toEqual(EXI("CH-02", 2));
    s = reduce(s, route(toCh("CH-02")));
    expect(s).toEqual(ENT("CH-02", 3));
  });
});

/* ------------------------------------------------------------------------------------------------
 * 窮舉不變量：每個狀態 × 每個事件
 * ---------------------------------------------------------------------------------------------- */
describe("窮舉不變量", () => {
  const events: Array<[string, DirectorEvent]> = [
    ["ROUTE hub", route(toHub)],
    ["ROUTE hub instant", route(toHub, true)],
    ["ROUTE ch same", route(toCh("CH-02"))],
    ["ROUTE ch other", route(toCh("CH-01"))],
    ["ROUTE ch other instant", route(toCh("CH-01"), true)],
    ["ROUTE null", route(toCh(null))],
    ["HANDOFF", { type: "HANDOFF", gen: G }],
    ["HANDOFF stale", { type: "HANDOFF", gen: G - 1 }],
    ["DONE", { type: "DONE", gen: G }],
    ["DONE stale", { type: "DONE", gen: G - 1 }],
    ["INPUT", { type: "INPUT" }],
    ["INPUT swallowed", { type: "INPUT", swallowed: true }],
  ];
  const PHASES: Phase[] = ["boot", "hub", "entering-pre", "entering-post", "station", "exiting-pre", "exiting-post", "switching-pre", "switching-post"];

  for (const [sn, s] of Object.entries(ALL)) {
    for (const [en, e] of events) {
      it(`${sn} × ${en}：回傳合法狀態、gen 只增 0 或 1、不改輸入`, () => {
        const before = JSON.stringify(s);
        const out = reduce(s, e);
        expect(JSON.stringify(s)).toBe(before);
        expect(PHASES).toContain(phaseOf(out));
        expect([G, G + 1]).toContain(out.gen);
        if (out.gen === G + 1) expect(isTransition(out) && !("handoff" in out && out.handoff)).toBe(true);
        if (e.type !== "ROUTE") expect(out.gen).toBe(G); // 只有 ROUTE 會開新轉場
        if (e.type === "ROUTE" && e.instant) expect(isTransition(out)).toBe(false);
      });
    }
  }

  it("過期（gen 不符）的 HANDOFF／DONE 對任何狀態都是 no-op（BOOT 除外：它沒有計時器）", () => {
    for (const [sn, s] of Object.entries(ALL)) {
      if (s.kind === "BOOT") continue;
      expect(reduce(s, { type: "HANDOFF", gen: G - 1 }), sn).toBe(s);
      expect(reduce(s, { type: "DONE", gen: G - 1 }), sn).toBe(s);
    }
  });

  it("INPUT 之後不再是 pre-handoff 轉場（輸入閘不會卡住）", () => {
    for (const s of Object.values(ALL)) expect(isPreHandoff(reduce(s, { type: "INPUT", swallowed: true }))).toBe(false);
  });

  it("DONE 之後（gen 相符）永遠不是轉場", () => {
    for (const s of Object.values(ALL)) expect(isTransition(reduce(s, { type: "DONE", gen: G }))).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 輔助
 * ---------------------------------------------------------------------------------------------- */
describe("輔助", () => {
  it("phaseOf", () => {
    expect([BOOT_HUB, HUB, ENT_PRE, ENT_POST, STA, EXI_PRE, EXI_POST, SW_PRE, SW_POST].map(phaseOf)).toEqual([
      "boot",
      "hub",
      "entering-pre",
      "entering-post",
      "station",
      "exiting-pre",
      "exiting-post",
      "switching-pre",
      "switching-post",
    ]);
  });
  it("isPreHandoff", () => {
    expect([HUB, ENT_PRE, ENT_POST, STA, EXI_PRE, EXI_POST, SW_PRE, SW_POST].map(isPreHandoff)).toEqual([
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
    ]);
  });
  it("isTransition", () => {
    expect([BOOT_HUB, HUB, ENT_PRE, STA, EXI_POST, SW_PRE].map(isTransition)).toEqual([false, false, true, false, true, true]);
  });
  it("endOf：保留 gen", () => {
    expect(endOf(ENT_POST)).toEqual(STA);
    expect(endOf(EXI_POST)).toEqual(HUB);
    expect(endOf(SW_PRE)).toEqual(STA_AT("CH-03"));
    expect(endOf(STA)).toBe(STA);
    expect(endOf(HUB)).toBe(HUB);
  });
  it("transitionKindOf", () => {
    expect([HUB, STA, ENT_PRE, EXI_PRE, SW_PRE].map(transitionKindOf)).toEqual([null, null, "enter", "exit", "switch"]);
  });
  it("stationChOf：SWITCHING 回傳目的地頻道", () => {
    expect([HUB, STA, ENT_PRE, EXI_PRE, SW_PRE].map(stationChOf)).toEqual([null, "CH-02", "CH-02", "CH-02", "CH-03"]);
  });
});
