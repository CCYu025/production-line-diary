import { describe, expect, it, vi } from "vitest";
import { REPORT_WINDOW_BG, buildReportWindowHtml, collectHeadStyles, openReportWindow } from "./reportWindow";

describe("buildReportWindowHtml（開新視窗的 HTML）", () => {
  const html = buildReportWindowHtml({
    reportHtml: '<div id="report-output">內容</div>',
    origin: "http://localhost:3000",
    headStyles: '<link rel="stylesheet" href="/assets/index.css">',
  });

  it("帶 <base href=origin/>（照片 /photos/… 才找得到）", () => {
    expect(html).toContain('<base href="http://localhost:3000/">');
    expect(html.indexOf("<base")).toBeLessThan(html.indexOf("<link")); // base 要在其他帶網址的元素之前
  });

  it("固定灰底 #e9e7df（不吃 App 的 --page）、列印時不留外距", () => {
    expect(REPORT_WINDOW_BG).toBe("#e9e7df");
    expect(html).toMatch(/body\{[^}]*background:#e9e7df/);
    expect(html).toMatch(/@media print\{body\{padding:0\}\}/);
  });

  it("報表包在 #root 裡（列印規則用 body > :not(#root) 隱藏浮層），樣式表與標題都帶過去", () => {
    expect(html).toContain('<div id="root"><div id="report-output">內容</div></div>');
    expect(html).toContain('<link rel="stylesheet" href="/assets/index.css">');
    expect(html).toContain("<title>設備紀錄表</title>");
    expect(html).toContain('lang="zh-Hant"');
  });

  it("origin 含特殊字元時會跳脫，不會跳出屬性", () => {
    const evil = buildReportWindowHtml({ reportHtml: "", origin: 'http://x"><script>', headStyles: "" });
    expect(evil).not.toContain("<script>");
  });
});

describe("collectHeadStyles", () => {
  it("收集 <link rel=stylesheet> 與 <style>，其餘不要", () => {
    const doc = document.implementation.createHTMLDocument("t");
    doc.head.innerHTML =
      '<link rel="stylesheet" href="/a.css"><link rel="icon" href="/i.png"><style>.x{color:red}</style><script src="/s.js"></script>';
    const out = collectHeadStyles(doc);
    expect(out).toContain('href="/a.css"');
    expect(out).toContain(".x{color:red}");
    expect(out).not.toContain("icon");
    expect(out).not.toContain("script");
  });
});

describe("openReportWindow", () => {
  it("被彈出視窗封鎖（open 回傳 null）回 false，不丟錯", () => {
    expect(openReportWindow("<p/>", { open: (() => null) as unknown as typeof window.open })).toBe(false);
  });

  it("成功時寫入並 close，回 true", () => {
    const write = vi.fn();
    const close = vi.fn();
    const open = vi.fn(() => ({ document: { write, close } }) as unknown as Window);
    expect(openReportWindow("<p>x</p>", { open: open as unknown as typeof window.open })).toBe(true);
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
