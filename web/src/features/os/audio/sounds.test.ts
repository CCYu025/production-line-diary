import { describe, expect, it } from "vitest";
import { ENTER, EXIT } from "../transition/timing";
import {
  compressorMakeupDb,
  dbToLinear,
  FREQ_MAX,
  FREQ_MIN,
  LIMITER,
  LIMITER_TRIM,
  linearToDb,
  MASTER_GAIN,
  peakBound,
  peakBoundDbfs,
  SOUND_IDS,
  SOUNDS,
  type SoundId,
} from "./sounds";

/** brief §2 的音效表：長度上限（秒）與相對音量（dB）。 */
const TABLE: Record<SoundId, { maxSec: number | null; db: number }> = {
  boot: { maxSec: 2.5, db: 0 },
  hum: { maxSec: null, db: -24 },
  relay: { maxSec: 0.06, db: -10 },
  enterRise: { maxSec: ENTER.E1[1] / 1000, db: -6 },
  enterClick: { maxSec: 0.06, db: -6 },
  enterNoise: { maxSec: (ENTER.E3[1] - ENTER.E3[0]) / 1000, db: -6 },
  exitChirp: { maxSec: (EXIT.X1[1] - EXIT.X1[0]) / 1000, db: -8 },
  exitDescend: { maxSec: (EXIT.X4[1] - EXIT.X4[0]) / 1000, db: -8 },
  switchNoise: { maxSec: 0.15, db: -8 },
  alert: { maxSec: 0.2, db: -6 },
  error: { maxSec: 0.15, db: -10 },
  cut: { maxSec: 0.06, db: -8 },
};

describe("A7：音效表參數範圍", () => {
  it("每個音效都在表裡，id 一致，沒有多餘的音效", () => {
    expect(SOUND_IDS.sort()).toEqual(Object.keys(TABLE).sort());
    for (const id of SOUND_IDS) expect(SOUNDS[id].id).toBe(id);
  });

  for (const id of Object.keys(TABLE) as SoundId[]) {
    const spec = SOUNDS[id];
    const row = TABLE[id];
    describe(id, () => {
      it("長度符合上表；所有聲部都在音效長度之內", () => {
        if (row.maxSec === null) {
          expect(spec.durationSec).toBeNull();
          return;
        }
        expect(spec.durationSec).not.toBeNull();
        expect(spec.durationSec!).toBeGreaterThan(0);
        expect(spec.durationSec!).toBeLessThanOrEqual(row.maxSec + 1e-9);
        for (const v of spec.voices) {
          expect(v.at).toBeGreaterThanOrEqual(0);
          expect(v.dur).toBeGreaterThan(0);
          expect(v.at + v.dur).toBeLessThanOrEqual(spec.durationSec! + 1e-9);
          expect(v.attack + v.release).toBeLessThanOrEqual(v.dur + 1e-9);
        }
      });

      it("頻率（振盪器與濾波器，起迄兩端）都在 20–12,000 Hz", () => {
        expect(spec.voices.length).toBeGreaterThan(0);
        for (const v of spec.voices) {
          const freqs = v.kind === "osc" ? v.freq : v.filter.freq;
          for (const f of freqs) {
            expect(f).toBeGreaterThanOrEqual(FREQ_MIN);
            expect(f).toBeLessThanOrEqual(FREQ_MAX);
          }
          if (v.kind === "noise") {
            expect(v.filter.q).toBeGreaterThan(0);
            expect(v.filter.q).toBeLessThanOrEqual(2);
          }
        }
      });

      it("增益：每個聲部 ≤ 1、同時發聲的總和 ≤ 1、相對音量符合上表（≤ 0 dB）", () => {
        for (const v of spec.voices) {
          expect(v.gain).toBeGreaterThan(0);
          expect(v.gain).toBeLessThanOrEqual(1);
        }
        expect(peakBound(spec)).toBeLessThanOrEqual(1 + 1e-9);
        expect(spec.gainDb).toBe(row.db);
        expect(spec.gainDb).toBeLessThanOrEqual(0);
      });

      it("經過總音量之後的峰值上界 ≤ −18 dBFS", () => {
        expect(peakBoundDbfs(spec)).toBeLessThanOrEqual(-18);
      });
    });
  }

  it("開機音 0 dB：聲部總和達 1（峰值＝上限，−18.06 dBFS）", () => {
    expect(peakBound(SOUNDS.boot)).toBeCloseTo(1, 6);
    expect(peakBoundDbfs(SOUNDS.boot)).toBeCloseTo(linearToDb(MASTER_GAIN), 6);
  });

  it("嗡聲：60Hz 基音，其餘是整數倍泛音", () => {
    const freqs = SOUNDS.hum.voices.map((v) => (v.kind === "osc" ? v.freq[0] : 0));
    expect(freqs[0]).toBe(60);
    for (const f of freqs) expect(f % 60).toBe(0);
  });

  it("單一音效最多 4 個同時發聲的聲部以上也不超過：全表聲部總數合理（沒有失控的資料）", () => {
    for (const id of SOUND_IDS) expect(SOUNDS[id].voices.length).toBeLessThanOrEqual(8);
  });
});

describe("A7：總音量上限與限制器", () => {
  it("總音量 ≤ −18 dBFS（線性 ≤ 0.1259）", () => {
    expect(MASTER_GAIN).toBeLessThanOrEqual(dbToLinear(-18));
    expect(linearToDb(MASTER_GAIN)).toBeLessThanOrEqual(-18);
    // 但不要太小：和上限相差不到 0.1 dB（開機音峰值＝上限）
    expect(linearToDb(MASTER_GAIN)).toBeGreaterThan(-18.1);
  });
  it("限制器：threshold −18 dBFS、ratio 20、attack 1ms", () => {
    expect(LIMITER.thresholdDb).toBe(-18);
    expect(LIMITER.ratio).toBe(20);
    expect(LIMITER.attackSec).toBe(0.001);
  });
  it("補償增益：knee 0 約 +10.26 dB、knee 30 約 +2.01 dB（Chrome 實測值）；trim 剛好抵銷", () => {
    expect(compressorMakeupDb(-18, 0, 20)).toBeCloseTo(10.26, 2);
    expect(compressorMakeupDb(-18, 30, 20)).toBeCloseTo(2.01, 2);
    expect(linearToDb(LIMITER_TRIM) + compressorMakeupDb(LIMITER.thresholdDb, LIMITER.kneeDb, LIMITER.ratio)).toBeCloseTo(0, 6);
  });
});
