// Guard for the --base worktree of verify:holo: it must be a LINKED worktree (like pld-wt/h2-base) whose .env* files never point at real data.
// The main checkout has a .env whose DATA_DIR is the real data folder; building or serving it from here would put that folder in reach of a verification run.
// checkBase() returns null (acceptable) or a short reason. The reason NEVER contains a DATA_DIR value or any .env content (it ends up in logs and json).
// Self-test: node scripts/verify/base-guard.selftest.mjs ; integration: verify-holo.selftest.mjs (bg-*).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const gitPath = (root, arg) => {
  const r = spawnSync('git', ['-C', root, 'rev-parse', arg], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const p = path.resolve(root, r.stdout.trim());
  try { return fs.realpathSync(p); } catch { return p; }
};
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const inside = (child, parent) => { const r = path.relative(norm(path.resolve(parent)), norm(path.resolve(child))); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** every .env / .env.* file directly inside each dir */
export function envFilesIn(dirs) {
  const out = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && /^\.env(?:\..*)?$/.test(e.name)).map((e) => e.name).sort(); } catch { /* no such dir */ }
    for (const n of names) out.push(path.join(d, n));
  }
  return out;
}
/** DATA_DIR assignments in .env text: every `DATA_DIR=value` / `export DATA_DIR = "value"` line (the last one wins in dotenv, but every one is checked). */
export function dataDirValues(text) {
  const vals = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?DATA_DIR\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[1];
    const q = /^(["'])(.*)\1/.exec(v);
    v = q ? q[2] : v.replace(/\s+#.*$/, '');
    vals.push(v);
  }
  return vals;
}

/** @param {string} root the --base path @param {{real:string}} o real = the real-data folder name @returns {string|null} a reason (no values), or null when acceptable */
export function checkBase(root, { real }) {
  const gitDir = gitPath(root, '--git-dir'), common = gitPath(root, '--git-common-dir');
  if (!gitDir || !common) return 'base guard: --base is not a readable git worktree (it must be a linked worktree such as pld-wt/h2-base)';
  if (norm(gitDir) === norm(common)) return 'base guard: --base is a main checkout, not a linked worktree (a main checkout can have a .env that points at real data)';
  const example = path.join(root, 'backend', 'data', 'example');
  for (const f of envFilesIn([path.join(root, 'web'), root])) {
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch { return `base guard: cannot read ${path.basename(f)} in --base`; }
    for (const v of dataDirValues(text)) {
      if (!v || v.includes(real) || !inside(path.resolve(root, v), example)) return `base guard: DATA_DIR in ${path.basename(f)} of --base is not the example data (it must point inside backend/data/example)`;
    }
  }
  return null;
}
