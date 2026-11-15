import { describe, expect, it } from "vitest";
import { ReducedMotionSource } from "./reducedMotion";

function fakeMql(initial: boolean) {
  let reads = 0;
  let matches = initial;
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    get matches() {
      reads++;
      return matches;
    },
    addEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb),
    removeEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb),
  } as unknown as MediaQueryList;
  return { mql, reads: () => reads, set: (v: boolean) => { matches = v; for (const l of Array.from(listeners)) l({ matches: v }); }, listeners };
}

describe("ReducedMotionSource：單一來源，兩個方向都即時生效", () => {
  it("建構時讀一次 mql.matches，之後讀取 matches 不再碰 mql", () => {
    const f = fakeMql(false);
    const s = new ReducedMotionSource(f.mql);
    for (let i = 0; i < 1000; i++) void s.matches;
    expect(f.reads()).toBe(1);
  });
  it("開啟與關閉都由 change 事件更新並通知訂閱者", () => {
    const f = fakeMql(false);
    const s = new ReducedMotionSource(f.mql);
    const seen: boolean[] = [];
    s.subscribe((v) => seen.push(v));
    expect(s.matches).toBe(false);
    f.set(true);
    expect(s.matches).toBe(true);
    f.set(false);
    expect(s.matches).toBe(false);
    expect(seen).toEqual([true, false]);
  });
  it("一開始就是減少動態效果；dispose 後移除監聽", () => {
    const f = fakeMql(true);
    const s = new ReducedMotionSource(f.mql);
    expect(s.matches).toBe(true);
    s.dispose();
    expect(f.listeners.size).toBe(0);
  });
  it("沒有 matchMedia 時視為不減少", () => {
    expect(new ReducedMotionSource(null).matches).toBe(false);
  });
});
