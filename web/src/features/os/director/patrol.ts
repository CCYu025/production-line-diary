/*
 * 待機巡視（docs/os-mode-spec.md §4.3；X2）：控制室（HUB）無輸入達 PATROL_IDLE_MS 就進入巡視；
 * 任何按鍵、點擊、滾輪、觸控「立刻」結束巡視，而且那次輸入「不被吞掉」——監聽器只觀察（passive、不 preventDefault、
 * 不 stopPropagation），所以那次按鍵或點擊照常傳給下面的畫面。
 * 只在符合資格時（導演狀態是 HUB、介面沒有暫停）才計時；資格消失立刻結束巡視並停表。
 * 這個檔案是純邏輯（計時器＋事件），不碰 React／three；鏡頭怎麼巡視由場景層讀 `patrolling` 決定。
 */
import { PATROL_IDLE_MS } from "../transition/timing";

/** 算「有輸入」的事件（capture 階段、passive 觀察）。不含 mousemove：滑鼠只是晃過不算操作。 */
export const PATROL_INPUT_EVENTS = ["keydown", "pointerdown", "mousedown", "click", "wheel", "touchstart"] as const;

export interface IdlePatrol {
  /** 資格改變：true＝在控制室且介面沒暫停。變成 true 時從頭計時；變成 false 時立刻結束巡視 */
  setEligible(eligible: boolean): void;
  /** 有輸入：結束巡視並重新計時（監聽器或測試直接呼叫） */
  notifyInput(): void;
  /** 目前是否巡視中 */
  isPatrolling(): boolean;
  /** 停止一切（卸載）：清計時器、移除監聽器 */
  dispose(): void;
}

export interface IdlePatrolOptions {
  idleMs?: number;
  /** 巡視狀態改變時呼叫（只在真的改變時） */
  onChange: (patrolling: boolean) => void;
  /** 監聽輸入的目標；省略＝不裝監聽器（呼叫端自己呼叫 notifyInput） */
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
}

export function createIdlePatrol({ idleMs = PATROL_IDLE_MS, onChange, target }: IdlePatrolOptions): IdlePatrol {
  let eligible = false;
  let patrolling = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (v: boolean) => {
    if (patrolling === v) return;
    patrolling = v;
    onChange(v);
  };
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const arm = () => {
    clear();
    if (!eligible || disposed) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (eligible && !disposed) set(true);
    }, idleMs);
  };

  // 只觀察：不呼叫 preventDefault／stopPropagation，所以輸入不會被吞掉
  const onInput = () => api.notifyInput();
  const api: IdlePatrol = {
    setEligible(next) {
      if (disposed || eligible === next) return;
      eligible = next;
      if (next) arm();
      else {
        clear();
        set(false);
      }
    },
    notifyInput() {
      if (disposed) return;
      set(false);
      arm();
    },
    isPatrolling: () => patrolling,
    dispose() {
      disposed = true;
      clear();
      if (target) for (const t of PATROL_INPUT_EVENTS) target.removeEventListener(t, onInput, true);
    },
  };
  if (target) for (const t of PATROL_INPUT_EVENTS) target.addEventListener(t, onInput, { capture: true, passive: true });
  return api;
}
