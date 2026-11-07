/*
 * 合成器（docs/os-mode-spec.md §8；X4）：依 sounds.ts 的參數物件在「任何 BaseAudioContext」上建立一個音效的節點圖。
 * 即時引擎（engine.ts）用真正的 AudioContext、驗證者用 OfflineAudioContext（debug.ts 的 __osAudioRender）、單元測試用假的 context——
 * 三者走同一個 renderSound，所以驗證算出來的波形就是使用者聽到的。
 *
 * 節點生命週期：每個音效只有「聲部 → 音效增益」這一小串節點；最晚結束的來源 ended 之後（或被 stop）全部 disconnect。
 * 嗡聲是唯一長駐的來源（沒有 stop，只有 setLevel 淡入淡出）。
 */
import {
  dbToLinear,
  LIMITER,
  LIMITER_TRIM,
  MASTER_GAIN,
  SOUNDS,
  type NoiseVoice,
  type OscVoice,
  type SoundId,
} from "./sounds";

/** 節點計數：created − disconnected ＝ 目前還連著的節點數（除錯掛鉤的 activeNodeCount）。 */
export interface NodeTracker {
  created: number;
  disconnected: number;
}

export const newTracker = (): NodeTracker => ({ created: 0, disconnected: 0 });

/** 共用雜訊緩衝的長度（秒）與取樣：每個 context 只建一次。固定種子的亂數，所以離線算出來的波形可重現。 */
export const NOISE_SECONDS = 1;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * NOISE_SECONDS));
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rand = mulberry32(0x1995);
  for (let i = 0; i < length; i++) data[i] = rand() * 2 - 1;
  return buf;
}

export interface MasterChain {
  /** 所有音效接到這裡（總音量節點） */
  input: GainNode;
  /** 靜音：總音量在 fadeMs 內淡到 0（或回到 MASTER_GAIN）；context 保留 */
  setMuted(muted: boolean, fadeMs: number): void;
  /** 拆掉整條鏈 */
  dispose(): void;
}

/** 總音量 → 安全限制器 → 補償 → 輸出。 */
export function buildMasterChain(ctx: BaseAudioContext, tracker: NodeTracker | null = null, destination: AudioNode = ctx.destination): MasterChain {
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.thresholdDb;
  limiter.knee.value = LIMITER.kneeDb;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attackSec;
  limiter.release.value = LIMITER.releaseSec;
  const trim = ctx.createGain();
  trim.gain.value = LIMITER_TRIM;
  master.connect(limiter);
  limiter.connect(trim);
  trim.connect(destination);
  if (tracker) tracker.created += 3;
  return {
    input: master,
    setMuted(muted, fadeMs) {
      const p = master.gain;
      const now = ctx.currentTime;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, now + fadeMs / 1000);
    },
    dispose() {
      for (const n of [master, limiter, trim]) {
        try {
          n.disconnect();
        } catch {
          /* 已斷開 */
        }
      }
      if (tracker) tracker.disconnected += 3;
    },
  };
}

export interface SoundHandle {
  readonly id: SoundId;
  /** 預定開始與（非持續音的）結束時間（context 時間，秒） */
  readonly startAt: number;
  readonly endAt: number | null;
  /** 已經結束並且節點都 disconnect 了 */
  readonly done: boolean;
  /** 淡出 fadeMs 後停止並 disconnect；還沒開始的音效直接取消。已結束的呼叫沒有作用。 */
  stop(fadeMs: number): void;
  /** 音效增益在 fadeMs 內移到目標（0–1，乘在 gainDb 的線性值上）；嗡聲的淡入淡出用。 */
  setLevel(level: number, fadeMs: number): void;
}

export interface RenderOptions {
  /** 共用的雜訊緩衝（同一個 context 只建一次） */
  noise: AudioBuffer;
  tracker?: NodeTracker | null;
  /** 音效播完（或被 stop 之後）disconnect 完成時呼叫 */
  onDone?: (h: SoundHandle) => void;
  /** 起始音量（0–1）；嗡聲從 0 淡入用。預設 1 */
  initialLevel?: number;
}

const LONG = 1e6;

function rampTo(param: AudioParam, from: number, to: number, t0: number, t1: number): void {
  param.setValueAtTime(from, t0);
  if (to !== from) param.exponentialRampToValueAtTime(to, t1);
}

/**
 * 在 ctx 上、時間 when（context 時間）建立並排程一個音效，輸出接到 destination。
 * 持續音（durationSec 為 null）沒有結束時間，必須由呼叫端 stop()。
 */
export function renderSound(ctx: BaseAudioContext, id: SoundId, destination: AudioNode, when: number, opts: RenderOptions): SoundHandle {
  const spec = SOUNDS[id];
  const tracker = opts.tracker ?? null;
  const nodes: AudioNode[] = [];
  const sources: Array<AudioScheduledSourceNode> = [];
  const track = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    if (tracker) tracker.created++;
    return n;
  };

  const base = dbToLinear(spec.gainDb);
  const out = track(ctx.createGain());
  out.gain.value = base * (opts.initialLevel ?? 1);
  out.connect(destination);

  const sustained = spec.durationSec === null;
  const total = spec.durationSec ?? LONG;

  for (const v of spec.voices) {
    const t0 = when + v.at;
    const t1 = sustained ? t0 + LONG : t0 + v.dur;
    const vg = track(ctx.createGain());
    vg.gain.setValueAtTime(0, t0);
    if (sustained) {
      vg.gain.setValueAtTime(v.gain, t0);
    } else {
      vg.gain.linearRampToValueAtTime(v.gain, t0 + Math.max(v.attack, 0.0005));
      vg.gain.setValueAtTime(v.gain, Math.max(t0 + v.attack, t1 - v.release));
      vg.gain.linearRampToValueAtTime(0, t1);
    }
    vg.connect(out);

    let src: AudioScheduledSourceNode;
    if (v.kind === "osc") {
      const o = track(ctx.createOscillator());
      const ov = v as OscVoice;
      o.type = ov.wave;
      rampTo(o.frequency, ov.freq[0], ov.freq[1], t0, t1);
      o.connect(vg);
      src = o;
    } else {
      const nv = v as NoiseVoice;
      const s = track(ctx.createBufferSource());
      s.buffer = opts.noise;
      s.loop = true;
      const f = track(ctx.createBiquadFilter());
      f.type = nv.filter.type;
      f.Q.value = nv.filter.q;
      rampTo(f.frequency, nv.filter.freq[0], nv.filter.freq[1], t0, t1);
      s.connect(f);
      f.connect(vg);
      src = s;
    }
    sources.push(src);
    if (v.kind === "noise") (src as AudioBufferSourceNode).start(t0, (v.at * 7919) % NOISE_SECONDS);
    else src.start(t0);
    if (!sustained) {
      src.stop(t1 + 0.01);
    }
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const s of sources) {
      s.onended = null;
      try {
        s.disconnect();
      } catch {
        /* 已斷開 */
      }
    }
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* 已斷開 */
      }
    }
    if (tracker) tracker.disconnected += nodes.length;
    opts.onDone?.(handle);
  };

  // 最晚結束的來源 ended 之後整串 disconnect（持續音沒有 ended）
  if (!sustained) {
    // 全部來源都 ended 才收尾
    let pending = sources.length;
    for (const s of sources) {
      s.onended = () => {
        if (--pending === 0) finish();
      };
    }
  }

  const handle: SoundHandle = {
    id,
    startAt: when,
    endAt: sustained ? null : when + total,
    get done() {
      return finished;
    },
    stop(fadeMs) {
      if (finished) return;
      const now = ctx.currentTime;
      if (now < when) {
        // 還沒開始：取消排程
        for (const s of sources) {
          try {
            s.stop(now);
          } catch {
            /* 略 */
          }
        }
        finish();
        return;
      }
      const g = out.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + fadeMs / 1000);
      for (const s of sources) {
        try {
          s.stop(now + fadeMs / 1000 + 0.005);
        } catch {
          /* 略 */
        }
      }
      // ended 事件在離線／假 context 上不一定會來：保險計時（即時 context 上 ended 先到，finish 是冪等的）
      if (typeof setTimeout === "function") setTimeout(finish, fadeMs + 60);
    },
    setLevel(level, fadeMs) {
      if (finished) return;
      const g = out.gain;
      const now = ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(base * level, now + fadeMs / 1000);
    },
  };
  return handle;
}
