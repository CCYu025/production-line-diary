/*
 * 音效引擎（docs/os-mode-spec.md §8；X4）：一個 AudioContext、一條總音量鏈、一個嗡聲。
 *
 * - AudioContext 只在使用者手勢的處理函式裡建立或 resume（activate，由 useAudio 在 window 的 keydown／pointerdown 捕獲階段呼叫）；之前一律不建立。
 *   建立失敗＝永久靜默（狀態 unsupported，不影響任何功能）。
 * - 手勢不一定讓 context 變成 running：Esc 不被 Chrome 當成「使用者啟用」，所以 B1 用 Esc 進入時 context 會留在 suspended（狀態 pending），
 *   下一次手勢再 resume（每次手勢都會再呼叫 activate，直到 running）。
 * - 靜音＝總音量 20ms 淡到 0，context 保留；分頁隱藏 suspend()、可見 resume()；離開 OS 模式 close()。
 * - 全部走注入的 context 工廠，單元測試用假 context；即時與離線共用 synth.ts。
 */
import { audioDebugEnabled, dbgContextCreated, dbgEvent, dbgRetractStart, setAudioDebugSource, setAudioRenderHook } from "./debug";
import { renderSoundOffline } from "./offline";
import { HUM_FADE_IN_MS, HUM_FADE_OUT_MS, MUTE_FADE_MS, SKIP_FADE_MS, type SoundId } from "./sounds";
import { buildMasterChain, createNoiseBuffer, newTracker, renderSound, type MasterChain, type NodeTracker, type SoundHandle } from "./synth";

/** idle＝還沒有手勢（沒建立 context）；pending＝已建立但還沒 running；running；unsupported＝不支援或建立失敗；closed＝已離開 OS 模式。 */
export type EngineStatus = "idle" | "pending" | "running" | "unsupported" | "closed";

export interface EngineSnapshot {
  status: EngineStatus;
  muted: boolean;
}

export interface Playback {
  /** 取消：已開始的在 fadeMs（預設 30ms）內淡出；還沒開始的直接取消。已結束的沒有作用。 */
  cancel(fadeMs?: number): void;
}

const NOOP_PLAYBACK: Playback = { cancel() {} };
/** 手勢處理函式裡 context 還沒 running 時，排隊等 running 的音效最多等這麼久（毫秒），過了就丟掉（不要補播過期的聲音）。 */
export const PENDING_PLAY_MAX_AGE_MS = 300;
const MAX_PENDING = 8;

export interface EngineDeps {
  /** 建立 AudioContext；null＝瀏覽器不支援。預設用 window.AudioContext／webkitAudioContext */
  createContext?: (() => AudioContext) | null;
  now?: () => number;
}

function defaultFactory(): (() => AudioContext) | null {
  const g = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? () => new Ctor() : null;
}

export class AudioEngine {
  private readonly factory: (() => AudioContext) | null;
  private readonly now: () => number;
  private ctx: AudioContext | null = null;
  private chain: MasterChain | null = null;
  private noise: AudioBuffer | null = null;
  private readonly tracker: NodeTracker = newTracker();
  private muted = false;
  private failed = false;
  private closed = false;
  private hidden = false;
  private humWanted = false;
  private hum: SoundHandle | null = null;
  private readonly active = new Set<SoundHandle>();
  private readonly cancelledBeforeStart = new WeakSet<SoundHandle>();
  private pending: Array<{ id: SoundId; delaySec: number; at: number; box: { handle: SoundHandle | null; dead: boolean } }> = [];
  private snap: EngineSnapshot;

  constructor(deps: EngineDeps = {}) {
    this.factory = deps.createContext === undefined ? defaultFactory() : deps.createContext;
    this.now = deps.now ?? (() => performance.now());
    this.snap = { status: this.factory ? "idle" : "unsupported", muted: false };
    if (audioDebugEnabled()) {
      setAudioDebugSource(() => ({
        supported: this.factory !== null && !this.failed,
        contextState: this.ctx ? this.ctx.state : null,
        activeNodeCount: this.tracker.created - this.tracker.disconnected,
        muted: this.muted,
        humActive: this.humActive(),
      }));
      setAudioRenderHook((id) => renderSoundOffline(id));
    }
  }

  // ---- 狀態（給 useSyncExternalStore；訂閱在模組層級，引擎被換掉（離開再進入 OS 模式）時訂閱者不用重接） ----
  getSnapshot = (): EngineSnapshot => this.snap;

  private status(): EngineStatus {
    if (this.closed) return "closed";
    if (!this.factory || this.failed) return "unsupported";
    if (!this.ctx) return "idle";
    return this.ctx.state === "running" ? "running" : "pending";
  }

  private refresh(): void {
    const status = this.status();
    if (status === this.snap.status && this.muted === this.snap.muted) return;
    this.snap = { status, muted: this.muted };
    emitAudio();
  }

  /** 有沒有 AudioContext 可用（不含「已建立但還沒 running」） */
  get isRunning(): boolean {
    return this.status() === "running";
  }

  private humActive(): boolean {
    return this.humWanted && !this.muted && this.isRunning;
  }

  // ---- 啟用（只在使用者手勢的處理函式裡呼叫） ----
  activate(): void {
    if (this.closed || this.failed || !this.factory) return;
    if (!this.ctx) {
      try {
        const ctx = this.factory();
        this.ctx = ctx;
        dbgContextCreated();
        this.chain = buildMasterChain(ctx, this.tracker);
        if (this.muted) this.chain.input.gain.value = 0;
        this.noise = createNoiseBuffer(ctx);
        ctx.onstatechange = () => this.onContextState();
      } catch {
        // 永久靜默：不影響任何功能
        this.failed = true;
        this.ctx = null;
        this.chain = null;
        this.refresh();
        return;
      }
    }
    const ctx = this.ctx;
    if (!this.hidden && ctx.state === "suspended") {
      try {
        void Promise.resolve(ctx.resume()).then(
          () => this.onContextState(),
          () => {},
        );
      } catch {
        /* 略 */
      }
    }
    this.onContextState();
  }

  private onContextState(): void {
    if (this.closed) return;
    if (this.isRunning) {
      const queued = this.pending;
      this.pending = [];
      const t = this.now();
      for (const p of queued) {
        const age = t - p.at;
        if (p.box.dead || age > PENDING_PLAY_MAX_AGE_MS) continue;
        p.box.handle = this.start(p.id, Math.max(0, p.delaySec - age / 1000));
      }
      this.applyHum();
    }
    this.refresh();
  }

  // ---- 播放 ----
  /**
   * 在 delaySec 秒後播放一個音效。context 沒有 running 時（還沒手勢、Esc 進入、分頁隱藏中）：已建立但還沒 running 的短暫空檔排隊等候，
   * 其餘直接丟掉（沒有聲音，也不留任何東西）。靜音時不建立任何節點。
   */
  play(id: SoundId, delaySec = 0): Playback {
    if (this.closed || this.failed || !this.factory) return NOOP_PLAYBACK;
    if (this.muted) return NOOP_PLAYBACK;
    if (this.ctx && !this.isRunning && !this.hidden && this.ctx.state === "suspended") {
      if (this.pending.length >= MAX_PENDING) this.pending.shift();
      const box = { handle: null as SoundHandle | null, dead: false };
      this.pending.push({ id, delaySec, at: this.now(), box });
      return {
        cancel: (fade = SKIP_FADE_MS) => {
          box.dead = true;
          if (box.handle) this.cancelHandle(box.handle, fade);
        },
      };
    }
    if (!this.isRunning) return NOOP_PLAYBACK;
    const handle = this.start(id, delaySec);
    return { cancel: (fade = SKIP_FADE_MS) => this.cancelHandle(handle, fade) };
  }

  private start(id: SoundId, delaySec: number): SoundHandle {
    const ctx = this.ctx!;
    const when = ctx.currentTime + Math.max(0, delaySec);
    const handle = renderSound(ctx, id, this.chain!.input, when, {
      noise: this.noise!,
      tracker: this.tracker,
      onDone: (h) => {
        this.active.delete(h);
        dbgEvent(h.id, "stop", this.now(), this.cancelledBeforeStart.has(h) || undefined);
      },
    });
    this.active.add(handle);
    dbgEvent(id, "start", this.now() + Math.max(0, delaySec) * 1000);
    return handle;
  }

  private cancelHandle(h: SoundHandle, fadeMs: number): void {
    if (h.done || !this.ctx) return;
    if (this.ctx.currentTime < h.startAt) {
      this.cancelledBeforeStart.add(h);
      dbgRetractStart(h.id, this.now());
    } else {
      dbgEvent(h.id, "fadeout", this.now());
    }
    h.stop(fadeMs);
  }

  // ---- 靜音 ----
  setMuted(muted: boolean): void {
    if (this.closed || muted === this.muted) return;
    this.muted = muted;
    this.chain?.setMuted(muted, MUTE_FADE_MS);
    if (muted) {
      // 靜音期間不留還沒播的音效
      for (const p of this.pending) p.box.dead = true;
      this.pending = [];
    }
    this.refresh();
  }

  // ---- 嗡聲（只在 HUB） ----
  setHum(wanted: boolean): void {
    if (this.closed || wanted === this.humWanted) return;
    this.humWanted = wanted;
    this.applyHum();
  }

  private applyHum(): void {
    if (!this.isRunning || !this.ctx) return;
    if (this.humWanted) {
      if (!this.hum) {
        this.hum = renderSound(this.ctx, "hum", this.chain!.input, this.ctx.currentTime, { noise: this.noise!, tracker: this.tracker, initialLevel: 0 });
        dbgEvent("hum", "start", this.now());
      }
      this.hum.setLevel(1, HUM_FADE_IN_MS);
    } else if (this.hum) {
      dbgEvent("hum", "fadeout", this.now());
      this.hum.setLevel(0, HUM_FADE_OUT_MS);
    }
  }

  // ---- 背景暫停 ----
  /** 分頁隱藏：取消還沒播完的音效（回來時不要補播過期的聲音），再 suspend()；嗡聲留在 context 裡，resume 後接續。 */
  suspendForHidden(): void {
    if (this.closed) return;
    this.hidden = true;
    for (const p of this.pending) p.box.dead = true;
    this.pending = [];
    for (const h of Array.from(this.active)) this.cancelHandle(h, 0);
    const ctx = this.ctx;
    if (ctx && ctx.state === "running") {
      try {
        void Promise.resolve(ctx.suspend()).catch(() => {});
      } catch {
        /* 略 */
      }
    }
  }

  resumeFromHidden(): void {
    if (this.closed) return;
    this.hidden = false;
    const ctx = this.ctx;
    if (ctx && ctx.state === "suspended") {
      try {
        void Promise.resolve(ctx.resume()).then(
          () => this.onContextState(),
          () => {},
        );
      } catch {
        /* 略 */
      }
    }
  }

  // ---- 離開 OS 模式 ----
  close(): void {
    if (this.closed) return;
    for (const p of this.pending) p.box.dead = true;
    this.pending = [];
    for (const h of Array.from(this.active)) h.stop(0);
    this.hum?.stop(0);
    this.hum = null;
    this.chain?.dispose();
    this.chain = null;
    const ctx = this.ctx;
    this.closed = true;
    if (ctx) {
      ctx.onstatechange = null;
      try {
        void Promise.resolve(ctx.close()).catch(() => {});
      } catch {
        /* 略 */
      }
    }
    this.refresh();
  }
}

// ---- 單例：一次 OS 模式工作階段一個引擎 ----
let engine: AudioEngine | null = null;
const listeners = new Set<() => void>();

export function emitAudio(): void {
  for (const l of Array.from(listeners)) l();
}

export function subscribeAudio(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 目前引擎的狀態快照（沒有引擎就先建一個空的：不建立 AudioContext）。 */
export function getAudioSnapshot(): EngineSnapshot {
  return getAudioEngine().getSnapshot();
}

export function getAudioEngine(): AudioEngine {
  if (!engine || engine.getSnapshot().status === "closed") engine = new AudioEngine();
  return engine;
}

/** 離開 OS 模式（OsShell 卸載）：close() 並丟掉單例。 */
export function disposeAudioEngine(): void {
  engine?.close();
  engine = null;
}

/** 測試用：換上指定的引擎（或清掉）。 */
export function setAudioEngineForTest(e: AudioEngine | null): void {
  engine = e;
}
