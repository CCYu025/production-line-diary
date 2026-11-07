/*
 * 音效表（docs/os-mode-spec.md §8；X4）：每個音效是一個純資料的參數物件，沒有任何 Web Audio 物件，
 * 由 synth.ts 的 renderSound 依參數在任何 BaseAudioContext（即時或 Offline）上建立節點圖。
 * sounds.test.ts 檢查每個音效的參數範圍：頻率 20–12,000Hz、長度符合上表、增益 ≤ 1、同時發聲的增益總和 ≤ 1。
 *
 * 音量階層（峰值上限 −18 dBFS）：
 *   各聲部（voice）增益 ≤ 1，同時發聲的總和 ≤ 1（peakBound）→ 音效增益（gainDb，相對 0 dB＝開機）→ 總音量 MASTER_GAIN（≈ −18.06 dBFS）
 *   → 安全限制器（DynamicsCompressor，threshold −18 dBFS、ratio 20、attack 1ms）→ 補償 → 輸出。
 *   所以最大聲的開機音在進限制器之前峰值就 ≤ −18.06 dBFS；限制器只是多個音效疊在一起時的保險，不是主要的音量控制。
 */

export type SoundId =
  | "boot"
  | "hum"
  | "relay"
  | "enterRise"
  | "enterClick"
  | "enterNoise"
  | "exitChirp"
  | "exitDescend"
  | "switchNoise"
  | "alert"
  | "error"
  | "cut";

/** 聲部振幅包絡：attack 線性升到 gain，release 在結束前線性降到 0（秒）。 */
interface VoiceBase {
  /** 相對音效開始的起點（秒） */
  at: number;
  /** 長度（秒）；起點加長度不超過音效的 durationSec */
  dur: number;
  /** 峰值增益 0–1 */
  gain: number;
  attack: number;
  release: number;
}

export interface OscVoice extends VoiceBase {
  kind: "osc";
  wave: "sine" | "square" | "triangle" | "sawtooth";
  /** 起始與結束頻率（Hz）；不同時用指數掃頻 */
  freq: readonly [number, number];
}

export interface NoiseVoice extends VoiceBase {
  kind: "noise";
  /** 濾波器：起始與結束的中心／截止頻率（Hz，指數掃頻）與 Q */
  filter: { type: "bandpass" | "lowpass" | "highpass"; freq: readonly [number, number]; q: number };
}

export type Voice = OscVoice | NoiseVoice;

export interface SoundSpec {
  id: SoundId;
  /** 事件說明（文件與除錯用） */
  event: string;
  /** 長度（秒）；持續音（嗡聲）為 null */
  durationSec: number | null;
  /** 相對音量（dB，0 dB＝開機音）；≤ 0 */
  gainDb: number;
  voices: readonly Voice[];
}

const osc = (v: Omit<OscVoice, "kind">): OscVoice => ({ kind: "osc", ...v });
const noise = (v: Omit<NoiseVoice, "kind">): NoiseVoice => ({ kind: "noise", ...v });

/**
 * 繼電器喀噠：兩次短促的高頻雜訊＋方波衰減。
 * 尾端（X5）：最後一個聲部在 50ms 結束；總音量鏈的限制器有約 6ms 預看延遲，量到的「−60 dBFS 以上」長度才會落在 60ms 以內（原本 57ms 結束量到 61ms）。
 */
const CLICK_VOICES: readonly Voice[] = [
  noise({ at: 0, dur: 0.012, gain: 0.5, attack: 0.001, release: 0.008, filter: { type: "highpass", freq: [2400, 2400], q: 0.7 } }),
  osc({ at: 0.001, dur: 0.03, gain: 0.35, attack: 0.001, release: 0.025, wave: "square", freq: [1800, 700] }),
  noise({ at: 0.032, dur: 0.012, gain: 0.4, attack: 0.001, release: 0.008, filter: { type: "highpass", freq: [1800, 1800], q: 0.7 } }),
  osc({ at: 0.033, dur: 0.017, gain: 0.25, attack: 0.001, release: 0.014, wave: "square", freq: [1300, 600] }),
];

export const SOUNDS: Readonly<Record<SoundId, SoundSpec>> = {
  boot: {
    id: "boot",
    event: "開機 B2：撥接握手（雙音頻＋雜訊掃頻），結尾 BIOS 嗶一聲",
    durationSec: 2.4,
    gainDb: 0,
    voices: [
      // 撥號雙音
      osc({ at: 0.05, dur: 0.4, gain: 0.2, attack: 0.01, release: 0.03, wave: "sine", freq: [697, 697] }),
      osc({ at: 0.05, dur: 0.4, gain: 0.2, attack: 0.01, release: 0.03, wave: "sine", freq: [1209, 1209] }),
      // 握手：兩段上下掃頻的載波
      osc({ at: 0.6, dur: 0.5, gain: 0.2, attack: 0.02, release: 0.05, wave: "sine", freq: [1300, 2100] }),
      osc({ at: 0.6, dur: 0.5, gain: 0.15, attack: 0.02, release: 0.05, wave: "sine", freq: [980, 980] }),
      osc({ at: 1.15, dur: 0.8, gain: 0.18, attack: 0.03, release: 0.08, wave: "sine", freq: [2400, 1200] }),
      // 雜訊掃頻（嘶嘶聲）
      noise({ at: 0.9, dur: 1.05, gain: 0.4, attack: 0.05, release: 0.2, filter: { type: "bandpass", freq: [700, 3400], q: 1.2 } }),
      // BIOS 嗶一聲
      osc({ at: 2.1, dur: 0.25, gain: 1, attack: 0.003, release: 0.02, wave: "square", freq: [1000, 1000] }),
    ],
  },
  hum: {
    id: "hum",
    event: "控制室待機：CRT 低頻嗡聲（60Hz 基音＋泛音，極小聲，只在 HUB）",
    durationSec: null,
    gainDb: -24,
    voices: [
      osc({ at: 0, dur: 1, gain: 0.55, attack: 0, release: 0, wave: "sine", freq: [60, 60] }),
      osc({ at: 0, dur: 1, gain: 0.25, attack: 0, release: 0, wave: "sine", freq: [120, 120] }),
      osc({ at: 0, dur: 1, gain: 0.12, attack: 0, release: 0, wave: "sine", freq: [180, 180] }),
      osc({ at: 0, dur: 1, gain: 0.05, attack: 0, release: 0, wave: "sine", freq: [240, 240] }),
    ],
  },
  relay: { id: "relay", event: "選頻道（←→、換選取）：繼電器喀噠", durationSec: 0.06, gainDb: -10, voices: CLICK_VOICES },
  enterRise: {
    id: "enterRise",
    event: "進入 E1：上升音（0–600ms）",
    durationSec: 0.6,
    gainDb: -6,
    voices: [
      osc({ at: 0, dur: 0.6, gain: 0.55, attack: 0.04, release: 0.12, wave: "sine", freq: [180, 1400] }),
      osc({ at: 0, dur: 0.6, gain: 0.3, attack: 0.04, release: 0.12, wave: "triangle", freq: [360, 2100] }),
    ],
  },
  enterClick: { id: "enterClick", event: "進入 E2：喀噠（600ms）", durationSec: 0.06, gainDb: -6, voices: CLICK_VOICES },
  enterNoise: {
    id: "enterNoise",
    event: "進入 E3：轉台雜訊（750–1000ms）",
    durationSec: 0.25,
    gainDb: -6,
    voices: [noise({ at: 0, dur: 0.25, gain: 0.9, attack: 0.01, release: 0.1, filter: { type: "bandpass", freq: [3200, 900], q: 0.8 } })],
  },
  exitChirp: {
    id: "exitChirp",
    event: "離開 X1：高頻「啾」（約 6kHz 往下掃）",
    durationSec: 0.15,
    gainDb: -8,
    voices: [osc({ at: 0, dur: 0.14, gain: 0.7, attack: 0.005, release: 0.04, wave: "sine", freq: [6000, 2200] })],
  },
  exitDescend: {
    id: "exitDescend",
    event: "離開 X4：低頻下降音（300ms 起）",
    durationSec: 0.6,
    gainDb: -8,
    voices: [
      osc({ at: 0, dur: 0.6, gain: 0.6, attack: 0.03, release: 0.2, wave: "sine", freq: [520, 90] }),
      osc({ at: 0, dur: 0.6, gain: 0.3, attack: 0.03, release: 0.2, wave: "triangle", freq: [260, 60] }),
    ],
  },
  switchNoise: {
    id: "switchNoise",
    event: "短轉場：150ms 轉台雜訊（E3 縮短版）",
    durationSec: 0.15,
    gainDb: -8,
    // 聲部 140ms（限制器預看約 6ms）：量到的 −60 dBFS 以上長度 ≤ 150ms
    voices: [noise({ at: 0, dur: 0.14, gain: 0.9, attack: 0.008, release: 0.06, filter: { type: "bandpass", freq: [2800, 1100], q: 0.8 } })],
  },
  alert: {
    id: "alert",
    event: "雷達新異常：短促雙音",
    durationSec: 0.2,
    gainDb: -6,
    voices: [
      osc({ at: 0, dur: 0.085, gain: 0.7, attack: 0.004, release: 0.02, wave: "triangle", freq: [880, 880] }),
      osc({ at: 0.105, dur: 0.085, gain: 0.7, attack: 0.004, release: 0.03, wave: "triangle", freq: [1320, 1320] }),
    ],
  },
  error: {
    id: "error",
    event: "指令列：指令錯誤（低音嗶）",
    durationSec: 0.15,
    gainDb: -10,
    voices: [osc({ at: 0, dur: 0.14, gain: 0.7, attack: 0.004, release: 0.04, wave: "triangle", freq: [170, 150] })],
  },
  cut: { id: "cut", event: "減少動態效果的直接切換：只有一聲喀噠", durationSec: 0.06, gainDb: -8, voices: CLICK_VOICES },
};

export const SOUND_IDS = Object.keys(SOUNDS) as SoundId[];

/** 總音量（線性）：0.125 ＝ −18.06 dBFS。各音效的聲部增益總和 ≤ 1，所以最大聲的開機音峰值 ≤ 0.125（−18.06 dBFS）。 */
export const MASTER_GAIN = 0.125;

/** 安全限制器參數（brief §1）。knee 0＝硬轉折。 */
export const LIMITER = { thresholdDb: -18, ratio: 20, attackSec: 0.001, releaseSec: 0.1, kneeDb: 0 } as const;

/** 允許的頻率範圍（Hz）。 */
export const FREQ_MIN = 20;
export const FREQ_MAX = 12_000;

/** 靜音／淡出時間（毫秒）：靜音 20ms；跳過轉場或開機 30ms；嗡聲淡出 200ms、淡入 400ms。 */
export const MUTE_FADE_MS = 20;
export const SKIP_FADE_MS = 30;
export const HUM_FADE_OUT_MS = 200;
export const HUM_FADE_IN_MS = 400;

/** 警示音的最短間隔（毫秒）：2 秒內最多一次。 */
export const ALERT_MIN_INTERVAL_MS = 2000;

export const dbToLinear = (db: number) => Math.pow(10, db / 20);
export const linearToDb = (x: number) => 20 * Math.log10(x);

/** 同時發聲的聲部增益總和的最大值（峰值上界；線性振幅，未乘音效增益與總音量）。 */
export function peakBound(spec: SoundSpec): number {
  let max = 0;
  for (const v of spec.voices) {
    let sum = 0;
    for (const w of spec.voices) if (w.at <= v.at && v.at < w.at + w.dur) sum += w.gain;
    max = Math.max(max, sum);
  }
  return max;
}

/** 這個音效經過總音量之後的峰值上界（dBFS）。 */
export function peakBoundDbfs(spec: SoundSpec): number {
  return linearToDb(peakBound(spec) * dbToLinear(spec.gainDb) * MASTER_GAIN);
}

/**
 * Chrome／Firefox／Safari 的 DynamicsCompressor 會自動加「補償增益」（makeup gain，依 threshold／knee／ratio 決定，與訊號無關）：
 * 低於 threshold 的訊號也被放大（threshold −18、ratio 20、knee 0 時約 +10.26 dB；knee 30 約 +2.01 dB）。實測確認（Chrome）。
 * 限制器後面必須接一個反向的 trim，整條鏈在 threshold 以下才是 0 dB，否則 −18 dBFS 的峰值會被放大到約 −8 dBFS。
 * 公式與 Blink 的 DynamicsCompressorKernel 相同（KAtSlope 二分法、makeup = (1/saturate(1))^0.6）。
 */
export function compressorMakeupDb(thresholdDb: number, kneeDb: number, ratio: number): number {
  const lt = dbToLinear(thresholdDb);
  const kneeThresholdDb = thresholdDb + kneeDb;
  const kt = dbToLinear(kneeThresholdDb);
  const slope = 1 / ratio;
  const kneeCurve = (x: number, k: number) => (x < lt ? x : lt + (1 - Math.exp(-k * (x - lt))) / k);
  const slopeAt = (x: number, k: number) => {
    if (x < lt) return 1;
    const x2 = x * 1.001;
    return (linearToDb(kneeCurve(x2, k)) - linearToDb(kneeCurve(x, k))) / (linearToDb(x2) - linearToDb(x));
  };
  let lo = 0.1;
  let hi = 10_000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kt, k) < slope) hi = k;
    else lo = k;
    k = Math.sqrt(lo * hi);
  }
  const yKneeDb = linearToDb(kneeCurve(kt, k));
  const saturate = (x: number) => (x < kt ? kneeCurve(x, k) : dbToLinear(yKneeDb + slope * (linearToDb(x) - kneeThresholdDb)));
  return linearToDb(Math.pow(1 / saturate(1), 0.6));
}

/** 限制器後面的補償（線性）。 */
export const LIMITER_TRIM = dbToLinear(-compressorMakeupDb(LIMITER.thresholdDb, LIMITER.kneeDb, LIMITER.ratio));
