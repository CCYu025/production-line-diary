import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");
const indexCss = read("index.css");
const reportCss = read("../features/report/report.css");

/** 取出 index.css 標準淺色 :root 的 token 值 */
function lightToken(name: string): string {
  const root = indexCss.slice(indexCss.indexOf(":root {"));
  const m = root.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`:root 沒有 ${name}`);
  return m[1]!.trim();
}

describe("375 寬固定底部分頁列：聚焦捲動預留空間", () => {
  it("< 768px 的 html 有 scroll-padding-bottom（分頁列高度＋安全區）", () => {
    const m = indexCss.match(/@media \(max-width: 767px\)\s*\{\s*html\s*\{([^}]*)\}/);
    expect(m, "找不到 < 768px 的 html 規則").not.toBeNull();
    expect(m![1]).toMatch(/scroll-padding-bottom:\s*calc\(3\.5rem \+ 1px \+ env\(safe-area-inset-bottom/);
    // 新增表單底部的固定操作列高度（RecordForm 量測後寫入 --form-bar-h）也要預留
    expect(m![1]).toContain("var(--form-bar-h, 0px)");
  });
});

describe("被 overflow 裁掉的焦點環：只有三處改成內縮", () => {
  const inset = "focus-visible:outline-offset-[-2px]";
  it.each([
    ["側欄連結", "../app/Sidebar.tsx", "navItemClass"],
    ["列表列", "../features/records/RecordList.tsx", "data-record-id={r.id}"],
    ["趨勢柱", "../features/dashboard/charts.tsx", 'data-fx="trend-col"'],
  ])("%s", (_name, rel, anchor) => {
    const src = read(rel);
    expect(src).toContain(anchor);
    expect(src).toContain(inset);
  });
  it("顏色與粗細沿用 base 層（不另寫 outline 寬度／顏色）", () => {
    for (const rel of ["../app/Sidebar.tsx", "../features/records/RecordList.tsx", "../features/dashboard/charts.tsx"]) {
      expect(read(rel)).not.toMatch(/focus-visible:outline-(2|accent|\[#)/);
    }
  });
});

describe("列印報表：嚴重度色塊一律淺色色票", () => {
  const printBlock = reportCss.slice(reportCss.lastIndexOf("@media print"));
  it.each(["--good", "--warning", "--serious", "--serious-wash", "--critical", "--critical-ink"])(
    "@media print 內 #report-output 的 %s = 標準淺色值",
    (token) => {
      const m = printBlock.match(new RegExp(`${token}:\\s*([^;]+);`));
      expect(m, `${token} 未在列印區塊定義`).not.toBeNull();
      expect(m![1]!.trim()).toBe(lightToken(token));
    },
  );
});
