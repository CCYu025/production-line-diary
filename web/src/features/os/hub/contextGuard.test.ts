import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContextGuard } from "./contextGuard";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createContextGuard", () => {
  it("遺失後 3 秒內恢復：不失敗", () => {
    const onFail = vi.fn();
    const g = createContextGuard({ onFail });
    g.lost();
    vi.advanceTimersByTime(2999);
    g.restored();
    vi.advanceTimersByTime(10_000);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("遺失後 3 秒沒恢復：失敗一次", () => {
    const onFail = vi.fn();
    const g = createContextGuard({ onFail });
    g.lost();
    vi.advanceTimersByTime(2999);
    expect(onFail).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onFail).toHaveBeenCalledTimes(1);
    g.lost();
    vi.advanceTimersByTime(10_000);
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it("恢復一次之後第二次遺失：立刻失敗", () => {
    const onFail = vi.fn();
    const g = createContextGuard({ onFail });
    g.lost();
    g.restored();
    g.lost();
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it("dispose 之後的事件與計時器都不作用", () => {
    const onFail = vi.fn();
    const g = createContextGuard({ onFail });
    g.lost();
    g.dispose();
    vi.advanceTimersByTime(10_000);
    g.lost();
    g.lost();
    expect(onFail).not.toHaveBeenCalled();
  });
});
