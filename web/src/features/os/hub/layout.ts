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
export const ARC_RADIUS = 7;
/** 螢幕外殼的外框尺寸（前殼箱：寬×高）與整體深度 */
export const MONITOR_BOX = { width: 2.6, height: 2.0, depth: 2.4 } as const;
/** 螢幕面在單台螢幕局部座標的位置（與 hubLines 的 SCREEN 一致：x=0、y=1.55、z=0.69） */
export const SCREEN_LOCAL = { y: 1.55, z: 0.69 } as const;
/** 進入推近時鏡頭離螢幕面的距離 */
export const CLOSE_DISTANCE = 1.25;
/** 選取時鏡頭轉向的上限（度）與到位時間（毫秒）；不擋輸入 */
export const SELECT_YAW_MAX_DEG = 8;
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

/** 單台螢幕外殼在世界座標的四個水平角落 x／z（前殼寬度與深度的粗估，用於「整面牆看得到」的檢查）。 */
export function monitorFootprint(pose: MonitorPose): Array<{ x: number; z: number }> {
  const hw = MONITOR_BOX.width / 2;
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  const pts: Array<[number, number]> = [
    [-hw, 0.1],
    [hw, 0.1],
    [-hw, -MONITOR_BOX.depth + 0.6],
    [hw, -MONITOR_BOX.depth + 0.6],
  ];
  // 局部 (lx, lz) → 世界：繞 y 軸 yaw（x' = x cos + z sin；z' = -x sin + z cos）
  return pts.map(([lx, lz]) => ({ x: pose.position.x + lx * c + lz * s, z: pose.position.z - lx * s + lz * c }));
}

/**
 * 休息位置的鏡頭：高度 y、看向牆的中心，往 +z 退到整面牆在 aspect（寬/高）畫面內都看得到（含邊距 marginFrac，例如 0.04＝每側留 4%）。
 * fovDeg 是垂直視角。回傳最小退後量對應的位置與看向點。
 */
export function fitRestCamera(fovDeg: number, aspect: number, opts: { y?: number; lookY?: number; marginFrac?: number } = {}) {
  const y = opts.y ?? 2.2;
  const lookY = opts.lookY ?? 1.3;
  const margin = opts.marginFrac ?? 0.04;
  const tanHalfH = Math.tan(rad(fovDeg) / 2) * aspect * (1 - margin);
  const lookAt: Vec3 = { x: 0, y: lookY, z: 0 };
  // 水平方向：對每個外殼角落 (x, z)，需要 |x| / (camZ - z) <= tanHalfH → camZ >= z + |x| / tanHalfH
  let camZ = 0;
  for (const p of monitorPoses()) for (const q of monitorFootprint(p)) camZ = Math.max(camZ, q.z + Math.abs(q.x) / tanHalfH);
  const position: Vec3 = { x: 0, y, z: camZ };
  return { position, lookAt };
}

/** 世界點是否落在鏡頭水平視角內（測試與除錯用；鏡頭看向 -z，不含俯仰）。 */
export function withinHorizontalFov(cam: Vec3, point: { x: number; z: number }, fovDeg: number, aspect: number): boolean {
  const dz = cam.z - point.z;
  if (dz <= 0) return false;
  return Math.abs(point.x - cam.x) / dz <= Math.tan(rad(fovDeg) / 2) * aspect + 1e-9;
}
