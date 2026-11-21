// A5 + P4 + HB4: bundle checks on a built web/dist, grouped (docs/holo-mode-spec.md section 10.2).
//   A5: the entry's STATIC import graph must contain no three/r3f/OS chunk, and no holo code.
//   A5-holo: default build only - the WHOLE dist (manifest sources + every JS/CSS file) has no features/holo code.
//   P4: entry (static graph) JS gzip must not exceed baseline + 2048 B. DEFAULT build only: with --expect-holo (lab build, never shipped) the delta is printed and put in the json, not judged.
//   HB4 groups, each with its own gzip limit (JS only, KiB = 1024 B):
//     os 300 KiB (unchanged definition)  |  holo-core 220 KiB  |  holo-ch01 .. holo-ch07 60 KiB each.
//     A chunk is counted once, in the first group that reaches it (os first), so three shared with OS is not counted twice.
//     Groups come from dist/.vite/manifest.json (Vite build.manifest): a lazy chunk whose source is src/features/holo/** is
//     holo-core, src/features/holo/(channels/)ch0N/** is holo-chN; each group = those chunks + their static imports that are
//     not already in the entry graph or an earlier group.
//     A group with no chunks prints SKIP (not built yet) and never fails.
//   --expect-holo: the dist is the lab build (VITE_HOLO_LAB=1); holo-core must exist (and is measured), A5-holo is not applied, P4a (entry delta) is recorded but not judged.
// node scripts/verify/os-bundle.mjs [--dist web/dist] [--baseline <bytes>] [--write-baseline] [--expect-holo] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { analyze, NAME_RE } from './bundle-graph.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const { values: A } = parseArgs({
  options: {
    dist: { type: 'string', default: path.join(REPO, 'web', 'dist') },
    baseline: { type: 'string' },
    'baseline-file': { type: 'string', default: path.join(HERE, 'bundle-baseline.json') },
    'write-baseline': { type: 'boolean', default: false },
    'expect-holo': { type: 'boolean', default: false },
    json: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (A.help) { console.log('node scripts/verify/os-bundle.mjs [--dist web/dist] [--baseline <bytes>] [--baseline-file f] [--write-baseline] [--expect-holo] [--json out.json]'); process.exit(0); }

const DELTA_LIMIT = 2048;          // P4: entry gzip may grow by at most 2 KiB vs baseline
const KIB = 1024;
const LIMITS = { os: 300 * KIB, 'holo-core': 220 * KIB, channel: 60 * KIB };
// Strings that only exist in holo engine code / styles (not the generic word "holo": the OS HUD has a holo-slot class).
const HOLO_ENGINE_MARKERS = ['__holoLab', 'holo-slate', 'holo-root', 'holo-world'];
// Strings that only exist where the lab route is wired in (entry of a lab build legitimately has them).
const HOLO_ROUTE_MARKERS = ['HoloLabPage', '/_holo'];
const HOLO_SRC_RE = /(^|\/)features\/holo\//;
const CHANNEL_SRC_RE = /(^|\/)features\/holo\/(?:channels\/)?ch0([1-7])(?:[\/._-]|$)/;

const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
let G;
try { G = analyze(A.dist); } catch (e) { console.error('FAIL: ' + e.message); process.exit(2); }
for (const w of G.warnings) console.warn('WARN: ' + w);
const { dist, rel, cssFiles, staticGraph, lazyJs, markersOf, closure, allJs } = G;

// ---- manifest: chunk file -> original source module (dynamic entries only have one)
const manifestFile = path.join(dist, '.vite', 'manifest.json');
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* old build without manifest */ }
const srcOfFile = new Map();
const manifestSources = [];
if (manifest) {
  for (const [key, v] of Object.entries(manifest)) {
    manifestSources.push(v.src ?? key);
    if (v.file && /\.m?js$/.test(v.file) && v.src) srcOfFile.set(path.join(dist, v.file), v.src);
  }
} else console.warn(`WARN: ${manifestFile} not found - holo groups fall back to content markers (build with the current vite config for exact groups)`);

const readText = (f) => fs.readFileSync(f, 'utf8');
const holoEngineMarkersOf = (f) => { const t = readText(f); return HOLO_ENGINE_MARKERS.filter((m) => t.includes(m)); };
const holoRouteMarkersOf = (f) => { const t = readText(f); return HOLO_ROUTE_MARKERS.filter((m) => t.includes(m)); };

// ---- A5 (entry static graph)
const violations = [];
for (const f of staticGraph) {
  const reasons = [];
  if (NAME_RE.test(path.basename(f))) reasons.push('file name matches three|fiber|OsShell|features/os');
  const mk = markersOf(f); if (mk.length) reasons.push('contains ' + mk.join(','));
  const hk = holoEngineMarkersOf(f); if (hk.length) reasons.push('contains holo code ' + hk.join(','));
  if (!A['expect-holo']) { const rk = holoRouteMarkersOf(f); if (rk.length) reasons.push('contains holo route ' + rk.join(',')); }
  if (reasons.length) violations.push({ file: rel(f), reasons });
}

// ---- A5-holo (whole dist, default build)
const holoLeaks = [];
for (const s of manifestSources) if (HOLO_SRC_RE.test(s)) holoLeaks.push(`manifest source ${s}`);
const textFiles = [...allJs, ...cssFiles.filter((f) => fs.existsSync(f))];
(function walkCss(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '.vite') walkCss(p); } else if (/\.css$/.test(e.name) && !textFiles.includes(p)) textFiles.push(p); } })(dist);
for (const f of textFiles) {
  const hk = [...holoEngineMarkersOf(f), ...holoRouteMarkersOf(f)];
  if (hk.length) holoLeaks.push(`${rel(f)} contains ${hk.join(',')}`);
}

// ---- groups (JS only; each chunk counted once, first group wins)
const assigned = new Set([...staticGraph]);
const seedsAll = lazyJs.filter((f) => {
  const src = srcOfFile.get(f);
  if (src) return HOLO_SRC_RE.test(src);
  return !manifest && holoEngineMarkersOf(f).length > 0; // fallback without manifest
});
const channelOf = (f) => { const m = CHANNEL_SRC_RE.exec(srcOfFile.get(f) ?? ''); return m ? m[2] : null; };
const osFiles = [...G.osLazy].filter((f) => !seedsAll.includes(f)).sort();
for (const f of osFiles) assigned.add(f);
const groupFiles = (seeds) => {
  const files = [...closure(seeds, assigned)].filter((f) => !assigned.has(f)).sort();
  for (const f of files) assigned.add(f);
  return files;
};
const coreSeeds = seedsAll.filter((f) => !channelOf(f));
const groups = [{ id: 'os', limit: LIMITS.os, files: osFiles }, { id: 'holo-core', limit: LIMITS['holo-core'], files: groupFiles(coreSeeds) }];
for (let n = 1; n <= 7; n++) groups.push({ id: `holo-ch0${n}`, limit: LIMITS.channel, files: groupFiles(seedsAll.filter((f) => channelOf(f) === String(n))) });

// ---- sizes
const sizeOf = (files) => files.reduce((s, f) => s + gz(fs.readFileSync(f)), 0);
const entryJs = [...staticGraph].sort();
const entryGzip = sizeOf(entryJs);
const cssGzip = sizeOf(cssFiles.filter((f) => fs.existsSync(f)));
for (const g of groups) g.gzip = sizeOf(g.files);
const osGroup = groups[0];

console.log(`dist: ${dist}${A['expect-holo'] ? '   (--expect-holo: lab build)' : ''}`);
console.log(`\nEntry static graph (${entryJs.length} chunks):`);
for (const f of entryJs) console.log(`  ${rel(f)}  gzip ${gz(fs.readFileSync(f))} B`);
console.log(`\nEntry CSS (${cssFiles.length}):`);
for (const f of cssFiles) console.log(`  ${rel(f)}  gzip ${fs.existsSync(f) ? gz(fs.readFileSync(f)) : '?'} B`);
console.log(`\nLazy JS chunks not in entry static graph (${lazyJs.length}):`);
for (const f of lazyJs.slice().sort()) {
  const g = groups.find((x) => x.files.includes(f));
  console.log(`  ${rel(f)}${g ? `   [${g.id}]` : ''}`);
}
console.log('\nGroups (gzip -9, JS only):');
for (const g of groups) {
  if (!g.files.length) { console.log(`  ${g.id.padEnd(10)}: SKIP (not built yet)`); continue; }
  console.log(`  ${g.id.padEnd(10)}: ${String(g.files.length).padStart(2)} chunks  ${g.gzip} B (${(g.gzip / KIB).toFixed(1)} KiB)  limit ${g.limit} B (${g.limit / KIB} KiB)`);
  for (const f of g.files) console.log(`      ${rel(f)}  gzip ${gz(fs.readFileSync(f))} B`);
}
console.log('\nSizes (gzip -9):');
console.log(`  web entry JS (static graph): ${entryGzip} B (${(entryGzip / KIB).toFixed(1)} KiB)`);
console.log(`  entry CSS                  : ${cssGzip} B (${(cssGzip / KIB).toFixed(1)} KiB)`);
console.log(`  OS lazy JS total           : ${osGroup.gzip} B (${(osGroup.gzip / KIB).toFixed(1)} KiB)  limit ${LIMITS.os} B`);

if (A['write-baseline']) {
  fs.writeFileSync(A['baseline-file'], JSON.stringify({ entryGzipBytes: entryGzip, cssGzipBytes: cssGzip, note: 'gzip -9 of entry static-graph JS; written by os-bundle.mjs --write-baseline' }, null, 2) + '\n');
  console.log(`\nBaseline written: ${A['baseline-file']}`);
}

const fails = [];
console.log('\nChecks:');
// A5
if (violations.length) { for (const v of violations) fails.push(`A5: static graph chunk ${v.file}: ${v.reasons.join('; ')}`); console.log('  A5 FAIL'); }
else console.log('  A5 PASS  (no three/r3f/OS/holo chunk in entry static graph)');
// A5-holo
if (A['expect-holo']) {
  if (!groups[1].files.length) { fails.push('A5-holo: --expect-holo but no holo-core chunk was found (is this a VITE_HOLO_LAB=1 build?)'); console.log('  A5-holo FAIL (no holo-core chunk in a lab build)'); }
  else console.log('  A5-holo n/a (lab build: holo-core present, measured above)');
} else if (holoLeaks.length) { for (const l of holoLeaks) fails.push(`A5-holo: default build contains holo code: ${l}`); console.log('  A5-holo FAIL'); }
else console.log('  A5-holo PASS (no features/holo anywhere in dist)');
// P4 delta
let baseline = null;
if (A.baseline != null) baseline = Number(A.baseline);
else if (fs.existsSync(A['baseline-file'])) { try { baseline = JSON.parse(fs.readFileSync(A['baseline-file'], 'utf8')).entryGzipBytes; } catch (e) { console.warn('WARN: cannot parse baseline file: ' + e.message); } }
if (baseline == null || !Number.isFinite(baseline)) console.log(`  P4a SKIP (no baseline: pass --baseline <bytes> or create ${path.relative(REPO, A['baseline-file'])} via --write-baseline)`);
else if (A['expect-holo']) {
  // designer ruling 2026-11-19: the lab build is never shipped, and HB1 (entry +2048 B) is a promise to web users, so the cumulative P4 is judged on the DEFAULT build only (ci-bundle).
  // The lab build's entry carries the lab route, so its delta is recorded here and never judged. Everything else (A5, P4b, HB4 groups, holo-core present) still applies to the lab build,
  // and A5-holo (no features/holo in the default build) lives in the default-build run, which this branch does not touch.
  const delta = entryGzip - baseline;
  console.log(`  P4a INFO delta ${delta >= 0 ? '+' : ''}${delta} B (lab build: recorded, NOT judged; the default build is judged by ci-bundle)`);
} else {
  const delta = entryGzip - baseline;
  if (delta > DELTA_LIMIT) { fails.push(`P4: entry gzip ${entryGzip} - baseline ${baseline} = +${delta} B > ${DELTA_LIMIT} B`); console.log(`  P4a FAIL delta ${delta >= 0 ? '+' : ''}${delta} B (limit +${DELTA_LIMIT})`); }
  else console.log(`  P4a PASS delta ${delta >= 0 ? '+' : ''}${delta} B (limit +${DELTA_LIMIT})`);
}
// P4 OS lazy (group os)
if (!osGroup.files.length) console.log('  P4b PASS (WARNING: no OS chunks found - dist has no OS code / built from main?)');
else if (osGroup.gzip > LIMITS.os) { fails.push(`P4: OS lazy JS gzip ${osGroup.gzip} B > ${LIMITS.os} B`); console.log('  P4b FAIL'); }
else console.log(`  P4b PASS OS lazy ${osGroup.gzip} B <= ${LIMITS.os} B`);
// HB4 groups
for (const g of groups.slice(1)) {
  if (!g.files.length) { console.log(`  HB4 ${g.id} SKIP (not built yet)`); continue; }
  if (g.gzip > g.limit) { fails.push(`HB4: ${g.id} gzip ${g.gzip} B > ${g.limit} B`); console.log(`  HB4 ${g.id} FAIL ${g.gzip} B > ${g.limit} B`); }
  else console.log(`  HB4 ${g.id} PASS ${g.gzip} B <= ${g.limit} B`);
}

if (A.json) fs.writeFileSync(A.json, JSON.stringify({
  dist, expectHolo: A['expect-holo'], manifest: !!manifest, entryChunks: entryJs.map(rel), lazyChunks: lazyJs.map(rel), osLazy: osFiles.map(rel),
  groups: groups.map((g) => ({ id: g.id, limit: g.limit, skipped: !g.files.length, gzip: g.gzip, chunks: g.files.map(rel) })),
  entryGzip, cssGzip, osLazyGzip: osGroup.gzip, baseline, deltaBytes: baseline != null && Number.isFinite(baseline) ? entryGzip - baseline : null, p4Judged: !A['expect-holo'], violations, holoLeaks, fails,
}, null, 2));
console.log(fails.length ? `\nRESULT: FAIL\n  - ${fails.join('\n  - ')}` : '\nRESULT: PASS');
process.exit(fails.length ? 1 : 0);
