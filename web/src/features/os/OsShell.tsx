/*
 * OS 外殼（docs/os-mode-spec.md §3.1–3.4、§4.6）：取代網頁模式的 AppShell，整個延遲載入（React.lazy，見 app/ModeShell.tsx）。
 * 由下到上：控制室 3D 層（A）→ HUD → 工作站（現有頁面＋CRT 外框）→ 轉場疊層（A）；Radix 浮層與 toast 是 z-50 以上，蓋在所有 OS 圖層之上。
 */
import * as React from "react";
import { Outlet, useLocation, useMatches, useNavigate } from "react-router-dom";
import { consumeBoot } from "@/app/BootScreen";
import type { RouteHandle } from "@/app/AppShell";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { applyTheme, getAppliedTheme, getThemePreference, subscribeTheme } from "@/lib/theme";
import { getChannel, HUB_PATH, type ChannelId } from "./channels";
import { placeOf, phaseOf, type DirectorState } from "./director/reducer";
import { useDirector } from "./director/useDirector";
import { useInputGate } from "./director/useInputGate";
import HubCanvas, { type HubMode } from "./hub/HubCanvas";
import { Hud } from "./hud/Hud";
import "./os.css";
import { StationFrame } from "./station/StationFrame";
import { TransitionOverlay } from "./transition/TransitionOverlay";

function useRouteTitle(): string {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]?.handle as RouteHandle | undefined;
    if (handle?.title) return handle.title;
  }
  return "產線日誌";
}

const HUB_CHANNEL: ChannelId = "CH-02";

function hubMode(s: DirectorState): HubMode {
  switch (s.kind) {
    case "HUB":
      return "hub";
    case "ENTERING":
      return "entering";
    case "EXITING":
      return "exiting";
    case "STATION":
      return "station";
  }
}

export default function OsShell() {
  const title = useRouteTitle();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const place = React.useMemo(() => placeOf(pathname), [pathname]);

  // FX-01 開機畫面在 OS 模式不播放：要在子元件（儀表板的 BootLoading）第一次 render 之前用掉
  React.useState(() => consumeBoot());

  const { state, skip, clock, gateActive } = useDirector(place, reduced);
  useInputGate(gateActive, skip);

  const phase = phaseOf(state);
  const mainRef = React.useRef<HTMLElement>(null);
  const hudButtonRef = React.useRef<HTMLButtonElement>(null);

  // <html data-mode="os">、Cyber 主題（只套用、不寫入：不呼叫 switchTheme）、開機畫面
  React.useLayoutEffect(() => {
    const root = document.documentElement;
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
      applyTheme(getThemePreference());
    };
  }, []);

  // 驗證用：目前階段
  React.useLayoutEffect(() => {
    document.documentElement.dataset.osPhase = phase;
  }, [phase]);

  React.useEffect(() => {
    document.title = title === "產線日誌" ? title : `${title}｜產線日誌`;
  }, [title]);

  // 交接點：焦點移到目的地（工作站的主內容／控制室的頻道按鈕）。直接載入、一般換頁不搶焦點。
  const prev = React.useRef(state);
  React.useEffect(() => {
    const before = prev.current;
    prev.current = state;
    const enteredNow =
      (state.kind === "ENTERING" && state.handoff && !(before.kind === "ENTERING" && before.handoff)) ||
      (state.kind === "STATION" && before.kind === "ENTERING" && !before.handoff);
    const exitedNow =
      (state.kind === "EXITING" && state.handoff && !(before.kind === "EXITING" && before.handoff)) ||
      (state.kind === "HUB" && before.kind === "EXITING" && !before.handoff);
    if (enteredNow) mainRef.current?.focus({ preventScroll: true });
    else if (exitedNow) hudButtonRef.current?.focus({ preventScroll: true });
  }, [state]);

  const channel = getChannel(HUB_CHANNEL);
  const stationCh = state.kind === "STATION" || state.kind === "ENTERING" || state.kind === "EXITING" ? state.ch : null;
  const stationChannel = stationCh ? getChannel(stationCh) : null;

  const showStation = state.kind === "STATION" || state.kind === "ENTERING";
  const stationHidden = state.kind === "ENTERING" && !state.handoff;
  const hubVisible = state.kind === "HUB" || state.kind === "EXITING" || (state.kind === "ENTERING" && !state.handoff);
  const hudActive = state.kind === "HUB" || (state.kind === "EXITING" && state.handoff);
  const overlayKind = state.kind === "ENTERING" ? "enter" : state.kind === "EXITING" ? "exit" : null;
  const cardCh = stationChannel ?? channel;
  const live = state.kind === "ENTERING" ? `進入${cardCh.name}` : state.kind === "EXITING" ? "回到控制室" : "";

  const stationInert = stationHidden ? { inert: "" } : undefined;

  return (
    <div className="os-root" data-os="root">
      <div className="os-hub" data-os="hub" data-visible={hubVisible ? "true" : "false"}>
        <HubCanvas running={hubVisible} mode={hubMode(state)} clock={clock} reduced={reduced} />
      </div>
      <Hud channel={channel} active={hudActive} buttonRef={hudButtonRef} onEnter={() => void navigate(channel.path, { flushSync: true })} />
      {showStation ? (
        <div
          className="os-station"
          data-os="station"
          data-hidden={stationHidden ? "true" : "false"}
          {...(stationInert as object)}
        >
          <StationFrame
            tag={stationChannel?.id ?? ""}
            onBack={() => void navigate(HUB_PATH, { flushSync: true })}
            onSkipToMain={() => mainRef.current?.focus()}
          >
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
      <div className="sr-only" role="status" aria-live="polite" data-os="live">
        {live}
      </div>
    </div>
  );
}
