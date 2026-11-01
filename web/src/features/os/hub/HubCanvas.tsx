/*
 * 控制室 3D 層（docs/os-mode-spec.md §3.1、§4.1–4.3 的 X0 子集）：@react-three/fiber 的 <Canvas>，aria-hidden。
 * 場景＝透視地板網格（線性霧淡入 --page）＋一台線框 CRT（螢幕面是唯一的貼圖）。
 * 繪製迴圈只在 HUB 與轉場（到進入交接點為止）執行；STATION 時 frameloop="never"（P2：零 rAF）。
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";
import type { Channel } from "../channels";
import { readOsColors } from "../colors";
import { CrtPipeline } from "../crt/pipeline";
import type { TransitionClock } from "../director/useDirector";
import { ENTER, EXIT } from "../transition/timing";
import { webglAvailable } from "../webgl";
import { createContextGuard } from "./contextGuard";
import { buildHubLines, SCREEN } from "./hubLines";

export type HubMode = "hub" | "entering" | "exiting" | "station";

export interface HubCanvasProps {
  running: boolean;
  mode: HubMode;
  clock: TransitionClock;
  reduced: boolean;
  /** 螢幕貼圖顯示的頻道（目前選中／正在進出的頻道）；改變時重畫貼圖 */
  channel: Channel;
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

const REST_POS = new THREE.Vector3(0, 1.9, 6.2);
const REST_TARGET = new THREE.Vector3(0, 1.35, 0.2);
const CLOSE_POS = new THREE.Vector3(SCREEN.center.x, SCREEN.center.y, SCREEN.center.z + 1.25);
const CLOSE_TARGET = SCREEN.center.clone();

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** 0＝控制室原位，1＝推到螢幕前 */
export function cameraProgress(mode: HubMode, elapsedMs: number): number {
  switch (mode) {
    case "hub":
      return 0;
    case "entering":
      return ease(clamp01(elapsedMs / ENTER.E1[1]));
    case "station":
      return 1;
    case "exiting":
      return elapsedMs < EXIT.X4[0] ? 1 : 1 - ease(clamp01((elapsedMs - EXIT.X4[0]) / (EXIT.X4[1] - EXIT.X4[0])));
  }
}

const TEX_W = 320;
const TEX_H = 240;

/** 把頻道代號與名稱畫進螢幕貼圖的 2D canvas（唯一允許的貼圖）。 */
function drawScreen(c: HTMLCanvasElement, colors: ReturnType<typeof readOsColors>, channel: Channel) {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = colors.page;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, TEX_W - 20, TEX_H - 20);
  ctx.fillStyle = colors.accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 44px 'IBM Plex Mono', monospace";
  ctx.fillText(channel.id, TEX_W / 2, 92);
  ctx.font = "700 30px 'IBM Plex Mono', monospace";
  ctx.fillText(channel.code, TEX_W / 2, 142);
  ctx.fillStyle = colors.ink;
  ctx.font = "400 18px 'IBM Plex Mono', monospace";
  ctx.fillText("signal lock ▮▮▮▯", TEX_W / 2, 196);
}

function makeScreenTexture(colors: ReturnType<typeof readOsColors>, channel: Channel): { tex: THREE.CanvasTexture; canvas: HTMLCanvasElement } {
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  drawScreen(c, colors, channel);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { tex, canvas: c };
}

function HubScene({ channel }: { channel: Channel }) {
  const scene = useThree((s) => s.scene);
  const channelRef = React.useRef(channel);
  channelRef.current = channel;
  const built = React.useMemo(() => {
    const colors = readOsColors();
    const { group, segments } = buildHubLines({
      floor: colors.lineStrong,
      // 外殼：--line-strong 往 --accent 靠一點（仍然是 token 的混色，不是新色碼）
      housing: new THREE.Color(colors.lineStrong).lerp(new THREE.Color(colors.accent), 0.4),
      screenFrame: colors.accent,
    });
    const { tex, canvas } = makeScreenTexture(colors, channelRef.current);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN.width, SCREEN.height),
      new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false, depthTest: false }),
    );
    screen.position.copy(SCREEN.center);
    screen.renderOrder = 1;
    group.add(screen);
    return { colors, group, segments, tex, canvas, screen };
  }, []);

  // 選中的頻道改變：重畫螢幕貼圖（下一幀上傳）
  React.useEffect(() => {
    drawScreen(built.canvas, built.colors, channel);
    built.tex.needsUpdate = true;
  }, [built, channel]);

  React.useEffect(() => {
    const page = new THREE.Color(built.colors.page);
    scene.background = page;
    scene.fog = new THREE.Fog(page, 9, 34);
    scene.add(built.group);
    return () => {
      scene.remove(built.group);
      built.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | undefined;
        mat?.dispose();
      });
      built.tex.dispose();
      scene.background = null;
      scene.fog = null;
    };
  }, [scene, built]);
  return null;
}

function Rig({ mode, clock, reduced, sway }: Pick<HubCanvasProps, "mode" | "clock" | "reduced"> & { sway: boolean }) {
  const modeRef = React.useRef(mode);
  modeRef.current = mode;
  const tmp = React.useRef({ pos: new THREE.Vector3(), target: new THREE.Vector3() }).current;
  useFrame(({ camera, clock: three }) => {
    const m = modeRef.current;
    const elapsed = clock.start == null ? 0 : performance.now() - clock.start;
    const p = reduced ? (m === "station" || m === "entering" ? 1 : 0) : cameraProgress(m, elapsed);
    tmp.pos.lerpVectors(REST_POS, CLOSE_POS, p);
    tmp.target.lerpVectors(REST_TARGET, CLOSE_TARGET, p);
    camera.position.copy(tmp.pos);
    camera.lookAt(tmp.target);
    if (!reduced && sway && m === "hub") {
      // 輕微晃動：±0.3°、週期 8 秒
      const a = Math.sin((three.elapsedTime * Math.PI * 2) / 8);
      camera.rotateY(THREE.MathUtils.degToRad(0.3) * a);
      camera.rotateX(THREE.MathUtils.degToRad(0.2) * Math.sin((three.elapsedTime * Math.PI * 2) / 8 + 1.1));
    }
  });
  return null;
}

function Pipeline({ reduced, bloom }: { reduced: boolean; bloom: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const pipeline = React.useMemo(
    () => new CrtPipeline({ pageColor: new THREE.Color(readOsColors().page), bloom, flicker: !reduced }),
    [bloom, reduced],
  );
  React.useEffect(() => () => pipeline.dispose(), [pipeline]);
  // priority > 0：接手繪製（fiber 不再自動 render）
  useFrame(({ clock, size }) => {
    pipeline.render(gl, scene, camera, size.width / Math.max(1, size.height), clock.elapsedTime);
  }, 1);
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
    };
  }, [gl, debug]);
  return null;
}

export default function HubCanvas({ running, mode, clock, reduced, channel, onFailure }: HubCanvasProps) {
  const flags = React.useMemo(debugFlags, []);
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
        camera={{ fov: 45, near: 0.1, far: 120, position: REST_POS.toArray() }}
      >
        <HubScene channel={channel} />
        <Rig mode={mode} clock={clock} reduced={reduced} sway={!flags.has("nosway")} />
        <Pipeline reduced={reduced} bloom={!flags.has("nobloom")} />
        <GlLifecycle onFailure={notifyFailure} debug={debugGl} />
      </Canvas>
    </HubErrorBoundary>
  );
}
