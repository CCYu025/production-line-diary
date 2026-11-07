import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioDebugEnabled, resetAudioDebugForTest } from "./debug";
import { AudioEngine, PENDING_PLAY_MAX_AGE_MS } from "./engine";
import { LIMITER, LIMITER_TRIM, MASTER_GAIN } from "./sounds";
import { buildMasterChain, createNoiseBuffer, newTracker, renderSound } from "./synth";
import { asContext, FakeAudioContext, FakeCompressor, FakeGain } from "./testUtils";

let ctxs: FakeAudioContext[];
let clock: number;
const make = (opts: { allowRunning?: boolean } = {}) =>
  new AudioEngine({
    createContext: () => {
      const c = new FakeAudioContext();
      c.allowRunning = opts.allowRunning ?? true;
      ctxs.push(c);
      return asContext(c);
    },
    now: () => clock,
  });

beforeEach(() => {
  vi.useFakeTimers();
  ctxs = [];
  clock = 1000;
  resetAudioDebugForTest();
});
afterEach(() => {
  vi.useRealTimers();
  resetAudioDebugForTest();
});

describe("AudioContext 只在手勢裡建立", () => {
  it("建立引擎、播放、靜音、嗡聲都不會建立 context；activate 才建立（一次）", () => {
    const e = make();
    e.setMuted(false);
    e.setHum(true);
    expect(e.play("boot").cancel).toBeTypeOf("function");
    expect(ctxs).toHaveLength(0);
    expect(e.getSnapshot().status).toBe("idle");
    e.activate();
    e.activate();
    expect(ctxs).toHaveLength(1);
    expect(e.getSnapshot().status).toBe("running");
  });
  it("建立失敗＝永久靜默（unsupported），不拋出，之後 play 沒有作用", () => {
    const e = new AudioEngine({
      createContext: () => {
        throw new Error("no audio");
      },
    });
    expect(() => e.activate()).not.toThrow();
    expect(e.getSnapshot().status).toBe("unsupported");
    expect(() => e.play("boot").cancel()).not.toThrow();
    e.activate();
    expect(e.getSnapshot().status).toBe("unsupported");
  });
  it("瀏覽器不支援（沒有工廠）：unsupported", () => {
    const e = new AudioEngine({ createContext: null });
    expect(e.getSnapshot().status).toBe("unsupported");
    e.activate();
    expect(e.getSnapshot().status).toBe("unsupported");
  });
  it("Esc 不算使用者啟用：context 留在 suspended（pending），下一次手勢才 running", () => {
    const e = make({ allowRunning: false });
    e.activate();
    expect(e.getSnapshot().status).toBe("pending");
    expect(ctxs[0]!.resumeCalls).toBe(1);
    ctxs[0]!.allowRunning = true;
    e.activate();
    expect(e.getSnapshot().status).toBe("running");
    expect(ctxs).toHaveLength(1);
  });
});

describe("總音量鏈", () => {
  it("總音量 → 限制器 → 補償 → 輸出，參數正確", () => {
    const c = new FakeAudioContext();
    const chain = buildMasterChain(asContext(c), newTracker());
    const [master, limiter, trim] = c.nodes as unknown as [FakeGain, FakeCompressor, FakeGain];
    expect(master.gain.value).toBe(MASTER_GAIN);
    expect(limiter.threshold.value).toBe(LIMITER.thresholdDb);
    expect(limiter.ratio.value).toBe(LIMITER.ratio);
    expect(limiter.attack.value).toBe(LIMITER.attackSec);
    expect(trim.gain.value).toBe(LIMITER_TRIM);
    expect(master.connections).toEqual([limiter]);
    expect(limiter.connections).toEqual([trim]);
    expect(trim.connections).toEqual([c.destination]);
    expect(chain.input).toBe(master as unknown as GainNode);
  });
  it("靜音：總音量 20ms 淡到 0，context 保留；取消靜音淡回", () => {
    const e = make();
    e.activate();
    const master = ctxs[0]!.nodes[0] as unknown as FakeGain;
    e.setMuted(true);
    const last = master.gain.calls.at(-1)!;
    expect(last).toMatchObject({ type: "linear", value: 0 });
    expect(last.time).toBeCloseTo(0.02, 6);
    expect(ctxs[0]!.closeCalls).toBe(0);
    e.setMuted(false);
    expect(master.gain.calls.at(-1)).toMatchObject({ type: "linear", value: MASTER_GAIN });
  });
  it("靜音時 play 不建立任何節點", () => {
    const e = make();
    e.activate();
    e.setMuted(true);
    const n = ctxs[0]!.nodes.length;
    e.play("relay");
    expect(ctxs[0]!.nodes.length).toBe(n);
  });
});

describe("音效生命週期", () => {
  it("播完（ended）全部 disconnect；活動節點數回到基準", () => {
    const e = make();
    e.activate();
    const c = ctxs[0]!;
    const base = c.liveNodes.length;
    e.play("relay");
    expect(c.liveNodes.length).toBeGreaterThan(base);
    c.endSources();
    expect(c.liveNodes.length).toBe(base);
  });
  it("20 次進出（各 5 個音效）之後節點數回到基準", () => {
    const e = make();
    e.activate();
    const c = ctxs[0]!;
    const base = c.liveNodes.length;
    for (let i = 0; i < 20; i++) {
      for (const id of ["enterRise", "enterClick", "enterNoise", "exitChirp", "exitDescend"] as const) e.play(id, 0.1);
      c.endSources();
    }
    expect(c.liveNodes.length).toBe(base);
  });
  it("跳過：已開始的 30ms 淡出；還沒開始的直接取消（不留節點）", () => {
    const e = make();
    e.activate();
    const c = ctxs[0]!;
    const base = c.liveNodes.length;
    const started = e.play("enterRise");
    const later = e.play("enterClick", 0.6);
    c.currentTime = 0.1;
    started.cancel(30);
    later.cancel(30);
    const stops = c.sources.filter((s) => s.stoppedAt !== null).map((s) => s.stoppedAt!);
    expect(stops.some((t) => Math.abs(t - (0.1 + 0.03 + 0.005)) < 1e-9)).toBe(true);
    vi.advanceTimersByTime(200);
    expect(c.liveNodes.length).toBe(base);
  });
  it("嗡聲：等 running 後才建立；淡入 400ms、淡出 200ms", () => {
    const e = make();
    e.setHum(true);
    expect(ctxs).toHaveLength(0);
    e.activate();
    const c = ctxs[0]!;
    const humGain = c.nodes.find((n) => n instanceof FakeGain && n.gain.calls.some((k) => k.type === "linear" && Math.abs(k.time - 0.4) < 1e-9)) as unknown as FakeGain;
    expect(humGain).toBeDefined();
    e.setHum(false);
    expect(humGain.gain.calls.at(-1)).toMatchObject({ type: "linear", value: 0 });
    expect(humGain.gain.calls.at(-1)!.time).toBeCloseTo(0.2, 6);
  });
});

describe("背景暫停與離開", () => {
  it("隱藏 suspend、可見 resume", () => {
    const e = make();
    e.activate();
    const c = ctxs[0]!;
    e.play("exitDescend", 0.3);
    e.suspendForHidden();
    expect(c.state).toBe("suspended");
    expect(c.suspendCalls).toBe(1);
    e.resumeFromHidden();
    expect(c.state).toBe("running");
  });
  it("close()：context closed、節點全部 disconnect、之後不再作用", () => {
    const e = make();
    e.activate();
    e.setHum(true);
    e.play("boot");
    e.close();
    const c = ctxs[0]!;
    expect(c.state).toBe("closed");
    expect(c.closeCalls).toBe(1);
    expect(e.getSnapshot().status).toBe("closed");
    vi.advanceTimersByTime(200);
    expect(c.liveNodes.length).toBe(0);
    e.activate();
    expect(ctxs).toHaveLength(1);
  });
  it("手勢當下 context 還是 suspended：排隊，running 後補播；超過 300ms 的丟掉", () => {
    const e = make({ allowRunning: false });
    e.activate();
    const before = ctxs[0]!.nodes.length;
    e.play("boot");
    e.play("relay");
    expect(ctxs[0]!.nodes.length).toBe(before);
    clock += 100;
    ctxs[0]!.allowRunning = true;
    e.activate();
    expect(ctxs[0]!.nodes.length).toBeGreaterThan(before);
    const e2 = make({ allowRunning: false });
    e2.activate();
    const b2 = ctxs[1]!.nodes.length;
    e2.play("boot");
    clock += PENDING_PLAY_MAX_AGE_MS + 1;
    ctxs[1]!.allowRunning = true;
    e2.activate();
    expect(ctxs[1]!.nodes.length).toBe(b2);
  });
});

describe("除錯掛鉤（?osdebug=audio）", () => {
  it("沒有旗標：不安裝任何東西", () => {
    expect(audioDebugEnabled()).toBe(false);
    make();
    expect(window.__osAudio).toBeUndefined();
    expect(window.__osAudioRender).toBeUndefined();
  });
  it("有旗標：快照與事件紀錄", () => {
    window.history.pushState({}, "", "/?osdebug=transition,audio");
    resetAudioDebugForTest();
    const e = make();
    expect(window.__osAudio!().contextState).toBeNull();
    expect(window.__osAudio!().contextCreateCount).toBe(0);
    e.activate();
    const c = ctxs[0]!;
    e.play("relay");
    c.endSources();
    const snap = window.__osAudio!();
    expect(snap).toMatchObject({ supported: true, contextState: "running", contextCreateCount: 1, muted: false, humActive: false });
    expect(snap.events.map((x) => [x.id, x.kind])).toEqual([
      ["relay", "start"],
      ["relay", "stop"],
    ]);
    expect(snap.activeNodeCount).toBe(c.liveNodes.length);
    expect(window.__osAudioRender).toBeTypeOf("function");
    window.history.pushState({}, "", "/");
  });
});

describe("synth", () => {
  it("renderSound：節點全部被追蹤，結束後 created === disconnected", () => {
    const c = new FakeAudioContext();
    const tracker = newTracker();
    const chain = buildMasterChain(asContext(c), tracker);
    const done = vi.fn();
    renderSound(asContext(c), "boot", chain.input, 0, { noise: createNoiseBuffer(asContext(c)), tracker, onDone: done });
    expect(c.buffers).toBe(1);
    c.endSources();
    expect(done).toHaveBeenCalledTimes(1);
    chain.dispose();
    expect(tracker.created).toBe(tracker.disconnected);
  });
});
