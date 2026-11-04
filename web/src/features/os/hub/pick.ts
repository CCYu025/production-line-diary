/*
 * 螢幕點選（docs/os-mode-spec.md §4.3、X2）：純函式。射線 × 7 個螢幕面（矩形平面），回傳最近被打到的頻道。
 * 只在控制室（HUB）由 HubCanvas 呼叫；點擊走和 HUD 按鈕完全相同的「選取＋進入」路徑，懸停只改游標。
 */
import { CHANNELS, type ChannelId } from "../channels";
import { facing, monitorPoses, screenCenter, SCREEN_SIZE, type MonitorPose, type Vec3 } from "./layout";

export interface Ray {
  origin: Vec3;
  /** 不必是單位向量 */
  direction: Vec3;
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

/** 射線打到某台螢幕面的距離參數 t（沿 direction）；沒打到回傳 null。只算正面（從螢幕前方看）。 */
export function hitScreen(ray: Ray, pose: MonitorPose): number | null {
  const n = facing(pose);
  const denom = dot(ray.direction, n);
  if (denom >= -1e-9) return null; // 平行或從背面看
  const c = screenCenter(pose);
  const t = dot(sub(c, ray.origin), n) / denom;
  if (t <= 0) return null;
  const p: Vec3 = {
    x: ray.origin.x + ray.direction.x * t,
    y: ray.origin.y + ray.direction.y * t,
    z: ray.origin.z + ray.direction.z * t,
  };
  // 螢幕面的右方向（局部 +x 轉 yaw 後）：(cos yaw, 0, -sin yaw)
  const right: Vec3 = { x: Math.cos(pose.yaw), y: 0, z: -Math.sin(pose.yaw) };
  const d = sub(p, c);
  const u = dot(d, right);
  const v = d.y;
  return Math.abs(u) <= SCREEN_SIZE.width / 2 && Math.abs(v) <= SCREEN_SIZE.height / 2 ? t : null;
}

/** 射線打到的頻道（最近的一台）；都沒打到回傳 null。 */
export function pickChannel(ray: Ray, poses: readonly MonitorPose[] = monitorPoses()): ChannelId | null {
  let best: { t: number; ch: ChannelId } | null = null;
  for (const pose of poses) {
    const t = hitScreen(ray, pose);
    if (t !== null && (best === null || t < best.t)) best = { t, ch: CHANNELS[pose.index]!.id };
  }
  return best ? best.ch : null;
}
