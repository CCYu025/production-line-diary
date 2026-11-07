/*
 * 音效驗證用的除錯掛鉤（X4）：網址帶 ?osdebug=audio（可與其他旗標用逗號並列，例如 ?osdebug=transition,audio）時安裝：
 *
 *   window.__osAudio() → 快照
 *     {
 *       supported: boolean,               瀏覽器有沒有 AudioContext（false＝狀態列顯示 SND N/A）
 *       contextState: string | null,      "suspended" | "running" | "closed" | "interrupted"；從來沒建立過 context 是 null
 *       contextCreateCount: number,       這個頁面載入以來建立過幾個 AudioContext（沒有第一次手勢之前一定是 0）
 *       events: [{ id, tMs, kind, cancelled? }],  kind：'start'（tMs＝預定開始的 performance.now()）｜'fadeout'（跳過淡出開始）｜'stop'（已結束並 disconnect；cancelled＝還沒開始就被取消）
 *       activeNodeCount: number,          我們建立的節點數 − 已 disconnect 的節點數（總音量鏈與嗡聲是固定的基準）
 *       muted: boolean,                   pld.os.sound 為 off
 *       humActive: boolean,               嗡聲目前是要「有聲」的（HUB 且沒有靜音；淡出中算 false）
 *     }
 *   window.__osAudioRender(id) → Promise<{ id, sampleRate, durationSec, renderedSec, peak, peakDbfs, samples, encoding }>
 *     用 OfflineAudioContext（44100Hz）把這個音效「經過同一條總音量鏈（總音量＋限制器＋補償）」實際算出來，不需要使用者手勢；
 *     durationSec＝規格長度（嗡聲渲染 1 秒），renderedSec＝最後一個超過 −80 dBFS 的取樣時間，samples＝Float32 小端位元組的 base64（單聲道）。
 *
 * 沒有旗標時 audioDebugEnabled() 是 false，所有 dbg* 函式第一行就返回（不配置、不讀 DOM）。
 */
import type { SoundId } from "./sounds";

export type AudioEventKind = "start" | "fadeout" | "stop";

export interface AudioDebugEvent {
  id: SoundId;
  tMs: number;
  kind: AudioEventKind;
  cancelled?: boolean;
}

export interface AudioDebugSnapshot {
  supported: boolean;
  contextState: string | null;
  contextCreateCount: number;
  events: AudioDebugEvent[];
  activeNodeCount: number;
  muted: boolean;
  humActive: boolean;
}

export interface AudioRenderResult {
  id: SoundId;
  sampleRate: number;
  durationSec: number;
  renderedSec: number;
  peak: number;
  peakDbfs: number;
  samples: string;
  encoding: "f32le-base64";
}

declare global {
  interface Window {
    /** ?osdebug=audio 時的音效快照（驗證用） */
    __osAudio?: () => AudioDebugSnapshot;
    /** ?osdebug=audio 時：用 OfflineAudioContext 渲染一個音效（驗證用） */
    __osAudioRender?: (id: SoundId) => Promise<AudioRenderResult>;
  }
}

const MAX_EVENTS = 500;
let on: boolean | null = null;
let events: AudioDebugEvent[] = [];
let createCount = 0;
let source: (() => Omit<AudioDebugSnapshot, "events" | "contextCreateCount">) | null = null;

export function audioDebugEnabled(): boolean {
  if (on === null) {
    try {
      on = (new URLSearchParams(window.location.search).get("osdebug") ?? "").split(",").includes("audio");
    } catch {
      on = false;
    }
    if (on) {
      window.__osAudio = () => {
        const s = source?.() ?? { supported: false, contextState: null, activeNodeCount: 0, muted: false, humActive: false };
        return JSON.parse(JSON.stringify({ ...s, contextCreateCount: createCount, events })) as AudioDebugSnapshot;
      };
    }
  }
  return on;
}

/** 掛上快照來源（引擎建立時）。 */
export function setAudioDebugSource(fn: (() => Omit<AudioDebugSnapshot, "events" | "contextCreateCount">) | null): void {
  if (!audioDebugEnabled()) return;
  source = fn;
}

/** 掛上離線渲染（沿用 synth 的函式；由 offline.ts 動態提供，避免循環相依）。 */
export function setAudioRenderHook(fn: ((id: SoundId) => Promise<AudioRenderResult>) | null): void {
  if (!audioDebugEnabled()) return;
  if (fn) window.__osAudioRender = fn;
  else delete window.__osAudioRender;
}

export function dbgContextCreated(): void {
  if (!audioDebugEnabled()) return;
  createCount++;
}

export function dbgEvent(id: SoundId, kind: AudioEventKind, tMs: number = performance.now(), cancelled?: boolean): void {
  if (!audioDebugEnabled()) return;
  if (events.length >= MAX_EVENTS) events.shift();
  events.push(cancelled ? { id, tMs, kind, cancelled } : { id, tMs, kind });
}

/** 還沒開始就被取消：把它的 'start' 紀錄拿掉（最近一筆同 id 且 tMs 還在未來的）。 */
export function dbgRetractStart(id: SoundId, now: number = performance.now()): void {
  if (!audioDebugEnabled()) return;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.id === id && e.kind === "start" && e.tMs > now) {
      events.splice(i, 1);
      return;
    }
  }
}

/** 測試用：丟掉快取的旗標、事件與計數。 */
export function resetAudioDebugForTest(): void {
  on = null;
  events = [];
  createCount = 0;
  source = null;
  delete window.__osAudio;
  delete window.__osAudioRender;
}
