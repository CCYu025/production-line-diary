// Path scrubbing for verify:holo evidence (F2). Every file under --out is evidence people paste into reports, so the absolute --base path must not be in any of them, in any spelling.
// Self-test: node scripts/verify/scrub.selftest.mjs
import fs from 'node:fs';
import path from 'node:path';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** one separator in any spelling: / or \ , plain or JSON-escaped (\\) or escaped twice (\\\\), and runs of them (mixed slashes, doubled slashes) */
const SEP = '(?:\\\\|/)+';

/** a regex that matches `absPath` in every spelling of its separators (/ \ \\ \\\\ mixed), case-insensitive (Windows drive letters and folder names) */
export function pathRegex(absPath) {
  const segs = String(absPath).split(/[\\/]+/).filter(Boolean);
  if (!segs.length) return null;
  const lead = /^[\\/]/.test(absPath) ? SEP : '';
  return new RegExp(lead + segs.map(escapeRe).join(SEP), 'gi');
}

/** every spelling of the --base path (as given, resolved, with / or \, JSON-escaped, mixed slashes) becomes `shortName`. `given` is the value of --base as typed (may be relative). */
export function scrubPathText(text, { given, resolved, shortName }) {
  let out = String(text);
  for (const p of new Set([resolved, given].filter((v) => typeof v === 'string' && v.length > 3))) {
    const re = pathRegex(p);
    if (re) out = out.replace(re, shortName);
  }
  return out;
}

const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|bmp|ico|mp4|webm|zip|gz|woff2?|ttf)$/i;
/** rewrite, in place, every file under `dir` that contains the base path (any extension: a path can hide in a file nobody expected); returns the files it changed. Binary files (screenshots, known binary extension or a NUL byte) are left alone. */
export function scrubTree(dir, scrub) {
  const changed = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile() || BINARY_EXT.test(e.name)) continue;
      try {
        const buf = fs.readFileSync(p);
        if (buf.includes(0)) continue;
        const text = buf.toString('utf8');
        const next = scrub(text);
        if (next !== text) { fs.writeFileSync(p, next); changed.push(p); }
      } catch { /* unreadable or locked: leave it; the self-test scans the whole folder */ }
    }
  };
  walk(dir);
  return changed;
}
