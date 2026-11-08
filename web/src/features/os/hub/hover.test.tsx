import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createHoverProbe, createHoverStore, useHovered, type HoverStore } from "./hover";

describe("createHoverStore（H0）", () => {
  it("get／set／subscribe；同值不通知；取消訂閱後不再通知", () => {
    const s = createHoverStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    expect(s.get()).toBeNull();
    s.set("CH-03");
    expect(s.get()).toBe("CH-03");
    expect(fn).toHaveBeenCalledTimes(1);
    s.set("CH-03");
    expect(fn).toHaveBeenCalledTimes(1);
    s.set(null);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    s.set("CH-01");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("每個 store 各自獨立（不是模組層級的全域值）", () => {
    const a = createHoverStore();
    const b = createHoverStore();
    a.set("CH-02");
    expect(b.get()).toBeNull();
  });

  it("useHovered 隨 store 更新；沒有 store 永遠是 null", () => {
    const store = createHoverStore();
    const seen: Array<string | null> = [];
    function Probe({ s }: { s: HoverStore | undefined }) {
      seen.push(useHovered(s));
      return null;
    }
    const { rerender } = render(<Probe s={store} />);
    act(() => store.set("CH-05"));
    expect(seen.at(-1)).toBe("CH-05");
    rerender(<Probe s={undefined} />);
    expect(seen.at(-1)).toBeNull();
  });
});

describe("createHoverProbe（3D 懸停射線的 rAF 節流）", () => {
  function setup(hit: (x: number, y: number) => "CH-01" | "CH-02" | null) {
    const queue = new Map<number, () => void>();
    let next = 1;
    const results: Array<string | null> = [];
    const hitFn = vi.fn(hit);
    const probe = createHoverProbe({
      hit: hitFn,
      onResult: (c) => results.push(c),
      schedule: (cb) => {
        queue.set(next, cb);
        return next++;
      },
      cancel: (h) => {
        queue.delete(h);
      },
    });
    const frame = () => {
      const cbs = [...queue.values()];
      queue.clear();
      cbs.forEach((cb) => cb());
    };
    return { probe, frame, hitFn, results, queue };
  }

  it("一個動畫幀內不論來幾次 pointermove，射線最多算一次，而且用最後一個座標", () => {
    const t = setup((x) => (x > 50 ? "CH-02" : "CH-01"));
    for (let i = 0; i < 30; i++) t.probe.move(i, 10);
    t.probe.move(99, 10);
    expect(t.hitFn).not.toHaveBeenCalled();
    expect(t.queue.size).toBe(1);
    t.frame();
    expect(t.hitFn).toHaveBeenCalledTimes(1);
    expect(t.hitFn).toHaveBeenCalledWith(99, 10);
    expect(t.results).toEqual(["CH-02"]);
    // 下一幀沒有新移動就不算
    t.frame();
    expect(t.hitFn).toHaveBeenCalledTimes(1);
    // 之後再移動又會排一次
    t.probe.move(1, 1);
    t.frame();
    expect(t.hitFn).toHaveBeenCalledTimes(2);
    expect(t.results).toEqual(["CH-02", "CH-01"]);
  });

  it("沒打到螢幕就回報 null", () => {
    const t = setup(() => null);
    t.probe.move(1, 1);
    t.frame();
    expect(t.results).toEqual([null]);
  });

  it("指標離開：取消尚未執行的排程、立刻回報 null；dispose 也會取消", () => {
    const t = setup(() => "CH-01");
    t.probe.move(1, 1);
    t.probe.leave();
    expect(t.queue.size).toBe(0);
    t.frame();
    expect(t.hitFn).not.toHaveBeenCalled();
    expect(t.results).toEqual([null]);
    t.probe.move(2, 2);
    t.probe.dispose();
    expect(t.queue.size).toBe(0);
    t.frame();
    expect(t.hitFn).not.toHaveBeenCalled();
  });
});
