import { describe, expect, it } from "vitest";
import { arrivalOf } from "./focusRule";
import type { DirectorState } from "./reducer";

const hub = (gen = 0): DirectorState => ({ kind: "HUB", gen });
const st = (ch: "CH-01" | "CH-02" | null, gen = 0): DirectorState => ({ kind: "STATION", ch, gen });
const ent = (handoff: boolean, gen = 1): DirectorState => ({ kind: "ENTERING", ch: "CH-02", handoff, gen });
const ex = (handoff: boolean, gen = 1): DirectorState => ({ kind: "EXITING", ch: "CH-02", handoff, gen });
const sw = (handoff: boolean, gen = 1): DirectorState => ({ kind: "SWITCHING", from: "CH-01", to: "CH-02", handoff, gen });

describe("arrivalOf", () => {
  it("進入：交接點 → station；交接點之前的跳過 → station；交接點之後的結束 → 不再移動", () => {
    expect(arrivalOf(ent(false), ent(true))).toBe("station");
    expect(arrivalOf(ent(false), st("CH-02", 1))).toBe("station");
    expect(arrivalOf(ent(true), st("CH-02", 1))).toBeNull();
  });

  it("切換：同進入", () => {
    expect(arrivalOf(sw(false), sw(true))).toBe("station");
    expect(arrivalOf(sw(false), st("CH-02", 1))).toBe("station");
    expect(arrivalOf(sw(true), st("CH-02", 1))).toBeNull();
  });

  it("離開：交接點 → hub；交接點之前的跳過 → hub；之後的結束 → 不再移動", () => {
    expect(arrivalOf(ex(false), ex(true))).toBe("hub");
    expect(arrivalOf(ex(false), hub(1))).toBe("hub");
    expect(arrivalOf(ex(true), hub(1))).toBeNull();
  });

  it("減少動態效果（直接切換）：hub → station、station → station（不同頻道）、station → hub", () => {
    expect(arrivalOf(hub(), st("CH-02"))).toBe("station");
    expect(arrivalOf(st("CH-01"), st("CH-02"))).toBe("station");
    expect(arrivalOf(st("CH-02"), hub())).toBe("hub");
  });

  it("沒有新目的地：同一頻道內、狀態沒變、轉場進行中換成新的轉場", () => {
    expect(arrivalOf(st("CH-02"), st("CH-02"))).toBeNull();
    const s = st("CH-02");
    expect(arrivalOf(s, s)).toBeNull();
    expect(arrivalOf(ent(true), sw(false, 2))).toBeNull();
    expect(arrivalOf(hub(), ent(false))).toBeNull();
    expect(arrivalOf(st("CH-02"), ex(false))).toBeNull();
  });

  it("新轉場的交接點（gen 不同）仍算抵達", () => {
    expect(arrivalOf(sw(true, 1), sw(true, 2))).toBe("station");
  });
});
