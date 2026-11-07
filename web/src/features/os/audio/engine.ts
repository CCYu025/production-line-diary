/*
 * 音效引擎（docs/os-mode-spec.md §8；X4）：一個 AudioContext、一條總音量鏈、一個嗡聲。
 *
 * - AudioContext 只在使用者手勢之後建立（activate，由 useAudio 在 window 的 keydown／pointerdown 捕獲階段呼叫）；之前一律不建立。
 *   建立失敗＝永久靜默（狀態 unsupported，不影響任何功能）。
 * - 建立時機（X5）：B1（PRESS ANY KEY，黑畫面）的那一次手勢在處理函式裡同步建立；其餘（短開機、深層連結）手勢只記下「已啟用」，
 *   context 延到「沒有轉場進行中、而且使用者已經 ≥1000ms 沒有任何輸入（指標／按鍵／滾輪）」的安靜視窗之後，再等一個閒置時刻
 *   （requestIdleCallback，timeout 1s）才建立——建立 context 會卡主執行緒約 380ms，不能落在剛點擊後的互動期。
 *   依據是 Chrome 的 sticky activation：手勢之後才建立的 context 直接是 running。還沒建立前要播的音效直接略過（不排隊）。
 *   建立後立刻用一個 0 增益、1ms 的節點預熱整條鏈，第一個真的音效才不會晚。
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
  /** 使用者手勢已經發生過（context 可能還在等安靜視窗才建立） */
  gestured: boolean;
}

export interface Playback {
  /** 取消：已開始的在 fadeMs（預設 30ms）內淡出；還沒開始的直接取消。已結束的沒有作用。 */
  cancel(fadeMs?: number): void;
}

const NOOP_PLAYBACK: Playback = { cancel() {} };
/** 手勢處理函式裡 context 還沒 running 時，排隊等 running 的音效最多等這麼久（毫秒），過了就丟掉（不要補播過期的聲音）。 */
export const PENDING_PLAY_MAX_AGE_MS = 300;
const MAX_PENDING = 8;

/** 閒置排程：回傳取消函式。預設用 requestIdleCallback（timeout 1s），沒有的瀏覽器退回 setTimeout。 */
export type IdleScheduler = (cb: () => void) => () => void;
/** 延後建立的最長等待（毫秒，requestIdleCallback 的 timeout） */
export const IDLE_TIMEOUT_MS = 1000;
/** 延後建立前必須的安靜視窗：距離最後一次使用者輸入至少這麼久（毫秒） */
export const QUIET_MS = 1000;
/** 延後建立時，轉場進行中就再等這麼久重試（毫秒） */
export const IDLE_RETRY_MS = 100;

function defaultIdle(cb: () => void): () => void {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = setTimeout(cb, 50);
  return () => clearTimeout(id);
}

/** 建立時機的策略（由 useAudioSession 依導演狀態提供）。 */
export interface ActivationPolicy {
  /** true＝這一次手勢不要在處理函式裡建立 context（B1 以外的情況） */
  shouldDefer: () => boolean;
  /** true＝轉場或開機進行中，延後的建立要再等 */
  isBusy: () => boolean;
}

export interface EngineDeps {
  /** 建立 AudioContext；null＝瀏覽器不支援。預設用 window.AudioContext／webkitAudioContext */
  createContext?: (() => AudioContext) | null;
  now?: () => number;
  scheduleIdle?: IdleScheduler;
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
  /** 嗡聲目前是「淡入或已淡入」（applyHum 已套用）；避免沒在播時每次手勢都記一筆 fadeout */
  private humOn = false;
  /** 預熱節點的收尾（播完或 close() 時 disconnect） */
  private warmNodes: (() => void) | null = null;
  private policy: ActivationPolicy | null = null;
  private readonly scheduleIdle: IdleScheduler;
  private cancelIdle: (() => void) | null = null;
  private gestured = false;
  private lastInputAt = Number.NEGATIVE_INFINITY;
  private readonly active = new Set<SoundHandle>();
  private readonly cancelledBeforeStart = new WeakSet<SoundHandle>();
  private pending: Array<{ id: SoundId; delaySec: number; at: number; box: { handle: SoundHandle | null; dead: boolean } }> = [];
  private snap: EngineSnapshot;

  constructor(deps: EngineDeps = {}) {
    this.factory = deps.createContext === undefined ? defaultFactory() : deps.createContext;
    this.now = deps.now ?? (() => performance.now());
    this.scheduleIdle = deps.scheduleIdle ?? defaultIdle;
    this.snap = { status: this.factory ? "idle" : "unsupported", muted: false, gestured: false };
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
    if (status === this.snap.status && this.muted === this.snap.muted && this.gestured === this.snap.gestured) return;
    this.snap = { status, muted: this.muted, gestured: this.gestured };
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
  configure(policy: ActivationPolicy | null): void {
    this.policy = policy;
  }

  /** 手勢已發生、context 還在等閒置時刻建立 */
  get creationDeferred(): boolean {
    return this.cancelIdle !== null;
  }

  /** 記下一次使用者輸入（指標移動、按鍵、滾輪…）的時間：延後建立要等它安靜 ≥QUIET_MS */
  noteInput(): void {
    this.lastInputAt = this.now();
  }

  activate(): void {
    if (this.closed || this.failed || !this.factory) return;
    this.noteInput();
    if (!this.gestured) {
      this.gestured = true;
      this.refresh();
    }
    if (!this.ctx) {
      if (this.policy?.shouldDefer()) {
        // 手勢只記下「已啟用」；建立延到閒置時刻（已排程就不重複排）
        this.deferCreate();
        return;
      }
      this.cancelDeferred();
      if (!this.createNow()) return;
    }
    this.resumeIfNeeded();
  }

  private deferCreate(): void {
    if (this.cancelIdle) return;
    this.waitQuiet();
  }

  /** 等到「不忙、且最後一次輸入已經 ≥QUIET_MS」才排閒置回呼；條件沒達成就依剩餘時間再等。 */
  private waitQuiet(): void {
    const quietLeft = () => QUIET_MS - (this.now() - this.lastInputAt);
    const wait = (ms: number) => {
      const id = setTimeout(() => {
        this.cancelIdle = null;
        this.waitQuiet();
      }, Math.max(1, ms));
      this.cancelIdle = () => clearTimeout(id);
    };
    if (this.closed || this.failed || this.ctx) return;
    if (this.policy?.isBusy()) return wait(IDLE_RETRY_MS);
    if (quietLeft() > 0) return wait(quietLeft());
    this.cancelIdle = this.scheduleIdle(() => {
      this.cancelIdle = null;
      if (this.closed || this.failed || this.ctx) return;
      // 排閒置回呼到真正執行之間又有輸入或轉場：回到等待（requestIdleCallback 的 timeout 到了也不能硬建）
      if (this.policy?.isBusy() || quietLeft() > 0) {
        this.waitQuiet();
        return;
      }
      if (this.createNow()) this.resumeIfNeeded();
    });
  }

  private cancelDeferred(): void {
    this.cancelIdle?.();
    this.cancelIdle = null;
  }

  /** 建立 context 與整條鏈；失敗＝永久靜默並回傳 false */
  private createNow(): boolean {
    try {
      const ctx = this.factory!();
      this.ctx = ctx;
      dbgContextCreated();
      this.chain = buildMasterChain(ctx, this.tracker);
      if (this.muted) this.chain.input.gain.value = 0;
      this.noise = createNoiseBuffer(ctx);
      ctx.onstatechange = () => this.onContextState();
      this.warmUp(ctx);
      return true;
    } catch {
      this.failed = true;
      this.ctx = null;
      this.chain = null;
      this.refresh();
      return false;
    }
  }

  /** 預熱：0 增益、1ms 的節點走一遍整條鏈（不計入節點數；播完自己 disconnect）。 */
  private warmUp(ctx: AudioContext): void {
    try {
      const g = ctx.createGain();
      g.gain.value = 0;
      const o = ctx.createOscillator();
      o.connect(g);
      g.connect(this.chain!.input);
      const t = ctx.currentTime;
      const dispose = () => {
        o.onended = null;
        this.warmNodes = null;
        try {
          o.disconnect();
          g.disconnect();
        } catch {
          /* 略 */
        }
      };
      this.warmNodes = dispose;
      o.onended = dispose;
      o.start(t);
      o.stop(t + 0.001);
    } catch {
      /* 預熱失敗不影響功能 */
    }
  }

  private resumeIfNeeded(): void {
    const ctx = this.ctx;
    if (!ctx) return;
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
    // 已經自然播完、只是 ended 事件還沒到：不必再淡出或 stop，也不記 fadeout
    if (h.endAt !== null && this.ctx.currentTime >= h.endAt) return;
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
      if (!this.humOn) {
        this.humOn = true;
        this.hum.setLevel(1, HUM_FADE_IN_MS);
      }
    } else if (this.hum && this.humOn) {
      // 只有真的在播才淡出；已經淡出完的嗡聲，之後每次手勢都不再記、也不重複動作
      this.humOn = false;
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
    this.cancelDeferred();
    for (const p of this.pending) p.box.dead = true;
    this.pending = [];
    for (const h of Array.from(this.active)) h.stop(0);
    this.hum?.stop(0);
    this.hum = null;
    this.humOn = false;
    this.warmNodes?.();
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
