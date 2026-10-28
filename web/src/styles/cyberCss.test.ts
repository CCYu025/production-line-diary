import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CYBER_ONLY_TOKENS,
  CYBER_SCOPE,
  declarationMap,
  findContentWithoutAltText,
  findRule,
  findUnscopedSelectors,
  parseCss,
} from "@/test/cssRules";

/*
 * cyber.css 守門（docs/cyber-theme-spec.md §9.1 A6）：
 *   1. 每條規則（含 @media 內、巢狀的）的每個選擇器都以 :root[data-theme="cyber"] 開頭——
 *      這樣「開新視窗」的報表（<html> 沒有 data-theme）整份都不會被 cyber 影響。
 *   2. 所有 content 宣告都要有不朗讀的替代文字：content: "> " / "";
 * 之後各期往 cyber.css 加規則，不需要改這個測試，違規會自動被抓到。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const cyberCss = readFileSync(path.join(here, "cyber.css"), "utf8");
const indexCss = readFileSync(path.join(here, "index.css"), "utf8");

/** index.css 的標準淺色 :root 與 cyber 區塊的宣告（--token → 值）。單一真相來源在 index.css，這裡不寫死第二份。 */
const lightRoot = declarationMap(findRule(indexCss, ":root")!.declarations);
const cyberRoot = declarationMap(findRule(indexCss, CYBER_SCOPE)!.declarations);

describe("cyber.css", () => {
  it("有規則可檢查（檔案沒讀空）", () => {
    expect(parseCss(cyberCss).length).toBeGreaterThan(0);
  });

  it(`每個選擇器都以 ${CYBER_SCOPE} 開頭（含 @media 內與選擇器列表中的每一個）`, () => {
    expect(findUnscopedSelectors(cyberCss)).toEqual([]);
  });

  it("所有 content 宣告都有 / \"\" 替代文字", () => {
    expect(findContentWithoutAltText(cyberCss)).toEqual([]);
  });

  it("@media print 還原區段在檔尾：html／body 背景回白底、文字回黑色", () => {
    const rules = parseCss(cyberCss);
    const printRules = rules.filter((r) => r.context.some((c) => /^@media\s+print\b/.test(c)));
    expect(printRules.length).toBeGreaterThan(0);
    // 檔尾：最後一條規則在 @media print 裡，而且沒有任何非 print 的規則排在 print 之後
    const lastScreen = rules.map((r) => r.context.length === 0).lastIndexOf(true);
    const firstPrint = rules.findIndex((r) => r.context.some((c) => /^@media\s+print\b/.test(c)));
    expect(firstPrint).toBeGreaterThan(lastScreen);
    const restore = printRules.find((r) => r.selectors.includes(CYBER_SCOPE) && r.selectors.includes(`${CYBER_SCOPE} body`));
    expect(restore, "要有 html／body 的還原規則").toBeDefined();
    expect(restore!.declarations).toMatch(/background:\s*#fff\b/);
    expect(restore!.declarations).toMatch(/color:\s*#000\b/);
  });
});

describe("cyber.css 與報表／列印的隔離（值一律取自 index.css 標準淺色 :root）", () => {
  it("#report-output 內嚴重度四色還原成標準值（report.css 的 .rr-sev 色塊會用到，列印時 print-color-adjust: exact）", () => {
    const rule = findRule(cyberCss, `${CYBER_SCOPE} #report-output`);
    expect(rule, "要有 #report-output 的隔離還原規則").toBeDefined();
    const decls = declarationMap(rule!.declarations);
    expect(Object.keys(decls).sort()).toEqual(["--critical", "--good", "--serious", "--warning"]);
    for (const [name, value] of Object.entries(decls)) expect(value, name).toBe(lightRoot[name]);
  });

  it("@media print：cyber 區塊的全部色彩／圓角 token（扣掉 cyber 專用 token）都還原成標準淺色值，並設 color-scheme: light", () => {
    const rule = findRule(cyberCss, CYBER_SCOPE, true);
    expect(rule, "print 區段要有 token 還原規則").toBeDefined();
    const printDecls = declarationMap(rule!.declarations);
    expect(printDecls["color-scheme"]).toBe("light");

    const expected = Object.keys(cyberRoot).filter((n) => n.startsWith("--") && !CYBER_ONLY_TOKENS.includes(n.slice(2)));
    expect(expected.length).toBeGreaterThan(30); // 沒解析成空
    const missing = expected.filter((n) => !(n in printDecls));
    expect(missing, "print 區段漏還原的 token").toEqual([]);
    for (const name of expected) expect(printDecls[name], name).toBe(lightRoot[name]);

    // 沒有多餘的：print 區段只能放 color-scheme 與上述 token（不會把 cyber 專用 token 或亂七八糟的值塞進來）
    const extras = Object.keys(printDecls).filter((n) => n !== "color-scheme" && !expected.includes(n));
    expect(extras).toEqual([]);
  });

  it("@media print：保留白底黑字與 body 字型還原", () => {
    const rule = findRule(cyberCss, CYBER_SCOPE, true);
    expect(rule).toBeDefined();
    const both = parseCss(cyberCss).find((r) => r.context.length === 1 && r.selectors.length === 2 && r.selectors.includes(`${CYBER_SCOPE} body`));
    expect(declarationMap(both!.declarations)).toMatchObject({ background: "#fff", color: "#000" });
    const body = parseCss(cyberCss).find((r) => r.context.length === 1 && r.selectors.length === 1 && r.selectors[0] === `${CYBER_SCOPE} body`);
    expect(declarationMap(body!.declarations)["font-family"]).toContain("Noto Sans TC");
  });
});

describe("檢查函式本身（反例要抓得到）", () => {
  const S = CYBER_SCOPE;

  it("沒有 cyber 前綴的選擇器會被抓到", () => {
    expect(findUnscopedSelectors(`.card { color: red; }`)).toEqual([".card"]);
    expect(findUnscopedSelectors(`body { color: red; }`)).toEqual(["body"]);
  });

  it("選擇器列表中只要有一個沒前綴就會被抓到", () => {
    expect(findUnscopedSelectors(`${S} .a, .b { color: red; }`)).toEqual([".b"]);
    expect(findUnscopedSelectors(`${S} .a,\n  ${S} .b ,\n.c { color: red; }`)).toEqual([".c"]);
  });

  it("@media／@supports 裡的規則也會被檢查", () => {
    expect(findUnscopedSelectors(`@media (max-width: 767px) { .x { color: red; } ${S} .y { color: red; } }`)).toEqual([".x"]);
    expect(findUnscopedSelectors(`@media print { @supports (display: grid) { html { background: #fff; } } }`)).toEqual(["html"]);
  });

  it("前綴在 :is() 之類的括號裡不算開頭", () => {
    expect(findUnscopedSelectors(`.a:is(${S}) b { color: red; }`)).toEqual([`.a:is(${S}) b`]);
  });

  it("符合規則的不會誤報（含括號內的逗號、註解、@keyframes 的影格）", () => {
    const ok = `
      /* .not-a-rule { color: red } */
      ${S} body { font-family: "IBM Plex Mono", "Noto Sans TC"; }
      ${S} :is(a, button):hover { color: var(--accent-text); }
      @keyframes blink { from { opacity: 0; } 50% { opacity: 1; } to { opacity: 0; } }
      @media print { ${S}, ${S} body { background: #fff; } }
    `;
    expect(findUnscopedSelectors(ok)).toEqual([]);
  });

  it("沒有 / \"\" 替代文字的 content 會被抓到", () => {
    expect(findContentWithoutAltText(`${S} a::before { content: "> "; }`)).toEqual([`content: "> "`]);
    expect(findContentWithoutAltText(`${S} a::before { color: red; content: "//" }`)).toHaveLength(1);
    expect(findContentWithoutAltText(`${S} a::before { content: "a" / "b"; }`)).toHaveLength(1);
    expect(findContentWithoutAltText(`@media print { ${S} a::after { content: counter(x); } }`)).toHaveLength(1);
    expect(findContentWithoutAltText(`@keyframes k { to { content: "x"; } }`)).toHaveLength(1);
  });

  it("有 / \"\" 的 content、content: none、字串裡有分號與 !important 都正確處理", () => {
    expect(findContentWithoutAltText(`${S} a::before { content: "> " / ""; }`)).toEqual([]);
    expect(findContentWithoutAltText(`${S} a::before { content: "[" / "" !important; color: red; }`)).toEqual([]);
    expect(findContentWithoutAltText(`${S} a::before { content:"x;y"/"" }`)).toEqual([]);
    expect(findContentWithoutAltText(`${S} a::before { content: none; }`)).toEqual([]);
    expect(findContentWithoutAltText(`${S} a::before { content: ""; }`)).toHaveLength(1);
  });

  it("其他屬性名稱裡帶有 content 的不會誤判", () => {
    expect(findContentWithoutAltText(`${S} a { align-content: center; justify-content: end; }`)).toEqual([]);
  });
});
