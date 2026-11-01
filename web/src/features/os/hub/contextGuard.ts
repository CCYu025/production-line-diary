/*
 * WebGL context 遺失的處理（docs/os-mode-spec.md §7）：遺失後最多等 timeoutMs（3 秒）讓瀏覽器恢復一次；
 * 逾時、或恢復之後再次遺失，就呼叫 onFail（改用網頁模式）。純邏輯，計時器可注入以便測試。
 */
export const CONTEXT_RESTORE_TIMEOUT_MS = 3000;

export interface ContextGuardOptions {
  onFail: () => void;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface ContextGuard {
  /** 收到 webglcontextlost */
  lost(): void;
  /** 收到 webglcontextrestored */
  restored(): void;
  /** 卸載：之後的事件都忽略，計時器取消 */
  dispose(): void;
}

export function createContextGuard({
  onFail,
  timeoutMs = CONTEXT_RESTORE_TIMEOUT_MS,
  setTimer = (fn, ms) => window.setTimeout(fn, ms),
  clearTimer = (id) => window.clearTimeout(id as number),
}: ContextGuardOptions): ContextGuard {
  let losses = 0;
  let timer: unknown = null;
  let done = false;

  const clear = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const fail = () => {
    if (done) return;
    done = true;
    clear();
    onFail();
  };

  return {
    lost() {
      if (done) return;
      losses += 1;
      clear();
      if (losses >= 2) {
        fail();
        return;
      }
      timer = setTimer(fail, timeoutMs);
    },
    restored() {
      if (done) return;
      clear();
    },
    dispose() {
      done = true;
      clear();
    },
  };
}
