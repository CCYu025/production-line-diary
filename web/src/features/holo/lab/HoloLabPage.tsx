/*
 * 全像實驗室 `#/_holo`（H1 技術驗證；用完即丟的外殼）。
 * 只有 DEV 或 VITE_HOLO_LAB=1 建置才存在（app/routes.tsx）；預設建置不含任何 features/holo 程式。
 * 全螢幕（fixed inset-0），不改 AppShell；掛載時設 data-mode="holo" 並 applyTheme("cyber")（只套用、不寫入偏好），卸載時還原。
 * 網址參數：
 *   scene=machine｜spiral   展示物件（預設機台）
 *   slate=proj｜css3d｜off  終端板定位方法（只在機台場景）；bb=1 讓 css3d 面向鏡頭
 *   n=5000                 只是標示目前量的資料規模（資料來自 useRecords()）
 *   rot=0                  關閉機台自動緩轉；crt=off｜std｜max 只在這次載入覆寫強度（不寫入偏好）
 *   freeze=0               關閉「選字期間凍結終端板位置」；snap=0 關閉方法 P 的裝置像素對齊
 *   holodebug=1            掛上 window.__holoLab()
 */
import * as React from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { Link, useSearchParams } from "react-router-dom";
import { applyTheme, getAppliedTheme, getThemePreference, subscribeTheme } from "@/lib/theme";
import { useRecords } from "@/lib/queries";
import { webglAvailable } from "@/features/os/webgl";
import type { CrtLevel } from "@/features/os/crt/settings";
import { HoloEngine } from "../engine/engine";
import { buildSpiral, keyToDays, wheelToDays } from "../engine/spiral";
import { thumbKey } from "../engine/thumbLoader";
import { createMachineWorld, type MachineWorld } from "../scenes/machineScene";
import { createSpiralWorld, type SpiralWorld } from "../scenes/spiralScene";
import { attachCss3dSlate, attachProjectionSlate, type SlateHandle } from "../slate/attach";
import { slateProbe } from "../slate/probe";
import { Slate } from "../slate/Slate";
import "../holo.css";

type SceneName = "machine" | "spiral";
type SlateMethod = "proj" | "css3d" | "off";

declare global {
  interface Window {
    __holoLab?: (() => Record<string, unknown>) & Record<string, unknown>;
  }
}

export default function HoloLabPage() {
  const [params] = useSearchParams();
  const scene: SceneName = params.get("scene") === "spiral" ? "spiral" : "machine";
  const slate: SlateMethod = params.get("slate") === "css3d" ? "css3d" : params.get("slate") === "off" ? "off" : "proj";
  // 換場景或定位方法就整個重建（乾淨地釋放前一個）
  const key = `${scene}|${slate}|${params.get("bb") ?? ""}|${params.get("crt") ?? ""}`;
  return <LabInner key={key} scene={scene} slate={slate} params={params} />;
}

function readCrt(v: string | null): CrtLevel | null {
  return v === "off" || v === "std" || v === "max" ? v : null;
}

function LabInner({ scene, slate, params }: { scene: SceneName; slate: SlateMethod; params: URLSearchParams }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const hudRef = React.useRef<HTMLDivElement>(null);
  const fpsRef = React.useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = React.useState(() => !webglAvailable());
  const [engine, setEngine] = React.useState<HoloEngine | null>(null);
  const frozenRef = React.useRef(false);
  const enteredAt = React.useRef(performance.now());
  const records = useRecords();
  // HP5 的分段時間（都是 performance.now() 時間軸）：資料可用、場景建好（含建立耗時）、世界第一幀
  const timing = React.useRef<{
    dataAt: number | null;
    engineStartAt: number | null;
    engineReadyAt: number | null;
    modelMs: number | null;
    modelBuiltAt: number | null;
    buildStartAt: number | null;
    sceneBuiltAt: number | null;
    firstWorldFrameAt: number | null;
  }>({ dataAt: null, engineStartAt: null, engineReadyAt: null, modelMs: null, modelBuiltAt: null, buildStartAt: null, sceneBuiltAt: null, firstWorldFrameAt: null });
  if (records.data && timing.current.dataAt === null) timing.current.dataAt = performance.now();
  // 除錯讀數用 ref：紀錄載入完成不該讓機台場景重建（世界的 effect 不依賴紀錄筆數）
  const recordsCount = React.useRef<number | null>(null);
  recordsCount.current = records.data?.length ?? null;
  const debug = params.get("holodebug") === "1";
  const slateHost = React.useMemo(() => {
    const d = document.createElement("div");
    d.className = "holo-slate-host";
    return d;
  }, []);

  // <html data-mode="holo">、Cyber 主題（只套用、不寫入：不呼叫 switchTheme）
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.mode = "holo";
    applyTheme("cyber");
    const unsubscribe = subscribeTheme(() => {
      if (getAppliedTheme() !== "cyber") applyTheme("cyber");
    });
    document.title = "全像實驗室｜產線日誌";
    return () => {
      unsubscribe();
      delete root.dataset.mode;
      applyTheme(getThemePreference());
    };
  }, []);

  // 引擎
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || failed) return;
    let eng: HoloEngine;
    timing.current.engineStartAt = performance.now();
    try {
      eng = new HoloEngine({ host, levelOverride: readCrt(params.get("crt")), onContextLost: () => setFailed(true) });
    } catch {
      setFailed(true);
      return;
    }
    setEngine(eng);
    eng.start();
    timing.current.engineReadyAt = performance.now();
    // fps 讀數（直接改 DOM 文字，不經過 React）
    let lastFrames = 0;
    let lastT = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const fps = ((eng.stats.frames - lastFrames) * 1000) / Math.max(1, now - lastT);
      lastFrames = eng.stats.frames;
      lastT = now;
      if (fpsRef.current) fpsRef.current.textContent = `${fps.toFixed(0)} fps`;
    }, 500);
    return () => {
      window.clearInterval(timer);
      setEngine(null);
      eng.dispose();
    };
  }, [failed, params]);

  // 世界（機台或螢幕牆螺旋）＋終端板
  const spiralModel = React.useMemo(() => {
    if (scene !== "spiral" || !records.data) return null;
    const t0 = performance.now();
    const m = buildSpiral(records.data);
    timing.current.modelBuiltAt = performance.now();
    timing.current.modelMs = timing.current.modelBuiltAt - t0;
    return m;
  }, [scene, records.data]);
  React.useEffect(() => {
    if (!engine) return;
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) return;
    slateProbe.enabled = debug;
    slateProbe.reset();
    let api: Record<string, unknown> = {};
    const slateRef: { handle: SlateHandle | null } = { handle: null };
    let machine: MachineWorld | null = null;
    let spiral: SpiralWorld | null = null;
    let readyAt: number | null = null;
    timing.current.buildStartAt = performance.now();
    timing.current.sceneBuiltAt = null;
    timing.current.firstWorldFrameAt = null;

    if (scene === "machine") {
      machine = createMachineWorld(engine);
      engine.setWorld(machine);
      let autoRotate = params.get("rot") !== "0";
      const applyRot = () => {
        engine.rig.autoRotate = autoRotate ? 0.18 : 0;
      };
      applyRot();
      engine.configureRig(
        { limits: { minDist: 12, maxDist: 75, minPitch: 0.02, maxPitch: 1.3 }, home: { yaw: 0.45, pitch: 0.3, dist: 27 }, homeTarget: new THREE.Vector3(1, 4, 0), wheelMode: "zoom" },
        {
          onClick: (x, y) => machine?.pick(x, y),
          onKey: (e) => {
            if (e.key === "a" || e.key === "A") {
              autoRotate = !autoRotate;
              applyRot();
            }
          },
        },
      );
      applyRot();
      if (slate !== "off") {
        if (!slateHost.isConnected && slate === "proj") root.appendChild(slateHost);
        const common = { isFrozen: () => frozenRef.current, snap: params.get("snap") !== "0", billboard: params.get("bb") === "1", countMutations: debug };
        slateRef.handle = slate === "proj" ? attachProjectionSlate(engine, slateHost, machine.anchor, common) : attachCss3dSlate(engine, host, slateHost, machine.anchor, common);
      }
      api = {
        setView: (yaw: number, pitch: number, dist: number) => {
          engine.rig.state = { yaw, pitch, dist };
        },
        autoRotate: (v: boolean) => {
          autoRotate = v;
          applyRot();
        },
        anchorScreen: () => engine.project(machine!.anchor),
        selected: () => machine!.selected(),
        segments: machine.segments,
      };
      readyAt = performance.now();
    } else if (spiralModel) {
      spiral = createSpiralWorld(engine, spiralModel);
      engine.setWorld(spiral);
      engine.rig.autoRotate = 0;
      engine.configureRig(
        { limits: { minDist: 4, maxDist: 40, minPitch: -0.4, maxPitch: 1.2 }, home: { yaw: 0, pitch: 0.12, dist: 14 }, homeTarget: engine.rig.target.clone(), wheelMode: "cursor" },
        {
          onWheel: (e) => spiral?.moveCursor(wheelToDays(e.deltaY, e.shiftKey)),
          onKey: (e) => {
            const d = keyToDays(e.key, e.shiftKey);
            if (d) {
              e.preventDefault();
              spiral?.moveCursor(d);
            }
          },
        },
      );
      engine.rig.lockPanZ = true;
      engine.rig.goal.set(0, 0, engine.rig.target.z);
      api = {
        setView: (yaw: number, pitch: number, dist: number) => {
          engine.rig.state = { yaw, pitch, dist };
        },
        moveCursor: (d: number) => spiral!.moveCursor(d),
        setCursor: (d: number) => spiral!.setCursor(d),
        cursor: () => spiral!.cursor(),
        maxDay: spiralModel.maxDay,
        minDay: spiralModel.minDay,
        total: spiralModel.items.length,
        /** 有照片的卡片（key 與縮圖快取一致），給驗證腳本挑「沒有槽位壓力」的時間窗用 */
        photoCards: spiralModel.items.filter((it) => it.firstPhoto).map((it) => ({ day: it.day, key: thumbKey(it.date, it.firstPhoto!) })),
      };
      readyAt = performance.now();
    }

    timing.current.sceneBuiltAt = readyAt;
    const offFrame = readyAt === null ? () => {} : engine.onFrame(() => {
      if (timing.current.firstWorldFrameAt === null) timing.current.firstWorldFrameAt = performance.now();
    });
    if (debug) {
      const fn = (() => ({
        scene,
        slateMethod: slate,
        level: engine.currentLevel,
        reducedMotion: engine.reducedMotion,
        size: engine.size,
        frames: engine.stats.frames,
        firstFrameAt: engine.stats.firstFrameAt,
        /** 世界可以操作的總毫秒數：進入實驗室（頁面元件掛載）→ 資料可用 → 場景建好 → 世界第一幀都包含在內 */
        readyMs: timing.current.firstWorldFrameAt === null ? null : timing.current.firstWorldFrameAt - enteredAt.current,
        /**
         * 分段（毫秒）。readyMs = 掛載 → 世界第一幀。分段加總 + otherMs = readyMs（引擎初始化與資料載入同時進行時，只有排在後面的那段算在關鍵路徑上，所以 engineCriticalMs 才是計入加總的那一項）：
         *   dataLoadMs      掛載到紀錄可用（機台沒有資料載入：null）
         *   engineCriticalMs 引擎初始化超出「資料可用」之後的部分（螺旋通常是 0，因為引擎比資料早好；機台＝掛載到引擎好）
         *   modelBuildMs    buildSpiral（螺旋）
         *   sceneBuildMs    建立世界（幾何、著色器、緩衝）
         *   firstWorldFrameMs 場景建好到世界第一幀
         *   otherMs         其餘（React 提交與重繪、effect 之間的等待）= readyMs − 以上加總
         *   engineInitMs    引擎初始化本身的耗時（參考，與上面可能重疊）
         */
        timing: (() => {
          const T = timing.current;
          const ready = T.firstWorldFrameAt === null ? null : T.firstWorldFrameAt - enteredAt.current;
          const dataLoadMs = T.dataAt === null || scene !== "spiral" ? null : T.dataAt - enteredAt.current;
          const base = scene === "spiral" && T.dataAt !== null ? T.dataAt : enteredAt.current;
          const engineCriticalMs = T.engineReadyAt === null ? null : Math.max(0, T.engineReadyAt - base);
          const modelBuildMs = scene === "spiral" ? T.modelMs : null;
          const sceneBuildMs = T.buildStartAt === null || T.sceneBuiltAt === null ? null : T.sceneBuiltAt - T.buildStartAt;
          const firstWorldFrameMs = T.firstWorldFrameAt === null || T.sceneBuiltAt === null ? null : T.firstWorldFrameAt - T.sceneBuiltAt;
          const sum = (dataLoadMs ?? 0) + (engineCriticalMs ?? 0) + (modelBuildMs ?? 0) + (sceneBuildMs ?? 0) + (firstWorldFrameMs ?? 0);
          return {
            readyMs: ready,
            dataLoadMs,
            engineCriticalMs,
            modelBuildMs,
            sceneBuildMs,
            firstWorldFrameMs,
            otherMs: ready === null ? null : ready - sum,
            engineInitMs: T.engineStartAt === null || T.engineReadyAt === null ? null : T.engineReadyAt - T.engineStartAt,
            enginePageFirstFrameMs: engine.stats.firstFrameAt === null ? null : engine.stats.firstFrameAt - enteredAt.current,
          };
        })(),
        nowMs: performance.now(),
        renderer: { memory: { ...engine.renderer.info.memory }, render: { ...engine.renderer.info.render }, programs: engine.renderer.info.programs?.length ?? 0 },
        camera: { ...engine.rig.state, target: engine.rig.target.toArray(), autoRotate: engine.rig.autoRotate, dragging: engine.rig.dragging, endCounts: { ...engine.rig.endCounts } },
        spiral: spiral ? { ...spiral.counts(), thumbs: spiral.thumbs(), total: spiralModel?.items.length ?? 0 } : null,
        machine: machine ? { selected: machine.selected(), segments: machine.segments } : null,
        slate: slateRef.handle
          ? {
              stats: { ...slateRef.handle.stats },
              rect: slateHost.getBoundingClientRect().toJSON(),
              frozen: frozenRef.current,
              probe: { submits: slateProbe.submits, composing: slateProbe.composing, compositions: slateProbe.compositions, events: slateProbe.events.slice(-120) },
            }
          : null,
        records: recordsCount.current,
      })) as unknown as NonNullable<Window["__holoLab"]>;
      Object.assign(fn, api, { resetProbe: () => slateProbe.reset(), isFrozen: () => frozenRef.current });
      window.__holoLab = fn;
    }

    return () => {
      offFrame();
      slateRef.handle?.dispose();
      slateRef.handle = null;
      if (slateHost.isConnected) slateHost.remove();
      engine.rig.lockPanZ = false;
      engine.setWorld(null);
      if (window.__holoLab) delete window.__holoLab;
      slateProbe.enabled = false;
    };
  }, [engine, scene, slate, spiralModel, debug, params, slateHost]);

  const onComposition = React.useCallback(
    (composing: boolean) => {
      frozenRef.current = composing && params.get("freeze") !== "0";
    },
    [params],
  );

  const q = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    return `/_holo${s ? `?${s}` : ""}`;
  };

  return (
    <div ref={rootRef} className="holo-root" data-holo="root">
      <div ref={hostRef} className="holo-world" data-holo="world" />
      {failed ? <div className="holo-lab-msg" role="alert">顯示卡不支援（WebGL 無法使用）</div> : null}
      {scene === "spiral" && records.isLoading ? <div className="holo-lab-msg" role="status">載入紀錄中…</div> : null}
      {scene === "spiral" && records.isError ? <div className="holo-lab-msg" role="alert">紀錄載入失敗</div> : null}
      <div ref={hudRef} className="holo-lab-hud" role="group" aria-label="實驗室控制">
        <div>
          H1 實驗室 ・ <span ref={fpsRef}>— fps</span>
        </div>
        <div>
          場景：
          <Link to={q({ scene: "machine" })} aria-current={scene === "machine"}>
            機台
          </Link>{" "}
          <Link to={q({ scene: "spiral" })} aria-current={scene === "spiral"}>
            螺旋{params.get("n") ? `（n=${params.get("n")}）` : ""}
          </Link>
        </div>
        {scene === "machine" ? (
          <div>
            終端板：
            <Link to={q({ slate: "proj" })} aria-current={slate === "proj"}>
              投影
            </Link>{" "}
            <Link to={q({ slate: "css3d" })} aria-current={slate === "css3d"}>
              CSS3D
            </Link>{" "}
            <Link to={q({ slate: "off" })} aria-current={slate === "off"}>
              關
            </Link>
          </div>
        ) : null}
        <div>
          強度：
          {(["off", "std", "max"] as const).map((l) => (
            <React.Fragment key={l}>
              <Link to={q({ crt: l })} aria-current={engine?.currentLevel === l}>
                {l === "off" ? "關" : l === "std" ? "標準" : "濃"}
              </Link>{" "}
            </React.Fragment>
          ))}
        </div>
        <div>{scene === "machine" ? "左鍵轉、滾輪縮、右鍵平移、R 回正、A 自動緩轉、點零件選取" : "滾輪／PageUp／PageDown 一天，Shift 一週；Ctrl＋滾輪縮；左鍵轉；R 回正"}</div>
        {scene === "spiral" && records.data ? <div>共 {records.data.length} 筆（上螺旋 {spiralModel?.items.length ?? 0}）</div> : null}
      </div>
      {slate !== "off" && scene === "machine" ? createPortal(<Slate onComposition={onComposition} />, slateHost) : null}
    </div>
  );
}
