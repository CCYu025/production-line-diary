/*
 * 全像材質（docs/holo-mode-spec.md §4.2；H1 雛形）：只畫線、加色混合；面最多是 6% 不透明的 accent 薄膜；
 * 景深霧讓最遠的物件保留 15% 亮度；選中時線寬 2.5px 並加外光暈。線段沿用 Line2／LineSegments2。
 * 顏色一律由呼叫端從 Cyber token 讀進來（tokens.ts），這裡不寫死色碼。
 * 向量線框的顏色直接用 CSS token 的 sRGB 值，不做色彩管理轉換（與 OS 的 hubLines／pipeline 相同做法）。
 */
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { FILM_OPACITY, FOG_MIN_BRIGHTNESS, LINE_WIDTH_PX, LINE_WIDTH_SELECTED_PX } from "./level";

THREE.ColorManagement.enabled = false;

/** LineMaterial 的片段著色器：把標準霧（把顏色混向霧色）換成「亮度乘以 mix(1, 最低亮度, 霧係數)」，最遠處仍保留 FOG_MIN_BRIGHTNESS */
function withBrightnessFog(m: LineMaterial): void {
  m.fragmentShader = m.fragmentShader.replace(
    "#include <fog_fragment>",
    `#ifdef USE_FOG
      gl_FragColor.rgb *= mix( 1.0, ${FOG_MIN_BRIGHTNESS.toFixed(2)}, smoothstep( fogNear, fogFar, vFogDepth ) );
    #endif`,
  );
}

export interface HoloMaterialOptions {
  color: THREE.ColorRepresentation;
  /** 線寬（CSS px），預設 1.5 */
  widthPx?: number;
  /** 整體不透明度（用來表示「已解決」的 55% 亮度、不符合篩選的淡出等） */
  opacity?: number;
}

/** 管理同一個世界裡所有線材質：統一更新解析度（線寬是以螢幕像素計）與 DPR。 */
export class HoloMaterials {
  private readonly lineMats = new Set<LineMaterial>();
  private readonly others = new Set<THREE.Material>();
  private resolution = new THREE.Vector2(1, 1);
  private dpr = 1;

  setSize(widthDevicePx: number, heightDevicePx: number, dpr: number): void {
    this.resolution.set(widthDevicePx, heightDevicePx);
    this.dpr = dpr;
    for (const m of this.lineMats) {
      m.resolution.copy(this.resolution);
      m.linewidth = (m.userData.widthCssPx as number) * dpr;
    }
  }

  /** 加色混合的線材質（不寫深度；開啟霧：scene.fog 要設定） */
  line({ color, widthPx = LINE_WIDTH_PX, opacity = 1 }: HoloMaterialOptions): LineMaterial {
    const m = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: widthPx * this.dpr,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      fog: true,
    });
    withBrightnessFog(m);
    m.userData.widthCssPx = widthPx;
    m.resolution.copy(this.resolution);
    this.lineMats.add(m);
    return m;
  }

  /** 選中：2.5px 的線。 */
  selectedLine(color: THREE.ColorRepresentation): LineMaterial {
    return this.line({ color, widthPx: LINE_WIDTH_SELECTED_PX });
  }

  /** 選中的外光暈：更寬、更淡的同色線（疊在選中線下面） */
  glowLine(color: THREE.ColorRepresentation): LineMaterial {
    return this.line({ color, widthPx: 7, opacity: 0.22 });
  }

  /** 面：最多 6% 不透明度的 accent 薄膜（加色、不寫深度、雙面） */
  film(color: THREE.ColorRepresentation, opacity = FILM_OPACITY): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).getHex(),
      transparent: true,
      opacity: Math.min(FILM_OPACITY, opacity),
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.others.add(m);
    return m;
  }

  dispose(): void {
    for (const m of this.lineMats) m.dispose();
    for (const m of this.others) m.dispose();
    this.lineMats.clear();
    this.others.clear();
  }
}
