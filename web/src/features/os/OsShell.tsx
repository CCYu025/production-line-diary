/*
 * OS 外殼（docs/os-mode-spec.md §3.1–3.4、§4.5–4.6、§7）：取代網頁模式的 AppShell，整個延遲載入（React.lazy，見 app/ModeShell.tsx）。
 * OsShell ＝ 裝置門檻（DeviceGate）＋ 舞台（OsStage）。由下到上：控制室 3D 層（A）→ 工作站（現有頁面＋CRT 外框）→ HUD → 轉場疊層（A）；
 * Radix 浮層（指令列、對話框、燈箱）與 toast 是 z-50 以上，蓋在所有 OS 圖層之上。
 */
import * as React from "react";
import { Outlet, useLocation, useMatches, useNavigate } from "react-router-dom";
import { consumeBoot } from "@/app/BootScreen";
import type { RouteHandle } from "@/app/AppShell";
import { notify } from "@/lib/feedback";
import { setMode } from "@/lib/mode";
import { applyTheme, getAppliedTheme, getThemePreference, subscribeTheme } from "@/lib/theme";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { channelByIndex, channelForPath, CHANNELS, getChannel, HUB_PATH, isHubPath, type ChannelId } from "./channels";
import { DeviceGate } from "./DeviceGate";
import { installEscapeRule } from "./director/escapeRule";
import { arrivalOf } from "./director/focusRule";
import { isDialogOpen, isInputTarget, isInteractiveTarget, resolveKey } from "./director/keymap";
import { phaseOf, placeOf, stationChOf, transitionKindOf, type DirectorState } from "./director/reducer";
import { useDirector } from "./director/useDirector";
import { useInputGate } from "./director/useInputGate";
import HubCanvas, { type HubMode } from "./hub/HubCanvas";
import { CommandPalette } from "./hud/CommandPalette";
import { Hud, type HudHandle } from "./hud/Hud";
import "./os.css";
import { StationFrame } from "./station/StationFrame";
import { TransitionOverlay } from "./transition/TransitionOverlay";
import { setKeepCyberOnExit, shouldKeepCyberOnExit, webglAvailable, WEBGL_FALLBACK_TEXT } from "./webgl";

function useRouteTitle(): string {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]?.handle as RouteHandle | undefined;
    if (handle?.title) return handle.title;
  }
  return "產線日誌";
}

/** 直接載入控制室、尚未選過頻道時預設選中的頻道。 */
const DEFAULT_SELECTED: ChannelId = "CH-02";

function hubMode(s: DirectorState): HubMode {
  switch (s.kind) {
    case "ENTERING":
      return "entering";
    case "EXITING":
      return "exiting";
    case "STATION":
    case "SWITCHING": // 短轉場不經過控制室：控制室維持隱藏、繪製迴圈不跑
      return "station";
    case "HUB":
    case "BOOT":
      return "hub";
  }
}

const nameOf = (ch: ChannelId | null) => (ch ? getChannel(ch).name : "頁面");

/** 轉場開始時的宣告。 */
function startAnnouncement(s: DirectorState): string {
  switch (s.kind) {
    case "ENTERING":
      return `進入${nameOf(s.ch)}`;
    case "EXITING":
      return "回到控制室";
    case "SWITCHING":
      return `切換到${nameOf(s.to)}`;
    default:
      return "";
  }
}

/** 轉場完成時的宣告（依剛結束的轉場）。 */
function doneAnnouncement(s: DirectorState): string {
  switch (s.kind) {
    case "ENTERING":
      return `已進入${nameOf(s.ch)}`;
    case "EXITING":
      return "已回到控制室";
    case "SWITCHING":
      return `已切換到${nameOf(s.to)}`;
    default:
      return "";
  }
}

export default function OsShell() {
  const title = useRouteTitle();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = React.useRef(pathname);
  pathRef.current = pathname;
  const navRef = React.useRef(navigate);
  navRef.current = navigate;

  // FX-01 開機畫面在 OS 模式不播放：要在子元件（儀表板的 BootLoading）第一次 render 之前用掉
  React.useState(() => consumeBoot());

  // <html data-mode="os">、Cyber 主題（只套用、不寫入：不呼叫 switchTheme）、開機畫面
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    setKeepCyberOnExit(false);
    root.dataset.mode = "os";
    applyTheme("cyber");
    consumeBoot();
    // 別的分頁改了 pld.theme（storage 事件會重新套用標準）：OS 模式期間一律維持 cyber
    const unsubscribe = subscribeTheme(() => {
      if (getAppliedTheme() !== "cyber") applyTheme("cyber");
    });
    return () => {
      unsubscribe();
      delete root.dataset.mode;
      delete root.dataset.osPhase;
      // WebGL 後備：這次載入保持 cyber（不寫入偏好）；其他情況依 pld.theme 還原
      applyTheme(shouldKeepCyberOnExit() ? "cyber" : getThemePreference());
    };
  }, []);

  React.useEffect(() => {
    document.title = title === "產線日誌" ? title : `${title}｜產線日誌`;
  }, [title]);

  /** 離開 OS 模式（D5）：留在目前路徑；在控制室（沒有可留的頁面）則到儀表板。焦點由 ModeShell 在 AppShell 掛上後移到 #main。 */
  const exitToWeb = React.useCallback(() => {
    if (isHubPath(pathRef.current)) void navRef.current("/dashboard", { replace: true });
    setMode("web");
  }, []);

  /** WebGL 不支援／初始化失敗／context 遺失後沒恢復（§7）：改用網頁模式（不記住為 os）、這次載入維持 cyber。 */
  const failedRef = React.useRef(false);
  const onWebglFailure = React.useCallback(() => {
    if (failedRef.current) return;
    failedRef.current = true;
    setKeepCyberOnExit(true);
    notify.error(WEBGL_FALLBACK_TEXT);
    exitToWeb();
  }, [exitToWeb]);

  // 掛載時就檢查（即使是直接載入工作站、還沒建立 3D 層）
  React.useEffect(() => {
    if (!webglAvailable()) onWebglFailure();
  }, [onWebglFailure]);

  return (
    <DeviceGate>
      <OsStage onExitWeb={exitToWeb} onWebglFailure={onWebglFailure} />
    </DeviceGate>
  );
}

interface OsStageProps {
  onExitWeb: () => void;
  onWebglFailure: () => void;
}

function OsStage({ onExitWeb, onWebglFailure }: OsStageProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const place = React.useMemo(() => placeOf(pathname), [pathname]);

  const { state, skip, clock, gateActive } = useDirector(place, reduced);
  useInputGate(gateActive, skip);

  const phase = phaseOf(state);
  const mainRef = React.useRef<HTMLElement>(null);
  const hudRef = React.useRef<HudHandle>(null);

  // ---- 選中的頻道：控制室記住最後一個「顯示過工作站」的頻道 ----
  const [selected, setSelected] = React.useState<ChannelId>(() => stationChOf(state) ?? channelForPath(pathname) ?? DEFAULT_SELECTED);
  const stationCh = stationChOf(state);
  const [lastStationCh, setLastStationCh] = React.useState(stationCh);
  if (stationCh !== lastStationCh) {
    // 只在「工作站頻道改變」那一刻跟著；離開轉場後半（使用者已經在用 HUD）不能把選擇拉回去
    setLastStationCh(stationCh);
    if (stationCh) setSelected(stationCh);
  }

  // 事件處理用的最新值（監聽器只裝一次）
  const latest = React.useRef({ phase, selected, navigate });
  latest.current = { phase, selected, navigate };

  const enterChannel = React.useCallback((id: ChannelId) => {
    setSelected(id);
    void latest.current.navigate(getChannel(id).path);
  }, []);

  // ---- 指令列 ----
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // 「/」（index 路由）在控制室不會渲染 Outlet，IndexRedirect 不會跑：這裡把網址整理成 /os（同為控制室，不影響導演狀態）
  React.useEffect(() => {
    if (pathname === "/") void navigate(HUB_PATH, { replace: true });
  }, [pathname, navigate]);

  // ---- 驗證用：目前階段 ----
  React.useLayoutEffect(() => {
    document.documentElement.dataset.osPhase = phase;
  }, [phase]);
  React.useLayoutEffect(
    () => () => {
      delete document.documentElement.dataset.osPhase;
    },
    [],
  );

  // ---- 快速鍵（§5.4、A6）：window 冒泡階段；規則在 director/keymap.ts ----
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = resolveKey(e, {
        phase: latest.current.phase,
        targetIsInput: isInputTarget(e.target),
        targetIsInteractive: isInteractiveTarget(e.target),
        overlayOpen: isDialogOpen(document),
      });
      if (!action) return;
      e.preventDefault();
      switch (action.type) {
        case "select-prev":
        case "select-next": {
          const step = action.type === "select-next" ? 1 : -1;
          setSelected((cur) => {
            const i = CHANNELS.findIndex((c) => c.id === cur);
            return CHANNELS[(i + step + CHANNELS.length) % CHANNELS.length]!.id;
          });
          return;
        }
        case "enter-selected":
          enterChannel(latest.current.selected);
          return;
        case "enter-index": {
          const ch = channelByIndex(action.index);
          if (ch) enterChannel(ch.id);
          return;
        }
        case "enter-new":
          enterChannel("CH-03");
          return;
        case "open-palette":
          setPaletteOpen(true);
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enterChannel]);

  // ---- Esc 離開工作站（§5.4、E6）：走 router 的 navigate，useBlocker 的確認照常 ----
  React.useEffect(
    () =>
      installEscapeRule(window, {
        getPhase: () => latest.current.phase,
        onLeave: () => void latest.current.navigate(HUB_PATH),
      }),
    [],
  );

  // ---- 焦點 ----
  // 控制室掛載（直接載入控制室、側欄進入、視窗放大後重新掛載）：焦點在選中的頻道按鈕
  React.useEffect(() => {
    if (state.kind === "HUB") hudRef.current?.focusSelected();
    // 只在掛載時
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 交接點：焦點移到目的地（工作站的主內容／控制室選中的頻道按鈕）。
  // 不是轉場的換頁（同一頻道內、例如 /records → /records/63/edit）：焦點移到 #main（第一次載入不搶焦點）。
  const prev = React.useRef({ state, pathname });
  React.useEffect(() => {
    const before = prev.current;
    prev.current = { state, pathname };
    const arrival = arrivalOf(before.state, state);
    if (arrival === "station") mainRef.current?.focus({ preventScroll: true });
    else if (arrival === "hub") hudRef.current?.focusSelected();
    else if (pathname !== before.pathname && state === before.state && state.kind === "STATION") mainRef.current?.focus({ preventScroll: true });
  }, [state, pathname]);

  // ---- 即時宣告：轉場開始＋完成（第一次掛載不宣告） ----
  const startText = startAnnouncement(state);
  const [doneText, setDoneText] = React.useState("");
  const prevForLive = React.useRef(state);
  React.useEffect(() => {
    const before = prevForLive.current;
    prevForLive.current = state;
    if (transitionKindOf(state)) setDoneText("");
    else if (transitionKindOf(before)) setDoneText(doneAnnouncement(before));
  }, [state]);
  const live = startText || doneText;

  // ---- 畫面 ----
  const channel = getChannel(selected);
  const showStation = state.kind === "STATION" || state.kind === "ENTERING" || state.kind === "SWITCHING";
  const stationHidden = (state.kind === "ENTERING" || state.kind === "SWITCHING") && !state.handoff;
  const hubVisible = state.kind === "HUB" || state.kind === "EXITING" || (state.kind === "ENTERING" && !state.handoff);
  const hudActive = state.kind === "HUB" || (state.kind === "EXITING" && state.handoff);
  const overlayKind = transitionKindOf(state);
  const cardCh = stationCh ? getChannel(stationCh) : channel;
  const stationInert = stationHidden ? { inert: "" } : undefined;

  return (
    <div className="os-root" data-os="root">
      <div className="os-hub" data-os="hub" data-visible={hubVisible ? "true" : "false"}>
        <HubCanvas running={hubVisible} mode={hubMode(state)} clock={clock} reduced={reduced} channel={channel} onFailure={onWebglFailure} />
      </div>
      <Hud ref={hudRef} selected={selected} active={hudActive} onEnter={enterChannel} onExit={onExitWeb} />
      {showStation ? (
        <div className="os-station" data-os="station" data-hidden={stationHidden ? "true" : "false"} {...(stationInert as object)}>
          <StationFrame tag={stationCh ?? ""} onBack={() => void navigate(HUB_PATH)} onSkipToMain={() => mainRef.current?.focus()}>
            <main
              id="main"
              ref={mainRef}
              tabIndex={-1}
              className="min-w-0 flex-1 px-4 pb-28 pt-5 focus:outline-none md:px-7 md:pb-16 md:pt-6 print:p-0"
            >
              <Outlet />
            </main>
          </StationFrame>
        </div>
      ) : null}
      <TransitionOverlay kind={overlayKind} clock={clock} cardText={`${cardCh.id} ${cardCh.code}`} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNavigate={(path) => void navigate(path)} onExit={onExitWeb} />
      <div className="sr-only" role="status" aria-live="polite" data-os="live">
        {live}
      </div>
    </div>
  );
}
