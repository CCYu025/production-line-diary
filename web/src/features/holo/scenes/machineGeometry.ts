/*
 * 展示用的線框機台（H1 雛形）：程序產生，方塊、圓柱、管線、操作面板，約 2,000 條線段。純函式，沒有 three 依賴。
 * 座標：y 向上、機台正面朝 +z，控制面板在正面右側（終端板的錨點）。
 */

export interface MachinePart {
  name: string;
  /** 線段端點：每 6 個數字一條線段（x1 y1 z1 x2 y2 z2） */
  lines: number[];
  /** 面（三角形頂點，每 9 個數字一個三角形）：只用來畫 6% 的薄膜 */
  faces: number[];
  min: [number, number, number];
  max: [number, number, number];
}

type V3 = [number, number, number];

class PartBuilder {
  lines: number[] = [];
  faces: number[] = [];
  constructor(readonly name: string) {}

  seg(a: V3, b: V3): void {
    this.lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  poly(pts: V3[], close = false): void {
    for (let i = 0; i + 1 < pts.length; i++) this.seg(pts[i]!, pts[i + 1]!);
    if (close && pts.length > 2) this.seg(pts[pts.length - 1]!, pts[0]!);
  }
  tri(a: V3, b: V3, c: V3): void {
    this.faces.push(...a, ...b, ...c);
  }
  quad(a: V3, b: V3, c: V3, d: V3): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  /** 方塊的 12 條邊與 6 個面（faces=false 時不畫面） */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, faces = true): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const p: V3[] = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const) this.seg(p[a]!, p[b]!);
    if (faces) {
      for (const f of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]] as const) this.quad(p[f[0]]!, p[f[1]]!, p[f[2]]!, p[f[3]]!);
    }
  }
  /** 水平圓環（在 y 高度） */
  ringY(cx: number, y: number, cz: number, r: number, seg: number): void {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const b = ((i + 1) / seg) * Math.PI * 2;
      this.seg([cx + r * Math.cos(a), y, cz + r * Math.sin(a)], [cx + r * Math.cos(b), y, cz + r * Math.sin(b)]);
    }
  }
  /** 朝 z 的圓（在 z 位置） */
  ringZ(cx: number, cy: number, z: number, r: number, seg: number): void {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const b = ((i + 1) / seg) * Math.PI * 2;
      this.seg([cx + r * Math.cos(a), cy + r * Math.sin(a), z], [cx + r * Math.cos(b), cy + r * Math.sin(b), z]);
    }
  }
  /** 直立圓柱：上下環、中間環、縱向線；側面用薄膜（粗略的多邊形帶） */
  cylinder(cx: number, y0: number, cz: number, r: number, h: number, seg: number, mids: number, verticals: number): void {
    this.ringY(cx, y0, cz, r, seg);
    this.ringY(cx, y0 + h, cz, r, seg);
    for (let m = 1; m <= mids; m++) this.ringY(cx, y0 + (h * m) / (mids + 1), cz, r, seg);
    for (let i = 0; i < verticals; i++) {
      const a = (i / verticals) * Math.PI * 2;
      this.seg([cx + r * Math.cos(a), y0, cz + r * Math.sin(a)], [cx + r * Math.cos(a), y0 + h, cz + r * Math.sin(a)]);
    }
    for (let i = 0; i < verticals; i++) {
      const a = (i / verticals) * Math.PI * 2;
      const b = ((i + 1) / verticals) * Math.PI * 2;
      this.quad(
        [cx + r * Math.cos(a), y0, cz + r * Math.sin(a)],
        [cx + r * Math.cos(b), y0, cz + r * Math.sin(b)],
        [cx + r * Math.cos(b), y0 + h, cz + r * Math.sin(b)],
        [cx + r * Math.cos(a), y0 + h, cz + r * Math.sin(a)],
      );
    }
  }
  /** 管線：沿折線的 sides 條縱線，每隔 ringEvery 一個斷面環 */
  pipe(path: V3[], r: number, sides: number, ringEvery: number): void {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const dir: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = Math.hypot(...dir) || 1;
      const u: V3 = [dir[0] / len, dir[1] / len, dir[2] / len];
      // 與 u 垂直的兩個軸
      const ref: V3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const n1: V3 = norm(cross(u, ref));
      const n2: V3 = cross(u, n1);
      const at = (t: number, k: number): V3 => {
        const ang = (k / sides) * Math.PI * 2;
        const c = Math.cos(ang) * r;
        const s = Math.sin(ang) * r;
        return [a[0] + u[0] * t + n1[0] * c + n2[0] * s, a[1] + u[1] * t + n1[1] * c + n2[1] * s, a[2] + u[2] * t + n1[2] * c + n2[2] * s];
      };
      for (let k = 0; k < sides; k++) this.seg(at(0, k), at(len, k));
      for (let t = 0; t <= len + 1e-6; t += ringEvery) for (let k = 0; k < sides; k++) this.seg(at(t, k), at(t, k + 1));
    }
  }
  /** 地板網格（y 高度，x∈[x0,x1]、z∈[z0,z1]，格距 step） */
  grid(y: number, x0: number, x1: number, z0: number, z1: number, step: number): void {
    for (let x = x0; x <= x1 + 1e-6; x += step) this.seg([x, y, z0], [x, y, z1]);
    for (let z = z0; z <= z1 + 1e-6; z += step) this.seg([x0, y, z], [x1, y, z]);
  }

  build(): MachinePart {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const arr of [this.lines, this.faces]) {
      for (let i = 0; i < arr.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, arr[i + k]!);
          max[k] = Math.max(max[k]!, arr[i + k]!);
        }
      }
    }
    return { name: this.name, lines: this.lines, faces: this.faces, min, max };
  }
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v: V3): V3 {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** 控制面板中心（世界座標）：終端板的錨點 */
export const PANEL_ANCHOR: V3 = [6.2, 3.2, 4.4];

export function buildMachine(): MachinePart[] {
  const parts: MachinePart[] = [];

  // 底座與輸送帶
  const base = new PartBuilder("底座");
  base.box(0, 0, 0, 16, 1, 9);
  base.grid(0.5, -8, 8, -4.5, 4.5, 1);
  parts.push(base.build());

  const conveyor = new PartBuilder("輸送帶");
  conveyor.box(-1, 1.4, 2.2, 12, 0.6, 2, false);
  for (let x = -6.8; x <= 4.8; x += 0.35) conveyor.seg([x, 1.7, 1.25], [x, 1.7, 3.15]);
  for (let x = -6.8; x <= 4.8; x += 0.7) conveyor.seg([x, 1.1, 1.25], [x, 1.1, 3.15]);
  parts.push(conveyor.build());

  // 三座塔架
  const towers = new PartBuilder("塔架");
  for (const [tx, h] of [[-6, 7], [-2.5, 9], [1, 6]] as const) {
    towers.box(tx, 0.5 + h / 2, -2, 2, h, 2);
    for (let y = 1; y < h; y += 1) towers.poly([[tx - 1, 0.5 + y, -3], [tx + 1, 0.5 + y, -3], [tx + 1, 0.5 + y, -1], [tx - 1, 0.5 + y, -1]], true);
    for (let y = 0; y < h - 1; y += 2) {
      towers.seg([tx - 1, 0.5 + y, -3], [tx + 1, 0.5 + y + 2, -3]);
      towers.seg([tx + 1, 0.5 + y, -3], [tx - 1, 0.5 + y + 2, -3]);
      towers.seg([tx - 1, 0.5 + y, -1], [tx + 1, 0.5 + y + 2, -1]);
    }
  }
  parts.push(towers.build());

  // 圓柱槽
  const tanks = new PartBuilder("儲槽");
  for (const [tx, tz, r, h] of [[4.5, -2.4, 1.3, 5.5], [7, -1.2, 1.0, 4], [5, 0.6, 0.8, 3]] as const) tanks.cylinder(tx, 0.5, tz, r, h, 28, 4, 14);
  parts.push(tanks.build());

  // 管線
  const pipes = new PartBuilder("管線");
  const paths: V3[][] = [
    [[-6, 8, -2], [-6, 9.2, -2], [-2.5, 9.2, -2], [-2.5, 9.6, -2]],
    [[-2.5, 5, -3], [-2.5, 5, -4.2], [4.5, 5, -4.2], [4.5, 6, -4.2]],
    [[1, 6.5, -2], [1, 7.5, -2], [4.5, 7.5, -2.4]],
    [[7, 4.5, -1.2], [7, 5.2, -1.2], [7, 5.2, 1.5], [3, 5.2, 1.5], [3, 3.6, 1.5]],
    [[5, 3.5, 0.6], [5, 4.2, 0.6], [5, 4.2, 2.8], [-5, 4.2, 2.8]],
    [[-7.4, 1, -3.6], [-7.4, 6, -3.6], [-6, 6, -3.6]],
  ];
  for (const p of paths) pipes.pipe(p, 0.16, 6, 0.4);
  parts.push(pipes.build());

  // 機械臂
  const arm = new PartBuilder("機械臂");
  arm.box(-4, 2.4, 3.4, 1, 1.6, 1);
  arm.ringY(-4, 3.2, 3.4, 0.5, 20);
  arm.box(-3.2, 4, 3.4, 2.6, 0.5, 0.5);
  arm.ringZ(-1.9, 4, 3.4, 0.4, 20);
  arm.ringZ(-1.9, 4, 3.4, 0.25, 16);
  arm.box(-1.2, 3.1, 3.4, 0.5, 1.9, 0.5);
  arm.ringZ(-1.2, 2.1, 3.4, 0.3, 16);
  arm.seg([-1.3, 2.0, 3.4], [-1.3, 1.65, 3.4]);
  arm.seg([-1.1, 2.0, 3.4], [-1.1, 1.65, 3.4]);
  parts.push(arm.build());

  // 操作面板（正面右側）：外框、螢幕、按鈕、旋鈕
  const panel = new PartBuilder("操作面板");
  const [ax, ay, az] = PANEL_ANCHOR;
  panel.box(ax, ay, az - 0.3, 3.2, 3.6, 0.6);
  panel.poly([[ax - 1.3, ay + 0.2, az + 0.02], [ax + 1.3, ay + 0.2, az + 0.02], [ax + 1.3, ay + 1.5, az + 0.02], [ax - 1.3, ay + 1.5, az + 0.02]], true);
  for (let i = 1; i < 8; i++) panel.seg([ax - 1.3, ay + 0.2 + (1.3 * i) / 8, az + 0.02], [ax + 1.3, ay + 0.2 + (1.3 * i) / 8, az + 0.02]);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const bx = ax - 1.2 + c * 0.48;
      const by = ay - 0.2 - r * 0.38;
      panel.poly([[bx, by, az + 0.02], [bx + 0.34, by, az + 0.02], [bx + 0.34, by + 0.26, az + 0.02], [bx, by + 0.26, az + 0.02]], true);
    }
  }
  for (const kx of [-0.9, 0, 0.9]) {
    panel.ringZ(ax + kx, ay - 1.55, az + 0.02, 0.22, 16);
    panel.seg([ax + kx, ay - 1.55, az + 0.02], [ax + kx + 0.14, ay - 1.4, az + 0.02]);
  }
  for (let i = 0; i < 6; i++) panel.seg([ax - 1.5, ay + 1.6 - i * 0.12, az + 0.02], [ax - 1.3, ay + 1.6 - i * 0.12, az + 0.02]);
  parts.push(panel.build());

  return parts;
}

export const segmentCount = (parts: readonly MachinePart[]): number => parts.reduce((s, p) => s + p.lines.length / 6, 0);
