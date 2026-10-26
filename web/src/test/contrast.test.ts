import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STEP_CLASS } from "@/features/calendar/calendarModel";

/*
 * 對比度守門：直接讀 styles/index.css 裡的色票，確認文字色在各底色上 ≥ 4.5:1（WCAG AA）。
 * 以後調色票如果讓 ink-muted 又變回難讀，這裡會失敗。
 */

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../styles/index.css"), "utf8");

/** 取出某個區塊（從 selector 起、到對應的 } 為止）裡的 --token: #hex 宣告 */
function tokens(startMarker: string): Record<string, string> {
  const start = css.indexOf(startMarker);
  if (start < 0) throw new Error(`找不到 ${startMarker}`);
  const open = css.indexOf("{", start);
  const end = css.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const m of css.slice(open, end).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]!] = m[2]!;
  return out;
}

const light = tokens(":root {");
const dark = { ...light, ...tokens(':root[data-theme="dark"]') };
// 系統深色（media query）那一組必須跟手動 data-theme="dark" 完全一致
const darkMedia = { ...light, ...tokens(':root:not([data-theme="light"])') };

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const THEMES = { 淺色: light, 深色: dark } as const;

describe("設計 token 對比度（WCAG AA 文字 ≥ 4.5:1）", () => {
  it("深色（系統偏好）與 data-theme=dark 是同一組色票", () => {
    expect(darkMedia).toEqual(dark);
  });

  for (const [name, t] of Object.entries(THEMES)) {
    describe(name, () => {
      for (const bg of ["page", "surface", "surface-raised"] as const) {
        it(`ink-muted 在 ${bg} 上 ≥ 4.5`, () => {
          expect(contrast(t["ink-muted"]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
        });
        it(`ink-2 / ink-1 在 ${bg} 上 ≥ 4.5`, () => {
          expect(contrast(t["ink-2"]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t["ink-1"]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
        });
      }
      it("accent-text 在 page / surface-raised / accent-wash 上 ≥ 4.5", () => {
        for (const bg of ["page", "surface-raised", "accent-wash"] as const) {
          expect(contrast(t["accent-text"]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
        }
      });
      it("按鈕：accent-ink 在 accent 上、critical-ink 在 critical 上 ≥ 4.5", () => {
        expect(contrast(t["accent-ink"]!, t.accent!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["critical-ink"]!, t.critical!)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it("ink-muted 比舊 UI 的 #898781 更深／更亮到足夠（舊值在淺色只有約 3.4:1）", () => {
    expect(contrast("#898781", light.page!)).toBeLessThan(4.5);
    expect(contrast(light["ink-muted"]!, light.page!)).toBeGreaterThan(5);
  });
});

describe("日曆格（STEP_CLASS）的文字在底色上 ≥ 4.5:1（12px 的日期數字也要達標）", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    for (const [step, classes] of Object.entries(STEP_CLASS)) {
      it(`${name}：色階 ${step}（${classes}）`, () => {
        const bg = /bg-([\w-]+)/.exec(classes)![1]!;
        const fg = /text-([\w-]+)/.exec(classes)![1]!;
        expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
