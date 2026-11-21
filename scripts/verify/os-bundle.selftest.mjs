// Self-test of os-bundle.mjs on FAKE dists (no build, no browser, no server): node scripts/verify/os-bundle.selftest.mjs   (exit 0 = all pass)
// Pins the designer ruling of 2026-11-19: the cumulative entry check (P4a, <= baseline + 2048 B) is judged on the DEFAULT build only; the lab build (--expect-holo) records the delta and does not
// judge it, while everything else on the lab build (holo-core limit, holo-core present) and the "lab route never leaks into the default build" check (A5-holo) keep failing the run.
// Every case here has a mutation that makes it fail (the PR body lists them).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-obst-'));
let n = 0, seq = 0;
const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };
const gz = (s) => zlib.gzipSync(Buffer.from(s), { level: 9 }).length;
/** text that does not compress: base64 of random bytes, roughly `bytes` of gzip output */
const noise = (bytes) => crypto.randomBytes(Math.ceil(bytes * 1.05)).toString('base64');

/** a fake dist: index.html -> assets/index.js (the entry, `entryBody` of filler), plus any extra files {relPath: text} and an optional manifest. Returns the dist folder and the entry's exact gzip size. */
function mkDist({ entryExtra = '', entryNoise = 4000, files = {}, manifest = null }) {
  const dist = path.join(TMP, `dist${++seq}`);
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><script type="module" src="/assets/index.js"></script>');
  const entry = `${entryExtra}\nexport const filler="${noise(entryNoise)}";\n`;
  fs.writeFileSync(path.join(dist, 'assets', 'index.js'), entry);
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dist, f)), { recursive: true }); fs.writeFileSync(path.join(dist, f), t); }
  if (manifest) { fs.mkdirSync(path.join(dist, '.vite'), { recursive: true }); fs.writeFileSync(path.join(dist, '.vite', 'manifest.json'), JSON.stringify(manifest)); }
  return { dist, entryGzip: gz(entry) };
}
const holoManifest = (file = 'assets/holo-core.js') => ({ 'src/main.tsx': { file: 'assets/index.js', isEntry: true }, 'src/features/holo/lab/HoloLabPage.tsx': { file, src: 'src/features/holo/lab/HoloLabPage.tsx', isDynamicEntry: true } });
function run(dist, args0 = []) {
  // a negative number must be glued on (parseArgs reads a bare -N as an option)
  const args = []; for (let i = 0; i < args0.length; i++) { if (args0[i] === '--baseline') args.push('--baseline=' + args0[++i]); else args.push(args0[i]); }
  const json = path.join(TMP, `r${++seq}.json`);
  const r = spawnSync(process.execPath, [path.join(HERE, 'os-bundle.mjs'), '--dist', dist, '--json', json, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr, j: fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, 'utf8')) : null };
}
const DELTA = 2048;

ok('default build, entry within baseline + 2048 B: PASS; entry over baseline + 2048 B: FAIL with P4 (this is what ci-bundle judges)', () => {
  const d = mkDist({});
  const good = run(d.dist, ['--baseline', String(d.entryGzip - DELTA)]); assert.equal(good.code, 0, good.out); assert.match(good.out, /P4a PASS/);
  const bad = run(d.dist, ['--baseline', String(d.entryGzip - DELTA - 1)]); assert.equal(bad.code, 1, bad.out); assert.match(bad.out, /P4a FAIL/); assert.ok(bad.j.fails.some((f) => /^P4: entry gzip/.test(f)));
  assert.equal(bad.j.p4Judged, true); assert.equal(bad.j.deltaBytes, DELTA + 1);
});
ok('lab build (--expect-holo): entry over baseline + 2048 B does NOT fail on P4; the delta is recorded (p4Judged false, deltaBytes) and printed as INFO', () => {
  const d = mkDist({ entryExtra: 'const lab="HoloLabPage /_holo";', manifest: holoManifest(), files: { 'assets/holo-core.js': 'export const x="__holoLab";' } });
  const r = run(d.dist, ['--expect-holo', '--baseline', String(d.entryGzip - 5000)]);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /P4a INFO delta \+5000 B/); assert.doesNotMatch(r.out, /P4a FAIL/); assert.deepEqual(r.j.fails, []);
  assert.equal(r.j.p4Judged, false); assert.equal(r.j.deltaBytes, 5000); assert.equal(r.j.baseline, d.entryGzip - 5000);
});
ok('lab build: the other checks still fail it - holo-core over its 220 KiB limit, and --expect-holo with no holo-core chunk at all', () => {
  const big = mkDist({ entryExtra: 'const lab="HoloLabPage";', manifest: holoManifest(), files: { 'assets/holo-core.js': `export const x="__holoLab";export const pad="${noise(230 * 1024)}";` } });
  const a = run(big.dist, ['--expect-holo', '--baseline', String(big.entryGzip)]);
  assert.equal(a.code, 1, a.out); assert.ok(a.j.fails.some((f) => /^HB4: holo-core gzip \d+ B > 225280 B/.test(f)), a.out); assert.match(a.out, /P4a INFO/);
  const none = mkDist({});
  const b = run(none.dist, ['--expect-holo', '--baseline', String(none.entryGzip)]);
  assert.equal(b.code, 1, b.out); assert.ok(b.j.fails.some((f) => /^A5-holo: --expect-holo but no holo-core chunk/.test(f)));
});
ok('lab build: an A5 violation in the entry static graph (holo engine code in the entry) still fails it', () => {
  const d = mkDist({ entryExtra: 'const e="__holoLab";', manifest: holoManifest(), files: { 'assets/holo-core.js': 'export const x=1;' } });
  const r = run(d.dist, ['--expect-holo', '--baseline', String(d.entryGzip)]);
  assert.equal(r.code, 1, r.out); assert.ok(r.j.fails.some((f) => /^A5: static graph chunk/.test(f)));
});
ok('A5-holo (default build): features/holo in the manifest, or a holo marker in ANY dist file (lazy js, css), FAILs the run - the lab route cannot leak into the shipped build', () => {
  const clean = mkDist({});
  assert.equal(run(clean.dist, ['--baseline', String(clean.entryGzip)]).code, 0, 'control: a clean default dist passes');
  const viaManifest = mkDist({ manifest: holoManifest('assets/other.js'), files: { 'assets/other.js': 'export const x=1;' } });
  const m = run(viaManifest.dist, ['--baseline', String(viaManifest.entryGzip)]);
  assert.equal(m.code, 1, m.out); assert.ok(m.j.fails.some((f) => /^A5-holo: default build contains holo code: manifest source src\/features\/holo\//.test(f)), m.out);
  for (const [k, files] of Object.entries({ lazyJsEngine: { 'assets/lazy.js': 'export const x="__holoLab";' }, lazyJsRoute: { 'assets/lazy.js': 'export const x="/_holo";' }, css: { 'assets/a.css': '.holo-slate{color:red}' }, nestedJs: { 'assets/sub/deep.js': 'export const x="HoloLabPage";' } })) {
    const d = mkDist({ files }); const r = run(d.dist, ['--baseline', String(d.entryGzip)]);
    assert.equal(r.code, 1, `${k}: ${r.out}`); assert.ok(r.j.fails.some((f) => /^A5-holo: default build contains holo code/.test(f)), k); assert.match(r.out, /A5-holo FAIL/);
  }
});
ok('the lab route marker in the ENTRY of a default build is an A5 failure too (it is only allowed with --expect-holo)', () => {
  const d = mkDist({ entryExtra: 'const lab="HoloLabPage";' });
  const a = run(d.dist, ['--baseline', String(d.entryGzip)]); assert.equal(a.code, 1, a.out); assert.ok(a.j.fails.some((f) => /holo route/.test(f)));
});
ok('A5-holo is not applied to a lab build (control: the same holo files pass --expect-holo, fail without it)', () => {
  const d = mkDist({ entryExtra: 'const lab="HoloLabPage";', manifest: holoManifest(), files: { 'assets/holo-core.js': 'export const x="__holoLab";' } });
  assert.equal(run(d.dist, ['--expect-holo', '--baseline', String(d.entryGzip)]).code, 0);
  assert.equal(run(d.dist, ['--baseline', String(d.entryGzip)]).code, 1);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} passed`);
