/*
 * 螺旋場景（docs/holo-mode-spec.md §6.1；H1 雛形）：把 buildSpiral() 的結果畫出來。
 *   時間游標前後 8 週：完整卡片（一個 InstancedMesh，線框矩形在著色器裡畫）；
 *   8–52 週：小方點（InstancedMesh）；52 週以外：每週一條刻度線。
 * 移動游標只改 instance 屬性（預先配置的緩衝區），不重建 geometry。
 * 完整卡片：寬度＝耗時（有下限）、顏色＝嚴重度（Cyber token）、亮度與外框＝狀態
 *   （待處理：實線＋角標；追蹤中：虛線外框緩慢流動；已解決：亮度 55%）；有照片：右上角相機角標。
 * 游標附近有照片的卡片最多 24 張顯示縮圖（thumbCache：同時 ≤ 24 張、離開視野 30 秒釋放）。
 */
import * as THREE from "three";
import type { HoloEngine, HoloWorld } from "../engine/engine";
import { advanceAnimTime, FOG_MIN_BRIGHTNESS } from "../engine/level";
import {
  CARD_HEIGHT,
  clampDay,
  DOT_WEEKS,
  FULL_CARD_CAP,
  lodRanges,
  rangeSize,
  SPIRAL_RADIUS,
  type LodRanges,
  type SpiralModel,
  zOfDay,
  DAYS_PER_TURN,
} from "../engine/spiral";
import { MAX_LIVE, ThumbCache } from "../engine/thumbCache";
import { loadThumb, thumbKey, type ThumbTexture } from "../engine/thumbLoader";

/** 縮圖顯示範圍：游標前後幾天內、有照片的卡片 */
export const THUMB_DAY_RADIUS = 3;

const CARD_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute float iRot;
attribute vec4 iData; // x: 嚴重度 0–3, y: 狀態 0–2, z: 有照片, w: 未使用
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying vec2 vSize;
varying vec4 vData;
varying float vFog;
void main() {
  float c = cos(iRot);
  float s = sin(iRot);
  vec2 l = position.xy * iSize;
  vec3 wp = iPos + vec3(c * l.x - s * l.y, s * l.x + c * l.y, 0.0);
  vec4 mv = modelViewMatrix * vec4(wp, 1.0);
  vUv = position.xy + 0.5;
  vSize = iSize;
  vData = iData;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const CARD_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSev[4];
uniform float uTime;
uniform float uMinBright;
uniform float uBorder;
varying vec2 vUv;
varying vec2 vSize;
varying vec4 vData;
varying float vFog;
void main() {
  vec2 p = vUv * vSize;
  vec2 d = min(p, vSize - p);
  float edge = min(d.x, d.y);
  float w = fwidth(edge);
  float border = 1.0 - smoothstep(uBorder - w, uBorder + w, edge);
  float status = vData.y;
  if (status > 0.5 && status < 1.5) {
    // 追蹤中：虛線外框，沿對角方向緩慢流動
    border *= step(0.5, fract((p.x + p.y) * 2.5 - uTime * 0.35));
  }
  float mark = 0.0;
  if (status < 0.5) mark = step(p.x, 0.16) * step(p.y, 0.16); // 待處理：左下角標
  if (vData.z > 0.5) mark = max(mark, step(vSize.x - 0.2, p.x) * step(vSize.y - 0.14, p.y)); // 有照片：右上角標
  float film = 0.06;
  float a = max(max(border, mark), film);
  int si = int(vData.x + 0.5);
  vec3 col = uSev[0];
  if (si == 1) col = uSev[1];
  else if (si == 2) col = uSev[2];
  else if (si == 3) col = uSev[3];
  float bright = status > 1.5 ? 0.55 : 1.0;
  a *= bright * mix(1.0, uMinBright, vFog);
  gl_FragColor = vec4(col, a);
}`;

const DOT_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iData; // x: 嚴重度, y: 狀態
uniform float uSize;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vData;
varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * uSize;
  vData = iData;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const DOT_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSev[4];
uniform float uMinBright;
varying vec2 vData;
varying float vFog;
void main() {
  int si = int(vData.x + 0.5);
  vec3 col = uSev[0];
  if (si == 1) col = uSev[1];
  else if (si == 2) col = uSev[2];
  else if (si == 3) col = uSev[3];
  float bright = vData.y > 1.5 ? 0.55 : 1.0;
  gl_FragColor = vec4(col, 0.8 * bright * mix(1.0, uMinBright, vFog));
}`;

export interface SpiralCounts {
  fullCards: number;
  dots: number;
  tickLines: number;
  cursorDay: number;
}

export interface SpiralWorld extends HoloWorld {
  setCursor(day: number): void;
  moveCursor(deltaDays: number): void;
  cursor(): number;
  counts(): SpiralCounts;
  thumbs(): { decoding: number; resident: number; queued: number; started: number; released: number; slots: number; shown: number };
}

export function createSpiralWorld(engine: HoloEngine, model: SpiralModel): SpiralWorld {
  const { colors } = engine;
  const root = new THREE.Group();
  const items = model.items;
  const sev = colors.severity.map((c) => {
    const col = new THREE.Color(c);
    return new THREE.Vector3(col.r, col.g, col.b);
  });
  const fogNear = 20;
  const fogFar = 260;
  const fogUniforms = { uFogNear: { value: fogNear }, uFogFar: { value: fogFar }, uMinBright: { value: FOG_MIN_BRIGHTNESS } };

  /* ---- 完整卡片 ---- */
  const plane = new THREE.PlaneGeometry(1, 1);
  const cardGeo = new THREE.InstancedBufferGeometry();
  cardGeo.index = plane.index;
  cardGeo.setAttribute("position", plane.getAttribute("position"));
  const cPos = new THREE.InstancedBufferAttribute(new Float32Array(FULL_CARD_CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const cSize = new THREE.InstancedBufferAttribute(new Float32Array(FULL_CARD_CAP * 2), 2).setUsage(THREE.DynamicDrawUsage);
  const cRot = new THREE.InstancedBufferAttribute(new Float32Array(FULL_CARD_CAP), 1).setUsage(THREE.DynamicDrawUsage);
  const cData = new THREE.InstancedBufferAttribute(new Float32Array(FULL_CARD_CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
  cardGeo.setAttribute("iPos", cPos);
  cardGeo.setAttribute("iSize", cSize);
  cardGeo.setAttribute("iRot", cRot);
  cardGeo.setAttribute("iData", cData);
  cardGeo.instanceCount = 0;
  const cardMat = new THREE.ShaderMaterial({
    vertexShader: CARD_VERT,
    fragmentShader: CARD_FRAG,
    uniforms: { uSev: { value: sev }, uTime: { value: 0 }, uBorder: { value: 0.045 }, ...fogUniforms },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cards = new THREE.Mesh(cardGeo, cardMat);
  cards.frustumCulled = false;
  root.add(cards);

  /* ---- 小方點 ---- */
  const dotCap = Math.min(items.length, 11 * (2 * DOT_WEEKS * DAYS_PER_TURN + 1));
  const dotGeo = new THREE.InstancedBufferGeometry();
  dotGeo.index = plane.index;
  dotGeo.setAttribute("position", plane.getAttribute("position"));
  const dPos = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, dotCap) * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const dData = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, dotCap) * 2), 2).setUsage(THREE.DynamicDrawUsage);
  dotGeo.setAttribute("iPos", dPos);
  dotGeo.setAttribute("iData", dData);
  dotGeo.instanceCount = 0;
  const dotMat = new THREE.ShaderMaterial({
    vertexShader: DOT_VERT,
    fragmentShader: DOT_FRAG,
    uniforms: { uSev: { value: sev }, uSize: { value: 0.28 }, ...fogUniforms },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const dots = new THREE.Mesh(dotGeo, dotMat);
  dots.frustumCulled = false;
  root.add(dots);

  /* ---- 每週刻度線（預先建好全部週，游標移動只改 drawRange） ---- */
  const tickPos = new Float32Array(model.weeks.length * 6);
  model.weeks.forEach((w, i) => {
    const theta = (2 * Math.PI * (w.startDay + DAYS_PER_TURN / 2)) / DAYS_PER_TURN;
    const r0 = SPIRAL_RADIUS - 0.6;
    const r1 = SPIRAL_RADIUS + 0.6;
    tickPos.set([r0 * Math.cos(theta), r0 * Math.sin(theta), w.z, r1 * Math.cos(theta), r1 * Math.sin(theta), w.z], i * 6);
  });
  const tickAttr = new THREE.BufferAttribute(tickPos, 3);
  const mkTickGeo = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", tickAttr);
    g.setDrawRange(0, 0);
    return g;
  };
  const tickMat = new THREE.LineBasicMaterial({ color: new THREE.Color(colors.accent).getHex(), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false });
  const tickBeforeGeo = mkTickGeo();
  const tickAfterGeo = mkTickGeo();
  const tickBefore = new THREE.LineSegments(tickBeforeGeo, tickMat);
  const tickAfter = new THREE.LineSegments(tickAfterGeo, tickMat);
  tickBefore.frustumCulled = false;
  tickAfter.frustumCulled = false;
  root.add(tickBefore, tickAfter);

  /* ---- 縮圖槽 ---- */
  const thumbCache = new ThumbCache<ThumbTexture>({ load: loadThumb });
  const thumbPlane = new THREE.PlaneGeometry(1, 1);
  const uv = thumbPlane.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)); // ImageBitmap 不翻轉：幾何翻轉 v
  interface Slot {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    key: string | null;
    idx: number;
    shownTex: THREE.Texture | null;
  }
  const slots: Slot[] = [];
  for (let i = 0; i < MAX_LIVE; i++) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false });
    const mesh = new THREE.Mesh(thumbPlane, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    root.add(mesh);
    slots.push({ mesh, mat, key: null, idx: -1, shownTex: null });
  }

  /* ---- 游標與更新 ---- */
  let cursorDay = items.length ? model.maxDay : 0;
  let smoothDay = cursorDay;
  let lastRanges: LodRanges | null = null;
  const counts: SpiralCounts = { fullCards: 0, dots: 0, tickLines: 0, cursorDay };
  let sweepAt = 0;
  let animSec = 0; // 只在 engine.animating 時推進：減少動態效果或強度「關」時虛線外框靜止

  const writeCard = (slot: number, i: number) => {
    const it = items[i]!;
    cPos.setXYZ(slot, it.x, it.y, it.z);
    cSize.setXY(slot, it.width, CARD_HEIGHT);
    cRot.setX(slot, it.rot);
    cData.setXYZW(slot, it.severity, it.status, it.photoCount > 0 ? 1 : 0, 0);
  };

  const refresh = () => {
    if (!items.length) return;
    const r = lodRanges(model, cursorDay);
    lastRanges = r;
    let n = 0;
    for (let i = r.full[0]; i < r.full[1]; i++) writeCard(n++, i);
    cardGeo.instanceCount = n;
    cPos.needsUpdate = cSize.needsUpdate = cRot.needsUpdate = cData.needsUpdate = true;
    let m = 0;
    for (const [a, b] of [r.dotsBefore, r.dotsAfter] as const) {
      for (let i = a; i < b && m < dotCap; i++) {
        const it = items[i]!;
        dPos.setXYZ(m, it.x, it.y, it.z);
        dData.setXY(m, it.severity, it.status);
        m++;
      }
    }
    dotGeo.instanceCount = m;
    dPos.needsUpdate = dData.needsUpdate = true;
    tickBeforeGeo.setDrawRange(r.ticksBefore[0] * 2, rangeSize(r.ticksBefore) * 2);
    tickAfterGeo.setDrawRange(r.ticksAfter[0] * 2, rangeSize(r.ticksAfter) * 2);
    counts.fullCards = n;
    counts.dots = m;
    counts.tickLines = rangeSize(r.ticksBefore) + rangeSize(r.ticksAfter);
    counts.cursorDay = cursorDay;
    assignThumbs(r);
  };

  /** 游標附近有照片的卡片（由近到遠，最多 24 張）→ 縮圖槽 */
  const assignThumbs = (r: LodRanges) => {
    const want: { idx: number; key: string; d: number }[] = [];
    for (let i = r.full[0]; i < r.full[1]; i++) {
      const it = items[i]!;
      if (!it.firstPhoto) continue;
      const d = Math.abs(it.day - cursorDay);
      if (d > THUMB_DAY_RADIUS) continue;
      want.push({ idx: i, key: thumbKey(it.date, it.firstPhoto), d });
    }
    want.sort((a, b) => a.d - b.d);
    const chosen = want.slice(0, MAX_LIVE);
    const keys = chosen.map((w) => w.key);
    thumbCache.setVisible(keys);
    const have = new Map(slots.filter((s) => s.key).map((s) => [s.key!, s]));
    const free = slots.filter((s) => !s.key || !keys.includes(s.key));
    for (const s of free) {
      s.key = null;
      s.idx = -1;
      s.mesh.visible = false;
    }
    for (const w of chosen) {
      let s = have.get(w.key);
      if (!s) {
        s = free.shift();
        if (!s) continue;
        s.key = w.key;
      }
      s.idx = w.idx;
      const it = items[w.idx]!;
      s.mesh.position.set(it.x, it.y, it.z + 0.03);
      s.mesh.rotation.set(0, 0, it.rot);
    }
  };

  const syncSlots = () => {
    for (const s of slots) {
      if (!s.key) continue;
      const res = thumbCache.get(s.key);
      if (!res) {
        s.mesh.visible = false;
        continue;
      }
      if (s.shownTex !== res.texture) {
        s.mat.map = res.texture;
        s.mat.needsUpdate = true;
        s.shownTex = res.texture;
        const aspect = res.width / Math.max(1, res.height);
        const h = 1.1;
        s.mesh.scale.set(h * aspect, h, 1);
      }
      s.mesh.visible = true;
    }
  };

  const setCursor = (day: number) => {
    const next = clampDay(day, model);
    if (next === cursorDay && lastRanges) return;
    cursorDay = next;
    refresh();
  };

  refresh();
  if (items.length) {
    engine.rig.goal.set(0, 0, zOfDay(smoothDay, model.originT) - 6);
    engine.rig.target.copy(engine.rig.goal);
  }

  const world: SpiralWorld = {
    root,
    fog: [fogNear, fogFar],
    setCursor,
    moveCursor: (delta) => setCursor(cursorDay + delta),
    cursor: () => cursorDay,
    counts: () => counts,
    thumbs: () => {
      const st = thumbCache.stats();
      return { ...st, slots: slots.filter((s) => s.key).length, shown: slots.filter((s) => s.mesh.visible).length };
    },
    update(dtMs, nowMs) {
      animSec = advanceAnimTime(animSec, dtMs, engine.animating);
      cardMat.uniforms.uTime!.value = animSec;
      // 游標在軸線上的位置平滑追隨（減少動態效果：直接到位）
      const k = engine.reducedMotion ? 1 : 1 - Math.exp(-dtMs / 140);
      smoothDay += (cursorDay - smoothDay) * k;
      if (Math.abs(cursorDay - smoothDay) < 0.001) smoothDay = cursorDay;
      engine.rig.goal.z = zOfDay(smoothDay, model.originT) - 6;
      syncSlots();
      if (nowMs - sweepAt > 1000) {
        sweepAt = nowMs;
        thumbCache.sweep();
      }
    },
    dispose() {
      thumbCache.disposeAll();
      for (const s of slots) s.mat.dispose();
      thumbPlane.dispose();
      plane.dispose();
      cardGeo.dispose();
      dotGeo.dispose();
      tickBeforeGeo.dispose();
      tickAfterGeo.dispose();
      cardMat.dispose();
      dotMat.dispose();
      tickMat.dispose();
    },
  };
  return world;
}
