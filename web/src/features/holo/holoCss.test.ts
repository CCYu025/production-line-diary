import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCss } from "@/test/cssRules";

/*
 * holo.css 守門（docs/holo-mode-spec.md §11.1 HA2 雛形）：
 *   1. 每條規則的每個選擇器都以 :root[data-mode="holo"] 開頭。
 *   2. 檔尾是 @media print，且隱藏所有全像元素。
 *   3. 不寫死色碼；data-fx 只出現在終端板內，用來蓋回共用元件（Combobox）的 Cyber 特效。
 */
const SCOPE = ':root[data-mode="holo"]';
const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "holo.css"), "utf8");

describe("holo.css", () => {
  const rules = parseCss(css);
  it("有規則可檢查", () => expect(rules.length).toBeGreaterThan(8));
  it(`每個選擇器都以 ${SCOPE} 開頭`, () => {
    const bad = rules.flatMap((r) => r.selectors).filter((s) => !s.startsWith(SCOPE));
    expect(bad).toEqual([]);
  });
  it("最後一條頂層區塊是 @media print", () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(stripped.lastIndexOf("@media print")).toBeGreaterThan(0);
    expect(stripped.endsWith("}")).toBe(true);
    const isPrint = (r: (typeof rules)[number]) => r.context.some((c) => /^@media\s+print\b/.test(c));
    const first = rules.findIndex(isPrint);
    expect(first).toBeGreaterThan(0);
    expect(rules.slice(first).filter((r) => !isPrint(r))).toEqual([]);
  });
  it("@media print 隱藏所有全像元素", () => {
    const hidden = rules
      .filter((r) => r.context.some((c) => /^@media\s+print\b/.test(c)) && /display:\s*none/.test(r.declarations))
      .flatMap((r) => r.selectors);
    for (const must of [".holo-root", ".holo-world", ".holo-slate-host", ".holo-slate", ".holo-lab-hud"]) expect(hidden, must).toContain(`${SCOPE} ${must}`);
  });
  it("沒有寫死的色碼", () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/\b(rgb|hsl)a?\(/);
  });
  it("data-fx 只出現在終端板內、用來蓋回共用元件的 Cyber 特效（combobox 提示符、pop 動畫）", () => {
    const withFx = rules.filter((r) => r.selectors.some((s) => s.includes("data-fx")));
    expect(withFx.length).toBeGreaterThan(0);
    for (const r of withFx) for (const s of r.selectors) expect(s.startsWith(`${SCOPE} .holo-slate `), s).toBe(true);
    const decl = (sel: string) => withFx.filter((r) => r.selectors.includes(sel)).map((r) => r.declarations).join(";");
    expect(decl(`${SCOPE} .holo-slate [data-fx="combobox"]::before`)).toMatch(/content:\s*none/);
    expect(decl(`${SCOPE} .holo-slate [data-fx="pop"]`)).toMatch(/animation:\s*none/);
  });
});
