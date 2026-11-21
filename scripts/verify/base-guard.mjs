// Guard for the --base worktree of verify:holo. A whitelist, no parsing:
//  (1) --base must be a LINKED worktree (like pld-wt/h2-base), never the main checkout (whose .env points at the real data);
//  (2) the base worktree must contain NO entry called .env or .env.* (any letter case, anywhere in the tree) except a template file (.env.example / .env.sample / .env.template) that git tracks
//      and whose content equals HEAD. Files, directories, symlinks, junctions and broken links all count; file CONTENT IS NEVER READ OR PARSED.
// Why: the base is a worktree we create ourselves and serve.mjs sets DATA_DIR for it, so it never needs a .env; refusing every .env is simpler and safer than judging what is inside one
// (dotenv / node parsing quirks, links, case-insensitive file systems all made a content check a way to be fooled).
// Excluded from the scan (never loaded by the app or by Vite, and build output): .git, <base>/node_modules, <base>/web/node_modules, <base>/web/dist.
// checkBase() returns null (acceptable) or a short reason (it may name a relative path of an offending entry, never any content).
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

const gitPath = (root, arg) => {
  const r = git(root, 'rev-parse', arg);
  if (r.status !== 0) return null;
  try { return fs.realpathSync(path.resolve(root, r.stdout.trim())); } catch { return null; } // realpath failure = not readable = refused
};
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** tracked template files: nothing loads them (the app starts with --env-file-if-exists=.env, Vite reads .env, .env.local, .env.[mode], .env.[mode].local) */
export const TEMPLATE_ENV = /^\.env\.(?:example|sample|template)$/i;

/** a template is skipped only when git TRACKS it (in the index) AND its working-tree content is identical to HEAD (same blob; a staged or unstaged edit, or a file not in HEAD, is not). Any git failure = false (fail closed: the file is judged). */
export function isPristineTracked(root, file) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (git(root, 'ls-files', '--error-unmatch', '--', rel).status !== 0) return false;
  const head = git(root, 'rev-parse', '--verify', '-q', 'HEAD:' + rel), work = git(root, 'hash-object', '--', file);
  return head.status === 0 && work.status === 0 && head.stdout.trim() !== '' && head.stdout.trim() === work.stdout.trim();
}

/** true when ANY of the names an entry goes by looks like an env file: its own name, the name its realpath ends in, and (for a link) the name its target ends in */
function envLike(full, dirent) {
  if (ENV_NAME.test(dirent.name)) return true;
  try { if (ENV_NAME.test(path.basename(fs.realpathSync(full)))) return true; } catch { /* broken link: realpath fails, the other names still count */ }
  if (dirent.isSymbolicLink()) { try { if (ENV_NAME.test(path.basename(fs.readlinkSync(full)))) return true; } catch { /* unreadable link: its own name was already checked */ } }
  return false;
}

/** every offending entry (relative path, forward slashes) under root, skipping the excluded folders; a folder that cannot be listed is reported as an offence too (fail closed) */
export function envOffenders(root) {
  const skip = new Set([norm(path.join(root, '.git')), norm(path.join(root, 'node_modules')), norm(path.join(root, 'web', 'node_modules')), norm(path.join(root, 'web', 'dist'))]);
  const found = [];
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { found.push(`${rel(dir) || '.'} (cannot be listed)`); return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (skip.has(norm(full))) continue;
      if (envLike(full, e)) {
        const plainFile = e.isFile() && !e.isSymbolicLink();
        if (plainFile && TEMPLATE_ENV.test(e.name) && isPristineTracked(root, full)) continue; // the only exception: an untouched, tracked template
        found.push(rel(full));
        continue;
      }
      if (e.isDirectory() && !e.isSymbolicLink()) walk(full); // links and junctions are never followed
    }
  };
  walk(root);
  return found;
}

/** @param {string} root the --base path @param {{env?:object}} o env = the environment to look for GIT_* variables in @returns {string|null} a reason (no content), or null when acceptable */
export function checkBase(root, { env = process.env } = {}) {
  const set = GIT_REDIRECT_VARS.filter((k) => env[k]);
  if (set.length) return `base guard: the environment variable ${set.join(', ')} is set; git would answer for another repository, so the base cannot be judged (unset it)`;
  const gitDir = gitPath(root, '--git-dir'), common = gitPath(root, '--git-common-dir');
  if (!gitDir || !common) return 'base guard: --base is not a readable git worktree (it must be a linked worktree such as pld-wt/h2-base)';
  if (norm(gitDir) === norm(common)) return 'base guard: --base is a main checkout, not a linked worktree (a main checkout can have a .env that points at real data)';
  const bad = envOffenders(root);
  if (bad.length) return `base guard: --base contains ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ` and ${bad.length - 3} more` : ''} (an .env* entry that is not an untouched, tracked template); a base worktree needs no .env, remove it`;
  return null;
}
