/*
 * 控制室 3D 層（docs/os-mode-spec.md §3.1、§4.1–4.3 的 X0 子集）：@react-three/fiber 的 <Canvas>，aria-hidden。
 * 場景＝透視地板網格（線性霧淡入 --page）＋一台線框 CRT（螢幕面是唯一的貼圖）。
 * 繪製迴圈只在 HUB 與轉場（到進入交接點為止）執行；STATION 時 frameloop="never"（P2：零 rAF）。
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";
import { readOsColors } from "../colors";
import { CrtPipeline } from "../crt/pipeline";
import type { TransitionClock } from "../director/useDirector";
import { ENTER, EXIT } from "../transition/timing";
import { buildHubLines, SCREEN } from "./hubLines";

export type HubMode = "hub" | "entering" | "exiting" | "station";

export interface HubCanvasProps {
  running: boolean;
  mode: HubMode;
  clock: TransitionClock;
  reduced: boolean;
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

/** 螢幕面貼圖（唯一允許的貼圖）：頻道代號與名稱，低解析度 2D canvas。 */
function makeScreenTexture(colors: ReturnType<typeof readOsColors>): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 240;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = colors.page;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
  ctx.fillStyle = colors.accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 44px 'IBM Plex Mono', monospace";
  ctx.fillText("CH-02", c.width / 2, 92);
  ctx.font = "700 30px 'IBM Plex Mono', monospace";
  ctx.fillText("RECORDS", c.width / 2, 142);
  ctx.fillStyle = colors.ink;
  ctx.font = "400 18px 'IBM Plex Mono', monospace";
  ctx.fillText("signal lock ▮▮▮▯", c.width / 2, 196);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function HubScene() {
  const scene = useThree((s) => s.scene);
  const built = React.useMemo(() => {
    const colors = readOsColors();
    const { group, segments } = buildHubLines({
      floor: colors.lineStrong,
      // 外殼：--line-strong 往 --accent 靠一點（仍然是 token 的混色，不是新色碼）
      housing: new THREE.Color(colors.lineStrong).lerp(new THREE.Color(colors.accent), 0.4),
      screenFrame: colors.accent,
    });
    const tex = makeScreenTexture(colors);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(SCREEN.width, SCREEN.height),
      new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false, depthTest: false }),
    );
    screen.position.copy(SCREEN.center);
    screen.renderOrder = 1;
    group.add(screen);
    return { colors, group, segments, tex, screen };
  }, []);

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

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function WebglFallback() {
  return (
    <div className="os-fallback" role="alert" data-os="webgl-fallback">
      <p>&gt; PLD/OS: WebGL 初始化失敗</p>
      <p>&gt; 這台電腦的瀏覽器無法顯示 3D 控制室。</p>
      <p>
        &gt; <a href="?mode=web">改用網頁模式</a>
      </p>
    </div>
  );
}

class HubErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <WebglFallback /> : this.props.children;
  }
}

export default function HubCanvas({ running, mode, clock, reduced }: HubCanvasProps) {
  const flags = React.useMemo(debugFlags, []);
  const supported = React.useMemo(webglAvailable, []);
  // 直接載入工作站時不必建立 WebGL context；第一次需要控制室才掛上
  const [mounted, setMounted] = React.useState(running);
  if (running && !mounted) setMounted(true);

  if (!supported) return <WebglFallback />;
  if (!mounted) return null;
  return (
    <HubErrorBoundary>
      <Canvas
        aria-hidden="true"
        frameloop={running ? "always" : "never"}
        linear
        flat
        dpr={[1, 2]}
        gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
        camera={{ fov: 45, near: 0.1, far: 120, position: REST_POS.toArray() }}
      >
        <HubScene />
        <Rig mode={mode} clock={clock} reduced={reduced} sway={!flags.has("nosway")} />
        <Pipeline reduced={reduced} bloom={!flags.has("nobloom")} />
      </Canvas>
    </HubErrorBoundary>
  );
}
