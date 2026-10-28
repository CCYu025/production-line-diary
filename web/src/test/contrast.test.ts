import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STEP_CLASS } from "@/features/calendar/calendarModel";

/*
 * 對比度守門：直接讀 styles/index.css 裡的色票，確認文字色在各底色上 ≥ 4.5:1（WCAG AA）。
 * 以後調色票如果讓 ink-muted 又變回難讀，這裡會失敗。
 */

// 先拿掉註解：註解裡會提到選擇器（例如 :root[data-theme="cyber"]），不能讓 indexOf 先撞到它們。
const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../styles/index.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** 取出某個區塊（從 selector 起、到對應的 } 為止）的內容 */
function blockOf(startMarker: string): string {
  const start = css.indexOf(startMarker);
  if (start < 0) throw new Error(`找不到 ${startMarker}`);
  const open = css.indexOf("{", start);
  const end = css.indexOf("}", open);
  return css.slice(open, end);
}

/** 取出某個區塊裡的 --token: #hex 宣告 */
function tokens(startMarker: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of blockOf(startMarker).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]!] = m[2]!;
  return out;
}

/** 取出某個區塊定義的所有 token 名稱（不分值的格式） */
function tokenNames(startMarker: string): Set<string> {
  return new Set([...blockOf(startMarker).matchAll(/(?:^|[;{\s])--([\w-]+)\s*:/g)].map((m) => m[1]!));
}

const light = tokens(":root {");
const dark = { ...light, ...tokens(':root[data-theme="dark"]') };
// 系統深色（media query）那一組必須跟手動 data-theme="dark" 完全一致
const darkMedia = { ...light, ...tokens(':root:not([data-theme="light"])') };
const CYBER = ':root[data-theme="cyber"]';
// Cyber-Terminal（永遠深色）；用淺色當底只是為了型別，A2 另外保證它自己定義了全部 token
const cyber = { ...light, ...tokens(CYBER) };

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const THEMES = { 淺色: light, 深色: dark, cyber } as const;

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

  describe("cyber：嚴重度四色（文字／色塊都要能在三種底色上辨識）", () => {
    for (const bg of ["page", "surface", "surface-raised"] as const) {
      it(`good / warning / serious / critical 在 ${bg} 上 ≥ 4.5`, () => {
        for (const fg of ["good", "warning", "serious", "critical"] as const) {
          expect(contrast(cyber[fg]!, cyber[bg]!), `${fg} 在 ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  });

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

/** cyber 專用 token（規格 §4.2）：只在 cyber 區塊定義，標準主題不引用，所以不必出現在淺色 :root。 */
const CYBER_ONLY_TOKENS = ["glow-accent", "glow-critical", "text-glow", "scan-opacity", "grid-dot", "cut-sm", "cut-md"];
/** 動態 token（規格 §4.4）：定義在 :root，所有主題共用，cyber 區塊不重複定義。 */
const SHARED_MOTION_TOKENS = ["dur-instant", "dur-fast", "dur-base", "dur-slow", "ease-out", "ease-in", "ease-glitch", "stagger"];

describe("cyber 區塊的完整性與位置（規格 §3.2、§9.1 A2）", () => {
  const lightNames = tokenNames(":root {");
  const cyberNames = tokenNames(CYBER);

  it("定義的 token 名稱集合 = 淺色 :root 的集合（扣掉共用的動態 token），再加上白名單內的 cyber 專用 token", () => {
    const expected = new Set([...lightNames].filter((n) => !SHARED_MOTION_TOKENS.includes(n)));
    for (const n of CYBER_ONLY_TOKENS) expected.add(n);
    expect([...cyberNames].sort()).toEqual([...expected].sort());
  });

  it("沒有漏定義：淺色 :root 的每個色彩／圓角 token，cyber 都有定義", () => {
    const missing = [...lightNames].filter((n) => !SHARED_MOTION_TOKENS.includes(n) && !cyberNames.has(n));
    expect(missing).toEqual([]);
  });

  it("cyber 專用 token 與動態 token 不會跑進淺色 :root／交叉定義", () => {
    for (const n of CYBER_ONLY_TOKENS) expect(lightNames.has(n), `淺色 :root 不該有 ${n}`).toBe(false);
    for (const n of SHARED_MOTION_TOKENS) {
      expect(lightNames.has(n), `:root 要有 ${n}`).toBe(true);
      expect(cyberNames.has(n), `cyber 不該重複定義 ${n}`).toBe(false);
    }
  });

  it("圓角三個 token 在 cyber 都是 2px，淺色是 6／10／14px", () => {
    const cyberBlock = blockOf(CYBER);
    for (const n of ["r-sm", "r-md", "r-lg"]) expect(cyberBlock).toContain(`--${n}: 2px`);
    const rootBlock = blockOf(":root {");
    expect(rootBlock).toMatch(/--r-sm:\s*6px/);
    expect(rootBlock).toMatch(/--r-md:\s*10px/);
    expect(rootBlock).toMatch(/--r-lg:\s*14px/);
  });

  it("cyber 區塊位於系統深色 media 區塊與 data-theme=dark 區塊之後（特異度相同，後面的才會勝出）", () => {
    const mediaDark = css.indexOf(':root:not([data-theme="light"])');
    const manualDark = css.indexOf(':root[data-theme="dark"]');
    const cyberAt = css.indexOf(CYBER);
    expect(mediaDark).toBeGreaterThan(-1);
    expect(manualDark).toBeGreaterThan(mediaDark);
    expect(cyberAt).toBeGreaterThan(manualDark);
  });

  it("cyber 區塊自己宣告 color-scheme: dark（永遠深色）", () => {
    expect(blockOf(CYBER)).toMatch(/color-scheme:\s*dark/);
  });
});
