import { describe, expect, it } from "vitest";
import { BOOT_FULL, BOOT_SHORT } from "../transition/timing";
import { BAND_MIN, biosKey, biosLines, biosVisibleLines, bootFrame } from "./bootVisual";

describe("開機時間軸", () => {
  it("完整開機：B2 有 BIOS 文字、不揭曉；B3 亮線展開；B4 由中心向外；結束後全部關閉", () => {
    const b2 = bootFrame("full", 1000, 5);
    expect(b2.biosOn).toBe(true);
    expect(b2.biosLines).toBeGreaterThan(0);
    expect(b2.band).toBe(-1);

    const b3a = bootFrame("full", BOOT_FULL.B3[0], 5);
    const b3b = bootFrame("full", BOOT_FULL.B3[1] - 1, 5);
    expect(b3a.biosOn).toBe(false);
    expect(b3a.reveal).toBe(0);
    expect(b3a.band).toBeGreaterThanOrEqual(BAND_MIN);
    expect(b3a.band).toBeLessThan(0.1);
    expect(b3b.band).toBeGreaterThan(1);
    expect(b3b.bandMix).toBeLessThan(0.05); // B4 開始前亮線已退回背景色

    const b4mid = bootFrame("full", (BOOT_FULL.B4[0] + BOOT_FULL.B4[1]) / 2, 5);
    expect(b4mid.band).toBe(-1);
    expect(b4mid.reveal).toBeGreaterThan(0);
    expect(b4mid.reveal).toBeLessThan(1);

    const end = bootFrame("full", BOOT_FULL.total, 5);
    expect(end.done).toBe(true);
    expect(end.reveal).toBe(1);
    expect(end.band).toBe(-1);
    expect(end.biosOn).toBe(false);
  });
  it("短開機只有 B3＋B4，沒有 BIOS 文字", () => {
    expect(bootFrame("short", 0, 5).biosOn).toBe(false);
    expect(bootFrame("short", 100, 5).band).toBeGreaterThan(0);
    expect(bootFrame("short", BOOT_SHORT.B4[0] + 100, 5).reveal).toBeGreaterThan(0);
    expect(bootFrame("short", BOOT_SHORT.total, 5).done).toBe(true);
  });
  it("揭曉單調遞增到 1（無閃爍）", () => {
    let prev = -1;
    for (let t = BOOT_FULL.B4[0]; t < BOOT_FULL.B4[1]; t += 50) {
      const r = bootFrame("full", t, 5).reveal;
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(bootFrame("full", BOOT_FULL.total, 5).reveal).toBe(1);
  });
  it("BIOS 行數逐行增加，B2 結束前全部出現", () => {
    expect(biosVisibleLines(0, 5)).toBe(1);
    let prev = 0;
    for (let t = 0; t < BOOT_FULL.B2[1]; t += 100) {
      const n = biosVisibleLines(t, 5);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(prev).toBe(5);
  });
  it("BIOS 文字含真實的機台數與紀錄數；沒載入顯示 ---", () => {
    const lines = biosLines({ machines: 12, records: 345 });
    expect(lines[0]).toBe("PLD/OS 1995 BIOS");
    expect(lines).toContain("MEMORY TEST ... 640K OK");
    expect(lines).toContain("EQUIPMENT ... 12 UNITS");
    expect(lines).toContain("RECORDS ... 345");
    expect(lines).toContain("LOADING CONTROL ROOM ...");
    expect(biosLines({ machines: null, records: null }).join("\n")).toContain("---");
  });
  it("內容鍵：行數、游標、計數任何一個改變才重畫", () => {
    const f = bootFrame("full", 1000, 5);
    const k = biosKey(f, { machines: 1, records: 2 });
    expect(biosKey(f, { machines: 1, records: 2 })).toBe(k);
    expect(biosKey(f, { machines: 1, records: 3 })).not.toBe(k);
    expect(biosKey({ ...f, cursorOn: !f.cursorOn }, { machines: 1, records: 2 })).not.toBe(k);
  });
  it("總長不超過上限（A4）", () => {
    expect(BOOT_FULL.total).toBeLessThanOrEqual(4000);
    expect(BOOT_SHORT.total).toBeLessThanOrEqual(1000);
  });
});
