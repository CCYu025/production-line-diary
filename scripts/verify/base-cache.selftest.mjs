// Self-test of base-cache.mjs (the --base cache of verify:holo): node scripts/verify/base-cache.selftest.mjs   (exit 0 = all pass)
// Pure key logic + file handling in a temp folder. The integration with verify-holo.mjs (hit / miss / dirty / --no-cache / corrupt) is in verify-holo.selftest.mjs (b1-*).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CACHE_SCHEMA, MEASURE_ID, buildKey, cacheDirProblem, entryPath, hashDir, hashEnvInputs, hashFile, readEntry, sha256, writeEntry } from './base-cache.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pld-bcst-'));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`PASS ${name}`); };
const REAL = '工作' + '日誌';
const IN = { baseHead: 'a'.repeat(40), clean: true, lockHash: sha256('lock'), node: 'v22.12.0', nodeModulesHash: sha256('installed tree'), envHash: sha256('env'), scripts: { 'os-bundle.mjs': sha256('1'), 'bundle-graph.mjs': sha256('2'), 'holo-baseline.json': sha256('3') } };

ok('key: every component changes the digest (base HEAD, lock hash, node version, each script hash, params, each script name)', () => {
  const d0 = buildKey(IN).digest;
  const variants = {
    nodeModules: { ...IN, nodeModulesHash: sha256('another installed tree') }, env: { ...IN, envHash: sha256('another env') }, head: { ...IN, baseHead: 'b'.repeat(40) }, lock: { ...IN, lockHash: sha256('other lock') }, node: { ...IN, node: 'v24.14.1' }, params: { ...IN, params: MEASURE_ID + '-2' },
    osBundle: { ...IN, scripts: { ...IN.scripts, 'os-bundle.mjs': sha256('x') } }, bundleGraph: { ...IN, scripts: { ...IN.scripts, 'bundle-graph.mjs': sha256('x') } }, baseline: { ...IN, scripts: { ...IN.scripts, 'holo-baseline.json': sha256('x') } },
    extraScript: { ...IN, scripts: { ...IN.scripts, 'new.mjs': sha256('x') } }, missingScript: { ...IN, scripts: { 'os-bundle.mjs': IN.scripts['os-bundle.mjs'], 'bundle-graph.mjs': IN.scripts['bundle-graph.mjs'] } },
  };
  for (const [k, v] of Object.entries(variants)) assert.notEqual(buildKey(v).digest, d0, `changing ${k} must change the key`);
  assert.equal(buildKey({ ...IN, scripts: Object.fromEntries(Object.entries(IN.scripts).reverse()) }).digest, d0, 'the order of the scripts does not matter');
  assert.equal(buildKey(IN).digest, d0, 'deterministic');
});
ok('key (F1): no installed-tree identity or no env hash = NO key (null): missing / undefined / not a sha256 is never an identity', () => {
  for (const bad of ['missing', undefined, null, '', 'abc', sha256('x').toUpperCase()]) {
    assert.equal(buildKey({ ...IN, nodeModulesHash: bad }), null, 'nodeModulesHash ' + String(bad)); assert.equal(buildKey({ ...IN, envHash: bad }), null, 'envHash ' + String(bad));
  }
  assert.notEqual(buildKey(IN), null);
});
ok('hashEnvInputs (F1): editing, adding, removing or renaming any .env* file in any of the dirs changes the hash; VITE_* / NODE_ENV variables count; other files and variables do not', () => {
  const web = path.join(TMP, 'envweb'), root = path.join(TMP, 'envroot'); fs.mkdirSync(web, { recursive: true }); fs.mkdirSync(root, { recursive: true });
  const H = (env = {}) => hashEnvInputs({ dirs: [web, root], env });
  const h0 = H(); assert.match(h0, /^[0-9a-f]{64}$/); assert.equal(H(), h0, 'deterministic');
  fs.writeFileSync(path.join(web, '.env.local'), 'VITE_A=1'); const h1 = H(); assert.notEqual(h1, h0, 'a new web/.env.local');
  fs.writeFileSync(path.join(web, '.env.local'), 'VITE_A=2'); const h2 = H(); assert.notEqual(h2, h1, 'edited content');
  fs.renameSync(path.join(web, '.env.local'), path.join(web, '.env.production.local')); const h3 = H(); assert.notEqual(h3, h2, 'same content under another name');
  fs.writeFileSync(path.join(root, '.env'), 'X=1'); const h4 = H(); assert.notEqual(h4, h3, 'a repo-root .env');
  fs.rmSync(path.join(root, '.env')); assert.equal(H(), h3, 'removed again = the earlier value');
  fs.rmSync(path.join(web, '.env.production.local')); assert.equal(H(), h0, 'all removed = the empty value');
  fs.writeFileSync(path.join(web, '.env'), ''); assert.notEqual(H(), h0, 'an EMPTY .env file is different from no file');
  fs.rmSync(path.join(web, '.env'));
  fs.writeFileSync(path.join(web, 'env.txt'), 'x'); fs.writeFileSync(path.join(web, '.envrc'), 'x'); fs.writeFileSync(path.join(web, 'x.env'), 'x'); assert.equal(H(), h0, 'files that vite does not read as env files are not part of it');
  const e1 = H({ VITE_FOO: '1' }); assert.notEqual(e1, h0); assert.notEqual(H({ VITE_FOO: '2' }), e1); assert.notEqual(H({ NODE_ENV: 'production' }), h0);
  assert.equal(H({ OTHER: '1', PATH: 'x' }), h0, 'variables vite does not expose are not part of it');
  assert.equal(hashEnvInputs({ dirs: [path.join(TMP, 'no-such-dir'), root], env: {} }) === hashEnvInputs({ dirs: [path.join(TMP, 'no-such-dir-2'), root], env: {} }), true, 'a missing directory is the same as one without env files');
});
ok('key: a dirty or unknown base worktree has NO key (null): it can neither read nor write the cache', () => {
  assert.equal(buildKey({ ...IN, clean: false }), null); assert.equal(buildKey({ ...IN, baseHead: null }), null); assert.equal(buildKey({ ...IN, baseHead: '' }), null);
  assert.notEqual(buildKey(IN), null);
});
ok('key: the summary carries every component (what json / log show) and the schema', () => {
  const k = buildKey(IN);
  assert.equal(k.summary.baseHead, IN.baseHead); assert.equal(k.summary.lockHash, IN.lockHash); assert.equal(k.summary.nodeModulesHash, IN.nodeModulesHash); assert.equal(k.summary.envHash, IN.envHash); assert.equal(k.summary.node, IN.node); assert.equal(k.summary.params, MEASURE_ID); assert.equal(k.summary.schema, CACHE_SCHEMA);
  assert.deepEqual(Object.keys(k.summary.scripts), ['bundle-graph.mjs', 'holo-baseline.json', 'os-bundle.mjs']);
});

const key = buildKey(IN);
const V = { distHash: sha256('dist'), builtAt: '2026-11-18T10:00:00.000Z', entryGzip: 1234, measuredAt: '2026-11-18T10:01:00.000Z' };
ok('entry: write then read round-trips (with and without a measurement); a missing file is a miss', () => {
  const dir = path.join(TMP, 'rt');
  assert.equal(readEntry(dir, key), null);
  assert.equal(writeEntry(dir, key, { distHash: V.distHash, builtAt: V.builtAt }), true);
  assert.deepEqual({ ...readEntry(dir, key) }.entryGzip, null); assert.equal(readEntry(dir, key).distHash, V.distHash);
  assert.equal(writeEntry(dir, key, V), true);
  const e = readEntry(dir, key); assert.equal(e.entryGzip, 1234); assert.equal(e.measuredAt, V.measuredAt); assert.equal(e.digest, key.digest);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no temp file left');
});
ok('entry: another key never reads this entry (different digest, or the same file renamed to another digest)', () => {
  const dir = path.join(TMP, 'other'); writeEntry(dir, key, V);
  const k2 = buildKey({ ...IN, baseHead: 'c'.repeat(40) });
  assert.equal(readEntry(dir, k2), null);
  fs.copyFileSync(entryPath(dir, key.digest), entryPath(dir, k2.digest)); // entry content belongs to key, file name says k2
  assert.equal(readEntry(dir, k2), null, 'the stored digest / key summary must match the one asked for');
});
ok('entry: corrupt or malformed content is a miss, never a hit and never a throw', () => {
  const dir = path.join(TMP, 'bad'); writeEntry(dir, key, V); const f = entryPath(dir, key.digest); const good = JSON.parse(fs.readFileSync(f, 'utf8'));
  const bad = {
    garbage: 'x{', empty: '', nul: 'null', arr: '[]', num: '5', str: '"s"', schema: { ...good, schema: 2 }, digest: { ...good, digest: 'z' }, key: { ...good, key: { ...good.key, node: 'v1' } }, keyMissing: { ...good, key: undefined },
    dist: { ...good, distHash: 'abc' }, distUpper: { ...good, distHash: good.distHash.toUpperCase() }, distNum: { ...good, distHash: 5 }, built: { ...good, builtAt: 'nope' }, builtMissing: { ...good, builtAt: undefined },
    gzStr: { ...good, entryGzip: '1234' }, gzNeg: { ...good, entryGzip: -1 }, gzNaN: { ...good, entryGzip: null, measuredAt: good.measuredAt }, gzInf: '{"entryGzip":1e999}', gzUndef: { ...good, entryGzip: undefined }, gzBool: { ...good, entryGzip: true },
    measured: { ...good, measuredAt: 'later' }, measuredMissing: { ...good, measuredAt: null },
  };
  bad.gzNaN = JSON.stringify({ ...good, entryGzip: 'NaN' });
  for (const [k, v] of Object.entries(bad)) {
    fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v));
    let r; try { r = readEntry(dir, key); } catch (e) { assert.fail(`${k}: readEntry threw ${e.message}`); }
    assert.equal(r, null, `${k} must be a miss`);
  }
  fs.writeFileSync(f, JSON.stringify(good)); assert.notEqual(readEntry(dir, key), null, 'control: the unmodified entry hits');
  fs.rmSync(f); fs.mkdirSync(f); assert.equal(readEntry(dir, key), null, 'a directory in place of the file is a miss');
});
ok('entry: an unwritable location returns false (never throws): the cache folder path is an existing file', () => {
  const file = path.join(TMP, 'a-file'); fs.writeFileSync(file, 'x');
  assert.equal(writeEntry(file, key, V), false); assert.equal(writeEntry(path.join(file, 'sub'), key, V), false); assert.equal(readEntry(file, key), null);
});
ok('hashDir / hashFile: any content change, rename, added or removed file changes the hash; nested files count; missing dir = null, missing file = "missing"', () => {
  const d = path.join(TMP, 'dist'); fs.mkdirSync(path.join(d, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(d, 'index.html'), 'a'); fs.writeFileSync(path.join(d, 'assets', 'x.js'), 'b');
  const h0 = hashDir(d); assert.match(h0, /^[0-9a-f]{64}$/); assert.equal(hashDir(d), h0);
  fs.writeFileSync(path.join(d, 'assets', 'x.js'), 'c'); const h1 = hashDir(d); assert.notEqual(h1, h0);
  fs.renameSync(path.join(d, 'assets', 'x.js'), path.join(d, 'assets', 'y.js')); const h2 = hashDir(d); assert.notEqual(h2, h1);
  fs.writeFileSync(path.join(d, 'new.txt'), ''); const h3 = hashDir(d); assert.notEqual(h3, h2);
  fs.rmSync(path.join(d, 'new.txt')); assert.equal(hashDir(d), h2);
  assert.equal(hashDir(path.join(TMP, 'nope')), null); assert.equal(hashFile(path.join(TMP, 'nope')), 'missing'); assert.equal(hashFile(path.join(d, 'index.html')), sha256('a'));
});
ok('cacheDirProblem: absolute only; not the real-data folder name; not inside the repo or the --base worktree (also not equal to them); an unrelated absolute path is fine', () => {
  const repo = path.join(TMP, 'repo'); const base = path.join(TMP, 'base'); const o = { real: REAL, forbiddenRoots: [repo, base, null] };
  assert.equal(cacheDirProblem(path.join(TMP, 'cache'), o), null);
  assert.equal(cacheDirProblem(path.join(TMP, 'repo-sibling', 'c'), o), null, 'a sibling whose name merely starts like the repo is not inside it');
  for (const [k, d] of Object.entries({ rel: 'cache', dot: './cache', empty: '', real: path.join(TMP, 'x' + REAL), inRepo: path.join(repo, 'a'), repoItself: repo, inBase: path.join(base, 'deep', 'er'), baseItself: base })) assert.notEqual(cacheDirProblem(d, o), null, `${k} must be refused`);
  assert.equal(cacheDirProblem(undefined, o), 'empty path');
});
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${n} passed`);
