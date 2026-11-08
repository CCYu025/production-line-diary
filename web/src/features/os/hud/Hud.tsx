/*
 * HUD（docs/os-mode-spec.md §4.5；H0 重新設計見 docs/holo-mode-spec.md §7）：疊在控制室 3D 上的真實操作層。
 * 上方狀態列（透明底，只有線與文字）：PLD/OS 1995、時鐘（只在 HUD 作用中時每秒更新，不用 rAF）、CRT 強度三段切換、音效按鈕（X4）、EXIT TO WEB。
 * 下方控制台：7 個真實的 <button>（roving tabindex：選中的是 tab stop），沿一條淺弧排列（CSS）；←/→ 的選擇由 OsShell 的全域快速鍵處理，
 * 這裡負責「焦點在清單內時，焦點跟著選中的按鈕走」。
 * 懸停連動（H0）：鍵懸停 → hover store 寫入 → 3D 對應螢幕出現淡四角框；3D 螢幕懸停 → 這裡對應的鍵得到 data-hover="true"。
 * 只是預覽：不改 aria-current、不改選取。引線（aria-hidden、pointer-events: none）從選中的鍵畫到 3D 選中的螢幕，只在選取／視窗／CRT 強度改變時重算。
 * 按鈕文字與 accessible name 取自即時訊號的 name（例如 "CH-02 紀錄 · 今日 3"；資料還沒載入只有 "CH-02 紀錄"）。
 * 數字是週期性更新的，所以按鈕不是 aria-live；新異常的公告由 OsShell 的專用 aria-live 區域負責。
 */
import * as React from "react";
import { toggleSound } from "../audio/settings";
import { useSoundButton } from "../audio/useAudio";
import { CHANNELS, type ChannelId } from "../channels";
import { CRT_LABEL, CRT_LEVELS, setCrtLevel, useCrtLevel } from "../crt/settings";
import { A_ZONE } from "../crt/zones";
import { useHovered, type HoverStore } from "../hub/hover";
import { hudArcDepthPx, SELECT_YAW_MS, selectYawDeg } from "../hub/layout";
import type { HubSignals } from "../hub/signals";
import { keyLayout, leaderGeometry, type Leader } from "./leader";

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
  /** 懸停預覽的共用狀態（H0）；沒有就沒有連動 */
  hover?: HoverStore;
  /** 鏡頭在休息位置、沒有巡視（HUB 靜止）時才畫引線；其餘時間（轉場、巡視中）引線會對不上螢幕，所以隱藏 */
  settled?: boolean;
  /** 減少動態效果：選取偏航直接到位，引線不必等鏡頭 */
  reduced?: boolean;
}

/** 視窗大小（resize 時更新）；HUD 的弧度與引線都由它算 */
function useViewport(): { w: number; h: number } {
  const [vp, setVp] = React.useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  React.useEffect(() => {
    const on = () => setVp((p) => (p.w === window.innerWidth && p.h === window.innerHeight ? p : { w: window.innerWidth, h: window.innerHeight }));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

/** 按鈕名稱（"CH-02 紀錄 · 今日 3"）的視覺版：CH 代號獨立一排大字，其餘是第二排；textContent 仍與原本相同。 */
function KeyText({ id, text, className }: { id: ChannelId; text: string; className: string }) {
  const rest = text.startsWith(`${id} `) ? text.slice(id.length) : ` ${text}`;
  return (
    <span className={className} aria-hidden="true">
      <span className="os-hud-id">{text.startsWith(`${id} `) ? id : ""}</span>
      {rest}
    </span>
  );
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

/** 音效按鈕（X4）：SND ON／SND OFF／SND …（待啟用：還沒有第一次手勢）／SND N/A（不支援）；真正的按鈕，aria-pressed 標示是否開啟。 */
export function SoundButton() {
  const s = useSoundButton();
  return (
    <button type="button" className="os-sound" data-os="sound" aria-pressed={s.pressed} aria-label={s.name} disabled={s.disabled} onClick={toggleSound}>
      {s.label}
    </button>
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

export const Hud = React.forwardRef<HudHandle, HudProps>(function Hud({ selected, signals, active, onEnter, onExit, hover, settled = false, reduced = false }, ref) {
  const listRef = React.useRef<HTMLUListElement>(null);
  const hudRef = React.useRef<HTMLDivElement>(null);
  const hovered = useHovered(hover);
  const vp = useViewport();
  const level = useCrtLevel();
  const barrelK = A_ZONE[level].effects ? A_ZONE[level].barrel : 0;

  // 鍵的水平對位：中心對齊各螢幕的投影（只在視窗大小、CRT 強度、選取（偏航）改變時重算）；算不出來或空間不夠就退回平均排列
  const layout = React.useMemo(() => keyLayout(vp.w, vp.h, barrelK, selectYawDeg(CHANNELS.findIndex((c) => c.id === selected))), [vp.w, vp.h, barrelK, selected]);

  // HUD 不作用（轉場、進入工作站）時清掉懸停：隱藏的鍵收不到 pointerleave，3D 的預覽框不能留著
  React.useEffect(() => {
    if (!active) hover?.set(null);
  }, [active, hover]);

  // 引線：選取改變後等鏡頭的選取偏航到位（SELECT_YAW_MS）才顯示；其餘時機（視窗、CRT 強度）立即重算
  const [leader, setLeader] = React.useState<Leader | null>(null);
  const [leaderReady, setLeaderReady] = React.useState(true);
  const seenSelected = React.useRef(selected);
  React.useLayoutEffect(() => {
    if (seenSelected.current === selected) return;
    seenSelected.current = selected;
    if (reduced) return;
    setLeaderReady(false);
    const t = window.setTimeout(() => setLeaderReady(true), SELECT_YAW_MS + 30);
    return () => window.clearTimeout(t);
  }, [selected, reduced]);
  React.useLayoutEffect(() => {
    const key = listRef.current?.querySelector<HTMLButtonElement>(`[data-ch="${selected}"]`);
    const root = hudRef.current;
    if (!settled || !active || !key || !root) {
      setLeader(null);
      return;
    }
    const kr = key.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    setLeader(leaderGeometry({ width: vp.w, height: vp.h, channel: selected, barrelK, key: { left: kr.left - rr.left, top: kr.top - rr.top, width: kr.width } }));
  }, [settled, active, selected, vp.w, vp.h, barrelK, signals, layout]);
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
    <div
      ref={hudRef}
      className="os-hud"
      data-os="hud"
      data-active={active ? "true" : "false"}
      style={{ "--hud-arc": `${hudArcDepthPx(vp.h)}px` } as React.CSSProperties}
      {...(inert as object)}
    >
      <h1 className="sr-only">PLD/OS 1995 控制室</h1>
      <div className="os-statusbar" data-os="statusbar">
        <span className="os-statusbar-title">PLD/OS 1995</span>
        <Clock active={active} />
        <CrtToggle />
        <SoundButton />
        <button type="button" className="os-exit" data-os="exit" onClick={onExit}>
          EXIT TO WEB
        </button>
      </div>
      <nav className="os-channels" aria-label="頻道" data-placed={layout ? "true" : "false"}>
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
              <li
                key={ch.id}
                style={layout ? ({ "--key-x": `${layout.x[CHANNELS.indexOf(ch)]}px`, "--key-w": `${layout.w}px` } as React.CSSProperties) : undefined}
              >
                <button
                  type="button"
                  className="os-hud-button"
                  data-os="hud-ch"
                  data-ch={ch.id}
                  tabIndex={isSelected ? 0 : -1}
                  {...(isSelected ? { "aria-current": "true" as const } : {})}
                  {...(hovered === ch.id ? { "data-hover": "true" as const } : {})}
                  aria-label={signals[ch.id].name}
                  onClick={() => onEnter(ch.id)}
                  onPointerEnter={() => hover?.set(ch.id)}
                  onPointerLeave={() => {
                    if (hover?.get() === ch.id) hover.set(null);
                  }}
                >
                  {/* accessible name 永遠是完整的 name（aria-label）；視窗 < 1440px 時 CSS 改顯示精簡文字 */}
                  <KeyText id={ch.id} text={signals[ch.id].name} className="os-hud-full" />
                  <KeyText id={ch.id} text={signals[ch.id].compact} className="os-hud-compact" />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* 引線：純裝飾（aria-hidden、pointer-events: none；列印隱藏）。選中的鍵 → 3D 選中的螢幕 */}
      <svg className="os-lead" data-os="hud-lead" data-ready={leaderReady ? "true" : "false"} aria-hidden="true" focusable="false">
        {leader ? (
          <>
            <line x1={leader.x1} y1={leader.y1} x2={leader.x2} y2={leader.y2} />
            <circle cx={leader.x1} cy={leader.y1 - 3} r="2" />
          </>
        ) : null}
      </svg>
    </div>
  );
});
