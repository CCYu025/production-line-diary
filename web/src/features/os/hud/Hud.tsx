/*
 * HUD（docs/os-mode-spec.md §4.5）：疊在控制室 3D 上的真實操作層。
 * 上方狀態列：PLD/OS 1995、時鐘（只在 HUD 作用中時每秒更新，不用 rAF）、CRT 強度三段切換、EXIT TO WEB。
 * 下方頻道清單：7 個真實的 <button>（roving tabindex：選中的是 tab stop）；←/→ 的選擇由 OsShell 的全域快速鍵處理，
 * 這裡負責「焦點在清單內時，焦點跟著選中的按鈕走」。
 * 按鈕文字與 accessible name 取自即時訊號的 name（例如 "CH-02 紀錄 · 今日 3"；資料還沒載入只有 "CH-02 紀錄"）。
 * 數字是週期性更新的，所以按鈕不是 aria-live；新異常的公告由 OsShell 的專用 aria-live 區域負責。
 */
import * as React from "react";
import { CHANNELS, type ChannelId } from "../channels";
import { CRT_LABEL, CRT_LEVELS, setCrtLevel, useCrtLevel } from "../crt/settings";
import type { HubSignals } from "../hub/signals";

export interface HudHandle {
  /** 把焦點移到選中頻道的按鈕 */
  focusSelected(): void;
}

export interface HudProps {
  selected: ChannelId;
  /** 每個頻道的即時訊號（按鈕文字） */
  signals: HubSignals;
  /** 控制室可操作（HUD 顯示）；否則 inert＋隱藏 */
  active: boolean;
  /** 點擊或 Enter：進入頻道 */
  onEnter: (id: ChannelId) => void;
  onExit: () => void;
}

export function formatClock(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** CRT 強度三段切換（D7）：真正的按鈕，aria-pressed 標示目前強度。 */
export function CrtToggle() {
  const level = useCrtLevel();
  return (
    <div className="os-crt" role="group" aria-label="CRT 強度" data-os="crt-toggle">
      {CRT_LEVELS.map((l) => (
        <button key={l} type="button" className="os-crt-button" data-crt={l} aria-pressed={l === level} onClick={() => setCrtLevel(l)}>
          {CRT_LABEL[l]}
        </button>
      ))}
    </div>
  );
}

/** 時鐘：只在 active 時每秒更新（setInterval，不用 rAF）。 */
function Clock({ active }: { active: boolean }) {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return (
    <span className="os-clock" data-os="clock">
      {formatClock(now)}
    </span>
  );
}

export const Hud = React.forwardRef<HudHandle, HudProps>(function Hud({ selected, signals, active, onEnter, onExit }, ref) {
  const listRef = React.useRef<HTMLUListElement>(null);
  const focusInside = React.useRef(false);

  const buttonOf = React.useCallback(
    (id: ChannelId) => listRef.current?.querySelector<HTMLButtonElement>(`[data-ch="${id}"]`) ?? null,
    [],
  );

  React.useImperativeHandle(ref, () => ({ focusSelected: () => buttonOf(selected)?.focus({ preventScroll: true }) }), [buttonOf, selected]);

  // 焦點在清單內時，選擇改變（←/→）焦點跟著走
  React.useLayoutEffect(() => {
    if (!focusInside.current) return;
    const el = buttonOf(selected);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [selected, buttonOf]);

  const inert = active ? undefined : { inert: "" };
  return (
    <div className="os-hud" data-os="hud" data-active={active ? "true" : "false"} {...(inert as object)}>
      <h1 className="sr-only">PLD/OS 1995 控制室</h1>
      <div className="os-statusbar" data-os="statusbar">
        <span className="os-statusbar-title">PLD/OS 1995</span>
        <Clock active={active} />
        <CrtToggle />
        <button type="button" className="os-exit" data-os="exit" onClick={onExit}>
          EXIT TO WEB
        </button>
      </div>
      <nav className="os-channels" aria-label="頻道">
        <ul
          ref={listRef}
          data-os="hud-list"
          onFocus={() => {
            focusInside.current = true;
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusInside.current = false;
          }}
        >
          {CHANNELS.map((ch) => {
            const isSelected = ch.id === selected;
            return (
              <li key={ch.id}>
                <button
                  type="button"
                  className="os-hud-button"
                  data-os="hud-ch"
                  data-ch={ch.id}
                  tabIndex={isSelected ? 0 : -1}
                  {...(isSelected ? { "aria-current": "true" as const } : {})}
                  onClick={() => onEnter(ch.id)}
                >
                  {signals[ch.id].name}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
});
