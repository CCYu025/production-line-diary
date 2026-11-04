import { describe, expect, it } from "vitest";
import { BOOT_FULL, BOOT_SHORT } from "../transition/timing";
import { BAND_MIN, biosKey, biosLines, biosVisibleLines, bootFrame, GLOW_MAX, LINE_PEAK } from "./bootVisual";

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
    expect(b3a.bandW).toBeLessThan(0.1); // 一開始是中心的一個點
    expect(b3b.band).toBeGreaterThan(1); // 結束時光柵已打開成全畫面

    const b4mid = bootFrame("full", (BOOT_FULL.B4[0] + BOOT_FULL.B4[1]) / 2, 5);
    expect(b4mid.reveal).toBeGreaterThan(0);
    expect(b4mid.reveal).toBeLessThan(1);

    const end = bootFrame("full", BOOT_FULL.total, 5);
    expect(end.done).toBe(true);
    expect(end.reveal).toBe(1);
    expect(end.band).toBe(-1);
    expect(end.biosOn).toBe(false);
  });
  it("B3：只有線是亮的——亮線先展開到全寬，再垂直打開成暗光柵（光柵亮度 <= 亮線峰值的 20%）", () => {
    let peakLine = 0;
    let maxGlow = 0;
    let widthFullAt = -1;
    let openStartsAt = -1;
    for (let t = BOOT_FULL.B3[0]; t < BOOT_FULL.B3[1]; t += 10) {
      const f = bootFrame("full", t, 5);
      peakLine = Math.max(peakLine, f.line);
      maxGlow = Math.max(maxGlow, f.glow);
      if (widthFullAt < 0 && f.bandW >= 1) widthFullAt = t;
      if (openStartsAt < 0 && f.band > 0.05) openStartsAt = t;
    }
    expect(peakLine).toBe(LINE_PEAK);
    expect(maxGlow).toBeGreaterThan(0);
    expect(maxGlow).toBeLessThanOrEqual(0.2 * peakLine + 1e-9);
    expect(GLOW_MAX).toBeLessThanOrEqual(0.2 * LINE_PEAK);
    // 先橫向展開（細線），之後才垂直打開
    expect(widthFullAt).toBeGreaterThanOrEqual(0);
    expect(openStartsAt).toBeGreaterThan(widthFullAt - 100);
    // 打開之前沒有光柵（只有線）
    expect(bootFrame("full", BOOT_FULL.B3[0] + 50, 5).glow).toBe(0);
  });

  it("B3 → B4 直接交疊：邊界上光柵與亮線連續（沒有黑畫面），B4 期間光柵淡出到 0", () => {
    for (const kind of ["full", "short"] as const) {
      const T = kind === "full" ? BOOT_FULL : BOOT_SHORT;
      const before = bootFrame(kind, T.B3[1] - 1, 5);
      const after = bootFrame(kind, T.B4[0], 5);
      expect(Math.abs(after.glow - before.glow)).toBeLessThan(0.02);
      expect(Math.abs(after.line - before.line)).toBeLessThan(0.05);
      expect(after.band).toBeGreaterThan(1);
      expect(after.glow).toBeGreaterThan(0.1); // 邊界上還有光柵（不是黑）
      expect(bootFrame(kind, T.B4[1] - 1, 5).glow).toBe(0);
    }
  });

  it("短開機只有 B3＋B4，沒有 BIOS 文字", () => {
    expect(bootFrame("short", 0, 5).biosOn).toBe(false);
    expect(bootFrame("short", 100, 5).bandW).toBeGreaterThan(0);
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
    expect(BOOT_FULL.total).toBeLessThanOrEqual(3900);
    expect(BOOT_SHORT.total).toBeLessThanOrEqual(1000);
  });
});
