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
  stripComments,
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

  it("@media print 還原區段在檔尾：html／body 底色與文字色用 var(--page)／var(--ink-1)（與標準淺色相同）", () => {
    const rules = parseCss(cyberCss);
    const printRules = rules.filter((r) => r.context.some((c) => /^@media\s+print\b/.test(c)));
    expect(printRules.length).toBeGreaterThan(0);
    // 檔尾：最後一條規則在 @media print 裡，而且沒有任何非 print 的規則排在 print 之後
    const lastScreen = rules.map((r) => r.context.length === 0).lastIndexOf(true);
    const firstPrint = rules.findIndex((r) => r.context.some((c) => /^@media\s+print\b/.test(c)));
    expect(firstPrint).toBeGreaterThan(lastScreen);
    const restore = findRule(cyberCss, `${CYBER_SCOPE} body`, true);
    expect(restore, "要有 body 的還原規則").toBeDefined();
    // 與標準淺色 body 相同：用語意 token（print 區段把 token 還原成標準淺色值），不寫死色碼
    expect(declarationMap(restore!.declarations)).toMatchObject({ background: "var(--page)", color: "var(--ink-1)" });
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

  it("@media print：保留與標準淺色 body 相同的底色／文字色（var(--page)／var(--ink-1)）與 body 字型還原", () => {
    const body = findRule(cyberCss, `${CYBER_SCOPE} body`, true);
    expect(body).toBeDefined();
    const decls = declarationMap(body!.declarations);
    expect(decls).toMatchObject({ background: "var(--page)", color: "var(--ink-1)" });
    expect(decls["font-family"]).toContain("Noto Sans TC");
    // 不寫死 #000／#fff（寫死的 #000 曾讓列印時 app 外殼的文字色跟標準淺色的 rgb(11,11,11) 不同）
    expect(cyberCss.slice(cyberCss.indexOf("@media print"))).not.toMatch(/(?:background|color)\s*:\s*#(?:000|fff)\b/i);
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

/*
 * P1 靜態外觀的守門（docs/cyber-theme-spec.md §5、§8）。以新增方式擴充，不動上面既有的斷言。
 */

const rules = parseCss(cyberCss);
const stripped = stripComments(cyberCss);
const inPrint = (r: { context: string[] }) => r.context.some((c) => /^@media\s+print\b/.test(c));
const screenRules = rules.filter((r) => !inPrint(r));
const printRules = rules.filter(inPrint);
const decl = (r: { declarations: string }) => declarationMap(r.declarations);
/** 螢幕規則（不含 @media）裡選擇器完全相等的規則 */
const screenRule = (selector: string) => screenRules.find((r) => r.selectors.length === 1 && r.selectors[0] === selector && r.context.length === 0);
const printRule = (selector: string) => printRules.find((r) => r.selectors.includes(selector));
const inMedia = (r: { context: string[] }, re: RegExp) => r.context.some((c) => re.test(c));

describe("cyber.css：背景點陣與掃描線（§5.1）", () => {
  const scan = screenRule(`${CYBER_SCOPE} body::after`);

  it("掃描線是 body::after：fixed、不擋點擊、z-index 高於 sonner 容器（999999999）、水平細線、透明度走 --scan-opacity", () => {
    expect(scan, "要有 body::after 掃描線規則").toBeDefined();
    const d = decl(scan!);
    expect(d["position"]).toBe("fixed");
    expect(d["inset"]).toBe("0");
    expect(d["pointer-events"]).toBe("none");
    expect(Number(d["z-index"])).toBeGreaterThan(999999999);
    expect(d["background"]).toMatch(/^repeating-linear-gradient\(/);
    expect(d["opacity"]).toBe("var(--scan-opacity)");
    expect(d["content"]).toBe('"" / ""');
  });

  it("點陣畫在 body 的 background-image，24px 間距、顏色是 --grid-dot", () => {
    const body = screenRule(`${CYBER_SCOPE} body`);
    expect(body).toBeDefined();
    const d = decl(body!);
    expect(d["background-image"]).toContain("radial-gradient(");
    expect(d["background-image"]).toContain("var(--grid-dot)");
    expect(d["background-size"]).toBe("24px 24px");
  });

  it("手機（< 768px）掃描線透明度降為 .015（覆寫 token，不新增 token 名稱）", () => {
    const mobile = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === CYBER_SCOPE && r.context.length === 1 && inMedia(r, /max-width:\s*767px/));
    expect(mobile, "手機區段要覆寫 --scan-opacity").toBeDefined();
    expect(decl(mobile!)["--scan-opacity"]).toBe("0.015");
  });
});

describe("cyber.css：P1 是靜態外觀（沒有動畫與 transition）", () => {
  it("沒有 @keyframes，也沒有 animation／transition 宣告（FX 屬於 P2／P3）", () => {
    expect(stripped).not.toMatch(/@keyframes/i);
    expect(stripped).not.toMatch(/(^|[\s;{])(animation|transition)[\w-]*\s*:/i);
  });
});

describe("cyber.css：只用屬性選擇器、不寫死色碼", () => {
  it("沒有任何 class 選擇器（Tailwind class 會變動，也會誤中報表）；只用 data-fx／data-variant／aria-*／id", () => {
    const withClass = rules.flatMap((r) => r.selectors).filter((s) => /(^|[\s>+~)\]])\.[A-Za-z_-]/.test(s.replace(/"[^"]*"/g, '""')));
    expect(withClass).toEqual([]);
  });

  it("螢幕規則的宣告不含色碼／rgb()／hsl()：顏色全部走 token（@media print 的還原與 #report-output 隔離除外）", () => {
    const hard = screenRules
      .filter((r) => !r.selectors.some((s) => s.includes("#report-output")))
      .flatMap((r) =>
        Object.entries(decl(r))
          .filter(([, v]) => /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(v))
          .map(([k, v]) => `${r.selectors[0]} { ${k}: ${v} }`),
      );
    expect(hard).toEqual([]);
  });

  it("引用的 data-fx 值都在規格 §3.3 的表裡（打錯字會被抓到）", () => {
    const known = new Set([
      "panel", "panel-cut", "nav-item", "nav-group", "brand", "fab", "topbar", "bar-row", "bar", "trend-col", "trend-bar", "cal-cell", "row",
      "page-title", "kpi-num", "field", "combobox", "error-msg", "check", "submit", "button", "seg", "sev", "sheet", "dialog", "pop", "tooltip",
      "skeleton", "error",
    ]);
    const used = [...stripped.matchAll(/\[data-fx="([^"]+)"\]/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((v) => !known.has(v))).toEqual([]);
  });
});

describe("cyber.css：panel-cut 切角面板（§5.3）", () => {
  const SEL = `${CYBER_SCOPE} [data-fx="panel-cut"]`;

  it("可聚焦的元素本身不加 clip-path／overflow（焦點環才不會被裁）；元素本身底色與框線透明", () => {
    const own = screenRules.filter((r) => r.selectors.some((s) => s.includes('[data-fx="panel-cut"]') && !s.includes("::")));
    expect(own.length).toBeGreaterThan(0);
    for (const r of own) {
      const d = decl(r);
      expect(d["clip-path"], `${r.selectors[0]} 本身不能有 clip-path`).toBeUndefined();
      expect(d["overflow"], `${r.selectors[0]} 本身不能有 overflow`).toBeUndefined();
    }
    const base = decl(screenRule(SEL)!);
    expect(base["background-color"]).toBe("transparent");
    expect(base["border-color"]).toBe("transparent");
    expect(base["position"]).toBe("relative"); // 0 筆時是 <div>，沒有 Tailwind 的 relative
    expect(base["isolation"]).toBe("isolate");
  });

  it("切角與底色／框線畫在 ::before（clip-path、右上與左下兩個切角、斜邊 45° 補線）；L 形角框畫在 ::after，不做 clip-path", () => {
    const before = decl(screenRule(`${SEL}::before`)!);
    expect(before["clip-path"]).toContain("polygon(");
    expect(before["clip-path"]).toContain("var(--pc-cut)");
    expect(before["z-index"]).toBe("-1");
    expect(before["background"]).toContain("to top right"); // 斜邊補線
    expect(before["box-shadow"]).toContain("inset");
    expect(before["content"]).toBe('"" / ""');
    const after = decl(screenRule(`${SEL}::after`)!);
    expect(after["clip-path"]).toBeUndefined();
    expect(after["z-index"]).toBe("-1");
    expect((after["background"]!.match(/linear-gradient\(/g) ?? []).length).toBe(10); // 四角各兩條＋兩個切角的 45° 斜線（折角括號）
    expect(after["content"]).toBe('"" / ""');
  });

  it("切角大小用 --cut-md，手機改 --cut-sm；有警示（[data-fx-alert]）時角框改 serious 色", () => {
    expect(decl(screenRule(SEL)!)["--pc-cut"]).toBe("var(--cut-md)");
    const mobile = rules.find((r) => r.selectors.includes(SEL) && inMedia(r, /max-width:\s*767px/));
    expect(mobile && decl(mobile)["--pc-cut"]).toBe("var(--cut-sm)");
    expect(decl(screenRule(`${SEL}[data-fx-alert]`)!)["--pc-corner"]).toBe("var(--serious)");
  });
});

describe("cyber.css：按鈕、前綴與嚴重度光暈", () => {
  const BTN = `${CYBER_SCOPE} :is([data-fx="button"], [data-fx="submit"])`;

  it("按鈕規則同時涵蓋 button 與 submit；primary／destructive 是透明底＋inset box-shadow 細框（不用 border，尺寸才與標準相同），hover 光暈與內框合併在同一個 box-shadow", () => {
    const primary = decl(screenRule(`${BTN}[data-variant="primary"]`)!);
    expect(primary["background-color"]).toBe("transparent");
    expect(primary["border"]).toBeUndefined();
    expect(primary["box-shadow"]).toBe("inset 0 0 0 1px var(--accent)");
    expect(primary["color"]).toBe("var(--accent-text)");
    const destructive = decl(screenRule(`${BTN}[data-variant="destructive"]`)!);
    expect(destructive["border"]).toBeUndefined();
    expect(destructive["box-shadow"]).toBe("inset 0 0 0 1px var(--critical)");
    expect(decl(screenRule(`${BTN}[data-variant="primary"]:hover:not(:disabled)`)!)["box-shadow"]).toBe("inset 0 0 0 1px var(--accent), var(--glow-accent)");
    expect(decl(screenRule(`${BTN}[data-variant="destructive"]:hover:not(:disabled)`)!)["box-shadow"]).toBe("inset 0 0 0 1px var(--critical), var(--glow-critical)");
    expect(decl(screenRule(`${BTN}[data-variant="secondary"]:hover:not(:disabled)`)!)["border-color"]).toBe("var(--accent)");
    expect(decl(screenRule(`${BTN}[data-variant="ghost"]:hover:not(:disabled)`)!)["color"]).toBe("var(--accent-text)");
    // link 不動；手機中央「新增」圓鈕（fab）維持實心，不在 cyber.css 裡
    expect(stripped).not.toMatch(/data-variant="link"/);
    expect(stripped).not.toMatch(/data-fx="fab"/);
  });

  it("文字光暈只用在 kpi-num 與（≥ 768 的）頁面標題 h1", () => {
    const users = screenRules.filter((r) => decl(r)["text-shadow"] !== undefined && decl(r)["text-shadow"] !== "none");
    expect(users.flatMap((r) => r.selectors).sort()).toEqual([`${CYBER_SCOPE} [data-fx="kpi-num"]`, `${CYBER_SCOPE} h1[data-fx="page-title"]`].sort());
    const h1 = users.find((r) => r.selectors[0]!.includes("h1"))!;
    expect(decl(h1)["text-shadow"]).toBe("var(--text-glow)");
    expect(inMedia(h1, /min-width:\s*768px/)).toBe(true);
  });

  it("裝飾前綴：目前頁 > 只在桌面側欄（≥ 1024）、群組 //、頁面標題 ~/（h1 只在 ≥ 768）、分段 [ ]、勾選 [x]／[ ]、錯誤 ERR: 、toast [OK]／[ERR]", () => {
    const contentOf = (sel: string) => {
      const r = screenRules.find((x) => x.selectors.includes(sel) && decl(x)["content"] !== undefined);
      return r ? { content: decl(r)["content"], rule: r } : undefined;
    };
    const nav = contentOf(`${CYBER_SCOPE} aside [data-fx="nav-item"][aria-current="page"]::before`);
    expect(nav?.content).toBe('"> " / ""');
    expect(inMedia(nav!.rule, /min-width:\s*1024px/)).toBe(true);
    expect(contentOf(`${CYBER_SCOPE} [data-fx="nav-group"]::before`)?.content).toBe('"// " / ""');
    const p = contentOf(`${CYBER_SCOPE} p[data-fx="page-title"]::before`);
    expect(p?.content).toBe('"~/" / ""');
    expect(p!.rule.context).toEqual([]);
    const h1 = contentOf(`${CYBER_SCOPE} h1[data-fx="page-title"]::before`);
    expect(h1?.content).toBe('"~/" / ""');
    expect(inMedia(h1!.rule, /min-width:\s*768px/)).toBe(true);
    expect(contentOf(`${CYBER_SCOPE} [data-fx="seg"] > button[aria-pressed="true"] > span:first-child::before`)?.content).toBe('"[" / ""');
    expect(contentOf(`${CYBER_SCOPE} [data-fx="seg"] > button[aria-pressed="true"] > span:first-child::after`)?.content).toBe('"]" / ""');
    expect(contentOf(`${CYBER_SCOPE} [data-fx="error-msg"]::before`)?.content).toBe('"ERR: " / ""');
    expect(contentOf(`${CYBER_SCOPE} [data-fx="check"]::before`)?.content).toBe('"[ ]" / ""');
    expect(contentOf(`${CYBER_SCOPE} [data-fx="check"][data-state="on"]::before`)?.content).toBe('"[x]" / ""');
    expect(contentOf(`${CYBER_SCOPE} [data-sonner-toast][data-type="success"] [data-title]::before`)?.content).toBe('"[OK] " / ""');
    expect(contentOf(`${CYBER_SCOPE} [data-sonner-toast][data-type="error"] [data-title]::before`)?.content).toBe('"[ERR] " / ""');
  });

  it("嚴重度光暈：4px、透明度 .5（重大 .7），顏色是嚴重度 token；手機減半；SVG 弧用 drop-shadow", () => {
    const base = decl(screenRule(`${CYBER_SCOPE} [data-fx="sev"]`)!);
    expect(base["--sv-r"]).toBe("4px");
    expect(base["--sv-a"]).toBe("50%");
    expect(base["--sv-c"]).toBe("var(--good)");
    expect(base["box-shadow"]).toBe("0 0 var(--sv-r) var(--sv-glow)");
    expect(base["--sv-glow"]).toBe("color-mix(in srgb, var(--sv-c) calc(var(--sv-a) * var(--sv-k)), transparent)");
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="sev"][data-severity="一般"]`)!)["--sv-c"]).toBe("var(--warning)");
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="sev"][data-severity="嚴重"]`)!)["--sv-c"]).toBe("var(--serious)");
    const critical = decl(screenRule(`${CYBER_SCOPE} [data-fx="sev"][data-severity="重大"]`)!);
    expect(critical["--sv-c"]).toBe("var(--critical)");
    expect(critical["--sv-a"]).toBe("70%");
    const mobile = rules.find((r) => r.selectors.includes(`${CYBER_SCOPE} [data-fx="sev"]`) && inMedia(r, /max-width:\s*767px/));
    expect(mobile && decl(mobile)).toMatchObject({ "--sv-k": "0.5", "--sv-r": "2px" });
    expect(decl(screenRule(`${CYBER_SCOPE} circle[data-fx="sev"]`)!)["filter"]).toContain("drop-shadow(");
  });
});

describe("cyber.css：@media print 還原（cyber 列印 ≡ 標準淺色列印）", () => {
  it("掃描線不印、點陣還原：body::after display:none，body background-image:none", () => {
    expect(decl(printRule(`${CYBER_SCOPE} body::after`)!)["display"]).toBe("none");
    const body = decl(findRule(cyberCss, `${CYBER_SCOPE} body`, true)!);
    expect(body["background-image"]).toBe("none");
  });

  it("所有 data-fx 元件（含 ::before／::after）用 all: revert-layer 退回標準樣式，特異度壓過螢幕的 :hover 規則", () => {
    for (const sel of ["[data-fx]", "[data-fx]::before", "[data-fx]::after"]) {
      const full = `${CYBER_SCOPE}:not(#cyber-print) ${sel}`;
      const r = printRule(full);
      expect(r, full).toBeDefined();
      expect(decl(r!)["all"]).toBe("revert-layer");
    }
  });

  it("沒有 data-fx 的被改動元素（分段按鈕、勾選的 svg、欄位輸入框、toast）在 print 也有還原；print 區段不留 content（除了 none）", () => {
    const printSelectors = printRules.flatMap((r) => r.selectors).join("\n");
    for (const part of ['[data-fx="seg"] > button', '[data-fx="check"] > svg', '[data-fx="field"] :is(input, textarea, select)', "[data-sonner-toast]", "[data-sonner-toaster]"]) {
      expect(printSelectors, part).toContain(part);
    }
    for (const r of printRules) {
      const c = decl(r)["content"];
      if (c !== undefined) expect(c).toBe("none");
    }
  });

  it("print 區段在檔尾（沒有任何非 print 的規則排在 print 之後）", () => {
    const lastScreen = rules.map((r) => !inPrint(r)).lastIndexOf(true);
    const firstPrint = rules.findIndex(inPrint);
    expect(firstPrint).toBeGreaterThan(lastScreen);
  });
});

/*
 * P1 設計審查退回項的守門（docs/cyber-theme-spec.md §1「P1 設計審查」、§5.2–§5.4、§7）。
 */
describe("cyber.css：設計審查退回項", () => {
  const BTN = `${CYBER_SCOPE} :is([data-fx="button"], [data-fx="submit"])`;
  const SEG = `${CYBER_SCOPE} [data-fx="seg"] > button`;
  const rulesFor = (sel: string) => screenRules.filter((r) => r.selectors.includes(sel));

  it("分段按鈕選中態：空心終端風（accent-wash 底、1px accent 內框用 inset box-shadow 不改尺寸、accent-text 字）", () => {
    const d = decl(screenRule(`${SEG}[aria-pressed="true"]`)!);
    expect(d["background-color"]).toBe("var(--accent-wash)");
    expect(d["box-shadow"]).toBe("inset 0 0 0 1px var(--accent)");
    expect(d["color"]).toBe("var(--accent-text)");
    expect(d["border"]).toBeUndefined();
    expect(d["padding"]).toBeUndefined();
  });

  it("分段按鈕括號（桌面）：所有分段按鈕都有 ::before／::after 括號當 flex 子項目（未選中 visibility:hidden 佔位，文字不跳動），離文字 4px（gap 6px − 2px），選中才可見", () => {
    const find = (sel: string) => rulesFor(sel).find((r) => inMedia(r, /min-width:\s*768px/) && decl(r)["content"] !== undefined)!;
    const before = find(`${SEG}::before`);
    const after = find(`${SEG}::after`);
    expect(decl(before)).toMatchObject({ content: '"[" / ""', "margin-right": "-2px", visibility: "hidden" });
    expect(decl(after)).toMatchObject({ content: '"]" / ""', "margin-left": "-2px", visibility: "hidden" });
    const shown = rules.find((r) => r.selectors.includes(`${SEG}[aria-pressed="true"]::before`) && inMedia(r, /min-width:\s*768px/));
    expect(shown && decl(shown)["visibility"]).toBe("visible");
    // 括號不是絕對定位（桌面是排版內的子項目，才會貼著文字、又不會蓋到筆數）
    expect(decl(before)["position"]).toBeUndefined();
  });

  it("分段按鈕括號（手機）：畫在標籤 <span>（第一個子元素）兩側，絕對定位、離文字 4px；按鈕最小寬度放大到容得下括號", () => {
    const S = `${SEG}[aria-pressed="true"] > span:first-child`;
    const inMobile = (sel: string) => rules.find((r) => r.selectors.includes(sel) && inMedia(r, /max-width:\s*767px/) && decl(r)["content"] !== undefined)!;
    expect(decl(inMobile(`${S}::before`))).toMatchObject({ content: '"[" / ""', right: "calc(100% + 4px)" });
    expect(decl(inMobile(`${S}::after`))).toMatchObject({ content: '"]" / ""', left: "calc(100% + 4px)" });
    const pos = rules.find((r) => r.selectors.includes(`${S}::before`) && decl(r)["position"] !== undefined);
    expect(decl(pos!)["position"]).toBe("absolute");
    const min = rules.find((r) => r.selectors.includes(SEG) && inMedia(r, /max-width:\s*767px/));
    expect(min && decl(min)["min-width"]).toBe("52px");
  });

  it("data-fx-tone=\"danger\"（回收桶永久刪除）：critical 字與框，hover 為 critical 光暈、框不變青色；不用 accent", () => {
    const base = decl(screenRule(`${BTN}[data-fx-tone="danger"]`)!);
    expect(base).toMatchObject({ "border-color": "var(--critical)", color: "var(--critical)" });
    const hover = decl(screenRule(`${BTN}[data-fx-tone="danger"]:hover:not(:disabled)`)!);
    expect(hover["border-color"]).toBe("var(--critical)");
    expect(hover["box-shadow"]).toBe("var(--glow-critical)");
    for (const r of screenRules.filter((x) => x.selectors.some((s) => s.includes("data-fx-tone")))) {
      expect(r.declarations, r.selectors[0]).not.toMatch(/accent/);
    }
  });

  it("panel-cut 折角括號：兩個切角（右上、左下）各有一條 45° 斜線（2px、corner 色）接在兩段直邊線之間", () => {
    const after = decl(screenRule(`${CYBER_SCOPE} [data-fx="panel-cut"]::after`)!)["background"]!;
    const diag = after.split("linear-gradient(").filter((g) => g.startsWith("to top right,") && g.includes("var(--pc-corner)"));
    expect(diag).toHaveLength(2);
    expect(diag.some((g) => /right top \/ var\(--pc-cut\) var\(--pc-cut\)/.test(g))).toBe(true);
    expect(diag.some((g) => /left bottom \/ var\(--pc-cut\) var\(--pc-cut\)/.test(g))).toBe(true);
  });

  it("日曆格焦點環：只在 :focus-visible，外側墊 --page 色的 6px 外暈（蓋得住 offset 2px＋寬 2px 的環），並用 z-index 蓋在相鄰格上", () => {
    const rule = screenRule(`${CYBER_SCOPE} [data-fx="cal-cell"]:focus-visible`);
    expect(rule, "要有 cal-cell:focus-visible 規則").toBeDefined();
    expect(decl(rule!)).toMatchObject({ position: "relative", "z-index": "1", "box-shadow": "0 0 0 6px var(--page)" });
    expect(decl(rule!)["outline"]).toBeUndefined(); // 環本身沿用 index.css base 層，不另寫（見檔頭）
  });

  it("平板圖示列（768–1023）目前頁：左側 2px accent 內側直條（靜態、只在這個寬度）", () => {
    const rule = screenRules.find((r) => r.selectors.includes(`${CYBER_SCOPE} aside [data-fx="nav-item"][aria-current="page"]`) && decl(r)["box-shadow"] !== undefined);
    expect(rule, "要有平板目前頁的規則").toBeDefined();
    expect(decl(rule!)["box-shadow"]).toBe("inset 2px 0 0 var(--accent)");
    expect(inMedia(rule!, /min-width:\s*768px\)\s*and\s*\(max-width:\s*1023px/)).toBe(true);
  });

  it("按鈕框線一律是 inset box-shadow（不新增實體 border，尺寸才與標準相同）；secondary 的標準 border 不動", () => {
    const selectors = screenRules.filter((r) => r.selectors.some((s) => s.startsWith(BTN)));
    for (const r of selectors) {
      const d = decl(r);
      expect(d["border"], r.selectors[0]).toBeUndefined();
      expect(d["border-width"], r.selectors[0]).toBeUndefined();
    }
  });

  it("@media print 還原新增的東西：分段按鈕（底色、內框、字色、最小寬度、兩種括號）與 span 的 position", () => {
    const P = `${CYBER_SCOPE}:not(#cyber-print) [data-fx="seg"] > button`;
    const btn = printRule(P);
    expect(btn).toBeDefined();
    for (const k of ["background-color", "box-shadow", "color", "min-width"]) expect(decl(btn!)[k], k).toBe("revert-layer");
    const pseudo = printRules.find((r) => r.selectors.includes(`${P}::before`) && r.selectors.includes(`${P} > span:first-child::before`));
    expect(pseudo && decl(pseudo)).toMatchObject({ content: "none", display: "none" });
    expect(decl(printRule(`${P} > span:first-child`)!)["position"]).toBe("revert-layer");
  });
});
