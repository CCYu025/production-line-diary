/*
 * 輸入閘（docs/os-mode-spec.md §5.1 交接點規則）：轉場在交接點之前，目的地還沒出現，
 * 第一次按鍵或點擊＝跳到終點，而且這次輸入「不會」傳給下面的畫面。
 * 做法：window 的 capture 階段攔截「一個手勢」的所有事件（pointerdown／mousedown／pointerup／mouseup／click…，
 * 或 keydown 與對應的 keyup），preventDefault ＋ stopImmediatePropagation；手勢結束（或 600ms 安全逾時）後完全移除。
 * 即使轉場因為這次輸入而結束（呼叫端不再需要閘），已開始的手勢仍要攔到結束，否則 mouseup／click 會落到剛現身的目的地上。
 * 沒有手勢進行中時，release() 把所有監聽器移除（交接點之後完全沒有監聽器）。
 */

export const GATE_SAFETY_MS = 600;

const POINTER_START = ["pointerdown", "mousedown"] as const;
const POINTER_REST = ["pointerup", "mouseup", "click", "auxclick", "contextmenu", "pointercancel"] as const;
/** 這些事件一出現，手勢就算結束。 */
const POINTER_END = new Set<string>(["click", "auxclick", "contextmenu", "pointercancel"]);
const MODIFIERS = new Set<string>(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "Fn", "OS"]);

export interface InputGate {
  /** 不再需要閘：移除「等待手勢」的監聽器；已開始的手勢會攔到結束 */
  release(): void;
}

function swallow(e: Event): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}

export function armInputGate(target: Window, onSkip: () => void): InputGate {
  let armed = true;
  let swallowing = false;
  let keyCode: string | null = null;
  let timer: number | undefined;
  const swallowListeners: Array<[string, (e: Event) => void]> = [];

  const finish = () => {
    swallowing = false;
    for (const [type, fn] of swallowListeners) target.removeEventListener(type, fn, true);
    swallowListeners.length = 0;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };

  const disarm = () => {
    armed = false;
    for (const t of POINTER_START) target.removeEventListener(t, onPointerStart, true);
    target.removeEventListener("keydown", onKeyStart, true);
  };

  const begin = () => {
    swallowing = true;
    disarm();
    timer = window.setTimeout(finish, GATE_SAFETY_MS);
    onSkip();
  };

  function onPointerStart(e: Event) {
    if (!armed) return;
    swallow(e);
    for (const t of POINTER_START) {
      const fn = (ev: Event) => swallow(ev);
      swallowListeners.push([t, fn]);
      target.addEventListener(t, fn, true);
    }
    for (const t of POINTER_REST) {
      const fn = (ev: Event) => {
        swallow(ev);
        if (POINTER_END.has(ev.type)) finish();
      };
      swallowListeners.push([t, fn]);
      target.addEventListener(t, fn, true);
    }
    begin();
  }

  function onKeyStart(e: Event) {
    const ev = e as KeyboardEvent;
    if (!armed || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey || MODIFIERS.has(ev.key)) return;
    swallow(e);
    keyCode = ev.code;
    const down = (k: Event) => {
      if ((k as KeyboardEvent).code === keyCode) swallow(k); // 按住不放的重複 keydown
    };
    const up = (k: Event) => {
      if ((k as KeyboardEvent).code !== keyCode) return;
      swallow(k);
      finish();
    };
    swallowListeners.push(["keydown", down], ["keyup", up]);
    target.addEventListener("keydown", down, true);
    target.addEventListener("keyup", up, true);
    begin();
  }

  for (const t of POINTER_START) target.addEventListener(t, onPointerStart, true);
  target.addEventListener("keydown", onKeyStart, true);

  return {
    release() {
      if (armed) disarm();
      if (!swallowing) finish();
    },
  };
}
