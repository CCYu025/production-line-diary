import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const cyberCss = readFileSync(path.join(here, "cyber.css"), "utf8");
const printStart = cyberCss.lastIndexOf("@media print");
const printCss = cyberCss.slice(printStart);

describe("P4 列印邊緣：cyber 列印的計算後樣式與標準淺色一致", () => {
  it("匯出中（aria-busy）的導覽項目圖示：螢幕上 visibility: hidden，列印時 revert-layer 還原", () => {
    expect(cyberCss.slice(0, printStart)).toMatch(/\[data-fx="nav-item"\]\[aria-busy="true"\] > svg\s*\{\s*visibility:\s*hidden/);
    expect(printCss).toMatch(
      /:not\(#cyber-print\) \[data-fx="nav-item"\]\[aria-busy="true"\] > svg\s*\{\s*visibility:\s*revert-layer;/,
    );
  });
});
