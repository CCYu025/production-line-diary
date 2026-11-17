// Pure helpers for the static red-line scan in verify-holo.mjs (item `redline-grep`). No server, no packages.
// Checked by: node scripts/verify/redline-rules.selftest.mjs
//
// Patterns are assembled from pieces so that no file in the repo contains a ready-made personal path or the theme key as one string.

/** words after which a `/` starts a regex literal, not a division */
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof', 'yield', 'await']);

/**
 * Does a `/` that follows `before` (all code text so far, comments blanked) start a regex literal? Conservative: when unsure it says yes.
 * Division only after `)`, `]`, a number or a plain identifier/closing quote. After `}` (block end or object literal) it is ambiguous: yes.
 */
function regexAllowedAfter(before) {
  const t = before.trimEnd();
  if (!t) return true;
  const c = t[t.length - 1];
  if (c === ')' || c === ']') return false;
  if (/[\w$]/.test(c)) { const w = /[\w$]+$/.exec(t)[0]; return REGEX_AFTER_WORD.has(w); }
  if (c === '"' || c === "'" || c === '`') return false;
  return true;
}

/** end index (exclusive, flags included) of a regex literal that starts at raw[i] === '/', or -1 if the line has no closing slash */
function regexEnd(raw, i) {
  let inClass = false;
  for (let j = i + 1; j < raw.length; j++) {
    const c = raw[j];
    if (c === '\\') j++;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) { j++; while (j < raw.length && /[a-z]/i.test(raw[j])) j++; return j; }
  }
  return -1;
}

/**
 * Replace every comment with spaces, KEEPING line numbers, quotes and everything that is real code. Tracks block-comment state across lines
 * (so a line inside a multi-line comment that does not start with `*` is a comment, and `*` + `/` followed by code on the same line is code again),
 * and string state (so `"//"` or `"/*"` inside a string does not start a comment). Strings are kept, because the thing we look for is a quoted string.
 * Regex literals: a `/` where a regex can start (see regexAllowedAfter) and that has a closing `/` on the same line is a regex literal: its text is kept as code and
 * NOTHING inside it opens a comment or a string (a regex that contains an escaped slash, a star after a slash, or a bracket class with a slash and a star). Division (`a / b / c`, `x /= 2`) is left alone. When the scanner is unsure it reads a regex:
 * the worst case is that the text between two slashes is not interpreted, which can only add a hit, never hide one (a key inside it still shows up as quoted text).
 * Known simplification, in the README: `if (x) /re/.test(y)` (a regex right after `)`) is read as division.
 * @param {string} text
 * @returns {string[]} one entry per line
 */
export function stripComments(text) {
  const out = [];
  let state = 'code'; // code | block | line | sq | dq | tpl
  let hist = ''; // the last stripped code, across lines, to decide regex vs division
  for (const raw of text.split(/\r?\n/)) {
    let line = '';
    if (state === 'line') state = 'code';
    if (state === 'sq' || state === 'dq') state = 'code'; // an unterminated quote ends at the end of its line
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i], n = raw[i + 1];
      if (state === 'block') {
        if (c === '*' && n === '/') { state = 'code'; i++; line += '  '; } else line += ' ';
      } else if (state === 'line') {
        line += ' ';
      } else if (state === 'sq' || state === 'dq' || state === 'tpl') {
        line += c;
        if (c === '\\') { if (n !== undefined) { line += n; i++; } }
        else if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
      } else if (c === '/' && n === '*') { state = 'block'; i++; line += '  '; }
      else if (c === '/' && n === '/') { state = 'line'; line += '  '; i++; }
      else if (c === '/' && regexAllowedAfter(hist + line) && regexEnd(raw, i) > 0) {
        const e = regexEnd(raw, i);
        line += raw.slice(i, e); i = e - 1;
      } else {
        line += c;
        if (c === "'") state = 'sq'; else if (c === '"') state = 'dq'; else if (c === '`') state = 'tpl';
      }
    }
    out.push(line);
    hist = (hist + line + '\n').slice(-300);
  }
  return out;
}

/** the theme preference key as a quoted string (single, double or backtick) */
const THEME_KEY = new RegExp('["\'`]' + ['pld', 'theme'].join('\\.') + '["\'`]');
export const themeKeyHit = (codeLine) => THEME_KEY.test(codeLine);

/**
 * A Windows user-profile path in any letter case and drive letter, with forward or back slashes, single or double-escaped backslashes.
 * The macOS and Linux spellings stay case-sensitive (that is how those systems spell them).
 */
const WIN_PROFILE = new RegExp('[a-z]:[\\\\/]{1,2}' + 'us' + 'ers' + '[\\\\/]', 'i');
// macOS / Linux: only a REAL home folder: `/Users/<name>/...` or `/home/<name>/...` at the root of a string or path (start of line, or after a quote, space, `=`, `(`, `:` and the like),
// never in the middle of a path (`./Users/list`, `src/home/x/y`) and never without something after the name (`navigate('/home/dashboard')`). Also the `file:///` form and WSL `/mnt/c/Users/<name>/`.
const UNIX_PROFILE = new RegExp('(?:^|[^\\w.~$)\\]}/-]|file://)/(?:Us' + 'ers|ho' + 'me)/[\\w.-]+/');
const WSL_PROFILE = new RegExp('/mnt/[a-z]/Us' + 'ers/[\\w.-]+/', 'i');
export const profilePathHit = (text) => WIN_PROFILE.test(text) || UNIX_PROFILE.test(text) || WSL_PROFILE.test(text);

/** new-file scan (3a): the profile paths above plus extra literal needles (cloud-sync folder name, real-data folder name), case-sensitive as before */
export const personalHit = (text, extraNeedles = []) => profilePathHit(text) || extraNeedles.some((s) => s && text.includes(s));

/**
 * Rule 2 for one file: which of the ADDED line numbers carry the theme key in real code (not in a comment).
 * @param {string} fullText the whole file (not the diff: block-comment state needs the lines around the added ones)
 * @param {Iterable<number>} addedLineNumbers 1-based
 */
export function themeKeyLines(fullText, addedLineNumbers) {
  const code = stripComments(fullText);
  const hits = [];
  for (const ln of addedLineNumbers) if (code[ln - 1] !== undefined && themeKeyHit(code[ln - 1])) hits.push(ln);
  return hits;
}
