/*
 * A 區 CRT 著色器（docs/os-mode-spec.md §4.7，X0：固定「標準」強度）。
 * 依序：桶狀弧面 → 色偏 → 掃描線 → 映像管（Trinitron 直條，以裝置像素計算）→ 螢光暈開 → 暗角 → 閃爍。
 * 沒有磷光殘影（X3）。
 */

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** 9 點高斯模糊（單向）。 */
export const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uDir; // 一個低解析度像素的 uv 位移（水平或垂直）
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSource, vUv).rgb * 0.2270270270;
  c += texture2D(tSource, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSource, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSource, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSource, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

export const CRT_FRAG = /* glsl */ `
uniform sampler2D tScene;   // 640x360（最近鄰）
uniform sampler2D tBloom;   // 同尺寸、已模糊（線性）
uniform vec2 uLow;          // 低解析度尺寸（像素）
uniform vec3 uPage;         // 弧面外填色（--page）
uniform float uTime;
uniform float uBloom;       // 0 或 1
uniform float uFlicker;     // 0 或 1（減少動態效果時 0）
varying vec2 vUv;

const float CURVE = 0.03;       // 邊緣最大位移約 3%
const float CA = 0.6;           // 色偏：紅藍反向各 0.6 個低解析度像素（<= 0.7）
const float VIGNETTE = 0.25;    // 四角變暗約 25%

void main() {
  // 1. 桶狀弧面
  vec2 c = vUv * 2.0 - 1.0;
  c *= 1.0 + CURVE * dot(c, c);
  vec2 uv = c * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(uPage, 1.0);
    return;
  }

  // 2. 色偏（水平，低解析度像素為單位）
  float dx = CA / uLow.x;
  vec3 col;
  col.r = texture2D(tScene, uv + vec2(dx, 0.0)).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - vec2(dx, 0.0)).b;

  // 3. 掃描線：每列低解析度像素之間有暗縫，亮度越高暗縫越窄
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float rowPos = fract(uv.y * uLow.y);
  float edge = abs(rowPos - 0.5) * 2.0;           // 列中心 0 → 列邊界 1
  float gap = mix(0.55, 0.12, clamp(lum * 2.5, 0.0, 1.0));
  float scan = 1.0 - 0.7 * smoothstep(1.0 - gap, 1.0, edge);
  col *= scan;

  // 4. Trinitron 紅綠藍細直條（裝置像素，週期 3 個裝置像素）
  float stripe = mod(floor(gl_FragCoord.x), 3.0);
  vec3 mask = vec3(0.78) + 0.22 * vec3(step(stripe, 0.5), step(0.5, stripe) * step(stripe, 1.5), step(1.5, stripe));
  col *= mask;

  // 5. 螢光暈開
  col += texture2D(tBloom, uv).rgb * 0.9 * uBloom;

  // 6. 暗角
  float r = length(vUv * 2.0 - 1.0) / 1.41421356;
  col *= 1.0 - VIGNETTE * smoothstep(0.35, 1.0, r);

  // 7. 閃爍：全畫面亮度 ±1.5% 不規則跳動
  float f = sin(uTime * 37.0) * 0.5 + sin(uTime * 91.3 + 1.7) * 0.3 + sin(uTime * 13.1 + 4.2) * 0.2;
  col *= 1.0 + 0.015 * f * uFlicker;

  gl_FragColor = vec4(col, 1.0);
}
`;
