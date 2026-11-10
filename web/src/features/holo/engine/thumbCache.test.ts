import { describe, expect, it } from "vitest";
import { fitLongEdge, imageSize, MAX_LIVE, ThumbCache, TTL_MS, type ThumbResource } from "./thumbCache";

interface Res extends ThumbResource {
  key: string;
  disposed: boolean;
}

function setup(max = MAX_LIVE) {
  let now = 0;
  const pending = new Map<string, (r: Res) => void>();
  const failers = new Map<string, () => void>();
  const made: Res[] = [];
  const cache = new ThumbCache<Res>({
    max,
    now: () => now,
    load: (key) =>
      new Promise<Res>((resolve, reject) => {
        pending.set(key, (r) => resolve(r));
        failers.set(key, () => reject(new Error("x")));
      }),
  });
  const resolve = async (key: string) => {
    const r: Res = { key, disposed: false, dispose() { this.disposed = true; } };
    made.push(r);
    pending.get(key)!(r);
    pending.delete(key);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { cache, resolve, made, pending, failers, advance: (ms: number) => (now += ms) };
}

const keys = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `k${from + i}`);

describe("ThumbCache：同時最多 24 張（解碼中＋常駐）", () => {
  it("要 30 張只開始 24 張，其餘排隊；解碼中與常駐合計不超過 24", async () => {
    const t = setup();
    t.cache.setVisible(keys(24));
    expect(t.cache.stats()).toMatchObject({ decoding: 24, resident: 0, queued: 0 });
    // 視野是 24 張；再多要求的先不會被接受（可見集合 ≤ 24 是呼叫端的責任），這裡用較小的上限測排隊
    const t2 = setup(4);
    t2.cache.setVisible(keys(6));
    expect(t2.cache.stats()).toMatchObject({ decoding: 4, queued: 2 });
    await t2.resolve("k0");
    expect(t2.cache.stats().decoding + t2.cache.stats().resident).toBeLessThanOrEqual(4);
    expect(t2.cache.get("k0")).not.toBeNull();
    expect(t2.cache.get("k1")).toBeNull();
  });

  it("可見的常駐縮圖不會被擠掉：滿了就繼續排隊", async () => {
    const t = setup(2);
    t.cache.setVisible(["a", "b", "c"]);
    await t.resolve("a");
    await t.resolve("b");
    expect(t.cache.stats()).toMatchObject({ resident: 2, queued: 1 });
    expect(t.made.every((r) => !r.disposed)).toBe(true);
  });

  it("槽位用完時，立刻釋放不在視野內、最久沒看到的縮圖", async () => {
    const t = setup(2);
    t.cache.setVisible(["a", "b"]);
    await t.resolve("a");
    await t.resolve("b");
    t.advance(1000);
    t.cache.setVisible(["b", "c"]); // a 離開視野，c 想要槽位
    expect(t.made.find((r) => r.key === "a")!.disposed).toBe(true);
    expect(t.cache.get("a")).toBeNull();
    expect(t.cache.stats()).toMatchObject({ decoding: 1, resident: 1 });
  });
});

describe("ThumbCache：離開視野 30 秒後釋放", () => {
  it("29.9 秒還在，30 秒釋放；回到視野重新計時", async () => {
    const t = setup();
    t.cache.setVisible(["a", "b"]);
    await t.resolve("a");
    await t.resolve("b");
    t.cache.setVisible(["b"]);
    t.advance(TTL_MS - 100);
    t.cache.sweep();
    expect(t.cache.get("a")).not.toBeNull();
    t.advance(100);
    t.cache.sweep();
    expect(t.cache.get("a")).toBeNull();
    expect(t.made.find((r) => r.key === "a")!.disposed).toBe(true);
    expect(t.cache.get("b")).not.toBeNull(); // 還在視野內的不受影響
    expect(t.cache.stats().resident).toBe(1);
  });

  it("看得到的縮圖永遠不會因為 TTL 被釋放", async () => {
    const t = setup();
    t.cache.setVisible(["a"]);
    await t.resolve("a");
    t.advance(TTL_MS * 5);
    t.cache.sweep();
    expect(t.cache.get("a")).not.toBeNull();
  });
});

describe("ThumbCache：卸載與失敗", () => {
  it("disposeAll：常駐的立刻釋放，解碼中的完成時釋放，之後不再接受新要求", async () => {
    const t = setup();
    t.cache.setVisible(["a", "b"]);
    await t.resolve("a");
    t.cache.disposeAll();
    expect(t.made[0]!.disposed).toBe(true);
    await t.resolve("b");
    expect(t.made[1]!.disposed).toBe(true);
    expect(t.cache.stats()).toMatchObject({ decoding: 0, resident: 0, queued: 0 });
    t.cache.setVisible(["z"]);
    expect(t.cache.stats().decoding).toBe(0);
  });

  it("解碼失敗不佔槽位，冷卻期間不重試", async () => {
    const t = setup(1);
    t.cache.setVisible(["a"]);
    t.failers.get("a")!();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.cache.stats().decoding).toBe(0);
    t.cache.setVisible(["a"]);
    expect(t.cache.stats().decoding).toBe(0);
    t.advance(61_000);
    t.cache.setVisible(["a"]);
    expect(t.cache.stats().decoding).toBe(1);
  });

  it("沒有可見需求的排隊項目會被取消", () => {
    const t = setup(1);
    t.cache.setVisible(["a", "b", "c"]);
    expect(t.cache.stats().queued).toBe(2);
    t.cache.setVisible(["a"]);
    expect(t.cache.stats().queued).toBe(0);
  });
});

describe("imageSize／fitLongEdge", () => {
  it("讀 PNG 檔頭", () => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(b.buffer);
    dv.setUint32(16, 640);
    dv.setUint32(20, 480);
    expect(imageSize(b)).toEqual({ width: 640, height: 480 });
  });
  it("讀 JPEG 的 SOF（跳過 APP 區段）", () => {
    // SOI, APP0(len 4), SOF0(len 11): precision, height 300, width 200
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x00, 0xc8, 0x03, 0x01, 0x22, 0x00]);
    expect(imageSize(b)).toEqual({ width: 200, height: 300 });
  });
  it("讀不懂回傳 null", () => {
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("長邊縮到 256，不放大，保持比例", () => {
    expect(fitLongEdge(4000, 3000)).toEqual({ width: 256, height: 192 });
    expect(fitLongEdge(3000, 4000)).toEqual({ width: 192, height: 256 });
    expect(fitLongEdge(100, 80)).toEqual({ width: 100, height: 80 });
  });
});
