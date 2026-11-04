/*
 * A 區 CRT 著色器（docs/os-mode-spec.md §4.7；X2 起強度由 uniform 決定，見 zones.ts 的 A_ZONE）。
 * uEffects＝1 時依序：桶狀弧面 → 色偏 → 掃描線 → 映像管（Trinitron 直條，以裝置像素計算）→ 螢光暈開 → 暗角 → 閃爍。
 * uEffects＝0（強度「關」）：只有低解析度放大，直接輸出，沒有任何著色器效果。
 * 開機（§5.5，X2）：B3 亮線展開（uBand）與 B4 線框由中心向外描繪（uReveal）是這個 pass 的 uniform，不是疊層。
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
uniform sampler2D tScene;   // 低解析度場景（最近鄰）
uniform sampler2D tBloom;   // 同尺寸、已模糊（線性）
uniform vec2 uLow;          // 低解析度尺寸（像素）
uniform vec3 uPage;         // 弧面外填色（--page）
uniform float uTime;
uniform float uEffects;     // 1＝CRT 效果；0＝關（只放大）
uniform float uBloom;       // 暈開疊加強度（0＝不疊）
uniform float uVignette;    // 四角變暗比例
uniform float uBarrel;      // 桶狀弧面邊緣位移
uniform float uFlicker;     // 0 或 1（減少動態效果時 0）
uniform float uReveal;      // 開機 B4：由中心向外描繪的半徑（0..1）；>= 1 表示不遮
uniform float uBand;        // 開機 B3：暗光柵的半高（-1..1 的座標單位）；< 0 表示沒有
uniform float uBandW;       // 開機 B3：亮線與暗光柵的半寬
uniform float uLine;        // 亮線亮度（1＝最亮）
uniform float uGlow;        // 暗光柵亮度（<= 亮線的 20%）
uniform vec3 uBandColor;    // 亮線顏色（由 --accent 往白色混）
varying vec2 vUv;

const float CA = 0.6;           // 色偏：紅藍反向各 0.6 個低解析度像素（<= 0.7）

void main() {
  vec2 c = vUv * 2.0 - 1.0;
  vec2 cc = c;
  vec3 col;
  if (uEffects > 0.5) {
    // 1. 桶狀弧面
    cc *= 1.0 + uBarrel * dot(c, c);
  }
  vec2 uv = cc * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(uPage, 1.0);
    return;
  }

  if (uEffects > 0.5) {
    // 2. 色偏（水平，低解析度像素為單位）
    float dx = CA / uLow.x;
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
  } else {
    col = texture2D(tScene, uv).rgb;
  }

  // 開機 B4：線框由中心向外描繪（遮罩外是背景色；場景背景本來就是 --page，所以揭曉完成後與沒有遮罩完全相同）
  if (uReveal < 1.0) {
    float aspect = uLow.x / uLow.y;
    vec2 p = vec2(c.x * aspect, c.y);
    float d = length(p) / length(vec2(aspect, 1.0));       // 中心 0 → 四角 1
    float edgeR = uReveal * 1.04;
    float m = 1.0 - smoothstep(edgeR - 0.025, edgeR, d);
    col = mix(uPage, col, m);
  }
  // 開機 B3：一條細亮線由中心向兩側展開到整個寬度，再垂直打開成「暗」光柵（只有線是亮的）；B4 時光柵逐漸淡出、與線框描繪交疊（沒有黑畫面）
  if (uBand >= 0.0) {
    float inX = 1.0 - smoothstep(uBandW, uBandW + 0.01, abs(c.x));
    float rect = inX * (1.0 - smoothstep(uBand, uBand + 0.01, abs(c.y)));
    float line = inX * (1.0 - smoothstep(0.004, 0.011, abs(c.y)));
    col = mix(col, uBandColor, rect * uGlow);
    col = mix(col, uBandColor, line * uLine);
  }

  if (uEffects > 0.5) {
    // 6. 暗角
    float r = length(vUv * 2.0 - 1.0) / 1.41421356;
    col *= 1.0 - uVignette * smoothstep(0.35, 1.0, r);

    // 7. 閃爍：全畫面亮度 ±1.5% 不規則跳動
    float f = sin(uTime * 37.0) * 0.5 + sin(uTime * 91.3 + 1.7) * 0.3 + sin(uTime * 13.1 + 4.2) * 0.2;
    col *= 1.0 + 0.015 * f * uFlicker;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;
