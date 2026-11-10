/*
 * 機台場景（H1 雛形）：把 machineGeometry 的零件變成全像線框（LineSegments2＋薄膜）。
 * 點擊零件（位移 < 4px 放開）→ 選中：線寬 2.5px 並加外光暈；點空白處取消。
 */
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { HoloEngine, HoloWorld } from "../engine/engine";
import { buildMachine, PANEL_ANCHOR, segmentCount, type MachinePart } from "./machineGeometry";

export interface MachineWorld extends HoloWorld {
  /** 終端板的錨點（世界座標） */
  anchor: THREE.Vector3;
  /** 點到畫面 (clientX, clientY)：回傳選中的零件名稱或 null，並更新選取 */
  pick(clientX: number, clientY: number): string | null;
  selected(): string | null;
  segments: number;
}

export function createMachineWorld(engine: HoloEngine): MachineWorld {
  const { colors, materials } = engine;
  const parts: MachinePart[] = buildMachine();
  const root = new THREE.Group();
  const baseMat = materials.line({ color: colors.accent, opacity: 0.85 });
  const dimMat = materials.line({ color: colors.accent, opacity: 0.5 });
  const selMat = materials.selectedLine(colors.accent);
  const glowMat = materials.glowLine(colors.accent);
  const filmMat = materials.film(colors.accent);
  const alertMat = materials.line({ color: colors.severity[2], opacity: 0.9 });

  interface Entry {
    part: MachinePart;
    line: LineSegments2;
    glow: LineSegments2;
    geo: LineSegmentsGeometry;
    film: THREE.Mesh | null;
    filmGeo: THREE.BufferGeometry | null;
    box: THREE.Box3;
  }
  const entries: Entry[] = [];
  for (const part of parts) {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(part.lines);
    const line = new LineSegments2(geo, part.name === "管線" || part.name === "輸送帶" ? dimMat : baseMat);
    line.frustumCulled = false;
    const glow = new LineSegments2(geo, glowMat);
    glow.frustumCulled = false;
    glow.visible = false;
    let film: THREE.Mesh | null = null;
    let filmGeo: THREE.BufferGeometry | null = null;
    if (part.faces.length) {
      filmGeo = new THREE.BufferGeometry();
      filmGeo.setAttribute("position", new THREE.Float32BufferAttribute(part.faces, 3));
      film = new THREE.Mesh(filmGeo, filmMat);
      film.frustumCulled = false;
      root.add(film);
    }
    root.add(glow, line);
    entries.push({ part, line, glow, geo, film, filmGeo, box: new THREE.Box3(new THREE.Vector3(...part.min), new THREE.Vector3(...part.max)) });
  }

  // 面板上的警示燈（嚴重度色，讀 token）：三個小方塊
  const [ax, ay, az] = PANEL_ANCHOR;
  const lamp: number[] = [];
  for (let i = 0; i < 3; i++) {
    const x = ax + 0.9 + i * 0.22;
    const y = ay + 1.55;
    lamp.push(x, y, az + 0.03, x + 0.14, y, az + 0.03, x + 0.14, y, az + 0.03, x + 0.14, y + 0.14, az + 0.03, x + 0.14, y + 0.14, az + 0.03, x, y + 0.14, az + 0.03, x, y + 0.14, az + 0.03, x, y, az + 0.03);
  }
  const lampGeo = new LineSegmentsGeometry();
  lampGeo.setPositions(lamp);
  const lampLine = new LineSegments2(lampGeo, alertMat);
  lampLine.frustumCulled = false;
  root.add(lampLine);

  let selected: Entry | null = null;
  const select = (e: Entry | null) => {
    if (selected) {
      selected.line.material = selected.part.name === "管線" || selected.part.name === "輸送帶" ? dimMat : baseMat;
      selected.glow.visible = false;
    }
    selected = e;
    if (e) {
      e.line.material = selMat;
      e.glow.visible = true;
    }
  };

  const ray = new THREE.Raycaster();
  const hit = new THREE.Vector3();
  const world: MachineWorld = {
    root,
    fog: [22, 60],
    anchor: new THREE.Vector3(...PANEL_ANCHOR),
    segments: segmentCount(parts),
    pick(clientX, clientY) {
      const r = engine.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, engine.camera);
      let best: Entry | null = null;
      let bestD = Infinity;
      for (const e of entries) {
        if (ray.ray.intersectBox(e.box, hit)) {
          const d = hit.distanceTo(ray.ray.origin);
          if (d < bestD) {
            bestD = d;
            best = e;
          }
        }
      }
      select(best === selected ? null : best);
      return selected?.part.name ?? null;
    },
    selected: () => selected?.part.name ?? null,
    dispose() {
      for (const e of entries) {
        e.geo.dispose();
        e.filmGeo?.dispose();
      }
      lampGeo.dispose();
    },
  };
  return world;
}
