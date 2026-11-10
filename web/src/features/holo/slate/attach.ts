/*
 * 終端板的兩種定位方法（H1 比較）：
 *   P：每幀用 Vector3.project() 算出錨點的畫面座標，只在終端板自己身上設 transform: translate()；根節點不加 transform／filter。
 *   C：three 內建的 CSS3DRenderer，把終端板放進 3D 空間（會在 renderer 的容器與每個物件上設 matrix3d）。
 * 兩者內容完全相同（同一個 DOM 節點，由 Slate 元件經 portal 渲染進來）。
 * 「選字期間凍結」：isFrozen() 為 true 時兩種方法都不更新位置（設計師預設的 IME 因應）。
 */
import * as THREE from "three";
import { CSS3DObject, CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { CAMERA_FOV, type HoloEngine } from "../engine/engine";
import { movedEnough, placeSlate, SLATE_GAP, snapToDevicePixel, type Pt } from "./geometry";

export interface SlateStats {
  method: "proj" | "css3d";
  /** 方法本身寫 transform 的次數（P：每次 translate；C：CSS3DRenderer 的 render 次數，每次最多改 2 個以上元素） */
  writes: number;
  frames: number;
  frozenFrames: number;
  /** MutationObserver 數到的 style 屬性變動次數（只有開除錯時才有） */
  styleMutations: number;
}

export interface SlateHandle {
  stats: SlateStats;
  dispose(): void;
}

export interface SlateOptions {
  isFrozen: () => boolean;
  /** 方法 P：對齊裝置像素（預設開） */
  snap?: boolean;
  /** 方法 C：面向鏡頭（預設否＝固定在機台正面的平面，會隨世界旋轉而透視變形） */
  billboard?: boolean;
  /** 除錯：數 style 變動 */
  countMutations?: boolean;
}

function observeMutations(root: Element, stats: SlateStats): () => void {
  const mo = new MutationObserver((records) => {
    for (const r of records) if (r.attributeName === "style") stats.styleMutations++;
  });
  mo.observe(root, { attributes: true, attributeFilter: ["style"], subtree: true });
  return () => mo.disconnect();
}

export function attachProjectionSlate(engine: HoloEngine, el: HTMLElement, anchor: THREE.Vector3, opts: SlateOptions): SlateHandle {
  const stats: SlateStats = { method: "proj", writes: 0, frames: 0, frozenFrames: 0, styleMutations: 0 };
  el.style.position = "fixed";
  el.style.left = "0";
  el.style.top = "0";
  el.style.willChange = "transform";
  el.style.transform = "translate(-9999px,-9999px)";
  let size = { w: el.offsetWidth || 560, h: el.offsetHeight || 420 };
  const ro = new ResizeObserver(() => {
    size = { w: el.offsetWidth, h: el.offsetHeight };
  });
  ro.observe(el);
  const stopMo = opts.countMutations ? observeMutations(el, stats) : () => {};
  let prev: Pt | null = null;
  const out = { x: 0, y: 0, behind: false };
  const off = engine.onFrame(() => {
    stats.frames++;
    if (opts.isFrozen()) {
      stats.frozenFrames++;
      return;
    }
    engine.project(anchor, out);
    if (out.behind) return;
    const vp = engine.size;
    let p = placeSlate(out, size, { w: vp.width, h: vp.height });
    if (opts.snap !== false) p = snapToDevicePixel(p, vp.dpr);
    if (!movedEnough(prev, p)) return;
    prev = p;
    el.style.transform = `translate(${p.x}px,${p.y}px)`;
    stats.writes++;
  });
  return {
    stats,
    dispose() {
      off();
      ro.disconnect();
      stopMo();
      el.style.transform = "";
    },
  };
}

export function attachCss3dSlate(engine: HoloEngine, host: HTMLElement, el: HTMLElement, anchor: THREE.Vector3, opts: SlateOptions): SlateHandle {
  const stats: SlateStats = { method: "css3d", writes: 0, frames: 0, frozenFrames: 0, styleMutations: 0 };
  const renderer = new CSS3DRenderer();
  renderer.domElement.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none";
  renderer.domElement.dataset.holo = "css3d";
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const obj = new CSS3DObject(el);
  // 1 個 CSS px ＝ 鏡頭預設距離上的 1 個螢幕 px
  const { height } = engine.size;
  const unit = (2 * engine.rig.state.dist * Math.tan((CAMERA_FOV * Math.PI) / 360)) / Math.max(1, height);
  obj.scale.setScalar(unit);
  // 讓板子的左緣離錨點 SLATE_GAP px：板子中心在錨點右邊 (gap + 板寬/2) px
  const place = () => {
    const w = el.offsetWidth || 560;
    obj.position.copy(anchor).add(new THREE.Vector3((SLATE_GAP + w / 2) * unit, 0, 0));
  };
  place();
  scene.add(obj);
  const stopMo = opts.countMutations ? observeMutations(renderer.domElement, stats) : () => {};
  const resize = () => {
    const s = engine.size;
    renderer.setSize(s.width, s.height);
  };
  resize();
  const ro = new ResizeObserver(() => {
    resize();
    place();
  });
  ro.observe(host);
  const off = engine.onFrame(() => {
    stats.frames++;
    if (opts.isFrozen()) {
      stats.frozenFrames++;
      return;
    }
    if (opts.billboard) obj.quaternion.copy(engine.camera.quaternion);
    renderer.render(scene, engine.camera);
    stats.writes++;
  });
  return {
    stats,
    dispose() {
      off();
      ro.disconnect();
      stopMo();
      scene.remove(obj);
      renderer.domElement.remove();
    },
  };
}
