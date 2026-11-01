import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCss, splitTopLevel } from "@/test/cssRules";

/*
 * os.css 守門（docs/os-mode-spec.md §9.1 A3）：
 *   1. 每條規則的每個選擇器都以 :root[data-mode="os"] 開頭。
 *   2. 檔尾是 @media print，且隱藏所有 OS 元素。
 *   3. 不寫死色碼。
 */
const OS_SCOPE = ':root[data-mode="os"]';
const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "os.css"), "utf8");

describe("os.css", () => {
  const rules = parseCss(css);

  it("有規則可檢查", () => expect(rules.length).toBeGreaterThan(10));

  it(`每個選擇器都以 ${OS_SCOPE} 開頭`, () => {
    const bad = rules.flatMap((r) => r.selectors).filter((s) => !s.startsWith(OS_SCOPE));
    expect(bad).toEqual([]);
  });

  it("最後一條頂層區塊是 @media print", () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const lastAt = stripped.lastIndexOf("@media print");
    expect(lastAt).toBeGreaterThan(0);
    // @media print 之後不應再有最上層規則：它的結尾大括號就是檔尾
    expect(stripped.endsWith("}")).toBe(true);
    const printRules = rules.filter((r) => r.context.some((c) => /^@media\s+print\b/.test(c)));
    const nonPrintAfter = rules.slice(rules.indexOf(printRules[0]!)).filter((r) => !r.context.some((c) => /^@media\s+print\b/.test(c)));
    expect(nonPrintAfter).toEqual([]);
  });

  it("@media print 隱藏所有 OS 元素（3D、HUD、疊層、外框頂列、跳過連結）", () => {
    const hidden = rules
      .filter((r) => r.context.some((c) => /^@media\s+print\b/.test(c)) && /display:\s*none/.test(r.declarations))
      .flatMap((r) => r.selectors);
    for (const must of [".os-hub", ".os-hud", "#os-overlay", ".os-frame-bar", ".os-skip", "[data-os-chrome]"]) {
      expect(hidden, must).toContain(`${OS_SCOPE} ${must}`);
    }
  });

  it("沒有寫死的色碼（hex／rgb／hsl）", () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
    expect(body).not.toMatch(/\b(rgba?|hsla?)\(/);
  });

  it("疊層永遠 pointer-events: none", () => {
    const rule = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === `${OS_SCOPE} #os-overlay` && r.context.length === 0);
    expect(rule).toBeDefined();
    expect(splitTopLevel(rule!.declarations, ";").some((d) => /pointer-events:\s*none/.test(d))).toBe(true);
  });
});
