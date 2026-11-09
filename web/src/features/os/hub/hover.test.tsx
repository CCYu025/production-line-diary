import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bindCanvasHover, createHoverProbe, createHoverStore, useHovered, type HoverStore } from "./hover";

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

describe("懸停來源（H0 r3：指標從畫布移到 HUD 鍵時 enter 先於 leave）", () => {
  it("release 只清自己來源的懸停；set 覆蓋任何來源；clear 無條件", () => {
    const s = createHoverStore();
    s.set("CH-05", "hud");
    s.release("3d");
    expect(s.get()).toBe("CH-05");
    expect(s.getSource()).toBe("hud");
    s.set("CH-03", "3d");
    s.release("hud");
    expect(s.get()).toBe("CH-03");
    s.release("3d", "CH-01");
    expect(s.get()).toBe("CH-03");
    s.release("3d", "CH-03");
    expect(s.get()).toBeNull();
    s.set("CH-02", "hud");
    s.clear();
    expect(s.get()).toBeNull();
    expect(s.getSource()).toBeNull();
  });

  function wire() {
    const store = createHoverStore();
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    let target: "CH-06" | null = "CH-06";
    const off = bindCanvasHover(canvas, {
      hit: () => target,
      hover: () => store,
      pickable: () => true,
      setCursor: (c) => {
        canvas.style.cursor = c;
      },
      schedule: (cb) => {
        cb();
        return 1;
      },
      cancel: () => {},
    });
    return { store, canvas, off, setTarget: (t: "CH-06" | null) => (target = t) };
  }

  it("整合：同一個 DOM 裡先派發 HUD 鍵 pointerenter、再派發畫布 pointerleave，懸停仍是 CH-05", async () => {
    const { Hud } = await import("../hud/Hud");
    const { computeSignals } = await import("./signals");
    const w = wire();
    render(<Hud selected="CH-02" signals={computeSignals(undefined, new Date())} active onEnter={() => {}} onExit={() => {}} hover={w.store} />);
    const key = document.querySelector('[data-os="hud-ch"][data-ch="CH-05"]')!;
    w.canvas.dispatchEvent(new Event("pointermove"));
    fireEvent.pointerEnter(key);
    expect(w.store.get()).toBe("CH-05");
    w.canvas.dispatchEvent(new Event("pointerleave"));
    expect(w.store.get()).toBe("CH-05");
    expect(w.store.getSource()).toBe("hud");
    // 反方向：離開鍵 → 進入畫布懸停另一台
    fireEvent.pointerLeave(key);
    expect(w.store.get()).toBeNull();
    const ev = new Event("pointermove");
    w.canvas.dispatchEvent(ev);
    expect(w.store.get()).toBe("CH-06");
    expect(w.store.getSource()).toBe("3d");
    // 畫布 3D 懸停中，HUD 鍵的 leave（沒有 enter 過）不清掉它
    fireEvent.pointerLeave(key);
    expect(w.store.get()).toBe("CH-06");
    w.canvas.dispatchEvent(new Event("pointerleave"));
    expect(w.store.get()).toBeNull();
    w.off();
  });
});
