/*
 * 螢幕面的投影矩形（docs/os-mode-spec.md §5.2；X3）：純數學。E1 結束（600ms）鏡頭推到位時，選中螢幕面在畫面上的矩形
 * 就是台標卡外框的起點（卡片從這裡接續，不再「縮放跳一下」）。CRT 桶狀弧面（A_ZONE.barrel）把畫面往外推，
 * 螢幕上看到的位置 c 對應場景座標 c·(1 + k|c|²)（與 Picker 的反算相同），所以這裡把投影後的四個角反算成「畫面上看到的位置」。
 */
import type { ChannelId } from "../channels";
import type { Rect } from "../transition/choreo";
import { poseAt } from "./camera";
import { CAMERA_FOV, makeProjector, poseForChannel, screenCenter, SCREEN_SIZE } from "./layout";

/** 場景 NDC → 桶狀弧面後畫面上看到的 NDC（固定點迭代；k＝0 就是原值）。 */
export function barrelDisplay(nx: number, ny: number, k: number): { x: number; y: number } {
  if (!k) return { x: nx, y: ny };
  let cx = nx;
  let cy = ny;
  for (let i = 0; i < 8; i++) {
    const s = 1 + k * (cx * cx + cy * cy);
    cx = nx / s;
    cy = ny / s;
  }
  return { x: cx, y: cy };
}

/**
 * 進度 p（0＝休息位置、1＝推到位）時，頻道 ch 的螢幕面在畫面上的外接矩形（視窗比例，y 向下）。
 * barrelK＝目前 CRT 強度的桶狀係數（A_ZONE[level].barrel；強度「關」為 0）。
 */
export function faceRectAt(aspect: number, ch: ChannelId, p: number, barrelK = 0): Rect {
  const pose = poseForChannel(ch);
  const cam = poseAt(aspect, ch, p);
  const project = makeProjector(cam, CAMERA_FOV, aspect);
  const c = screenCenter(pose);
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  const hw = SCREEN_SIZE.width / 2;
  const hh = SCREEN_SIZE.height / 2;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    // 螢幕面的局部 x 軸在世界座標是 (cos, 0, -sin)（見 layout.casingCorners）
    const q = project({ x: c.x + cos * hw * sx, y: c.y + hh * sy, z: c.z - sin * hw * sx });
    if (!q) continue;
    const d = barrelDisplay(q.x * 2 - 1, 1 - q.y * 2, barrelK);
    const x = (d.x + 1) / 2;
    const y = (1 - d.y) / 2;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
