/*
 * OS 外殼（docs/os-mode-spec.md §3.1–3.4、§4.5–4.6、§7）：取代網頁模式的 AppShell，整個延遲載入（React.lazy，見 app/ModeShell.tsx）。
 * OsShell ＝ 裝置門檻（DeviceGate）＋ 舞台（OsStage）。由下到上：控制室 3D 層（A）→ 工作站（現有頁面＋CRT 外框）→ HUD → 轉場疊層（A）；
 * Radix 浮層（指令列、對話框、燈箱）與 toast 是 z-50 以上，蓋在所有 OS 圖層之上。
 */
import * as React from "react";
import { Outlet, useLocation, useMatches, useNavigate, useNavigationType } from "react-router-dom";
import type { OsNavState } from "@/app/osEntry";
import { consumeBoot } from "@/app/BootScreen";
import { useExportAction } from "@/app/useExportAction";
import type { RouteHandle } from "@/app/AppShell";
import { notify } from "@/lib/feedback";
import { setMode } from "@/lib/mode";
import { applyTheme, getAppliedTheme, getThemePreference, subscribeTheme } from "@/lib/theme";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { channelByIndex, channelForPath, CHANNELS, getChannel, HUB_PATH, isHubPath, type ChannelId } from "./channels";
import { useCrtLevel } from "./crt/settings";
import { useDevicePixelRatio } from "./crt/useDevicePixelRatio";
import { bZoneVars } from "./crt/zones";
import { getAudioEngine } from "./audio/engine";
import { toggleSound } from "./audio/settings";
import { useAudioEvents } from "./audio/useAudioEvents";
import { useAudioSession } from "./audio/useAudio";
import { DeviceGate } from "./DeviceGate";
import { installEscapeRule } from "./director/escapeRule";
import { arrivalOf } from "./director/focusRule";
import { isDialogOpen, isInputTarget, isInteractiveTarget, resolveKey } from "./director/keymap";
import { isTransition, phaseOf, placeOf, stationChOf, transitionKindOf, type DirectorState } from "./director/reducer";
import { useDirector } from "./director/useDirector";
import { useInputGate } from "./director/useInputGate";
import { usePatrol } from "./director/usePatrol";
import HubCanvas, { type HubMode } from "./hub/HubCanvas";
import { bootCounts } from "./hub/signals";
import { acknowledgeForChannel, acknowledgeRecord, recIdFromPath } from "./hub/alerts";
import { useHubAnomalies } from "./hub/useHubAnomalies";
import { useHubData } from "./hub/useHubSignals";
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

/**
 * 減少動態效果的直接切換（沒有轉場狀態）：HUB／STATION 之間、或 STATION 換頻道。回傳開始與完成兩段宣告（與有轉場時同樣的字串），
 * 其他情況（含開機結束、沒有變化）回傳 null。
 */
export function cutAnnouncement(before: DirectorState, after: DirectorState): { start: string; done: string } | null {
  if (before === after) return null;
  if (before.kind === "HUB" && after.kind === "STATION") return { start: `進入${nameOf(after.ch)}`, done: `已進入${nameOf(after.ch)}` };
  if (before.kind === "STATION" && after.kind === "HUB") return { start: "回到控制室", done: "已回到控制室" };
  if (before.kind === "STATION" && after.kind === "STATION" && before.ch !== after.ch) return { start: `切換到${nameOf(after.ch)}`, done: `已切換到${nameOf(after.ch)}` };
  return null;
}

/** 直接切換時，開始宣告與完成宣告之間隔多久（毫秒）：讓讀屏分成兩句唸，不會被合併。 */
export const CUT_DONE_DELAY_MS = 150;
/** 進入轉場開始後多久，把（仍隱藏的）工作站預先「畫好」（visibility 改回 visible、opacity 維持 0）：交接點那一幀只剩 opacity 與 inert。 */
export const STATION_PREP_MS = 60;
/** 抵達後焦點重試的幀數上限（約 500ms） */
export const FOCUS_RETRY_FRAMES = 30;

export default function OsShell() {
  const title = useRouteTitle();
  const navigate = useNavigate();
  const { pathname, search, state: locState } = useLocation();
  const navType = useNavigationType();
  const pathRef = React.useRef(pathname + search);
  pathRef.current = pathname + search;
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
    const here = pathRef.current;
    if (isHubPath(here.split("?")[0]!)) {
      void navRef.current("/dashboard", { replace: true });
      setMode("web");
      return;
    }
    // 在工作站：先「導覽」到 /os（帶 exitToWeb），頁面的 useBlocker 可以攔下（取消＝什麼都不發生）；
    // 抵達後由下面的 layout effect 切換模式並 replace 回原路徑。
    const state: OsNavState = { exitToWeb: { to: here } };
    // replace：導覽成功後再 replace 回原路徑，歷史紀錄淨結果不變（上一頁回到進入這頁之前的頁面）；useBlocker 對 replace 同樣會攔
    void navRef.current(HUB_PATH, { state, replace: true });
  }, []);

  // 抵達 /os 且帶 exitToWeb（PUSH／REPLACE，不含上一頁）：先 replace 回原路徑，再切換成網頁模式。這段期間不渲染舞台（不閃控制室、不建 WebGL）。
  const exitTo = (locState as OsNavState | null)?.exitToWeb?.to;
  const leaving = !!exitTo && navType !== "POP" && isHubPath(pathname);
  // 用 passive effect：剛離開的頁面的 useBlocker 要先解除註冊（卸載的清理先於這裡），否則回原路徑的導覽會被同一個頁面再攔一次
  React.useEffect(() => {
    if (!leaving || !exitTo) return;
    void navRef.current(exitTo, { replace: true });
    setMode("web");
  }, [leaving, exitTo]);

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

  if (leaving) return null;
  return (
    <DeviceGate onUseWeb={exitToWeb}>
      {(active) => <OsStage suspended={!active} onExitWeb={exitToWeb} onWebglFailure={onWebglFailure} />}
    </DeviceGate>
  );
}

interface OsStageProps {
  /** 視窗小於門檻：舞台保留（表單不丟）但暫停——不繪製、不收快速鍵、不跑時鐘 */
  suspended: boolean;
  onExitWeb: () => void;
  onWebglFailure: () => void;
}

function OsStage({ suspended, onExitWeb, onWebglFailure }: OsStageProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const place = React.useMemo(() => placeOf(pathname), [pathname]);

  const { state, skip, clock, gateActive, waiting } = useDirector(place, reduced);
  // 音效（X4）：第一次手勢啟用的監聽器必須早於輸入閘裝上（同一個 window 捕獲階段按註冊順序執行：輸入閘吃掉的那一次手勢，音效也要先拿到）
  useAudioSession({ waiting, busy: isTransition(state) || (state.kind === "BOOT" && !waiting) });
  // B1 與 B2 跳過是兩道連續的閘：waiting 變了就重新武裝（那一次手勢仍由舊的閘攔到結束）
  useInputGate(
    gateActive && !suspended,
    React.useCallback(() => {
      getAudioEngine().activate(); // 手勢處理函式裡：保險（監聽器已經啟用過；activate 可重複呼叫）
      skip();
    }, [skip]),
    waiting,
  );
  useAudioEvents(state, clock, suspended);

  const phase = phaseOf(state);
  const inHub = state.kind === "HUB";

  // ---- 控制室資料（X2）：沿用現有的紀錄查詢快取；只在 HUB 且分頁可見時每 30 秒重抓 ----
  const hubData = useHubData(inHub);
  const anomalies = useHubAnomalies(inHub, hubData.records, hubData.settled, hubData.dataUpdatedAt);
  const counts = React.useMemo(() => bootCounts(hubData.records), [hubData.records]);
  // 待機巡視：只在 HUB（沒暫停、沒有減少動態效果）；任何輸入立刻結束，而且輸入不被吞掉（patrol.ts 只觀察）
  const patrolling = usePatrol(inHub && !suspended && !reduced);
  // CRT 強度（A 區著色器參數；B 區 CSS 疊層的變數）
  const crtLevel = useCrtLevel();
  const dpr = useDevicePixelRatio();
  const bVars = React.useMemo(() => bZoneVars(crtLevel, dpr), [crtLevel, dpr]);
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

  // 確認未確認的新異常警示：進入 CH-01／CH-02（其他頻道不算）；`rec <id>` 在下面的指令列處理
  React.useEffect(() => {
    acknowledgeForChannel(stationCh);
  }, [stationCh]);

  // 事件處理用的最新值（監聽器只裝一次）
  const latest = React.useRef({ phase, selected, navigate, suspended });
  latest.current = { phase, selected, navigate, suspended };
  // 即時的選取（連按方向鍵時，state 還沒重繪也要算對）；音效：換選取才響一聲繼電器
  const selectedLive = React.useRef(selected);
  selectedLive.current = selected;
  const changeSelection = React.useCallback((id: ChannelId) => {
    if (id === selectedLive.current) return;
    selectedLive.current = id;
    setSelected(id);
    getAudioEngine().play("relay");
  }, []);

  /** HUD 按鈕、快速鍵與 3D 螢幕點選共用的路徑：選取＋進入（選取的頻道和目前不同才響繼電器） */
  const enterChannel = React.useCallback(
    (id: ChannelId) => {
      changeSelection(id);
      void latest.current.navigate(getChannel(id).path);
    },
    [changeSelection],
  );

  // ---- 指令列 ----
  const exporter = useExportAction();
  const runExport = exporter.run;
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // 「/」（index 路由）在控制室不會渲染 Outlet，IndexRedirect 不會跑：這裡把網址整理成 /os（同為控制室，不影響導演狀態）
  React.useEffect(() => {
    if (pathname === "/") void navigate(HUB_PATH, { replace: true });
  }, [pathname, navigate]);

  // 視窗縮小時關掉指令列（它掛在 body，不在被隱藏的子樹裡）
  React.useEffect(() => {
    if (suspended) setPaletteOpen(false);
  }, [suspended]);

  // 一掛載（開機的 B2 期間主執行緒最閒）就先載入工作站會用到的中文字型子集：
  // 進入時第一次排版不必等字型，也不會在開機結束、控制室現身那一刻才處理字型（那一刻曾多出一個 ~80ms 的長工作）
  React.useEffect(() => {
    if (suspended || !document.fonts?.load) return;
    const sample = CHANNELS.map((c) => c.name).join("") + "待處理今日本月機台設備異常嚴重狀態日期時間篩選匯出儲存取消確認刪除還原";
    const t = window.setTimeout(() => {
      for (const weight of [400, 500, 700]) void document.fonts.load(`${weight} 14px "Noto Sans TC"`, sample).catch(() => {});
    }, 100);
    return () => window.clearTimeout(t);
  }, [suspended]);

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
      if (e.defaultPrevented || latest.current.suspended) return;
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
          const i = CHANNELS.findIndex((c) => c.id === selectedLive.current);
          changeSelection(CHANNELS[(i + step + CHANNELS.length) % CHANNELS.length]!.id);
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
        case "toggle-sound":
          toggleSound();
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enterChannel, changeSelection]);

  // ---- Esc 離開工作站（§5.4、E6）：走 router 的 navigate，useBlocker 的確認照常 ----
  React.useEffect(
    () =>
      installEscapeRule(window, {
        getPhase: () => latest.current.phase,
        onLeave: () => {
          if (!latest.current.suspended) void latest.current.navigate(HUB_PATH);
        },
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
  const focusRetry = React.useRef<{ raf: number; arrival: "station" | "hub" } | null>(null);
  React.useEffect(
    () => () => {
      if (focusRetry.current) window.cancelAnimationFrame(focusRetry.current.raf);
    },
    [],
  );
  React.useEffect(() => {
    const before = prev.current;
    prev.current = { state, pathname };
    const arrival = arrivalOf(before.state, state);
    const focusMain = () => mainRef.current?.focus({ preventScroll: true });
    if (arrival === "station") focusMain();
    else if (arrival === "hub") hudRef.current?.focusSelected();
    else if (pathname !== before.pathname && state === before.state && state.kind === "STATION") focusMain();
    // 轉場進行中切換減少動態效果：同一個 commit 同時改了工作站的隱藏／inert 與 HUD 的 inert，瀏覽器可能還沒讓目的地可以聚焦，
    // 焦點會掉到 <body>。目的地可能還要幾十到幾百毫秒才可聚焦（驗證 r2：工作站在轉場中途仍是 visibility:hidden），所以有上限地逐幀重試：
    // 焦點到了目標就停；焦點被移到別的真實元素（使用者自己移的）就停；最多 FOCUS_RETRY_FRAMES 幀。
    // 重試迴圈不綁在這個 effect 的 cleanup 上（驗證 r4：交接點後約 6ms 狀態又變成 STATION，那一次沒有抵達事件，cleanup 會把剛排好的重試取消，
    // 焦點就永遠留在 body）。只有「新的抵達」「去了和重試目的地無關的狀態」「卸載」才取消。
    const pending = focusRetry.current;
    if (arrival) {
      if (pending) window.cancelAnimationFrame(pending.raf);
      const job = { raf: 0, arrival };
      focusRetry.current = job;
      let n = 0;
      const done = () => {
        if (focusRetry.current === job) focusRetry.current = null;
      };
      const retry = () => {
        const a = document.activeElement;
        const target = arrival === "station" ? mainRef.current : null;
        if (arrival === "station" && a === target) return done();
        if (a && a !== document.body && a !== document.documentElement && (arrival === "station" || !a.matches?.('[data-os="hud-ch"]'))) return done();
        if (arrival === "hub" && a && a.matches?.('[data-os="hud-ch"][aria-current="true"]')) return done();
        if (arrival === "station") focusMain();
        else hudRef.current?.focusSelected();
        if (++n < FOCUS_RETRY_FRAMES) job.raf = window.requestAnimationFrame(retry);
        else done();
      };
      job.raf = window.requestAnimationFrame(retry);
    } else if (pending) {
      const toward = pending.arrival === "station" ? state.kind === "STATION" || state.kind === "ENTERING" || state.kind === "SWITCHING" : state.kind === "HUB" || state.kind === "EXITING";
      if (!toward) {
        window.cancelAnimationFrame(pending.raf);
        focusRetry.current = null;
      }
    }
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
    else {
      // 減少動態效果的直接切換：沒有轉場狀態，仍要宣告開始與完成（§6.5）
      const cut = cutAnnouncement(before, state);
      if (!cut) return;
      setDoneText(cut.start);
      const t = window.setTimeout(() => setDoneText(cut.done), CUT_DONE_DELAY_MS);
      return () => window.clearTimeout(t);
    }
  }, [state]);
  const live = startText || doneText;

  // ---- 畫面 ----
  const channel = getChannel(selected);
  const showStationNow = state.kind === "STATION" || state.kind === "ENTERING" || state.kind === "SWITCHING";
  const stationHidden = (state.kind === "ENTERING" || state.kind === "SWITCHING") && !state.handoff;
  // 進入轉場開始時工作站是「隱藏地先掛上」（頁面一開始載入）：第一次掛整頁（冷的 JS、整棵樹的 render）若和點擊同一幀做完，
  // 會讓那一幀 > 60ms。用 useDeferredValue 把這次掛載交給 React 的時間切片（每 5ms 讓出給瀏覽器），點擊那一幀只做控制室與疊層的事。
  // 一旦不再隱藏（交接點、被跳到終點、STATION）一律立刻掛上，不等延後的那次 render。
  const deferredShow = React.useDeferredValue(showStationNow);
  const showStation = showStationNow && (deferredShow || !stationHidden);
  // 進入轉場進行到一半時，把隱藏的工作站「預先畫好」：visibility 改 visible（opacity 仍是 0、inert 仍在），
  // 整棵子樹的樣式重算與繪製記錄在 E1 中段完成，交接點那一幀只剩 opacity 與 inert 的改變。
  // 預先畫好從進入轉場開始後 STATION_PREP_MS 起，一直維持到進入轉場結束（交接點之後 data-prep 仍在：工作站維持自己的合成層，
  // 交接點只剩 opacity／inert；rule 的 visibility 只在 hidden 時才生效）。
  const enterPre = state.kind === "ENTERING";
  const enterGen = state.gen;
  const stationRef = React.useRef<HTMLDivElement>(null);
  const [prep, setPrep] = React.useState(false);
  React.useEffect(() => {
    if (!prep) return;
    // 在隱藏狀態下於 E1 就讓第一次排版完成（單純讀一次高度，放在 rAF，避免和 commit 同一個工作）
    const raf = window.requestAnimationFrame(() => void stationRef.current?.offsetHeight);
    return () => window.cancelAnimationFrame(raf);
  }, [prep]);
  React.useEffect(() => {
    if (!enterPre) {
      setPrep(false);
      return;
    }
    const t = window.setTimeout(() => setPrep(true), STATION_PREP_MS);
    return () => window.clearTimeout(t);
  }, [enterPre, enterGen]);
  const hubVisible = state.kind === "HUB" || state.kind === "BOOT" || state.kind === "EXITING" || (state.kind === "ENTERING" && !state.handoff);
  const hudActive = state.kind === "HUB" || (state.kind === "EXITING" && state.handoff);
  const overlayKind = transitionKindOf(state);
  const cardCh = stationCh ? getChannel(stationCh) : channel;
  const stationInert = stationHidden ? { inert: "" } : undefined;
  // 指令列（Radix Dialog，掛在 body）開啟時：控制室整棵（HUD、3D 螢幕、工作站）inert，背景不可聚焦也不可點；關閉即還原，焦點由指令列還給原來的元素
  const rootInert = paletteOpen ? { inert: "" } : undefined;

  return (
    <div className="os-root" data-os="root" data-crt={crtLevel} style={(bVars ?? undefined) as React.CSSProperties | undefined} {...(rootInert as object)}>
      <div className="os-hub" data-os="hub" data-visible={hubVisible ? "true" : "false"}>
        <HubCanvas
          running={hubVisible && !suspended}
          mode={hubMode(state)}
          clock={clock}
          reduced={reduced}
          channel={channel}
          signals={hubData.signals}
          blips={anomalies.blips}
          alerts={anomalies.alerts}
          patrolling={patrolling}
          boot={state.kind === "BOOT" ? (state.short ? "short" : "full") : null}
          bootCounts={counts}
          level={crtLevel}
          pickable={hudActive && !suspended}
          onPick={enterChannel}
          onFailure={onWebglFailure}
        />
      </div>
      <Hud ref={hudRef} selected={selected} signals={hubData.signals} active={hudActive && !suspended} onEnter={enterChannel} onExit={onExitWeb} />
      {showStation ? (
        <div ref={stationRef} className="os-station" data-os="station" data-hidden={stationHidden ? "true" : "false"} data-prep={enterPre && prep ? "true" : "false"} {...(stationInert as object)}>
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
      <TransitionOverlay
        kind={overlayKind}
        gen={isTransition(state) ? state.gen : -1}
        clock={clock}
        cardText={`${cardCh.id} ${cardCh.code}`}
        channel={channel.id}
        level={crtLevel}
        reduced={reduced}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNavigate={(path) => {
          const recId = recIdFromPath(path);
          if (recId !== null) acknowledgeRecord(recId);
          void navigate(path);
        }} onExit={onExitWeb} onExport={() => void runExport()} onError={() => void getAudioEngine().play("error")} />
      {/* B1（X4）：開機前等第一次按鍵或點擊；那一次輸入由輸入閘吃掉。游標只是裝飾，另有一句給螢幕閱讀器的話 */}
      {waiting ? (
        <div className="os-b1" data-os="b1">
          <span className="sr-only" role="status">
            PLD/OS 1995，按任意鍵開始
          </span>
          <p aria-hidden="true">
            PRESS ANY KEY<span className="os-b1-cursor">▮</span>
          </p>
        </div>
      ) : null}
      <div className="sr-only" role="status" aria-live="polite" data-os="live">
        {live}
      </div>
      {/* 新異常公告（雷達光點脈衝時）：專用的 polite 區域；不發聲。週期性的數字更新不會出現在任何 aria-live */}
      <div className="sr-only" role="status" aria-live="polite" data-os="anomaly-live">
        {anomalies.announcement}
      </div>
    </div>
  );
}
