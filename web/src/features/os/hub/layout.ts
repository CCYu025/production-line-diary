/*
 * 螢幕牆版面（docs/os-mode-spec.md §4.3；X2）：純數學，不依賴 three，場景與轉場共用。
 * 座標：右手系、y 向上；螢幕牆在 z ≈ 0 附近，鏡頭在 +z 看向 -z；x 負＝左。
 * 7 台螢幕沿著圓弧排列（圓心在牆的正前方，螢幕朝向圓心），CH-01 在最左（-55°）、CH-07 在最右（+55°）。
 * 中間那台（CH-04）的位置與 X0／X1 的單台螢幕相同（原點）。
 */
import { CHANNELS, channelIndex, type ChannelId } from "../channels";

export const MONITOR_COUNT = 7;
/** 弧形半角（度）：最左與最右的螢幕在 ±55° */
export const ARC_HALF_DEG = 55;
/** 圓弧半徑 */
export const ARC_RADIUS = 10.5;
/** 螢幕外殼的外框尺寸（前殼箱：寬×高）與整體深度 */
export const MONITOR_BOX = { width: 2.34, height: 2.0, depth: 2.4 } as const;
/** 螢幕面的尺寸（世界單位）；貼圖與點選共用 */
export const SCREEN_SIZE = { width: 2.0, height: 1.5 } as const;
/** 螢幕面在單台螢幕局部座標的位置（與 hubLines 的 SCREEN 一致：x=0、y=1.55、z=0.69） */
export const SCREEN_LOCAL = { y: 1.55, z: 0.69 } as const;
/** 垂直視角（度） */
export const CAMERA_FOV = 45;
/**
 * 進入推近到位（E1 結束，600ms）時，螢幕面的高度占視窗高度的比例。X3：螢幕面在這一刻的投影矩形就是台標卡外框的起點，
 * 所以不能再超出畫面（X0–X2 的 1.25 會讓螢幕面比視窗還大約 45%，卡片出現時才「縮」一下）。
 */
export const FACE_FILL_FRAC = 0.84;
/** 進入推近時鏡頭離螢幕面的距離：由 FACE_FILL_FRAC 與垂直視角算出 */
export const CLOSE_DISTANCE = SCREEN_SIZE.height / (FACE_FILL_FRAC * 2 * Math.tan((CAMERA_FOV * Math.PI) / 360));
/** 選取時鏡頭轉向的上限（度）與到位時間（毫秒）；不擋輸入 */
export const SELECT_YAW_MAX_DEG = 3;
export const SELECT_YAW_MS = 250;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MonitorPose {
  index: number;
  channel: ChannelId;
  /** 在弧上的角度（度）：-55…+55，由左到右 */
  angleDeg: number;
  /** 螢幕組的原點（地面） */
  position: Vec3;
  /** 繞 y 軸的旋轉（弧度），使螢幕面朝向圓心 */
  yaw: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** 第 index 台（0–6）在弧上的角度（度）。 */
export function arcAngleDeg(index: number): number {
  return -ARC_HALF_DEG + (index * 2 * ARC_HALF_DEG) / (MONITOR_COUNT - 1);
}

export function monitorPose(index: number): MonitorPose {
  const angleDeg = arcAngleDeg(index);
  const a = rad(angleDeg);
  return {
    index,
    channel: CHANNELS[index]!.id,
    angleDeg,
    // 圓心在 (0, ARC_RADIUS)：中間那台在原點，兩側往鏡頭方向彎過來
    position: { x: ARC_RADIUS * Math.sin(a), y: 0, z: ARC_RADIUS - ARC_RADIUS * Math.cos(a) },
    yaw: -a,
  };
}

export function monitorPoses(): MonitorPose[] {
  return Array.from({ length: MONITOR_COUNT }, (_, i) => monitorPose(i));
}

export function poseForChannel(ch: ChannelId): MonitorPose {
  return monitorPose(channelIndex(ch));
}

/** 螢幕面朝外的單位向量（水平）。 */
export function facing(pose: MonitorPose): Vec3 {
  return { x: Math.sin(pose.yaw), y: 0, z: Math.cos(pose.yaw) };
}

/** 螢幕面中心的世界座標。 */
export function screenCenter(pose: MonitorPose): Vec3 {
  const f = facing(pose);
  return { x: pose.position.x + f.x * SCREEN_LOCAL.z, y: SCREEN_LOCAL.y, z: pose.position.z + f.z * SCREEN_LOCAL.z };
}

/**
 * 進入推近（與離開拉遠）的終點：鏡頭在選中螢幕面正前方 CLOSE_DISTANCE，看向螢幕面中心。
 * 進入與離開都以「選中的螢幕」為目標，不是畫面中央。
 */
export function dollyTarget(pose: MonitorPose): { position: Vec3; lookAt: Vec3 } {
  const c = screenCenter(pose);
  const f = facing(pose);
  return { position: { x: c.x + f.x * CLOSE_DISTANCE, y: c.y, z: c.z + f.z * CLOSE_DISTANCE }, lookAt: c };
}

/**
 * 選取時鏡頭朝選中螢幕轉的偏航角（度，正＝往右／+x 轉）。與螢幕在弧上的位置成正比，最大 SELECT_YAW_MAX_DEG（≤ 8°）；
 * 中間那台是 0。減少動態效果時場景直接套用（不緩動）。
 */
export function selectYawDeg(index: number): number {
  return (arcAngleDeg(index) / ARC_HALF_DEG) * SELECT_YAW_MAX_DEG;
}

/** 指數趨近：dt 毫秒後 current 往 target 靠近，約 SELECT_YAW_MS 內到位（誤差 < 1%）。不依賴幀率。 */
export function easeToward(current: number, target: number, dtMs: number, durationMs = SELECT_YAW_MS): number {
  if (dtMs <= 0) return current;
  const tau = durationMs / Math.log(100);
  const k = 1 - Math.exp(-dtMs / tau);
  return current + (target - current) * k;
}

/**
 * 外殼的凸包（局部座標，由 hubLines 的 housingGeometry 取得；hubLines.test 檢查所有頂點都在這個稜柱內）：
 * 水平截面（x, z）八邊形，高度 CASING_Y。用來投影整面牆的範圍與相鄰外殼的間距。
 */
export const CASING_HULL_XZ: ReadonlyArray<readonly [number, number]> = [
  [-1.17, 0.1],
  [-0.68, -1.45],
  [0.68, -1.45],
  [1.17, 0.1],
  [1.17, 0.6],
  [1.05, 0.68],
  [-1.05, 0.68],
  [-1.17, 0.6],
];
export const CASING_Y = [0.12, 2.55] as const;

/** 單台螢幕外殼凸包在世界座標的 16 個角落。 */
export function casingCorners(pose: MonitorPose): Vec3[] {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  const out: Vec3[] = [];
  for (const y of CASING_Y) {
    for (const [lx, lz] of CASING_HULL_XZ) {
      // 局部 (lx, lz) → 世界：繞 y 軸 yaw（x' = x cos + z sin；z' = -x sin + z cos）
      out.push({ x: pose.position.x + lx * c + lz * s, y, z: pose.position.z - lx * s + lz * c });
    }
  }
  return out;
}

/* ---------- 鏡頭投影（純數學；休息位置與驗證共用） ---------- */

/** 休息鏡頭的高度與牆的目標比例（1920×1080 時：整面牆約占寬度 78%、螢幕面中心在畫面高度 45%） */
export const REST_CAM_Y = 7;
export const REST_WALL_WIDTH_FRAC = 0.78;
export const REST_FACE_Y_FRAC = 0.45;
/** 相鄰外殼投影後的最小水平間距（占視窗寬度） */
export const MIN_CASING_GAP_FRAC = 0.01;
/** 牆兩側（含選取偏航最大位移）至少保留的邊距（占視窗寬度） */
export const MIN_WALL_MARGIN_FRAC = 0.04;

export interface CamPose {
  position: Vec3;
  lookAt: Vec3;
  /** 在 lookAt 之上再繞鏡頭的垂直軸偏航（度，正＝往右）；選取偏航用 */
  yawDeg?: number;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** 世界點 → 視窗比例（x 由左到右 0..1、y 由上到下 0..1）；在鏡頭後方回傳 null。 */
export function makeProjector(cam: CamPose, fovDeg: number, aspect: number): (p: Vec3) => { x: number; y: number } | null {
  let f = unit3(sub3(cam.lookAt, cam.position));
  if (cam.yawDeg) {
    // 與 three 的 rotateOnWorldAxis(Y, -yaw) 相同：正偏航往 +x
    const th = -rad(cam.yawDeg);
    f = { x: f.x * Math.cos(th) + f.z * Math.sin(th), y: f.y, z: -f.x * Math.sin(th) + f.z * Math.cos(th) };
  }
  const right = unit3(cross3(f, { x: 0, y: 1, z: 0 }));
  const up = cross3(right, f);
  const t = Math.tan(rad(fovDeg) / 2);
  return (p) => {
    const d = sub3(p, cam.position);
    const z = dot3(d, f);
    if (z <= 1e-6) return null;
    return { x: (dot3(d, right) / (z * t * aspect) + 1) / 2, y: (1 - dot3(d, up) / (z * t)) / 2 };
  };
}

export interface WallExtents {
  /** 整面牆（含外殼）的水平範圍與垂直範圍（視窗比例） */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** 中間那台螢幕面中心的垂直位置（視窗比例） */
  faceCenterY: number;
  /** 由左到右相鄰外殼的水平間距（視窗比例；負＝重疊） */
  gaps: number[];
}

/** 以這個鏡頭看整面牆：外殼凸包投影後的範圍與相鄰間距。 */
export function wallExtents(cam: CamPose, fovDeg: number, aspect: number): WallExtents {
  const project = makeProjector(cam, fovDeg, aspect);
  const per = monitorPoses().map((pose) => {
    const pts = casingCorners(pose).map((c) => project(c)!);
    return { minX: Math.min(...pts.map((q) => q.x)), maxX: Math.max(...pts.map((q) => q.x)), minY: Math.min(...pts.map((q) => q.y)), maxY: Math.max(...pts.map((q) => q.y)) };
  });
  const mid = project(screenCenter(monitorPose(Math.floor(MONITOR_COUNT / 2))))!;
  return {
    minX: Math.min(...per.map((m) => m.minX)),
    maxX: Math.max(...per.map((m) => m.maxX)),
    minY: Math.min(...per.map((m) => m.minY)),
    maxY: Math.max(...per.map((m) => m.maxY)),
    faceCenterY: mid.y,
    gaps: per.slice(1).map((m, i) => m.minX - per[i]!.maxX),
  };
}

/**
 * 休息位置：鏡頭高度 REST_CAM_Y、水平置中；往後退到整面牆占視窗寬度 REST_WALL_WIDTH_FRAC，
 * 再把看向點的高度調到「中間那台螢幕面中心」落在畫面高度 REST_FACE_Y_FRAC（所以畫面上方不會空一大塊）。
 * 與選取偏航搭配：偏航上限 ≤ 3°、不位移，牆兩側仍有 ≥ 4% 邊距（layout.test 以投影驗證 1920×1080／1280×720／1024×640）。
 * fovDeg 是垂直視角。
 */
export function fitRestCamera(fovDeg: number, aspect: number, opts: { y?: number; widthFrac?: number; faceY?: number } = {}): { position: Vec3; lookAt: Vec3 } {
  const y = opts.y ?? REST_CAM_Y;
  const widthFrac = opts.widthFrac ?? REST_WALL_WIDTH_FRAC;
  const faceY = opts.faceY ?? REST_FACE_Y_FRAC;
  let camZ = 20;
  let lookY = 0.5;
  for (let iter = 0; iter < 5; iter++) {
    let lo = 4;
    let hi = 80;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      const e = wallExtents({ position: { x: 0, y, z: mid }, lookAt: { x: 0, y: lookY, z: 0 } }, fovDeg, aspect);
      if (e.maxX - e.minX > widthFrac) lo = mid;
      else hi = mid;
    }
    camZ = (lo + hi) / 2;
    let l2 = -3;
    let h2 = y;
    for (let k = 0; k < 40; k++) {
      const mid = (l2 + h2) / 2;
      const e = wallExtents({ position: { x: 0, y, z: camZ }, lookAt: { x: 0, y: mid, z: 0 } }, fovDeg, aspect);
      if (e.faceCenterY > faceY) h2 = mid;
      else l2 = mid;
    }
    lookY = (l2 + h2) / 2;
  }
  return { position: { x: 0, y, z: camZ }, lookAt: { x: 0, y: lookY, z: 0 } };
}

/** 世界點是否落在鏡頭水平視角內（測試與除錯用；鏡頭看向 -z，不含俯仰）。 */
export function withinHorizontalFov(cam: Vec3, point: { x: number; z: number }, fovDeg: number, aspect: number): boolean {
  const dz = cam.z - point.z;
  if (dz <= 0) return false;
  return Math.abs(point.x - cam.x) / dz <= Math.tan(rad(fovDeg) / 2) * aspect + 1e-9;
}
