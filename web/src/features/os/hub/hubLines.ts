/*
 * 控制室的線框幾何（docs/os-mode-spec.md §4.1、§4.3；X2）：透視地板網格＋沿弧排列的 7 台線框 CRT＋雷達台。
 * 只有線、沒有面（螢幕貼圖與 ▮ 游標除外）；顏色由呼叫端傳入（來自 Cyber token）。總線段數 ≤ 4,000（HUB_SEGMENT_CAP）：
 * 光點與脈衝環的線段以「預先配置的上限」計入，所以不管有幾台機台，預算都成立（hubLines.test.ts）。
 * 這個檔案只建立物件、不跑迴圈；每幀的動畫（掃描線旋轉、游標閃爍、脈衝擴張）由 HubCanvas 驅動。
 */
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { blipLocalUnit, type Blip, type BlipColorKey } from "./radar";
import { MONITOR_COUNT, monitorPoses, SCREEN_LOCAL, SCREEN_SIZE } from "./layout";

// 向量線框的顏色直接用 CSS token 的 sRGB 值，不做色彩管理轉換（輸出到離屏緩衝再由 CRT 著色器合成）
THREE.ColorManagement.enabled = false;

export const HUB_SEGMENT_CAP = 4000;
/** 雷達同時顯示的光點上限（超過的略過；7 天內不重複機台通常遠少於此） */
export const MAX_BLIPS = 64;
/** 每個光點的線段數：菱形 4 條＋一根細柱 1 條 */
export const SEGMENTS_PER_BLIP = 5;
/** 新異常脈衝環：同時存在的上限與每個環的線段數 */
export const PULSE_POOL = 6;
export const PULSE_SEGMENTS = 24;
/** 雷達台：位置（弧的內側、鏡頭與螢幕牆之間）、半徑、台緣高度 */
export const RADAR = { x: 0, z: 4.4, radius: 1.8, rim: 0.14 } as const;
const PLOT_Y = RADAR.rim + 0.01;
const BLIP_SIZE = 0.07;
const BLIP_STICK = 0.32;

export interface HubLineColors {
  /** 地板網格 */
  floor: THREE.ColorRepresentation;
  /** 螢幕外殼 */
  housing: THREE.ColorRepresentation;
  /** 未選中的螢幕面外框 */
  outline: THREE.ColorRepresentation;
  /** 選中色：選中螢幕的外框與四角框、雷達掃描線 */
  accent: THREE.ColorRepresentation;
  /** 雷達：內圈、外圈與台緣 */
  ringDim: THREE.ColorRepresentation;
  ringStrong: THREE.ColorRepresentation;
  /** 掃描線尾跡淡出的目標色（--page） */
  page: THREE.ColorRepresentation;
}

/* ---------- 共用小工具 ---------- */

function lineGeometry(pts: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function basic(color: THREE.ColorRepresentation, fog: boolean): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, fog, depthTest: false });
}

/** 地板網格：延伸到霧中的 2 組平行線。 */
function floorGrid(color: THREE.ColorRepresentation): THREE.LineSegments {
  const extent = 70;
  const step = 1.5;
  const pts: number[] = [];
  for (let x = -extent; x <= extent; x += step) pts.push(x, 0, -extent, x, 0, 16);
  for (let z = -extent; z <= 16; z += step) pts.push(-extent, 0, z, extent, 0, z);
  return new THREE.LineSegments(lineGeometry(pts), basic(color, true));
}

/** 把 geometry 的邊（EdgesGeometry）套上矩陣後加進 out。 */
function edgesInto(out: number[], geometry: THREE.BufferGeometry, m: THREE.Matrix4): void {
  const e = new THREE.EdgesGeometry(geometry);
  const pos = e.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    out.push(v.x, v.y, v.z);
  }
  e.dispose();
  geometry.dispose();
}

/** 線框 CRT 外殼：前殼（箱）＋螢幕邊框＋後殼（四角錐台）＋頸＋底座，合併成一份 geometry（7 台共用）。 */
function housingGeometry(): THREE.BufferGeometry {
  const pts: number[] = [];
  const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  edgesInto(pts, new THREE.BoxGeometry(2.6, 2.0, 0.5), at(0, 1.55, 0.35));
  edgesInto(pts, new THREE.BoxGeometry(2.3, 1.7, 0.08), at(0, 1.55, 0.64));
  // 後殼：上小下大的四角錐台（CylinderGeometry 四邊形，轉 45° 與前殼對齊）
  const back = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 1.55, -0.65),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.PI / 4, 0)),
    new THREE.Vector3(1, 1, 0.78),
  );
  edgesInto(pts, new THREE.CylinderGeometry(0.9, 1.7, 1.6, 4, 1), back);
  edgesInto(pts, new THREE.BoxGeometry(0.6, 0.35, 0.6), at(0, 0.42, 0));
  edgesInto(pts, new THREE.BoxGeometry(1.7, 0.12, 1.3), at(0, 0.18, 0));
  return lineGeometry(pts);
}

/** 螢幕面外框（四條邊，局部座標）。 */
function outlineGeometry(): THREE.BufferGeometry {
  const hw = SCREEN_SIZE.width / 2;
  const hh = SCREEN_SIZE.height / 2;
  const z = SCREEN_LOCAL.z + 0.01;
  const y = SCREEN_LOCAL.y;
  return lineGeometry([-hw, y - hh, z, hw, y - hh, z, hw, y - hh, z, hw, y + hh, z, hw, y + hh, z, -hw, y + hh, z, -hw, y + hh, z, -hw, y - hh, z]);
}

/* ---------- 螢幕 ---------- */

export interface MonitorParts {
  index: number;
  group: THREE.Group;
  outline: THREE.LineSegments;
  outlineMat: THREE.LineBasicMaterial;
  screen: THREE.Mesh;
  screenMat: THREE.MeshBasicMaterial;
}

function buildMonitors(colors: HubLineColors): MonitorParts[] {
  const housingGeo = housingGeometry();
  const housingMat = basic(colors.housing, true);
  const outlineGeo = outlineGeometry();
  const screenGeo = new THREE.PlaneGeometry(SCREEN_SIZE.width, SCREEN_SIZE.height);
  return monitorPoses().map((pose) => {
    const group = new THREE.Group();
    group.position.set(pose.position.x, pose.position.y, pose.position.z);
    group.rotation.y = pose.yaw;
    const housing = new THREE.LineSegments(housingGeo, housingMat);
    group.add(housing);
    const outlineMat = basic(colors.outline, true);
    const outline = new THREE.LineSegments(outlineGeo, outlineMat);
    outline.renderOrder = 2;
    group.add(outline);
    // 螢幕面：唯一的貼圖（由 HubCanvas 指定 map）；亮度用材質顏色控制，選取切換不必重畫貼圖
    const screenMat = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false, depthTest: false });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, SCREEN_LOCAL.y, SCREEN_LOCAL.z);
    screen.renderOrder = 1;
    group.add(screen);
    return { index: pose.index, group, outline, outlineMat, screen, screenMat };
  });
}

/** 選中螢幕的四角框（Line2 系列：可以比 1 像素粗）。四個角各兩條邊，共 8 段。 */
export function buildBracket(color: THREE.ColorRepresentation): LineSegments2 {
  const hw = SCREEN_SIZE.width / 2 + 0.12;
  const hh = SCREEN_SIZE.height / 2 + 0.12;
  const len = 0.42;
  const pts: number[] = [];
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    pts.push(sx * hw, sy * hh, 0, sx * (hw - len), sy * hh, 0);
    pts.push(sx * hw, sy * hh, 0, sx * hw, sy * (hh - len), 0);
  }
  const geo = new LineSegmentsGeometry();
  geo.setPositions(pts);
  const mat = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: 3, worldUnits: false, depthTest: false, fog: false });
  const bracket = new LineSegments2(geo, mat);
  bracket.frustumCulled = false;
  bracket.renderOrder = 3;
  bracket.position.set(0, SCREEN_LOCAL.y, SCREEN_LOCAL.z + 0.02);
  return bracket;
}

/* ---------- 雷達台 ---------- */

function circlePts(radius: number, segs: number, y: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    pts.push(Math.cos(a0) * radius, y, -Math.sin(a0) * radius, Math.cos(a1) * radius, y, -Math.sin(a1) * radius);
  }
  return pts;
}

export interface PulseParts {
  ring: THREE.LineSegments;
  mat: THREE.LineBasicMaterial;
}

export interface RadarParts {
  group: THREE.Group;
  /** 繞 y 軸旋轉（rotation.y 為逆時針角度，與光點角度同向） */
  sweep: THREE.Group;
  blips: THREE.LineSegments;
  pulses: PulseParts[];
}

function buildRadar(colors: HubLineColors): RadarParts {
  const group = new THREE.Group();
  group.position.set(RADAR.x, 0, RADAR.z);
  const R = RADAR.radius;

  // 台緣：上下兩圈＋12 根立柱
  const rim: number[] = [...circlePts(R, 48, 0), ...circlePts(R, 48, RADAR.rim)];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    rim.push(Math.cos(a) * R, 0, -Math.sin(a) * R, Math.cos(a) * R, RADAR.rim, -Math.sin(a) * R);
  }
  group.add(new THREE.LineSegments(lineGeometry(rim), basic(colors.ringStrong, true)));

  // 3 個同心圈（外圈較亮）、刻度、十字準線
  const rings = new THREE.LineSegments(lineGeometry([...circlePts(R / 3, 64, PLOT_Y), ...circlePts((R * 2) / 3, 64, PLOT_Y)]), basic(colors.ringDim, true));
  group.add(rings);
  const outer = new THREE.LineSegments(lineGeometry(circlePts(R * 0.98, 64, PLOT_Y)), basic(colors.ringStrong, true));
  group.add(outer);
  const fine: number[] = [-R, PLOT_Y, 0, R, PLOT_Y, 0, 0, PLOT_Y, -R, 0, PLOT_Y, R];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    fine.push(Math.cos(a) * R * 0.9, PLOT_Y, -Math.sin(a) * R * 0.9, Math.cos(a) * R * 0.98, PLOT_Y, -Math.sin(a) * R * 0.98);
  }
  group.add(new THREE.LineSegments(lineGeometry(fine), basic(colors.ringDim, true)));

  // 掃描線＋尾跡（頂點色由 accent 往 page 淡出）
  const sweep = new THREE.Group();
  const trail = 5;
  const sp: number[] = [];
  const sc: number[] = [];
  const accent = new THREE.Color(colors.accent);
  const page = new THREE.Color(colors.page);
  for (let i = 0; i <= trail; i++) {
    const a = -(i * (4 * Math.PI)) / 180; // 每條尾跡落後 4°
    const c = accent.clone().lerp(page, i === 0 ? 0 : 0.35 + (i / trail) * 0.55);
    sp.push(0, PLOT_Y, 0, Math.cos(a) * R * 0.98, PLOT_Y, -Math.sin(a) * R * 0.98);
    sc.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const sg = lineGeometry(sp);
  sg.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3));
  const sweepLines = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, fog: false, depthTest: false }));
  sweepLines.renderOrder = 4;
  sweep.add(sweepLines);
  group.add(sweep);

  // 光點（預先配置上限；drawRange 控制實際數量；頂點色表示嚴重度）
  const bg = new THREE.BufferGeometry();
  bg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_BLIPS * SEGMENTS_PER_BLIP * 6), 3));
  bg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_BLIPS * SEGMENTS_PER_BLIP * 6), 3));
  bg.setDrawRange(0, 0);
  const blips = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ vertexColors: true, fog: false, depthTest: false }));
  blips.renderOrder = 5;
  blips.frustumCulled = false;
  group.add(blips);

  // 脈衝環（單位半徑；HubCanvas 縮放與淡出）
  const ringGeo = lineGeometry(circlePts(1, PULSE_SEGMENTS, 0));
  const pulses: PulseParts[] = [];
  for (let i = 0; i < PULSE_POOL; i++) {
    const mat = new THREE.LineBasicMaterial({ color: colors.accent, transparent: true, opacity: 0, fog: false, depthTest: false });
    const ring = new THREE.LineSegments(ringGeo, mat);
    ring.renderOrder = 6;
    ring.position.y = PLOT_Y;
    ring.visible = false;
    ring.frustumCulled = false;
    group.add(ring);
    pulses.push({ ring, mat });
  }
  return { group, sweep, blips, pulses };
}

/** 光點在雷達群組局部座標的位置（世界單位）。 */
export function blipLocal(b: Pick<Blip, "angle" | "radius">): { x: number; z: number } {
  const u = blipLocalUnit(b);
  return { x: u.x * RADAR.radius, z: u.z * RADAR.radius };
}

/* ---------- 整個場景 ---------- */

export interface HubParts {
  group: THREE.Group;
  segments: number;
  monitors: MonitorParts[];
  bracket: LineSegments2;
  radar: RadarParts;
  /** 選中第 index 台：外框變選中色、四角框移過去、其餘外框回到一般色；不碰貼圖。亮度由 setBrightness 負責。 */
  select(index: number): void;
  /** 填入光點（最多 MAX_BLIPS）；回傳實際畫出的數量 */
  setBlips(blips: readonly Blip[], colorOf: (k: BlipColorKey) => THREE.Color): number;
  dispose(): void;
}

export function countSegments(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof THREE.LineSegments) {
      const geo = o.geometry as THREE.BufferGeometry;
      const pos = geo.getAttribute("position");
      n += (geo.index ? geo.index.count : pos.count) / 2;
    } else if (o instanceof LineSegments2) {
      n += (o.geometry as LineSegmentsGeometry).attributes.instanceStart?.count ?? 0;
    }
  });
  return n;
}

export function buildHubLines(colors: HubLineColors): HubParts {
  const group = new THREE.Group();
  group.add(floorGrid(colors.floor));
  const monitors = buildMonitors(colors);
  for (const m of monitors) group.add(m.group);
  const radar = buildRadar(colors);
  group.add(radar.group);
  const bracket = buildBracket(colors.accent);

  const accent = new THREE.Color(colors.accent);
  const normal = new THREE.Color(colors.outline);
  const select = (index: number) => {
    for (const m of monitors) m.outlineMat.color.copy(m.index === index ? accent : normal);
    monitors[index]?.group.add(bracket);
  };
  select(Math.floor(MONITOR_COUNT / 2));

  const setBlips = (blips: readonly Blip[], colorOf: (k: BlipColorKey) => THREE.Color) => {
    const pos = radar.blips.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = radar.blips.geometry.getAttribute("color") as THREE.BufferAttribute;
    const n = Math.min(MAX_BLIPS, blips.length);
    const s = BLIP_SIZE;
    for (let i = 0; i < n; i++) {
      const b = blips[i]!;
      const p = blipLocal(b);
      const c = colorOf(b.colorKey);
      // 菱形（貼著台面）＋細柱
      const seg: number[] = [
        p.x, PLOT_Y, p.z - s, p.x + s, PLOT_Y, p.z,
        p.x + s, PLOT_Y, p.z, p.x, PLOT_Y, p.z + s,
        p.x, PLOT_Y, p.z + s, p.x - s, PLOT_Y, p.z,
        p.x - s, PLOT_Y, p.z, p.x, PLOT_Y, p.z - s,
        p.x, PLOT_Y, p.z, p.x, PLOT_Y + BLIP_STICK, p.z,
      ];
      for (let k = 0; k < seg.length; k += 3) {
        const v = i * SEGMENTS_PER_BLIP * 2 + k / 3;
        pos.setXYZ(v, seg[k]!, seg[k + 1]!, seg[k + 2]!);
        col.setXYZ(v, c.r, c.g, c.b);
      }
    }
    radar.blips.geometry.setDrawRange(0, n * SEGMENTS_PER_BLIP * 2);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    return n;
  };

  const segments = countSegments(group);
  if (segments > HUB_SEGMENT_CAP) throw new Error(`hub scene has ${segments} line segments (cap ${HUB_SEGMENT_CAP})`);

  const dispose = () => {
    const seen = new Set<unknown>();
    const kill = (o: { dispose?: () => void } | undefined | null) => {
      if (o && !seen.has(o)) {
        seen.add(o);
        o.dispose?.();
      }
    };
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      kill(m.geometry);
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(kill);
      else kill(mat);
    });
    kill(bracket.geometry);
    kill(bracket.material as THREE.Material);
  };

  return { group, segments, monitors, bracket, radar, select, setBlips, dispose };
}
