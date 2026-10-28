/*
 * 極簡的 CSS 規則解析與 cyber.css 守門檢查（cyberCss.test.ts 用）。
 * 不引入 CSS 解析套件：cyber.css 只有一般規則、@media／@supports 等巢狀區塊與 @keyframes，這樣就夠了。
 */

export const CYBER_SCOPE = ':root[data-theme="cyber"]';

export interface ParsedRule {
  /** 選擇器列表（已依最上層逗號拆開）；@keyframes／@font-face 等內部的規則是空陣列（它們沒有選擇器可檢查） */
  selectors: string[];
  /** 所在的 at-rule 前導（例如 ["@media print"]） */
  context: string[];
  /** 這條規則自己的宣告文字（不含巢狀區塊） */
  declarations: string;
}

/** 內容不是「選擇器規則」的 at-rule：裡面的 from／to／百分比 或描述子不是選擇器。 */
const NON_SELECTOR_AT_RULES = new Set(["keyframes", "-webkit-keyframes", "font-face", "property", "counter-style", "page"]);

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 在 text 裡從 start（指向一個 "{"）找出對應的 "}" 位置；字串與括號內的字元不算。 */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("CSS 括號不成對");
}

/** 依最上層（不在 ()、[]、字串內）的分隔字元切開。 */
export function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      cur += c;
      if (c === "\\") cur += text[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === "(" || c === "[") {
      depth++;
      cur += c;
    } else if (c === ")" || c === "]") {
      depth--;
      cur += c;
    } else if (c === sep && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  parts.push(cur);
  return parts;
}

function parseBlock(text: string, context: string[], out: ParsedRule[]): void {
  let i = 0;
  while (i < text.length) {
    // 讀到最上層的 "{" 或 ";" 為止，這段是前導（選擇器或 at-rule 名稱與參數）
    let j = i;
    let quote: string | null = null;
    let paren = 0;
    for (; j < text.length; j++) {
      const c = text[j]!;
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === "(" || c === "[") paren++;
      else if (c === ")" || c === "]") paren--;
      else if ((c === "{" || c === ";") && paren === 0) break;
    }
    const prelude = text.slice(i, j).trim();
    if (j >= text.length || text[j] === ";") {
      i = j + 1; // 沒有區塊的敘述（@import、@charset…）或結尾殘字
      continue;
    }
    const end = matchingBrace(text, j);
    const body = text.slice(j + 1, end);
    i = end + 1;

    if (prelude.startsWith("@")) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
      if (NON_SELECTOR_AT_RULES.has(name)) {
        // keyframes 的每個影格：沒有選擇器可檢查，但宣告（尤其 content）仍要檢查
        const frames: ParsedRule[] = [];
        if (body.includes("{")) parseBlock(body, [...context, prelude], frames);
        else frames.push({ selectors: [], context: [...context, prelude], declarations: body });
        for (const f of frames) out.push({ ...f, selectors: [] });
      } else {
        parseBlock(body, [...context, prelude], out);
      }
      continue;
    }

    // 一般規則：body 裡可能有 CSS nesting 的巢狀區塊，先把巢狀區塊拿掉得到自己的宣告
    let own = "";
    let k = 0;
    while (k < body.length) {
      const brace = body.indexOf("{", k);
      if (brace < 0) {
        own += body.slice(k);
        break;
      }
      const semi = body.lastIndexOf(";", brace);
      own += body.slice(k, semi < k ? k : semi + 1);
      k = matchingBrace(body, brace) + 1;
    }
    out.push({
      selectors: splitTopLevel(prelude, ",")
        .map((s) => s.trim())
        .filter(Boolean),
      context,
      declarations: own,
    });
    if (body.includes("{")) parseBlock(body, [...context, prelude], out); // 巢狀規則也要檢查
  }
}

export function parseCss(src: string): ParsedRule[] {
  const out: ParsedRule[] = [];
  parseBlock(stripComments(src), [], out);
  return out;
}

/** 回傳所有不是以 :root[data-theme="cyber"] 開頭的選擇器（含 @media 內與巢狀的）。 */
export function findUnscopedSelectors(src: string): string[] {
  const bad: string[] = [];
  for (const rule of parseCss(src)) {
    for (const sel of rule.selectors) {
      if (!sel.startsWith(CYBER_SCOPE)) bad.push(sel);
    }
  }
  return bad;
}

/**
 * 回傳所有沒有不朗讀替代文字的 content 宣告（寫法：content: "> " / "";）。
 * content: none／normal 不會產生內容，不需要替代文字。
 */
export function findContentWithoutAltText(src: string): string[] {
  const bad: string[] = [];
  for (const rule of parseCss(src)) {
    for (const decl of splitTopLevel(rule.declarations, ";")) {
      const m = /^\s*content\s*:([\s\S]*)$/i.exec(decl);
      if (!m) continue;
      const value = m[1]!.replace(/!important\s*$/i, "").trim();
      if (/^(none|normal)$/i.test(value)) continue;
      if (!/\/\s*(""|'')$/.test(value)) bad.push(decl.trim());
    }
  }
  return bad;
}
