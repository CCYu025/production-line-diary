// Guard for the --base worktree of verify:holo: it must be a LINKED worktree (like pld-wt/h2-base) whose .env* files never point at real data.
// The main checkout has a .env whose DATA_DIR is the real data folder; building or serving it from here would put that folder in reach of a verification run.
// Principle: FAIL CLOSED. This file does not try to reproduce how node / dotenv parse a .env file; anything it cannot judge with certainty is a refusal.
// checkBase() returns null (acceptable) or a short reason. The reason NEVER contains a DATA_DIR value or any .env content (it ends up in logs and json).
// Self-test: node scripts/verify/base-guard.selftest.mjs ; integration: verify-holo.selftest.mjs (bg-*).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ENV_NAME } from './base-cache.mjs';

/** the git variables that redirect which repository / index / work tree git looks at: a run that has any of them set could be answering for another repository */
export const GIT_REDIRECT_VARS = ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];
/** environment for the guard's own git calls: the redirecting variables removed (checkBase refuses before that when one is set; this keeps every other caller correct too) */
export function gitEnv(env = process.env) { const e = { ...env }; for (const k of GIT_REDIRECT_VARS) delete e[k]; return e; }
const git = (root, ...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', env: gitEnv() });

/** realpath of p, or of its nearest existing ancestor plus the missing rest. A dangling link, or any failure other than "does not exist", throws (callers fail closed). */
function realish(p) {
  let cur = path.resolve(p); const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
      let exists = true; try { fs.lstatSync(cur); } catch { exists = false; }
      if (exists) throw e; // there is an entry (a dangling link) but it resolves to nothing
      const parent = path.dirname(cur); if (parent === cur) throw e;
      rest.push(path.basename(cur)); cur = parent;
    }
  }
}
const gitPath = (root, arg) => {
  const r = git(root, 'rev-parse', arg);
  if (r.status !== 0) return null;
  try { return fs.realpathSync(path.resolve(root, r.stdout.trim())); } catch { return null; } // realpath failure = not readable = refused
};
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const inside = (child, parent) => { const r = path.relative(norm(parent), norm(child)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** every entry called .env or .env.* (any letter case, any entry type: files, links, junctions, directories) directly inside each dir; the caller judges what each one is */
export function envFilesIn(dirs) {
  const out = [];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d).filter((n) => ENV_NAME.test(n)).sort(); } catch { /* no such dir */ }
    for (const n of names) out.push(path.join(d, n));
  }
  return out;
}
/** raw DATA_DIR assignments in .env text, exactly as written after the first "=" (trimmed): every `DATA_DIR=value` / `export DATA_DIR = value` line. No unquoting, no comment stripping: see dataDirAmbiguous. */
export function dataDirValues(text) {
  const vals = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?DATA_DIR\s*=\s*(.*?)\s*$/.exec(line);
    if (m) vals.push(m[1]);
  }
  return vals;
}
/** true when the value is anything but a plain path: quotes of any kind, #, $, another "=", an escape sequence (a backslash before n t r b f v 0 or another backslash, or a trailing backslash; backslashes as Windows separators are fine), or a ".." segment */
export function dataDirAmbiguous(v) {
  return /["'`#$=]/.test(v) || /\\[ntrbfv0\\]/.test(v) || v.endsWith('\\') || v.split(/[\\/]+/).includes('..');
}

/** tracked template files: nothing loads them (the app starts with --env-file-if-exists=.env, Vite reads .env, .env.local, .env.[mode], .env.[mode].local), and the repo's own .env.example has a placeholder DATA_DIR on purpose */
export const TEMPLATE_ENV = /^\.env\.(?:example|sample|template)$/i;

/** a template is skipped only when git TRACKS it (in the index) AND its working-tree content is identical to HEAD (same blob; a staged or unstaged edit, or a file not in HEAD, is not). Any git failure = false (fail closed: the file is judged). */
export function isPristineTracked(root, file) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (git(root, 'ls-files', '--error-unmatch', '--', rel).status !== 0) return false;
  const head = git(root, 'rev-parse', '--verify', '-q', 'HEAD:' + rel), work = git(root, 'hash-object', '--', file);
  return head.status === 0 && work.status === 0 && head.stdout.trim() !== '' && head.stdout.trim() === work.stdout.trim();
}

/** @param {string} root the --base path @param {{real:string, env?:object}} o real = the real-data folder name @returns {string|null} a reason (no values), or null when acceptable */
export function checkBase(root, { real, env = process.env }) {
  const set = GIT_REDIRECT_VARS.filter((k) => env[k]);
  if (set.length) return `base guard: the environment variable ${set.join(', ')} is set; git would answer for another repository, so the base cannot be judged (unset it)`;
  const gitDir = gitPath(root, '--git-dir'), common = gitPath(root, '--git-common-dir');
  if (!gitDir || !common) return 'base guard: --base is not a readable git worktree (it must be a linked worktree such as pld-wt/h2-base)';
  if (norm(gitDir) === norm(common)) return 'base guard: --base is a main checkout, not a linked worktree (a main checkout can have a .env that points at real data)';
  let example;
  try {
    const realRoot = realish(root);
    example = realish(path.join(root, 'backend', 'data', 'example'));
    if (!inside(example, realRoot)) return 'base guard: backend/data/example of --base resolves outside the base worktree (a link)';
  } catch { return 'base guard: backend/data/example of --base cannot be resolved'; }
  for (const f of envFilesIn([path.join(root, 'web'), root])) {
    const name = path.basename(f);
    if (TEMPLATE_ENV.test(name) && isPristineTracked(root, f)) continue; // only an untouched, tracked template is skipped; anything else is judged
    let text;
    try {
      if (!fs.statSync(f).isFile()) return `base guard: ${name} in --base is not a regular file (directory or link to one)`; // statSync follows links
      text = fs.readFileSync(f, 'utf8');
    } catch { return `base guard: cannot read ${name} in --base (unreadable or a broken link)`; }
    const vals = dataDirValues(text);
    if (new Set(vals).size > 1) return `base guard: DATA_DIR in ${name} of --base is defined more than once with different values`;
    for (const v of vals) {
      if (!v) return `base guard: DATA_DIR in ${name} of --base is empty`;
      if (v.includes(real)) return `base guard: DATA_DIR in ${name} of --base is not the example data (it must point inside backend/data/example)`;
      if (dataDirAmbiguous(v)) return `base guard: DATA_DIR in ${name} of --base is ambiguous (quotes, #, $, =, escape sequences or ..); it must be a plain path inside backend/data/example`;
      let where;
      try { where = realish(path.resolve(root, v)); } catch { return `base guard: DATA_DIR in ${name} of --base cannot be resolved (broken link)`; }
      if (!inside(where, example)) return `base guard: DATA_DIR in ${name} of --base is not the example data (it must point inside backend/data/example)`;
    }
  }
  return null;
}
