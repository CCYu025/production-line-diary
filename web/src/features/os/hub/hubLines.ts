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
import { blipLocalUnit, phosphor, SWEEP_OMEGA, SWEEP_TAU_S, WEDGE_SPAN_S, type Blip, type BlipColorKey } from "./radar";
import { MONITOR_COUNT, monitorPoses, SCREEN_LOCAL, SCREEN_SIZE } from "./layout";

// 向量線框的顏色直接用 CSS token 的 sRGB 值，不做色彩管理轉換（輸出到離屏緩衝再由 CRT 著色器合成）
THREE.ColorManagement.enabled = false;

export const HUB_SEGMENT_CAP = 4000;
/** 雷達同時顯示的光點上限（超過的略過；7 天內不重複機台通常遠少於此） */
export const MAX_BLIPS = 64;
/** 每個光點的線段數：菱形 4 條＋一根細柱 1 條 */
export const SEGMENTS_PER_BLIP = 5;
/** ping 環（嚴重／重大的光點被掃過時）：同時存在的上限與每個環的線段數（預先建立，執行時不配置） */
export const PULSE_POOL = 12;
export const PULSE_SEGMENTS = 24;
/** 鎖定框池（重大光點＋未確認警示）：上限與每個框的線段數（菱形 4 個角 × 2 邊） */
export const LOCK_POOL = 16;
export const LOCK_SEGMENTS = 8;
/** 未確認警示的外圈（粗線）線段數 */
export const ALERT_RING_SEGMENTS = 64;
/** 掃描線尾跡楔形的線數（涵蓋 WEDGE_SPAN_S 秒的餘暉） */
export const WEDGE_LINES = 30;
/** 雷達台：位置（弧的內側、鏡頭與螢幕牆之間）、半徑、台緣高度 */
export const RADAR = { x: 0, z: 7.6, radius: 2.4, rim: 0.16 } as const;
const PLOT_Y = RADAR.rim + 0.01;
const BLIP_SIZE = 0.1;
const BLIP_STICK = 0.45;

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

/** Line2 系列的線（可以比 1 像素粗；線寬以離屏緩衝的像素計）。pts 為成對的線段端點。 */
function line2(pts: number[], color: THREE.ColorRepresentation, linewidth: number, transparent: boolean): { obj: LineSegments2; mat: LineMaterial } {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(pts);
  const mat = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth, worldUnits: false, depthTest: false, fog: false, transparent, opacity: 1 });
  const obj = new LineSegments2(geo, mat);
  obj.frustumCulled = false;
  return { obj, mat };
}

/** 地板網格：延伸到霧中的 2 組平行線。 */
function floorGrid(color: THREE.ColorRepresentation): THREE.LineSegments {
  const extent = 70;
  const step = 1.5;
  const pts: number[] = [];
  for (let x = -extent; x <= extent; x += step) pts.push(x, 0, -extent, x, 0, 26);
  for (let z = -extent; z <= 26; z += step) pts.push(-extent, 0, z, extent, 0, z);
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
export function housingGeometry(): THREE.BufferGeometry {
  const pts: number[] = [];
  const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  edgesInto(pts, new THREE.BoxGeometry(2.34, 2.0, 0.5), at(0, 1.55, 0.35));
  edgesInto(pts, new THREE.BoxGeometry(2.1, 1.7, 0.08), at(0, 1.55, 0.64));
  // 後殼：上小下大的四角錐台（CylinderGeometry 四邊形，轉 45° 與前殼對齊）
  const back = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 1.55, -0.65),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.PI / 4, 0)),
    new THREE.Vector3(1, 1, 0.78),
  );
  edgesInto(pts, new THREE.CylinderGeometry(0.5, 0.95, 1.6, 4, 1), back);
  edgesInto(pts, new THREE.BoxGeometry(0.6, 0.35, 0.6), at(0, 0.42, 0));
  edgesInto(pts, new THREE.BoxGeometry(1.5, 0.12, 1.1), at(0, 0.18, 0));
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
  /** 每台自己的外殼材質（X3：兩側螢幕滑開時各自淡入霧；顏色往 --page 混，不使用透明度） */
  housingMat: THREE.LineBasicMaterial;
  outline: THREE.LineSegments;
  outlineMat: THREE.LineBasicMaterial;
  screen: THREE.Mesh;
  screenMat: THREE.MeshBasicMaterial;
}

function buildMonitors(colors: HubLineColors): MonitorParts[] {
  const housingGeo = housingGeometry();
  const outlineGeo = outlineGeometry();
  const screenGeo = new THREE.PlaneGeometry(SCREEN_SIZE.width, SCREEN_SIZE.height);
  return monitorPoses().map((pose) => {
    const group = new THREE.Group();
    group.position.set(pose.position.x, pose.position.y, pose.position.z);
    group.rotation.y = pose.yaw;
    const housingMat = basic(colors.housing, true);
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
    return { index: pose.index, group, housingMat, outline, outlineMat, screen, screenMat };
  });
}

/** 選中螢幕的四角框（Line2 系列：可以比 1 像素粗）。四個角各兩條邊，共 8 段。 */
export function buildBracket(color: THREE.ColorRepresentation, opts: { linewidth?: number; opacity?: number } = {}): LineSegments2 {
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
  const mat = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: opts.linewidth ?? 3, worldUnits: false, depthTest: false, fog: false });
  if (opts.opacity !== undefined && opts.opacity < 1) {
    mat.transparent = true;
    mat.opacity = opts.opacity;
  }
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
  ring: LineSegments2;
  mat: LineMaterial;
}

export interface LockParts {
  obj: LineSegments2;
  mat: LineMaterial;
}

export interface RadarParts {
  group: THREE.Group;
  /** 繞 y 軸旋轉（rotation.y 為逆時針角度，與光點角度同向） */
  sweep: THREE.Group;
  blips: THREE.LineSegments;
  /** ping 環池（單位半徑，縮放與淡出由 radarAnim 驅動） */
  pulses: PulseParts[];
  /** 菱形鎖定框池 */
  locks: LockParts[];
  /** 未確認警示的外圈（粗線；顏色與不透明度由 radarAnim 驅動） */
  alertRing: LockParts;
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

  // 掃描線＋尾跡楔形：每條尾跡落後一小段角度，顏色依磷光衰減（與光點同一條 exp 曲線）由 accent 往 page 淡出
  const sweep = new THREE.Group();
  const sp: number[] = [];
  const sc: number[] = [];
  const accent = new THREE.Color(colors.accent);
  const page = new THREE.Color(colors.page);
  const stepRad = (WEDGE_SPAN_S * SWEEP_OMEGA) / WEDGE_LINES;
  for (let i = 0; i <= WEDGE_LINES; i++) {
    const a = -i * stepRad;
    const c = page.clone().lerp(accent, phosphor((i * stepRad) / SWEEP_OMEGA, SWEEP_TAU_S));
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

  // ping 環池（單位半徑；radarAnim 縮放與淡出）。Line2 粗 2px：426×240 的低解析度下仍分得出來
  const ringPts = circlePts(1, PULSE_SEGMENTS, 0);
  const pulses: PulseParts[] = [];
  for (let i = 0; i < PULSE_POOL; i++) {
    const { obj, mat } = line2(ringPts, colors.accent, 2, true);
    mat.opacity = 0;
    obj.renderOrder = 6;
    obj.position.y = PLOT_Y;
    obj.visible = false;
    group.add(obj);
    pulses.push({ ring: obj, mat });
  }

  // 菱形鎖定框池：四個角的 L 形標記（局部座標，貼著台面），位置由 radarAnim 指定
  const ls = 0.24;
  const tick = 0.09;
  const lockPts: number[] = [];
  for (const [cx, cz, ax, az, bx, bz] of [
    [0, -ls, tick, tick, -tick, tick],
    [ls, 0, -tick, tick, -tick, -tick],
    [0, ls, -tick, -tick, tick, -tick],
    [-ls, 0, tick, -tick, tick, tick],
  ] as const) {
    lockPts.push(cx, 0, cz, cx + ax, 0, cz + az, cx, 0, cz, cx + bx, 0, cz + bz);
  }
  const locks: LockParts[] = [];
  for (let i = 0; i < LOCK_POOL; i++) {
    const { obj, mat } = line2(lockPts, colors.accent, 2, true);
    obj.renderOrder = 7;
    obj.position.y = PLOT_Y;
    obj.visible = false;
    group.add(obj);
    locks.push({ obj, mat });
  }

  // 未確認警示的外圈（比 1px 的外圈粗，疊在外圈上）
  const ar = line2(circlePts(R * 0.98, ALERT_RING_SEGMENTS, PLOT_Y), colors.accent, 3, true);
  ar.obj.renderOrder = 6;
  ar.obj.visible = false;
  group.add(ar.obj);

  return { group, sweep, blips, pulses, locks, alertRing: { obj: ar.obj, mat: ar.mat } };
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
  /** 懸停預覽（H0）：在第 index 台（null＝沒有）畫一組淡的、較細的四角框；選中的那台已經有選取框，不重複畫。第一次需要時才建立。 */
  setHover(index: number | null): void;
  /** 目前的懸停四角框（測試用；還沒建立過是 null） */
  hoverBracket(): LineSegments2 | null;
  /** 第 index 台融進霧色的程度 0..1（X3，E1／X4 的兩側螢幕）：外殼與外框的顏色往 --page 混；0＝原色。不碰貼圖與亮度。 */
  fade(index: number, amount: number): void;
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
  const housingBase = new THREE.Color(colors.housing);
  const pageColor = new THREE.Color(colors.page);
  const fades: number[] = Array.from({ length: MONITOR_COUNT }, () => 0);
  let selectedIndex = Math.floor(MONITOR_COUNT / 2);
  const paint = (m: MonitorParts) => {
    const f = fades[m.index]!;
    m.housingMat.color.copy(housingBase).lerp(pageColor, f);
    m.outlineMat.color.copy(m.index === selectedIndex ? accent : normal).lerp(pageColor, f);
  };
  const select = (index: number) => {
    selectedIndex = index;
    for (const m of monitors) paint(m);
    monitors[index]?.group.add(bracket);
  };
  select(selectedIndex);
  let hoverBracket: LineSegments2 | null = null;
  const setHover = (index: number | null) => {
    if (index === null || index === selectedIndex || !monitors[index]) {
      hoverBracket?.removeFromParent();
      return;
    }
    hoverBracket ??= buildBracket(colors.accent, { opacity: 0.7 });
    monitors[index]!.group.add(hoverBracket);
  };
  const fade = (index: number, amount: number) => {
    const m = monitors[index];
    if (!m || fades[index] === amount) return;
    fades[index] = amount;
    paint(m);
  };

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
    if (hoverBracket) {
      kill(hoverBracket.geometry);
      kill(hoverBracket.material as THREE.Material);
    }
  };

  return { group, segments, monitors, bracket, radar, select, setHover, hoverBracket: () => hoverBracket, fade, setBlips, dispose };
}
