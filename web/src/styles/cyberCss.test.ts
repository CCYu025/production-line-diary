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
  splitTopLevel,
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

/** cyber.css 裡 P2 區段的起點標記（P1 區段在它之前，必須是靜態外觀） */
const P2_MARKER = "/* === P2 START === */";
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
  it("P1 區段（P2 動態區段之前）沒有 @keyframes，也沒有 animation／transition 宣告（P2 起的動態全部集中在後面的 P2 區段，由下方「P2 動畫守門」把關）", () => {
    // 分界是 cyber.css 裡明確的標記註解；標記不存在（或出現多次）時這個測試要失敗，不能默默掃整個檔案
    expect(cyberCss.split(P2_MARKER).length - 1, `cyber.css 要有一個 ${P2_MARKER} 標記`).toBe(1);
    const p2Start = cyberCss.indexOf(P2_MARKER);
    expect(p2Start).toBeGreaterThan(0);
    const p1Part = stripComments(cyberCss.slice(0, p2Start));
    expect(p1Part).not.toMatch(/@keyframes/i);
    expect(p1Part).not.toMatch(/(^|[\s;{])(animation|transition)[\w-]*\s*:/i);
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
      // P2 新增的掛勾（純屬性，規格 §3.3 之後補列）
      "chip", "bar-track", "detail-body", "lightbox", "error-title", "unsaved",
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

/*
 * P2 動態的守門（docs/cyber-theme-spec.md §6.1、§8）。以新增方式擴充，不動上面既有的斷言
 * （唯一的調整：P1 的「沒有動畫」斷言改成只掃 P1 區段，見該 describe 的註解）。
 */
describe("cyber.css：P2 動畫守門", () => {
  const frames = rules.filter((r) => r.context.some((c) => /^@keyframes\b/.test(c)));
  const keyframesName = (r: { context: string[] }) => /^@keyframes\s+(\S+)/.exec(r.context.find((c) => /^@keyframes\b/.test(c))!)![1]!;
  const definedNames = [...new Set(frames.map(keyframesName))];
  /** 非 keyframes 內的 animation／animation-name 宣告（螢幕與 print 都算） */
  const animationDecls = rules
    .filter((r) => !r.context.some((c) => /^@keyframes\b/.test(c)))
    .flatMap((r) =>
      Object.entries(decl(r))
        .filter(([k]) => /^animation(-[a-z-]+)?$/.test(k))
        .map(([k, v]) => ({ rule: r, prop: k, value: v })),
    );
  /** 秒數字串 → 毫秒 */
  const ms = (v: string) => (v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000);
  /** token（--dur-*）解析：index.css 的 :root（動態 token）＋ cyber.css 自己的 token 規則 */
  const cyberTokens = declarationMap(
    rules.filter((r) => r.selectors.length === 1 && r.selectors[0] === CYBER_SCOPE && r.context.length === 0).map((r) => r.declarations).join(";"),
  );
  const token = (name: string): string => cyberTokens[name] ?? lightRoot[name] ?? "";

  it("有 @keyframes，名稱一律 cyber- 前綴，而且每個都有被引用、每個被引用的都有定義", () => {
    expect(definedNames.length).toBeGreaterThan(10);
    expect(definedNames.filter((n) => !n.startsWith("cyber-"))).toEqual([]);
    const used = new Set(
      animationDecls
        .filter((d) => d.prop === "animation" || d.prop === "animation-name")
        .flatMap((d) => d.value.split(/[\s,]+/))
        .filter((t) => t.startsWith("cyber-")),
    );
    expect([...used].filter((n) => !definedNames.includes(n)), "引用了沒定義的 keyframes").toEqual([]);
    expect(definedNames.filter((n) => !used.has(n)), "定義了沒用到的 keyframes").toEqual([]);
  });

  it("keyframes 只動 transform／opacity／clip-path／box-shadow（沒有 width／height／top／left／margin／padding／顏色）", () => {
    const allowed = new Set(["transform", "opacity", "clip-path", "box-shadow"]);
    const bad = frames.flatMap((r) => Object.keys(decl(r)).filter((k) => !allowed.has(k)).map((k) => `${keyframesName(r)}: ${k}`));
    expect(bad).toEqual([]);
  });

  it("進場 keyframes 的最終影格就是基礎狀態（clip-path 的結尾是 inset(0 0 0 0)，或明確登記為退場／掃描）", () => {
    // 退場與掃描類在動畫結束後本來就該是「收起／看不見」：退場停在收起狀態等 Radix 卸載，掃描的基礎樣式是 opacity 0
    const endsHidden = new Set(["cyber-pop-out-down", "cyber-pop-out-up", "cyber-sheet-sweep"]);
    for (const name of definedNames) {
      const own = frames.filter((r) => keyframesName(r) === name);
      const withClip = own.filter((r) => decl(r)["clip-path"] !== undefined);
      if (withClip.length === 0 || endsHidden.has(name)) continue;
      const last = withClip[withClip.length - 1]!;
      expect(decl(last)["clip-path"], name).toBe("inset(0 0 0 0)");
    }
  });

  it("animation 簡寫與 animation-duration 不寫死毫秒（0ms 除外），時間走 --dur-* token；steps() 的步數除外", () => {
    const hard = animationDecls
      .filter((d) => d.prop === "animation" || d.prop === "animation-duration" || d.prop === "animation-delay")
      .map((d) => ({ ...d, value: d.value.replace(/var\([^)]*\)/g, "").replace(/steps\([^)]*\)/g, "") }))
      .filter((d) => /(^|[\s,(])\d*\.?\d+m?s\b/.test(d.value) && !/^0ms$/.test(d.value.trim()));
    // animation-delay 用 calc(var(--stagger-sheet) * n) 時 var 被拿掉後只剩 "* n"，不含時間單位，不會誤報
    expect(hard.map((d) => `${d.rule.selectors[0]} { ${d.prop}: ${d.value} }`)).toEqual([]);
  });

  it("只播一次：沒有 animation-iteration-count 數字 > 1；infinite 只有 FX-33 骨架掃光與 FX-35 呼吸", () => {
    const INFINITE_OK = new Set(["cyber-skeleton-sweep", "cyber-breathe"]);
    const infinite = animationDecls.filter((d) => /\binfinite\b/.test(d.value));
    expect(infinite.length).toBe(2);
    for (const d of infinite) {
      const names = d.value.split(/[\s,]+/).filter((t) => t.startsWith("cyber-"));
      expect(names.length, d.value).toBe(1);
      expect(INFINITE_OK.has(names[0]!), d.value).toBe(true);
    }
    for (const d of animationDecls.filter((x) => x.prop === "animation-iteration-count")) expect(d.value).toBe("1");
    // 簡寫裡不得有獨立的整數 ≥ 2（calc()／var()／steps() 內的不算）
    const counts = animationDecls
      .filter((d) => d.prop === "animation")
      .map((d) => d.value.replace(/(var|calc|steps)\((?:[^()]|\([^()]*\))*\)/g, ""))
      .filter((v) => /(^|\s)([2-9]|\d{2,})(\s|$)/.test(v));
    expect(counts).toEqual([]);
  });

  it("animation-fill-mode 只有兩種用法：依序淡入的 backwards（延遲期間維持透明）與退場的 forwards（停在收起狀態）；沒有 both", () => {
    const modes = animationDecls.flatMap((d) => (d.prop === "animation" ? d.value.split(/[\s,]+/) : d.prop === "animation-fill-mode" ? [d.value] : [])).filter((t) => /^(forwards|backwards|both)$/.test(t));
    expect(modes.filter((m) => m === "both")).toEqual([]);
    expect(new Set(modes)).toEqual(new Set(["backwards", "forwards"]));
    // backwards 只在詳情面板的依序淡入；forwards 只在退場（data-state="closed"）
    for (const d of animationDecls.filter((x) => x.prop === "animation" && /\bbackwards\b/.test(x.value))) {
      expect(d.rule.selectors.join(), d.value).toContain('[data-fx="detail-body"]');
    }
    for (const d of animationDecls.filter((x) => x.prop === "animation" && /\bforwards\b/.test(x.value))) {
      expect(d.rule.selectors.join(), d.value).toContain('[data-state="closed"]');
    }
  });

  it("退場（data-state=\"closed\"）的動畫時間 ≤ 120ms（Radix 會等退場動畫結束才卸載）", () => {
    const exits = screenRules.filter((r) => r.selectors.some((s) => s.includes('[data-state="closed"]')) && (decl(r)["animation"] !== undefined || decl(r)["animation-duration"] !== undefined));
    expect(exits.length).toBeGreaterThanOrEqual(3); // pop、dialog、sheet
    for (const r of exits) {
      const d = decl(r);
      const raw = d["animation-duration"] ?? d["animation"]!;
      const used = [...raw.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]!).filter((n) => n.startsWith("--dur-"));
      expect(used.length, r.selectors[0]).toBeGreaterThan(0);
      for (const n of used) expect(ms(token(n)), `${r.selectors[0]} 的 ${n}`).toBeLessThanOrEqual(120);
    }
  });

  it("transition 只動 transform／opacity／box-shadow（外加 Tailwind transition-colors 既有的顏色屬性與日曆格既有的 filter）", () => {
    const allowed = new Set(["transform", "opacity", "clip-path", "box-shadow", "filter", "color", "background-color", "border-color"]);
    const bad: string[] = [];
    for (const r of screenRules) {
      const d = decl(r);
      const props: string[] = [];
      if (d["transition"] !== undefined) props.push(...splitTopLevel(d["transition"], ",").map((p) => p.trim().split(/\s+/)[0]!));
      if (d["transition-property"] !== undefined) props.push(...d["transition-property"].split(",").map((p) => p.trim()));
      for (const p of props) if (!allowed.has(p)) bad.push(`${r.selectors[0]}: ${p}`);
    }
    expect(bad).toEqual([]);
    // transition 的時間也走 token
    const hard = screenRules.filter((r) => decl(r)["transition"] !== undefined && /(^|[\s,])\d*\.?\d+m?s\b/.test(decl(r)["transition"]!.replace(/var\([^)]*\)/g, "")));
    expect(hard.map((r) => r.selectors[0])).toEqual([]);
  });

  it("pointer-events: none 只出現在偽元素（裝飾蓋在可點元素上）；可點元素（button／a／input／row…）本身沒有", () => {
    const none = rules.filter((r) => decl(r)["pointer-events"] === "none");
    expect(none.length).toBeGreaterThan(0);
    const bad = none.flatMap((r) => r.selectors).filter((s) => !/::(before|after)$/.test(s));
    expect(bad).toEqual([]);
    // 新加的動畫規則不碰可點性
    for (const r of rules.filter((x) => decl(x)["animation"] !== undefined && !x.selectors.every((q) => /::(before|after)$/.test(q)))) expect(decl(r)["pointer-events"], r.selectors[0]).toBeUndefined();
  });

  it("#report-output 與報表相關的選擇器沒有任何動畫／transition", () => {
    const report = rules.filter((r) => r.selectors.some((s) => s.includes("#report-output")));
    for (const r of report) {
      expect(Object.keys(decl(r)).filter((k) => /^(animation|transition)/.test(k)), r.selectors[0]).toEqual([]);
    }
  });

  it("減少動態效果：延遲也歸零（index.css 的全域規則只壓 duration 與 iteration-count，依序淡入的 backwards 會多等）", () => {
    const rm = rules.find((r) => inMedia(r, /prefers-reduced-motion:\s*reduce/) && decl(r)["animation-delay"] !== undefined);
    expect(rm, "要有 reduced-motion 的 animation-delay 規則").toBeDefined();
    expect(rm!.declarations).toMatch(/animation-delay:\s*0ms\s*!important/);
    expect(rm!.selectors.every((s) => s.startsWith(CYBER_SCOPE))).toBe(true);
    // index.css 的全域規則仍在（cyber 的 CSS 動畫靠它收斂）
    expect(indexCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important[\s\S]*animation-iteration-count: 1 !important[\s\S]*transition-duration: 0\.01ms !important/);
  });

  it("基礎樣式就是最終狀態：靠 from 影格的元素不設 animation-fill-mode；掃描／環這類結束後看不見的，基礎樣式是 opacity 0 或在裁切範圍外", () => {
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="sheet"][data-side="right"]::after`)!)["opacity"]).toBe("0");
    expect(decl(screenRule(`${CYBER_SCOPE} nav[aria-label="底部導覽"] a[data-fx="nav-item"][href$="/records/new"]:active::after`)!)["opacity"]).toBe("0");
    const skeleton = decl(screenRule(`${CYBER_SCOPE} [data-fx="skeleton"]::after`)!);
    expect(skeleton["transform"]).toBe("translateX(-100%)"); // 基礎位置在左側外面
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="skeleton"]`)!)["overflow"]).toBe("hidden"); // 掃光被裁在骨架裡
  });

  it("FX-19 括號動畫：只在新選中項（[aria-pressed=\"true\"]）播，只動 transform／opacity，不改括號的最終位置與 P1 的 content", () => {
    const sel = (s: string) => `${CYBER_SCOPE} [data-fx="seg"] > button[aria-pressed="true"]${s}`;
    for (const s of [sel("::before"), sel(" > span:first-child::before")]) {
      const r = screenRule(`${s}`) ?? rules.find((x) => x.selectors.includes(s) && decl(x)["animation"] !== undefined);
      const d = decl(rules.find((x) => x.selectors.includes(s) && decl(x)["animation"] !== undefined)!);
      expect(d["animation"], s).toContain("cyber-bracket-l");
      expect(Object.keys(d), s).toEqual(["animation"]);
      expect(r).toBeDefined();
    }
    for (const s of [sel("::after"), sel(" > span:first-child::after")]) {
      expect(decl(rules.find((x) => x.selectors.includes(s) && decl(x)["animation"] !== undefined)!)["animation"], s).toContain("cyber-bracket-r");
    }
    for (const n of ["cyber-bracket-l", "cyber-bracket-r"]) {
      const own = frames.filter((r) => keyframesName(r) === n);
      expect(own).toHaveLength(1); // 只有 from；to 就是括號原本的位置
      expect(Object.keys(decl(own[0]!)).sort()).toEqual(["opacity", "transform"]);
      expect(Math.abs(parseFloat(/translateX\((-?\d+)px\)/.exec(decl(own[0]!)["transform"]!)![1]!))).toBe(4);
    }
  });

  it("FX-24 驗證錯誤：aria-invalid 出現時抖動一次（±4px、240ms）；ERR: 前綴與訊息文字一起打字式顯示；欄位 critical 光暈", () => {
    const inv = decl(screenRule(`${CYBER_SCOPE} [data-fx="field"] :is(input, textarea, select)[aria-invalid="true"]`)!);
    expect(inv["animation"]).toContain("cyber-shake");
    expect(inv["animation"]).toContain("var(--dur-shake)");
    expect(token("--dur-shake")).toBe("240ms");
    expect(inv["box-shadow"]).toBe("var(--glow-critical)");
    const shake = frames.filter((r) => keyframesName(r) === "cyber-shake");
    const offsets = shake.flatMap((r) => [...(decl(r)["transform"] ?? "").matchAll(/translateX\((-?\d+)px\)/g)].map((m) => Math.abs(Number(m[1]))));
    expect(Math.max(...offsets)).toBe(4);
    // 打字式顯示掛在 error-msg 本身（::before 的 "ERR: " 在它裡面，一起被 clip）
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="error-msg"]`)!)["animation"]).toContain("cyber-type");
    expect(findContentWithoutAltText(cyberCss)).toEqual([]);
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="error-msg"]::before`)!)["content"]).toBe('"ERR: " / ""');
  });

  it("FX-23 輸入框：聚焦 --glow-accent；Combobox 外層才有 \">\" 提示符（絕對定位、不擋點擊、有 / \"\" 替代文字）", () => {
    const focus = screenRules.find((r) => r.selectors.length === 1 && r.selectors[0] === `${CYBER_SCOPE} [data-fx="field"] :is(input, textarea, select):focus:not([aria-invalid="true"])` && decl(r)["box-shadow"] !== undefined);
    expect(focus && decl(focus)["box-shadow"]).toBe("var(--glow-accent)");
    const gt = decl(screenRule(`${CYBER_SCOPE} [data-fx="combobox"]::before`)!);
    expect(gt).toMatchObject({ content: '">" / ""', position: "absolute", "pointer-events": "none", opacity: "0" });
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="combobox"]:focus-within::before`)!)["opacity"]).toBe("1");
    // 輸入框本身不加偽元素：沒有任何 input／textarea／select 的 ::before／::after
    expect(screenRules.flatMap((r) => r.selectors).filter((s) => /(input|textarea|select)[^,]*::(before|after)/.test(s))).toEqual([]);
  });

  it("FX-15 日曆格：聚焦時保留 P1 的 0 0 0 6px var(--page) 外暈並疊上光暈（外暈在上，焦點環對比不被光暈稀釋）；hover 只有光暈", () => {
    expect(decl(screenRule(`${CYBER_SCOPE} button[data-fx="cal-cell"]:focus-visible`)!)["box-shadow"]).toBe("0 0 0 6px var(--page), var(--glow-accent)");
    expect(decl(screenRule(`${CYBER_SCOPE} button[data-fx="cal-cell"]:hover`)!)["box-shadow"]).toBe("var(--glow-accent)");
    // P1 的規則仍在
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="cal-cell"]:focus-visible`)!)["box-shadow"]).toBe("0 0 0 6px var(--page)");
  });

  it("FX-22 永久刪除對話框：4px 斜紋上緣（repeating-linear-gradient、critical、偽元素、不佔版面）；glitch 進場 ≤ 200ms", () => {
    const stripe = decl(screenRule(`${CYBER_SCOPE} [data-fx="dialog"][data-variant="destructive"]::before`)!);
    expect(stripe).toMatchObject({ position: "absolute", height: "4px", content: '"" / ""' });
    expect(stripe["background"]).toMatch(/^repeating-linear-gradient\(/);
    expect(stripe["background"]).toContain("var(--critical)");
    expect(ms(token("--dur-open"))).toBeLessThanOrEqual(200);
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="dialog"][data-state="open"]`)!)["animation"]).toContain("var(--dur-open)");
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="dialog"][data-variant="destructive"]`)!)["box-shadow"]).toContain("var(--glow-critical)");
  });

  it("FX-29 toast：不覆寫 sonner 的滑動（不動 toast 的 transform／transition／opacity）；swipe-out 時不蓋掉 sonner 的 animation-name；狀態色條畫在 [data-content]::before", () => {
    const toastRules = screenRules.filter((r) => r.selectors.some((s) => s.includes("[data-sonner-toast]")));
    for (const r of toastRules) {
      const d = decl(r);
      for (const k of ["transform", "transition", "transition-duration", "opacity", "translate"]) expect(d[k], `${r.selectors[0]} ${k}`).toBeUndefined();
    }
    const flash = screenRules.find((r) => r.selectors.some((s) => s.includes('[data-type="error"]:not([data-swipe-out="true"])')));
    expect(flash && decl(flash)["animation"]).toContain("cyber-flash-critical");
    const bar = decl(screenRule(`${CYBER_SCOPE} [data-sonner-toast][data-styled="true"][data-type] [data-content]::before`)!);
    expect(bar).toMatchObject({ content: '"" / ""', position: "absolute", width: "3px" });
    // toast 自己的 ::before／::after 被 sonner 拿去做滑動與展開的感應區，這裡不碰
    expect(screenRules.flatMap((r) => r.selectors).filter((s) => /\[data-sonner-toast\](?:\[[^\]]+\])*::(before|after)/.test(s))).toEqual([]);
    // 動作鈕按下閃一次，120ms
    expect(token("--dur-flash")).toBe("120ms");
  });

  it("FX-33 骨架：關掉標準的 opacity 脈動，改 ▒ 斜紋＋偽元素 translateX 掃光（1.6s 循環）", () => {
    const base = decl(screenRule(`${CYBER_SCOPE} [data-fx="skeleton"]`)!);
    expect(base["animation"]).toBe("none");
    expect(base["background-image"]).toMatch(/^repeating-linear-gradient\(/);
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="skeleton"]::after`)!)["animation"]).toBe("cyber-skeleton-sweep var(--dur-sweep) linear infinite");
    expect(token("--dur-sweep")).toBe("1.6s");
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="skeleton"]::after`)!)["content"]).toBe('"" / ""');
  });

  it("FX-35 呼吸：2.4s、透明度在 .35 與 1 之間，不是閃爍", () => {
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="unsaved"]::before`)!)["animation"]).toBe("cyber-breathe var(--dur-breathe) ease-in-out infinite");
    expect(token("--dur-breathe")).toBe("2.4s");
    const opacities = frames.filter((r) => keyframesName(r) === "cyber-breathe").map((r) => Number(decl(r)["opacity"]));
    expect(Math.min(...opacities)).toBeGreaterThanOrEqual(0.3);
    expect(Math.max(...opacities)).toBe(1);
  });

  it("FX-37 按壓：只作用在 button／submit 與分段按鈕的 :active:not(:disabled)，scale(.97)；transition 的 transform 用 --dur-instant", () => {
    const press = screenRules.find((r) => r.selectors.length === 2 && decl(r)["transform"] === "scale(0.97)");
    expect(press, "要有 :active 縮放規則").toBeDefined();
    expect(press!.selectors).toEqual([
      `${CYBER_SCOPE} :is([data-fx="button"], [data-fx="submit"]):active:not(:disabled)`,
      `${CYBER_SCOPE} [data-fx="seg"] > button:active:not(:disabled)`,
    ]);
    const trRule = screenRules.find((r) => r.selectors.includes(`${CYBER_SCOPE} [data-fx="seg"] > button`) && decl(r)["transition"] !== undefined)!;
    expect(trRule.selectors).toContain(`${CYBER_SCOPE} :is([data-fx="button"], [data-fx="submit"])`);
    expect(decl(trRule)["transition"]).toMatch(/transform var\(--dur-instant\)/);
    // 螢幕規則（keyframes 之外）裡只有這一處對元素本身做 scale()
    const scaled = screenRules.filter((r) => !r.context.some((c) => /^@keyframes\b/.test(c)) && /scale\(/.test(decl(r)["transform"] ?? ""));
    expect(scaled).toEqual([press]);
  });

  it("FX-18 浮層：開 --dur-fast／關 --dur-close，clip-path 由上往下（data-side=top 反向）；Combobox 清單（沒有 data-state）掛載時展開", () => {
    const P = `${CYBER_SCOPE} [data-fx="pop"]`;
    const open = rules.find((r) => r.selectors.includes(`${P}[data-state="open"]`))!;
    expect(open.selectors).toContain(`${P}:not([data-state])`);
    expect(decl(open)["animation"]).toBe("cyber-pop-down var(--dur-fast) var(--ease-out)");
    expect(decl(screenRule(`${P}[data-state="open"][data-side="top"]`)!)["animation-name"]).toBe("cyber-pop-up");
    expect(decl(screenRule(`${P}[data-state="closed"]`)!)["animation"]).toBe("cyber-pop-out-down var(--dur-close) var(--ease-in) forwards");
    expect(decl(screenRule(`${P}[data-state="closed"][data-side="top"]`)!)["animation-name"]).toBe("cyber-pop-out-up");
    expect(ms(token("--dur-close"))).toBe(100);
  });

  it("FX-06 手機分頁列：目前頁上緣 2px 線（scaleX，--dur-fast）；新增鈕環 300ms，只在 :active，基礎 opacity 0", () => {
    const line = decl(screenRule(`${CYBER_SCOPE} nav[aria-label="底部導覽"] [data-fx="nav-item"][aria-current="page"]::before`)!);
    expect(line).toMatchObject({ height: "2px", top: "0", animation: "cyber-tab-line var(--dur-fast) var(--ease-out)" });
    expect(decl(frames.find((r) => keyframesName(r) === "cyber-tab-line")!)["transform"]).toBe("scaleX(0)");
    expect(token("--dur-ring")).toBe("300ms");
    expect(decl(screenRule(`${CYBER_SCOPE} nav[aria-label="底部導覽"] a[data-fx="nav-item"][href$="/records/new"]:active::after`)!)["animation"]).toContain("var(--dur-ring)");
  });

  it("FX-05 導覽 hover 線用 ::after（::before 是目前頁的 \">\" 前綴），scaleY 由上往下長出", () => {
    const hover = decl(screenRule(`${CYBER_SCOPE} aside [data-fx="nav-item"]:not([aria-current="page"]):hover:not(:disabled)::after`)!);
    expect(hover).toMatchObject({ width: "2px", "transform-origin": "top", animation: "cyber-nav-line var(--dur-fast) var(--ease-out)" });
    expect(decl(frames.find((r) => keyframesName(r) === "cyber-nav-line")!)["transform"]).toBe("scaleY(0)");
  });

  it("FX-20 詳情面板：框線掃描是 data-side=right 的 ::after（clip-path 窗口）；內容區塊依序淡入最多 6 段、間隔 30ms", () => {
    expect(decl(screenRule(`${CYBER_SCOPE} [data-fx="sheet"][data-side="right"]::after`)!)["animation"]).toContain("cyber-sheet-sweep");
    expect(token("--stagger-sheet")).toBe("30ms");
    const delays = screenRules.filter((r) => r.selectors.some((s) => s.includes('[data-fx="detail-body"] >')) && decl(r)["animation-delay"] !== undefined).map((r) => decl(r)["animation-delay"]!);
    // 6 段：0（沒有 delay 宣告的第一段）＋ 1、2、3、4、5 倍間隔
    expect(delays.map((v) => (v === "var(--stagger-sheet)" ? 1 : Number(/\*\s*(\d)\)/.exec(v)![1]))).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("FX-21 沒有獨立動畫：detail-body 本身不播 glitch，靠 DetailBody 以 key 重新掛載時 FX-20 的依序淡入重播；總視覺收尾 ≤ 350ms", () => {
    // detail-body 本身沒有 animation（glitch 只剩對話框 FX-22 與錯誤標題 FX-34 在用）
    expect(screenRules.filter((r) => r.selectors.some((x) => x === `${CYBER_SCOPE} [data-fx="detail-body"]`) && decl(r)["animation"] !== undefined)).toEqual([]);
    const glitchUsers = animationDecls.filter((d) => d.prop === "animation" && d.value.split(/\s+/).includes("cyber-glitch")).map((d) => d.rule.selectors.join());
    expect(glitchUsers.sort()).toEqual([
      `${CYBER_SCOPE} [data-fx="error-title"]`,
    ]);
    // 不分前後方向
    expect(definedNames.filter((n) => /prev|next|left|right/.test(n))).toEqual([]);
    // 內容區塊依序淡入：每段時間走 token；最後一段（5 × 間隔 ＋ 單段）≤ 350ms
    const each = decl(screenRule(`${CYBER_SCOPE} [data-fx="detail-body"] > *`)!)["animation"]!;
    expect(each).toContain("var(--dur-sheet-item)");
    const mult = screenRules
      .filter((r) => r.selectors.some((x) => x.includes('[data-fx="detail-body"] >')) && decl(r)["animation-delay"] !== undefined)
      .map((r) => decl(r)["animation-delay"]!)
      .map((v) => (v === "var(--stagger-sheet)" ? 1 : Number(/\*\s*(\d)\)/.exec(v)![1])));
    const total = Math.max(...mult) * ms(token("--stagger-sheet")) + ms(token("--dur-sheet-item"));
    expect(total).toBeLessThanOrEqual(350);
    expect(Math.max(...mult) + 1, "最多 6 段").toBeLessThanOrEqual(6);
  });

  it("FX-06 新增鈕擴散環與 MobileChrome 的圓鈕尺寸／位移綁在一起：圓鈕的 size／top class 改了，這裡就要跟著改（也斷言環是偽元素、pointer-events: none）", () => {
    const src = readFileSync(path.join(here, "../app/MobileChrome.tsx"), "utf8");
    // 圓鈕是 <NavLink to="/records/new"> 裡的 data-fx="fab"
    const fab = /to="\/records\/new"[\s\S]*?data-fx="fab"\s+className="([^"]+)"/.exec(src);
    expect(fab, "MobileChrome.tsx 要有 /records/new 連結內的 data-fx=fab").not.toBeNull();
    const cls = fab![1]!.split(/\s+/);
    const size = Number(/^size-(\d+)$/.exec(cls.find((c) => /^size-\d+$/.test(c)) ?? "")?.[1]) * 4; // Tailwind：1 單位 = 4px
    const top = -Number(/^-top-(\d+)$/.exec(cls.find((c) => /^-top-\d+$/.test(c)) ?? "")?.[1]) * 4;
    expect(Number.isFinite(size) && size > 0, "圓鈕要有 size-N class").toBe(true);
    expect(Number.isFinite(top) && top < 0, "圓鈕要有 -top-N class").toBe(true);
    expect(cls, "水平置中").toEqual(expect.arrayContaining(["left-1/2", "-translate-x-1/2"]));
    const ringSel = `${CYBER_SCOPE} nav[aria-label="底部導覽"] a[data-fx="nav-item"][href$="/records/new"]:active::after`;
    const ring = decl(screenRule(ringSel)!);
    expect(ring["width"]).toBe(`${size}px`);
    expect(ring["height"]).toBe(`${size}px`);
    expect(ring["top"]).toBe(`${top}px`);
    expect(ring["left"]).toBe("50%");
    expect(ring["margin-left"]).toBe(`${-size / 2}px`);
    expect(ring["position"]).toBe("absolute");
    expect(ring["pointer-events"]).toBe("none"); // 偽元素蓋在相鄰分頁上，不能吃點擊
    expect(ring["border-radius"]).toBe("50%");
    expect(ring["opacity"]).toBe("0");
  });

  it("會被點擊的浮層（dialog／lightbox／sheet）進場動畫不用 clip-path：clip-path 會讓 hit-test 跟著被裁掉，動畫期間點不到按鈕", () => {
    const clipKeyframes = new Set(frames.filter((r) => decl(r)["clip-path"] !== undefined).map(keyframesName));
    expect(clipKeyframes.size).toBeGreaterThan(0);
    for (const fx of ["dialog", "lightbox", "sheet"]) {
      const used = animationDecls
        .filter((d) => d.rule.selectors.some((q) => q.includes(`[data-fx="${fx}"]`) && !/::(before|after)$/.test(q)))
        .flatMap((d) => d.value.split(/[\s,]+/))
        .filter((t) => t.startsWith("cyber-"));
      for (const n of used) expect(clipKeyframes.has(n), `${fx} 引用了含 clip-path 的 ${n}`).toBe(false);
    }
    expect(clipKeyframes.has("cyber-glitch")).toBe(true); // 只剩不可點的錯誤標題在用
    expect(clipKeyframes.has("cyber-crt-open")).toBe(false);
  });

  it("FX-20 掃描線只動 transform（translateY 到面板底）並淡出，不含 clip-path；偽元素 pointer-events: none、基礎 opacity 0、沒有 will-change", () => {
    const own = frames.filter((r) => keyframesName(r) === "cyber-sheet-sweep");
    expect(own.length).toBeGreaterThanOrEqual(2);
    for (const r of own) expect(Object.keys(decl(r)).filter((k) => !["transform", "opacity"].includes(k))).toEqual([]);
    expect(own.some((r) => /translateY\(calc\(100dvh - 2px\)\)/.test(decl(r)["transform"] ?? ""))).toBe(true);
    expect(decl(own[own.length - 1]!)["opacity"]).toBe("0");
    const rule = decl(screenRule(`${CYBER_SCOPE} [data-fx="sheet"][data-side="right"]::after`)!);
    expect(rule).toMatchObject({ height: "2px", opacity: "0", "pointer-events": "none" });
    expect(stripped).not.toMatch(/will-change/);
  });

  it("P2 新增的 data-fx 掛勾都在清單內（chip、bar-track、detail-body、lightbox、error-title、unsaved）", () => {
    for (const v of ["chip", "bar-track", "detail-body", "lightbox", "error-title", "unsaved"]) expect(stripped, v).toContain(`[data-fx="${v}"]`);
  });

  it("@media print：除了 toast 之外所有元素與偽元素的 animation／transition 退回標準值（revert-layer；cyber 自己加的在標準層沒有對應，等於 none）；toast 子樹只清 animation（sonner 的無層級 transition 不能退）", () => {
    const P = `${CYBER_SCOPE}:not(#cyber-print)`;
    const NOT_TOAST = "*:not([data-sonner-toaster], [data-sonner-toaster] *)";
    const r = printRules.find((x) => x.selectors.includes(`${P} ${NOT_TOAST}`) && x.selectors.includes(`${P} ${NOT_TOAST}::before`) && x.selectors.includes(`${P} ${NOT_TOAST}::after`));
    expect(r, "print 區段要有所有元素／::before／::after 的 animation／transition 規則").toBeDefined();
    expect(decl(r!)).toEqual({ animation: "revert-layer", transition: "revert-layer" });
    const toast = printRules.find((x) => x.selectors.includes(`${P} [data-sonner-toaster] *`) && x.selectors.includes(`${P} [data-sonner-toaster] *::before`) && x.selectors.includes(`${P} [data-sonner-toaster] *::after`));
    expect(toast && decl(toast)).toEqual({ animation: "none" });
    // 特異度高於螢幕規則的 :hover／:active（有 #id）
    expect([...r!.selectors, ...toast!.selectors].every((s) => s.includes(":not(#cyber-print)"))).toBe(true);
    // print 區段內不再宣告別的 animation
    const others = printRules.filter((x) => x !== r && x !== toast && Object.keys(decl(x)).some((k) => /^animation/.test(k) && k !== "all"));
    expect(others).toEqual([]);
    // 新增在非 data-fx 元素上的靜態裝飾也要還原：toast 色條、欄位的 box-shadow
    expect(printRules.flatMap((x) => x.selectors).join("\n")).toContain("[data-sonner-toast] [data-content]::before");
    expect(printRules.some((x) => decl(x)["box-shadow"] === "revert-layer" && x.selectors.some((s) => s.includes('[data-fx="field"]')))).toBe(true);
  });
});
