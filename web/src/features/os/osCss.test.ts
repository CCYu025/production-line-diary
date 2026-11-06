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

  it("@media print 隱藏所有 OS 元素（3D、HUD、狀態列、頻道清單、裝置門檻、指令列、疊層、外框頂列、跳過連結）", () => {
    const hidden = rules
      .filter((r) => r.context.some((c) => /^@media\s+print\b/.test(c)) && /display:\s*none/.test(r.declarations))
      .flatMap((r) => r.selectors);
    for (const must of [
      ".os-hub",
      ".os-hud",
      ".os-statusbar",
      ".os-channels",
      ".os-gate",
      ".os-palette",
      ".os-palette-overlay",
      "#os-overlay",
      ".os-frame-bar",
      ".os-skip",
      "[data-os-chrome]",
    ]) {
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

  describe("HUD 頻道按鈕一行排完（X2）", () => {
    const narrow = rules.filter((r) => r.context.some((c) => /max-width: *1439/.test(c)));
    it("< 1440px：按鈕不換行、完整文字隱藏、精簡文字顯示", () => {
      const has = (sel: string, decl: RegExp) => narrow.some((r) => r.selectors.includes(`${OS_SCOPE} ${sel}`) && decl.test(r.declarations));
      expect(has(".os-channels ul", /flex-wrap: *nowrap/)).toBe(true);
      expect(has(".os-hud-full", /display: *none/)).toBe(true);
      expect(has(".os-hud-compact", /display: *inline/)).toBe(true);
    });
    it("≥ 1440px：精簡文字預設隱藏", () => {
      const base = rules.find((r) => r.context.length === 0 && r.selectors.includes(`${OS_SCOPE} .os-hud-compact`));
      expect(base?.declarations).toMatch(/display: *none/);
    });
  });

  describe("B 區 CRT 疊層（X2）", () => {
    const overlay = rules.filter((r) => r.selectors.some((sel) => /::after$/.test(sel) && /os-(statusbar|channels|frame-bar|frame)/.test(sel)));

    it("只作用在 HUD 上下列與工作站外框（頂列＋外框環），不碰 <main>、螢幕與內容", () => {
      const targets = new Set(overlay.flatMap((r) => r.selectors).filter((sel) => /::after$/.test(sel)).map((sel) => sel.replace(/^.*\s(\.os-[a-z-]+)::after$/, "$1")));
      expect(Array.from(targets).sort()).toEqual([".os-channels", ".os-frame", ".os-frame-bar", ".os-statusbar"]);
      for (const sel of overlay.flatMap((r) => r.selectors)) {
        expect(sel).not.toMatch(/main|os-screen|#main/);
      }
    });

    it("pointer-events: none，且用 data-crt 在「關」時不畫", () => {
      const drawn = overlay.filter((r) => /background-image/.test(r.declarations));
      expect(drawn.length).toBeGreaterThan(0);
      for (const r of drawn) {
        expect(splitTopLevel(r.declarations, ";").some((d) => /pointer-events:\s*none/.test(d))).toBe(true);
        for (const sel of r.selectors) expect(sel).toContain(':not([data-crt="off"])');
      }
    });

    it("條紋與掃描線週期取自變數（整數裝置像素換算），顏色取自 token", () => {
      const drawn = overlay.find((r) => /background-image/.test(r.declarations))!;
      expect(drawn.declarations).toContain("var(--os-crt-stripe");
      expect(drawn.declarations).toContain("var(--os-crt-scan");
      expect(drawn.declarations).toContain("var(--os-crt-stripe-a");
    });

    it("外框環用遮罩挖空內容區，沒有遮罩合成就不畫", () => {
      const ring = css.slice(css.indexOf("@supports (mask-composite"));
      expect(ring).toContain("mask-composite: exclude");
      expect(ring).toContain("content-box");
      const fallback = rules.find((r) => r.selectors.includes(':root[data-mode="os"] .os-root .os-frame::after') && r.context.length === 0);
      expect(fallback?.declarations).toMatch(/display:\s*none/);
    });

    it("疊層比 Radix 浮層與 toast 低：只在 HUD／工作站的堆疊內（z-index 1），不設 50 以上", () => {
      for (const r of overlay) {
        const z = /z-index:\s*(\d+)/.exec(r.declarations);
        if (z) expect(Number(z[1])).toBeLessThan(10);
      }
    });
  });

  describe("裝置門檻終端機畫面（X3）", () => {
    it("游標預設閃爍，減少動態效果時 animation: none", () => {
      const base = rules.find((r) => r.context.length === 0 && r.selectors.includes(`${OS_SCOPE} .os-gate-cursor`));
      expect(base?.declarations).toMatch(/animation:[^;]*os-gate-blink/);
      const reduced = rules.find((r) => r.context.some((c) => /prefers-reduced-motion:\s*reduce/.test(c)) && r.selectors.includes(`${OS_SCOPE} .os-gate-cursor`));
      expect(reduced?.declarations).toMatch(/animation:\s*none/);
    });
    it("等寬字與邊框", () => {
      const gate = rules.find((r) => r.context.length === 0 && r.selectors.includes(`${OS_SCOPE} .os-gate`));
      expect(gate?.declarations).toMatch(/monospace/);
      const term = rules.find((r) => r.context.length === 0 && r.selectors.includes(`${OS_SCOPE} .os-gate-term`));
      expect(term?.declarations).toMatch(/border:\s*1px solid/);
    });
  });

  describe("轉場疊層的圖層（X3；修 X1 遺留：離開時的疊層內容不可被 HUD 列蓋住或切掉）", () => {
    const base = (sel: string) => rules.find((r) => r.context.length === 0 && r.selectors.includes(`${OS_SCOPE} ${sel}`));
    const z = (sel: string) => Number(/z-index:\s*(\d+)/.exec(base(sel)?.declarations ?? "")?.[1]);
    it("疊層高於 HUD 與工作站，台標層高於疊層，Radix 浮層（指令列 50）高於兩者", () => {
      expect(z("#os-overlay")).toBeGreaterThan(z(".os-hud"));
      expect(z("#os-overlay")).toBeGreaterThan(z(".os-station"));
      expect(z("#os-overlay-tag")).toBeGreaterThan(z("#os-overlay"));
      expect(z("#os-overlay-tag")).toBeLessThan(z(".os-palette-overlay"));
    });
    it("兩個疊層畫布都是 fixed 滿版、永遠 pointer-events: none（elementFromPoint 不會落在疊層上）", () => {
      for (const sel of ["#os-overlay", "#os-overlay-tag"]) {
        const d = base(sel)!.declarations;
        expect(d, sel).toMatch(/position:\s*fixed/);
        expect(d, sel).toMatch(/inset:\s*0/);
        expect(d, sel).toMatch(/pointer-events:\s*none/);
      }
    });
    it("疊層的祖先（.os-root）沒有 overflow／clip／contain／transform／filter：疊層不會被切掉", () => {
      const decls = rules
        .filter((r) => r.context.length === 0 && r.selectors.some((sel) => sel === `${OS_SCOPE} .os-root`))
        .map((r) => r.declarations)
        .join(";");
      expect(decls).not.toMatch(/overflow|clip|contain|transform|filter|perspective/);
    });
    it("兩個疊層列印時都隱藏", () => {
      const hidden = rules.filter((r) => r.context.some((c) => /^@media\s+print\b/.test(c)) && /display:\s*none/.test(r.declarations)).flatMap((r) => r.selectors);
      expect(hidden).toContain(`${OS_SCOPE} #os-overlay-tag`);
    });
  });
});
