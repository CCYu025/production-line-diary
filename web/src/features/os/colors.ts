/*
 * 從 Cyber token 讀色彩（docs/os-mode-spec.md §4.1：3D 場景與疊層在初始化時以 getComputedStyle 讀 token，不寫死色碼）。
 */

export interface OsColors {
  page: string;
  line: string;
  lineStrong: string;
  accent: string;
  ink: string;
  /** --ink-muted：安靜的文字色（已解決的雷達光點用它往 --page 混） */
  inkMuted: string;
}

export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function readOsColors(): OsColors {
  return {
    page: readToken("--page"),
    line: readToken("--line"),
    lineStrong: readToken("--line-strong"),
    accent: readToken("--accent"),
    ink: readToken("--ink-1"),
    inkMuted: readToken("--ink-muted"),
  };
}

export type Rgb = [number, number, number];

/** CSS 色彩字串 → [r,g,b]（0–255）。支援 #rgb／#rrggbb／rgb()；其他格式交給瀏覽器解析。 */
export function parseCssColor(value: string): Rgb {
  const v = value.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) {
    const h = m[1]!;
    return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16)];
  }
  m = /^#([0-9a-f]{6})/i.exec(v);
  if (m) {
    const h = m[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  // 其他格式：讓瀏覽器算出 rgb()
  const el = document.createElement("span");
  el.style.color = v;
  document.documentElement.appendChild(el);
  const computed = getComputedStyle(el).color;
  el.remove();
  const again = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(computed);
  return again ? [Number(again[1]), Number(again[2]), Number(again[3])] : [0, 0, 0];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const rgbCss = (c: Rgb, alpha = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
