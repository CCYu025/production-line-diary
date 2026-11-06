/*
 * 控制室 3D 層（docs/os-mode-spec.md §3.1、§4.1–4.3；X2）：@react-three/fiber 的 <Canvas>，aria-hidden。
 * 場景＝透視地板網格（線性霧淡入 --page）＋沿弧排列的 7 台線框 CRT（每台一張螢幕貼圖）＋雷達台（掃描線、光點、脈衝環）。
 * 繪製迴圈只在 HUB 與轉場（到進入交接點為止）執行；STATION 時 frameloop="never"（P2：零 rAF）。
 * 鏡頭：休息位置看得到整面牆；選取時偏航（≤ 8°、easeToward）；進入推近與離開拉遠以選中螢幕為目標；待機巡視；輕微晃動。
 * 開機（§5.5）：BIOS 文字貼圖畫進場景緩衝（經過 CRT 管線）、B3 亮線與 B4 揭曉是管線的 uniform；控制室在底下已經就緒。
 * 滑鼠：只在 HUB 對螢幕面做射線點選（pick.ts）；點擊＝呼叫 onPick（與 HUD 按鈕同一路徑），懸停只改游標。
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";
import { CHANNELS, channelIndex, type Channel, type ChannelId } from "../channels";
import { readOsColors, readToken } from "../colors";
import { isPhosphorDegraded, markPhosphorDegraded, phosphorEnabled, PhosphorGovernor } from "../crt/phosphor";
import { CrtPipeline, liveRenderTargets } from "../crt/pipeline";
import type { CrtLevel } from "../crt/settings";
import { A_ZONE } from "../crt/zones";
import type { BootKind } from "../director/boot";
import type { TransitionClock } from "../director/useDirector";
import { webglAvailable } from "../webgl";
import { biosKey, bootFrame, drawBios, type BootCounts } from "./bootVisual";
import { dbgHubFrame, dbgSet, dbgTime, transitionDebugEnabled } from "../transition/debug";
import { cameraProgress, CAMERA_FOV, poseAt, restPose, stepRig, type HubMode, type RigState } from "./camera";
import { faceRectAt } from "./faceRect";
import { sideFade, slidePose, type SlidePose } from "./slide";
import { createContextGuard } from "./contextGuard";
import { buildHubLines, type HubParts } from "./hubLines";
import { RadarAnimator } from "./radarAnim";
import type { HubAnomalies } from "./useHubAnomalies";
import { MONITOR_COUNT, SCREEN_LOCAL, SCREEN_SIZE } from "./layout";
import { pickChannel } from "./pick";
import { BLIP_TOKEN, DIM_BLIP_MIX, SWEEP_OMEGA, type Blip, type BlipColorKey } from "./radar";
import { drawMonitorScreen, TEX_H, TEX_W, UNSELECTED_BRIGHTNESS, type CursorRect } from "./screenTexture";
import { signalKey, type HubSignals } from "./signals";

export type { HubMode } from "./camera";
export { cameraProgress } from "./camera";

export interface HubCanvasProps {
  running: boolean;
  mode: HubMode;
  clock: TransitionClock;
  reduced: boolean;
  /** 選中的頻道：鏡頭偏航、進出推拉的目標，以及四角框所在的螢幕 */
  channel: Channel;
  /** 每個頻道的即時訊號（螢幕貼圖內容）；內容鍵沒變就不重畫 */
  signals: HubSignals;
  /** 雷達光點與未確認的新異常警示 */
  blips: Blip[];
  alerts: HubAnomalies["alerts"];
  /** 待機巡視中 */
  patrolling: boolean;
  /** 開機中（完整／短）；null＝不在開機中 */
  boot: BootKind | null;
  bootCounts: BootCounts;
  /** CRT 強度（A 區） */
  level: CrtLevel;
  /** 可以點選螢幕（導演狀態是 HUB 且介面沒暫停） */
  pickable: boolean;
  /** 點到某台螢幕：呼叫端走和 HUD 按鈕相同的「選取＋進入」路徑 */
  onPick: (id: ChannelId) => void;
  /** WebGL 無法使用（不支援、初始化失敗、context 遺失後沒恢復）：呼叫端改用網頁模式 */
  onFailure: () => void;
}

/** 驗證用的降級開關（網址 ?osdebug=nobloom,nosway；P1 不達標時依序關閉看差多少） */
function debugFlags(): Set<string> {
  try {
    return new Set((new URLSearchParams(window.location.search).get("osdebug") ?? "").split(",").filter(Boolean));
  } catch {
    return new Set();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const BLIP_KEYS: readonly BlipColorKey[] = ["good", "warning", "serious", "critical", "dim"];
/** 減少動態效果時掃描線停住的角度 */
const SWEEP_STILL = 0.6;

function mixColor(a: string, b: string, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

function readBlipColors(): Record<BlipColorKey, THREE.Color> {
  const out = {} as Record<BlipColorKey, THREE.Color>;
  for (const k of BLIP_KEYS) out[k] = new THREE.Color(readToken(BLIP_TOKEN[k]));
  // 已解決：--ink-muted 往 --page 混（亮度約為嚴重度色的2/3，在 --page 上仍清楚可見）
  const c = readOsColors();
  out.dim = new THREE.Color(c.page).lerp(new THREE.Color(c.inkMuted), DIM_BLIP_MIX);
  return out;
}

/** Rig 每幀把鏡頭進度交給場景，場景據此移動／淡出兩側螢幕（E1／X4）。 */
interface Motion {
  apply(p: number, selected: number): void;
}

interface Built {
  accentColor: THREE.Color;
  colors: ReturnType<typeof readOsColors>;
  parts: HubParts;
  canvases: HTMLCanvasElement[];
  textures: THREE.CanvasTexture[];
  keys: string[];
  cursor: THREE.Mesh;
  cursorGeo: THREE.PlaneGeometry;
  cursorMat: THREE.MeshBasicMaterial;
  blipColors: Record<BlipColorKey, THREE.Color>;
  anim: RadarAnimator;
}

const CURSOR_INDEX = CHANNELS.findIndex((c) => c.id === "CH-03");

function placeCursor(b: Built, rect: CursorRect | null) {
  b.cursor.visible = rect !== null;
  if (!rect) return;
  const u = (rect.x + rect.w / 2) / TEX_W;
  const v = (rect.y + rect.h / 2) / TEX_H;
  b.cursor.position.set((u - 0.5) * SCREEN_SIZE.width, SCREEN_LOCAL.y + (0.5 - v) * SCREEN_SIZE.height, SCREEN_LOCAL.z + 0.015);
  b.cursor.scale.set((rect.w / TEX_W) * SCREEN_SIZE.width, (rect.h / TEX_H) * SCREEN_SIZE.height, 1);
}

function HubScene({
  channel,
  signals,
  blips,
  alerts,
  reduced,
  motion,
}: Pick<HubCanvasProps, "channel" | "signals" | "blips" | "alerts" | "reduced"> & { motion: React.MutableRefObject<Motion | null> }) {
  const scene = useThree((s) => s.scene);
  const latest = React.useRef({ channel, signals, reduced });
  latest.current = { channel, signals, reduced };

  const built = React.useMemo<Built>(() => {
    const colors = readOsColors();
    const parts = buildHubLines({
      floor: colors.lineStrong,
      // 外殼：--line-strong 往 --accent 靠一點（仍然是 token 的混色，不是新色碼）
      housing: mixColor(colors.lineStrong, colors.accent, 0.3),
      outline: mixColor(colors.lineStrong, colors.accent, 0.3),
      accent: colors.accent,
      ringDim: colors.lineStrong,
      ringStrong: mixColor(colors.lineStrong, colors.accent, 0.45),
      page: colors.page,
    });
    const canvases: HTMLCanvasElement[] = [];
    const textures: THREE.CanvasTexture[] = [];
    for (const m of parts.monitors) {
      const c = document.createElement("canvas");
      c.width = TEX_W;
      c.height = TEX_H;
      const tex = new THREE.CanvasTexture(c);
      // 螢幕只占低解析度緩衝的幾十個像素：用 mipmap＋非等向過濾縮小，不要讓字被取樣成雜點
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      m.screenMat.map = tex;
      canvases.push(c);
      textures.push(tex);
    }
    const cursorGeo = new THREE.PlaneGeometry(1, 1);
    const cursorMat = new THREE.MeshBasicMaterial({ color: colors.accent, fog: false, toneMapped: false, depthTest: false });
    const cursor = new THREE.Mesh(cursorGeo, cursorMat);
    cursor.renderOrder = 3;
    cursor.visible = false;
    parts.monitors[CURSOR_INDEX]?.group.add(cursor);
    const blipColors = readBlipColors();
    return {
      accentColor: new THREE.Color(colors.accent),
      colors,
      parts,
      canvases,
      textures,
      keys: Array.from({ length: MONITOR_COUNT }, () => ""),
      cursor,
      cursorGeo,
      cursorMat,
      blipColors,
      anim: new RadarAnimator(parts, new THREE.Color(colors.page), (k) => blipColors[k]),
    };
  }, []);

  /** 內容鍵改變的螢幕才重畫（force＝字型載入完成後全部重畫）。 */
  const redraw = React.useCallback(
    (force: boolean) => {
      const sigs = latest.current.signals;
      CHANNELS.forEach((ch, i) => {
        const sig = sigs[ch.id];
        const key = signalKey(sig);
        if (!force && built.keys[i] === key) return;
        built.keys[i] = key;
        const rect = drawMonitorScreen(built.canvases[i]!, built.colors, ch, sig);
        built.textures[i]!.needsUpdate = true;
        if (i === CURSOR_INDEX) placeCursor(built, rect);
      });
    },
    [built],
  );

  React.useEffect(() => {
    redraw(false);
  }, [redraw, signals]);

  // 字型（IBM Plex Mono）載入完成後重畫一次，避免第一幀用後備字型
  React.useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) redraw(true);
    });
    return () => {
      alive = false;
    };
  }, [redraw]);

  // 選取：外框／四角框／亮度（不重畫貼圖）
  const selectedIndex = channelIndex(channel.id);
  React.useEffect(() => {
    built.parts.select(selectedIndex);
    built.parts.monitors.forEach((m, i) => {
      m.screenMat.color.setScalar(i === selectedIndex ? 1 : UNSELECTED_BRIGHTNESS);
    });
    built.cursorMat.color.set(built.colors.accent).multiplyScalar(selectedIndex === CURSOR_INDEX ? 1 : UNSELECTED_BRIGHTNESS);
  }, [built, selectedIndex]);

  // E1／X4：兩側螢幕沿弧線滑開並融進霧色（只改群組位置／朝向與顏色亮度；不配置物件）。p＝0 時完全回到原位與原亮度。
  React.useEffect(() => {
    const tmp: SlidePose = { x: 0, z: 0, yaw: 0 };
    motion.current = {
      apply(p, sel) {
        const ms = built.parts.monitors;
        for (let i = 0; i < ms.length; i++) {
          const m = ms[i]!;
          slidePose(i, sel, p, tmp);
          m.group.position.x = tmp.x;
          m.group.position.z = tmp.z;
          m.group.rotation.y = tmp.yaw;
          const f = sideFade(i, sel, p);
          built.parts.fade(i, f);
          const base = i === sel ? 1 : UNSELECTED_BRIGHTNESS;
          m.screenMat.color.setScalar(base * (1 - f));
          if (i === CURSOR_INDEX) built.cursorMat.color.copy(built.accentColor).multiplyScalar(base * (1 - f));
        }
      },
    };
    return () => {
      motion.current = null;
    };
  }, [built, motion]);

  // 光點與警示：改變時才寫入（位置、鎖定框、外圈顏色）；每幀只改顏色／不透明度（RadarAnimator.frame）
  React.useEffect(() => {
    built.anim.set(blips, alerts);
  }, [built, blips, alerts]);

  React.useEffect(() => {
    const page = new THREE.Color(built.colors.page);
    scene.background = page;
    scene.fog = new THREE.Fog(page, 16, 60);
    scene.add(built.parts.group);
    return () => {
      scene.remove(built.parts.group);
      built.parts.dispose();
      built.cursorGeo.dispose();
      built.cursorMat.dispose();
      for (const t of built.textures) t.dispose();
      scene.background = null;
      scene.fog = null;
    };
  }, [scene, built]);

  useFrame(({ clock }) => {
    const { reduced: r } = latest.current;
    const t = clock.elapsedTime;
    // 雷達掃描線（逆時針，4 秒一圈；減少動態效果：停住）
    built.parts.radar.sweep.rotation.y = r ? SWEEP_STILL : t * SWEEP_OMEGA;
    // READY▮ 游標：切換可見性（不重傳貼圖）；減少動態效果：常亮
    if (built.cursor.parent) built.cursor.visible = built.keys[CURSOR_INDEX] !== "" && (r || Math.floor(t * 2) % 2 === 0);
    // 光點餘暉、ping 環、鎖定框、警示外圈（只動顏色與不透明度）
    built.anim.frame(t, r);
  });
  return null;
}

function Rig({
  mode,
  clock,
  reduced,
  sway,
  channel,
  patrolling,
  level,
  motion,
}: Pick<HubCanvasProps, "mode" | "clock" | "reduced" | "channel" | "patrolling" | "level"> & { sway: boolean; motion: React.MutableRefObject<Motion | null> }) {
  const live = React.useRef({ mode, channel, patrolling });
  live.current = { mode, channel, patrolling };
  const rig = React.useRef<RigState>({ selectYaw: 0, patrolW: 0 });
  const last = React.useRef(0);
  const inited = React.useRef(false);
  // 進入／離開期間鎖住目標螢幕：離開後半段使用者可以改選頻道，鏡頭與側邊螢幕不能因此跳位置
  const pinned = React.useRef<{ mode: HubMode; ch: ChannelId } | null>(null);
  const applied = React.useRef<{ p: number; sel: number; m: Motion | null }>({ p: -1, sel: -1, m: null });
  const debug = React.useMemo(transitionDebugEnabled, []);
  useFrame(({ camera, size, clock: three }) => {
    const { mode: m, channel: ch, patrolling: pat } = live.current;
    const now = performance.now();
    const dtMs = last.current === 0 ? 16 : Math.min(100, now - last.current);
    const rawDt = last.current === 0 ? 0 : now - last.current;
    last.current = now;
    const elapsed = clock.start == null ? 0 : now - clock.start;
    // 減少動態效果：不跑鏡頭動畫，直接在終點（進入／工作站＝推到位，其餘＝原位）；執行中切換也立即生效
    const p = reduced ? (m === "station" || m === "entering" ? 1 : 0) : cameraProgress(m, elapsed);
    const aspect = size.width / Math.max(1, size.height);
    if (m === "entering" || m === "exiting") {
      if (!pinned.current || pinned.current.mode !== m) pinned.current = { mode: m, ch: ch.id };
    } else pinned.current = null;
    const target = pinned.current?.ch ?? ch.id;
    const pose = poseAt(aspect, target, p);
    if (!inited.current) {
      // 第一幀：選取偏航直接到位（不從 0 緩動）
      inited.current = true;
      rig.current = { selectYaw: stepRig({ selectYaw: 0, patrolW: 0 }, { channel: ch.id, mode: m, patrolling: false, reduced: true, dtMs: 0, tSec: 0 }, 0).state.selectYaw, patrolW: 0 };
    }
    const r = stepRig(rig.current, { channel: ch.id, mode: m, patrolling: pat, reduced, dtMs, tSec: three.elapsedTime }, p);
    rig.current = r.state;
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    if (r.yawDeg !== 0) camera.rotateOnWorldAxis(UP, -THREE.MathUtils.degToRad(r.yawDeg));
    if (!reduced && sway && m === "hub") {
      // 輕微晃動：±0.3°、週期 8 秒
      const a = Math.sin((three.elapsedTime * Math.PI * 2) / 8);
      camera.rotateY(THREE.MathUtils.degToRad(0.3) * a);
      camera.rotateX(THREE.MathUtils.degToRad(0.2) * Math.sin((three.elapsedTime * Math.PI * 2) / 8 + 1.1));
    }
    // 兩側螢幕的滑開／淡出（E1／X4）：只在進度或目標改變時寫入
    const sel = channelIndex(target);
    if (applied.current.p !== p || applied.current.sel !== sel || applied.current.m !== motion.current) {
      applied.current.p = p;
      applied.current.sel = sel;
      applied.current.m = motion.current;
      motion.current?.apply(p, sel);
    }
    if (debug) {
      if (m === "entering" || m === "exiting") dbgHubFrame(rawDt);
      dbgTime(elapsed);
      dbgSet({
        camera: { position: [pose.position.x, pose.position.y, pose.position.z], lookAt: [pose.lookAt.x, pose.lookAt.y, pose.lookAt.z], progress: p },
        faceRect: faceRectAt(aspect, target, p, A_ZONE[level].effects ? A_ZONE[level].barrel : 0),
      });
    }
  });
  return null;
}

interface PipelineInfo {
  level: CrtLevel;
  lowWidth: number;
  lowHeight: number;
  phosphor: boolean;
}
let pipelineInfo: PipelineInfo | null = null;

/** 自動降級每隔幾幀評估一次（中位數要排序，不必每幀做）。 */
const DEGRADE_CHECK_EVERY = 30;

function Pipeline({
  reduced,
  bloom,
  level,
  boot,
  bootCounts,
  clock,
  mode,
}: Pick<HubCanvasProps, "reduced" | "level" | "boot" | "bootCounts" | "clock" | "mode"> & { bloom: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  // 本分頁的磷光降級旗標（記憶體）；變成 true 時重建管線（dispose 回饋緩衝）
  const [degraded, setDegraded] = React.useState(isPhosphorDegraded);
  const phosphor = phosphorEnabled(level, reduced) && !degraded;
  const pipeline = React.useMemo(() => {
    const c = readOsColors();
    return new CrtPipeline({
      pageColor: new THREE.Color(c.page),
      bandColor: new THREE.Color(c.accent).lerp(new THREE.Color(1, 1, 1), 0.55),
      level,
      bloom,
      flicker: !reduced,
      phosphor,
    });
  }, [level, bloom, reduced, phosphor]);
  // 強度切換＝丟掉舊管線（dispose 全部離屏緩衝）；__osGl 的資源計數可以驗證沒有洩漏
  React.useEffect(() => () => pipeline.dispose(), [pipeline]);

  const lineRes = React.useRef({ w: 0, h: 0 });
  const live = React.useRef({ boot, bootCounts, mode });
  live.current = { boot, bootCounts, mode };
  // 自動降級：只在 HUB（非開機、文件可見）量測；狀態或可見性變化就重新累積
  const governor = React.useMemo(() => new PhosphorGovernor(), []);
  const gov = React.useRef({ frames: 0 });
  React.useEffect(() => {
    const onVis = () => governor.reset();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [governor]);
  const bios = React.useRef<{ canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string; w: number; h: number } | null>(null);
  const releaseBios = React.useCallback(() => {
    bios.current?.tex.dispose();
    bios.current = null;
  }, []);
  React.useEffect(
    () => () => {
      pipeline.setOverlay(null);
      releaseBios();
    },
    [pipeline, releaseBios],
  );

  // priority > 0：接手繪製（fiber 不再自動 render）
  useFrame(({ clock: three, size }, delta) => {
    const aspect = size.width / Math.max(1, size.height);
    pipeline.syncSize(aspect);
    const { boot: b, bootCounts: counts, mode: m } = live.current;
    if (phosphor) {
      const measuring = m === "hub" && !b && document.visibilityState === "visible";
      if (!measuring) {
        governor.reset();
        gov.current.frames = 0;
      } else {
        governor.push(delta * 1000);
        if (++gov.current.frames % DEGRADE_CHECK_EVERY === 0 && governor.shouldDegrade()) {
          markPhosphorDegraded(governor.medianFps() ?? undefined);
          setDegraded(true);
        }
      }
    }
    const bs = clock.bootStart;
    if (b && bs != null) {
      const f = bootFrame(b, performance.now() - bs, 5);
      pipeline.setBoot(f.done ? null : { reveal: f.reveal, band: f.band, bandW: f.bandW, line: f.line, glow: f.glow });
      if (f.biosOn) {
        const { width: w, height: h } = pipeline.lowSize;
        if (!bios.current || bios.current.w !== w || bios.current.h !== h) {
          releaseBios();
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const tex = new THREE.CanvasTexture(canvas);
          tex.minFilter = THREE.NearestFilter;
          tex.magFilter = THREE.NearestFilter;
          tex.generateMipmaps = false;
          bios.current = { canvas, tex, key: "", w, h };
        }
        const k = biosKey(f, counts);
        if (bios.current.key !== k) {
          bios.current.key = k;
          const c = readOsColors();
          drawBios(bios.current.canvas, c, f, counts);
          bios.current.tex.needsUpdate = true;
        }
        pipeline.setOverlay(bios.current.tex);
      } else {
        pipeline.setOverlay(null);
        releaseBios();
      }
    } else {
      pipeline.setBoot(null);
      pipeline.setOverlay(null);
      if (bios.current) releaseBios();
    }
    pipeline.render(gl, scene, camera, aspect, three.elapsedTime, delta * 1000, m === "entering" || m === "exiting");
    const low = pipeline.lowSize;
    if (!pipelineInfo || pipelineInfo.level !== level || pipelineInfo.lowWidth !== low.width || pipelineInfo.phosphor !== pipeline.hasPhosphor) pipelineInfo = { level, lowWidth: low.width, lowHeight: low.height, phosphor: pipeline.hasPhosphor };
    // Line2 的線寬以離屏緩衝的像素計；尺寸改變時才更新
    if (lineRes.current.w !== low.width || lineRes.current.h !== low.height) {
      lineRes.current = { w: low.width, h: low.height };
      scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as { isLineMaterial?: boolean; resolution?: THREE.Vector2 } | undefined;
        if (mat?.isLineMaterial && mat.resolution) mat.resolution.set(low.width, low.height);
      });
    }
  }, 1);
  return null;
}

/** 螢幕點選：只在 pickable（HUB）時作用。懸停只改游標；點擊呼叫 onPick。 */
function Picker({ pickable, onPick, level }: Pick<HubCanvasProps, "pickable" | "onPick" | "level">) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const live = React.useRef({ pickable, onPick, level });
  live.current = { pickable, onPick, level };
  React.useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = (e: MouseEvent): ChannelId | null => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = -((e.clientY - r.top) / r.height) * 2 + 1;
      // CRT 桶狀弧面把場景往外推：螢幕上看到的位置 c 對應場景座標 c·(1 + k|c|²)（強度「關」時 k＝0）
      const k = A_ZONE[live.current.level].effects ? A_ZONE[live.current.level].barrel : 0;
      const s = 1 + k * (x * x + y * y);
      ndc.set(x * s, y * s);
      raycaster.setFromCamera(ndc, get().camera);
      return pickChannel({ origin: raycaster.ray.origin, direction: raycaster.ray.direction });
    };
    const onMove = (e: PointerEvent) => {
      el.style.cursor = live.current.pickable && hit(e) ? "pointer" : "";
    };
    const onLeave = () => {
      el.style.cursor = "";
    };
    const onClick = (e: MouseEvent) => {
      if (!live.current.pickable) return;
      const ch = hit(e);
      if (ch) live.current.onPick(ch);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("click", onClick);
      el.style.cursor = "";
    };
  }, [gl, get]);
  React.useEffect(() => {
    if (!pickable) gl.domElement.style.cursor = "";
  }, [pickable, gl]);
  return null;
}

/** 後備提示（非連結文字）：實際的切換由 OsShell 的 onFailure 處理（toast＋改用網頁模式）。 */
export function WebglFallback() {
  return (
    <div className="os-fallback" data-os="webgl-fallback">
      <p>&gt; PLD/OS: WebGL 初始化失敗</p>
      <p>&gt; 這台電腦的瀏覽器無法顯示 3D 控制室，正在改用網頁模式。</p>
    </div>
  );
}

class HubErrorBoundary extends React.Component<{ children: React.ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? <WebglFallback /> : this.props.children;
  }
}

interface OsGlStats {
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
  /** CRT 強度與低解析度尺寸（驗證強度切換用；Canvas 還沒建立時沒有） */
  level?: CrtLevel;
  lowWidth?: number;
  lowHeight?: number;
  /** 磷光回饋緩衝是否存在（減少動態效果、強度關、被自動降級時為 false） */
  phosphor?: boolean;
  /** 存活的離屏 render target 數（強度來回切換不得增長） */
  renderTargets?: number;
}
declare global {
  interface Window {
    /** ?osdebug=gldebug 時的 WebGL 資源計數（驗證釋放用） */
    __osGl?: () => OsGlStats;
  }
}

/**
 * Canvas 內最後一個元件：掛載時接上 context 遺失／恢復的處理（webglcontextlost 要 preventDefault 才可能恢復）；
 * 卸載時釋放渲染器（renderLists、programs、context）。它在兄弟元件之後，所以先前的 effect 清理
 * （場景幾何／材質／貼圖、CrtPipeline 的離屏緩衝）都已經做完。
 * fiber 自己卸載後 500ms 也會呼叫 forceContextLoss，這裡先做完並把它換成空函式，避免對已遺失的 context 再丟一次警告。
 */
function GlLifecycle({ onFailure, debug }: { onFailure: () => void; debug: boolean }) {
  const gl = useThree((s) => s.gl);
  const failureRef = React.useRef(onFailure);
  failureRef.current = onFailure;
  React.useEffect(() => {
    const canvas = gl.domElement;
    const guard = createContextGuard({ onFail: () => failureRef.current() });
    const onLost = (e: Event) => {
      e.preventDefault();
      guard.lost();
    };
    const onRestored = () => guard.restored();
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    if (debug) {
      window.__osGl = () => ({
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
        calls: gl.info.render.calls,
        ...(pipelineInfo ?? {}),
        renderTargets: liveRenderTargets(),
      });
    }
    return () => {
      guard.dispose();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      gl.renderLists.dispose();
      gl.dispose();
      gl.forceContextLoss();
      gl.forceContextLoss = () => {};
      pipelineInfo = null;
    };
  }, [gl, debug]);
  return null;
}

export default function HubCanvas({
  running,
  mode,
  clock,
  reduced,
  channel,
  signals,
  blips,
  alerts,
  patrolling,
  boot,
  bootCounts,
  level,
  pickable,
  onPick,
  onFailure,
}: HubCanvasProps) {
  const flags = React.useMemo(debugFlags, []);
  const motion = React.useRef<Motion | null>(null);
  const supported = React.useMemo(webglAvailable, []);
  // 直接載入工作站時不必建立 WebGL context；第一次需要控制室才掛上
  const [mounted, setMounted] = React.useState(running);
  if (running && !mounted) setMounted(true);

  const failureRef = React.useRef(onFailure);
  failureRef.current = onFailure;
  const notifyFailure = React.useCallback(() => failureRef.current(), []);
  React.useEffect(() => {
    if (!supported) notifyFailure();
  }, [supported, notifyFailure]);
  const debugGl = flags.has("gldebug");
  React.useEffect(() => {
    // 還沒有 Canvas（例如直接載入工作站）時也要有這個函式，驗證腳本才能比對前後
    if (debugGl && !window.__osGl) window.__osGl = () => ({ geometries: 0, textures: 0, programs: 0, calls: 0 });
  }, [debugGl]);

  if (!supported) return <WebglFallback />;
  if (!mounted) return null;
  return (
    <HubErrorBoundary onFailure={notifyFailure}>
      <Canvas
        aria-hidden="true"
        frameloop={running ? "always" : "never"}
        linear
        flat
        dpr={[1, 2]}
        gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
        camera={{ fov: CAMERA_FOV, near: 0.1, far: 120, position: [restPose(16 / 9).position.x, restPose(16 / 9).position.y, restPose(16 / 9).position.z] }}
      >
        <HubScene channel={channel} signals={signals} blips={blips} alerts={alerts} reduced={reduced} motion={motion} />
        <Rig mode={mode} clock={clock} reduced={reduced} sway={!flags.has("nosway")} channel={channel} patrolling={patrolling} level={level} motion={motion} />
        <Pipeline reduced={reduced} bloom={!flags.has("nobloom")} level={level} boot={boot} bootCounts={bootCounts} clock={clock} mode={mode} />
        <Picker pickable={pickable} onPick={onPick} level={level} />
        <GlLifecycle onFailure={notifyFailure} debug={debugGl} />
      </Canvas>
    </HubErrorBoundary>
  );
}


