/*
 * 控制室的線框幾何（docs/os-mode-spec.md §4.1、§4.3 的 X0 子集）：透視地板網格＋一台線框 CRT。
 * 只有線、沒有面；顏色由呼叫端傳入（來自 Cyber token）。總線段數 ≤ 4,000（HUB_SEGMENT_CAP）。
 */
import * as THREE from "three";

// 向量線框的顏色直接用 CSS token 的 sRGB 值，不做色彩管理轉換（輸出到離屏緩衝再由 CRT 著色器合成）
THREE.ColorManagement.enabled = false;

export const HUB_SEGMENT_CAP = 4000;

export interface HubLineColors {
  /** 地板網格 */
  floor: THREE.ColorRepresentation;
  /** 螢幕外殼 */
  housing: THREE.ColorRepresentation;
  /** 螢幕面外框（選中色） */
  screenFrame: THREE.ColorRepresentation;
}

/** 螢幕面的尺寸與位置（鏡頭推進的目標） */
export const SCREEN = { width: 2.0, height: 1.5, center: new THREE.Vector3(0, 1.55, 0.69) };

/** 地板網格：延伸到霧中的 2 組平行線。 */
function floorGrid(color: THREE.ColorRepresentation): THREE.LineSegments {
  const extent = 70;
  const step = 1.5;
  const pts: number[] = [];
  for (let x = -extent; x <= extent; x += step) pts.push(x, 0, -extent, x, 0, 8);
  for (let z = -extent; z <= 8; z += step) pts.push(-extent, 0, z, extent, 0, z);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, fog: true, depthTest: false }));
}

function edges(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.LineSegments {
  return new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color, fog: true, depthTest: false }));
}

/** 線框 CRT：前殼（箱）＋後殼（四角錐台）＋底座＋螢幕面外框。 */
function monitor(housing: THREE.ColorRepresentation, frame: THREE.ColorRepresentation): THREE.Group {
  const g = new THREE.Group();
  const front = edges(new THREE.BoxGeometry(2.6, 2.0, 0.5), housing);
  front.position.set(0, 1.55, 0.35);
  g.add(front);

  const bezel = edges(new THREE.BoxGeometry(2.3, 1.7, 0.08), housing);
  bezel.position.set(0, 1.55, 0.64);
  g.add(bezel);

  // 後殼：上小下大的四角錐台（CylinderGeometry 四邊形，轉 45° 與前殼對齊）
  const back = edges(new THREE.CylinderGeometry(0.9, 1.7, 1.6, 4, 1), housing);
  back.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  back.scale.set(1, 1, 0.78);
  back.position.set(0, 1.55, -0.65);
  g.add(back);

  const neck = edges(new THREE.BoxGeometry(0.6, 0.35, 0.6), housing);
  neck.position.set(0, 0.42, 0.0);
  g.add(neck);
  const base = edges(new THREE.BoxGeometry(1.7, 0.12, 1.3), housing);
  base.position.set(0, 0.18, 0.0);
  g.add(base);

  // 螢幕面外框（四條邊）
  const hw = SCREEN.width / 2;
  const hh = SCREEN.height / 2;
  const z = SCREEN.center.z + 0.01;
  const loop = new THREE.BufferGeometry();
  loop.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-hw, -hh, 0, hw, -hh, 0, hw, -hh, 0, hw, hh, 0, hw, hh, 0, -hw, hh, 0, -hw, hh, 0, -hw, -hh, 0], 3),
  );
  const outline = new THREE.LineSegments(loop, new THREE.LineBasicMaterial({ color: frame, fog: true, depthTest: false }));
  outline.position.set(SCREEN.center.x, SCREEN.center.y, z);
  outline.renderOrder = 2;
  g.add(outline);
  return g;
}

export function countSegments(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof THREE.LineSegments) {
      const geo = o.geometry as THREE.BufferGeometry;
      const pos = geo.getAttribute("position");
      n += (geo.index ? geo.index.count : pos.count) / 2;
    }
  });
  return n;
}

export function buildHubLines(colors: HubLineColors): { group: THREE.Group; segments: number } {
  const group = new THREE.Group();
  group.add(floorGrid(colors.floor));
  group.add(monitor(colors.housing, colors.screenFrame));
  const segments = countSegments(group);
  if (segments > HUB_SEGMENT_CAP) throw new Error(`hub scene has ${segments} line segments (cap ${HUB_SEGMENT_CAP})`);
  return { group, segments };
}
