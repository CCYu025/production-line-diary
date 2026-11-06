/*
 * 離線渲染（驗證用，docs/os-mode-spec.md §8、X4）：把一個音效經過「與即時完全相同的總音量鏈」算成波形。
 * 單聲道、44100Hz；即時引擎的 renderSound／buildMasterChain 原樣使用，所以量到的峰值就是使用者聽到的。
 */
import type { AudioRenderResult } from "./debug";
import { buildMasterChain, createNoiseBuffer, renderSound } from "./synth";
import { linearToDb, SOUNDS, type SoundId } from "./sounds";

export const OFFLINE_SAMPLE_RATE = 44100;
/** 持續音（嗡聲）渲染的秒數 */
export const SUSTAINED_RENDER_SEC = 1;
/** 結尾多留的秒數（限制器的預看延遲、釋放尾巴） */
const TAIL_SEC = 0.1;

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function renderSoundOffline(id: SoundId, Ctor: typeof OfflineAudioContext = OfflineAudioContext): Promise<AudioRenderResult> {
  const spec = SOUNDS[id];
  const durationSec = spec.durationSec ?? SUSTAINED_RENDER_SEC;
  const length = Math.ceil((durationSec + TAIL_SEC) * OFFLINE_SAMPLE_RATE);
  const ctx = new Ctor(1, length, OFFLINE_SAMPLE_RATE);
  const chain = buildMasterChain(ctx);
  const noise = createNoiseBuffer(ctx);
  const handle = renderSound(ctx, id, chain.input, 0, { noise, initialLevel: 1 });
  const buffer = await ctx.startRendering();
  void handle;
  const data = buffer.getChannelData(0);
  let peak = 0;
  let lastAudible = 0;
  const floor = Math.pow(10, -80 / 20);
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]!);
    if (a > peak) peak = a;
    if (a > floor) lastAudible = i;
  }
  const bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return {
    id,
    sampleRate: OFFLINE_SAMPLE_RATE,
    durationSec,
    renderedSec: (lastAudible + 1) / OFFLINE_SAMPLE_RATE,
    peak,
    peakDbfs: peak > 0 ? linearToDb(peak) : -Infinity,
    samples: toBase64(bytes),
    encoding: "f32le-base64",
  };
}
