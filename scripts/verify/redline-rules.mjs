// Pure helpers for the static red-line scan in verify-holo.mjs (item `redline-grep`). No server, no packages.
// Checked by: node scripts/verify/redline-rules.selftest.mjs
//
// Patterns are assembled from pieces so that no file in the repo contains a ready-made personal path or the theme key as one string.

/**
 * Replace every comment with spaces, KEEPING line numbers, quotes and everything that is real code. Tracks block-comment state across lines
 * (so a line inside a multi-line comment that does not start with `*` is a comment, and `*` + `/` followed by code on the same line is code again),
 * and string state (so `"//"` or `"/*"` inside a string does not start a comment). Strings are kept, because the thing we look for is a quoted string.
 * Known simplification: a regex literal that contains a quote or comment opener can confuse it (stays a heuristic, written down in the README).
 * @param {string} text
 * @returns {string[]} one entry per line
 */
export function stripComments(text) {
  const out = [];
  let state = 'code'; // code | block | line | sq | dq | tpl
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
      else {
        line += c;
        if (c === "'") state = 'sq'; else if (c === '"') state = 'dq'; else if (c === '`') state = 'tpl';
      }
    }
    out.push(line);
  }
  return out;
}

/** the theme preference key as a quoted string (single, double or backtick) */
const THEME_KEY = new RegExp('["\'`]' + ['pld', 'theme'].join('\\.') + '["\'`]');
export const themeKeyHit = (codeLine) => THEME_KEY.test(codeLine);

/**
 * A Windows user-profile path in any letter case, with forward or back slashes, single or double-escaped backslashes (`c:\users\x`, `C:/Users/x`, `C:\\Users\\x`).
 * Unix style `/Users/` and `/home/` stay case-sensitive (that is how those systems spell them).
 */
const WIN_PROFILE = new RegExp('[a-z]:[\\\\/]{1,2}' + 'us' + 'ers' + '[\\\\/]', 'i');
const UNIX_PROFILE = ['/Us' + 'ers/', '/ho' + 'me/'];
export const profilePathHit = (text) => WIN_PROFILE.test(text) || UNIX_PROFILE.some((s) => text.includes(s));

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
