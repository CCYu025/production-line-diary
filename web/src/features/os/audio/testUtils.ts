/*
 * 測試用的假 Web Audio（jsdom 沒有 Web Audio）：只實作 synth.ts／engine.ts 用到的部分，記錄節點與排程。
 * 只給 *.test.ts(x) 引用，不會進正式的打包。
 */

export class FakeParam {
  value = 0;
  calls: Array<{ type: string; value?: number; time: number }> = [];
  setValueAtTime(v: number, t: number) {
    this.calls.push({ type: "set", value: v, time: t });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push({ type: "linear", value: v, time: t });
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.calls.push({ type: "exp", value: v, time: t });
    return this;
  }
  cancelScheduledValues(t: number) {
    this.calls.push({ type: "cancel", time: t });
    return this;
  }
}

export class FakeNode {
  kind = "node";
  connections: FakeNode[] = [];
  disconnected = false;
  constructor(readonly ctx: FakeAudioContext) {
    ctx.nodes.push(this);
  }
  connect(n: FakeNode) {
    this.connections.push(n);
    return n;
  }
  disconnect() {
    this.disconnected = true;
    this.connections = [];
  }
}

export class FakeGain extends FakeNode {
  kind = "gain";
  gain = new FakeParam();
}

export class FakeCompressor extends FakeNode {
  kind = "compressor";
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}

export class FakeFilter extends FakeNode {
  kind = "filter";
  type = "";
  frequency = new FakeParam();
  Q = new FakeParam();
}

export class FakeSource extends FakeNode {
  kind = "source";
  type = "";
  buffer: unknown = null;
  loop = false;
  frequency = new FakeParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(when = 0) {
    this.startedAt = when;
  }
  stop(when = 0) {
    this.stoppedAt = when;
  }
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state: "suspended" | "running" | "closed" = "suspended";
  onstatechange: (() => void) | null = null;
  nodes: FakeNode[] = [];
  destination = new FakeNode(this);
  buffers = 0;
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  /** true＝resume() 之後直接 running（有使用者啟用）；false＝停在 suspended（Esc 進入的情況） */
  allowRunning = true;

  constructor() {
    // destination 不算我們建立的節點
    this.nodes.length = 0;
  }

  createGain() {
    return new FakeGain(this) as unknown as GainNode;
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this) as unknown as DynamicsCompressorNode;
  }
  createBiquadFilter() {
    return new FakeFilter(this) as unknown as BiquadFilterNode;
  }
  createOscillator() {
    return new FakeSource(this) as unknown as OscillatorNode;
  }
  createBufferSource() {
    return new FakeSource(this) as unknown as AudioBufferSourceNode;
  }
  createBuffer(_ch: number, length: number) {
    this.buffers++;
    const data = new Float32Array(length);
    return { getChannelData: () => data, length, sampleRate: this.sampleRate } as unknown as AudioBuffer;
  }
  resume() {
    this.resumeCalls++;
    if (this.allowRunning && this.state === "suspended") {
      this.state = "running";
      this.onstatechange?.();
    }
    return Promise.resolve();
  }
  suspend() {
    this.suspendCalls++;
    if (this.state === "running") {
      this.state = "suspended";
      this.onstatechange?.();
    }
    return Promise.resolve();
  }
  close() {
    this.closeCalls++;
    this.state = "closed";
    this.onstatechange?.();
    return Promise.resolve();
  }

  /** 讓還沒結束的來源「播完」（觸發 onended） */
  endSources(): void {
    for (const n of this.nodes) if (n instanceof FakeSource && n.startedAt !== null) n.onended?.();
  }
  get sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }
  get liveNodes(): FakeNode[] {
    return this.nodes.filter((n) => !n.disconnected);
  }
}

export const asContext = (c: FakeAudioContext) => c as unknown as AudioContext;
