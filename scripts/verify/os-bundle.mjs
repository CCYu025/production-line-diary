// A5 + P4: bundle checks on a built web/dist.
//   A5: the entry's STATIC import graph must contain no three/r3f/OS chunk.
//   P4: entry (static graph) JS gzip must not exceed baseline + 2048 B; OS lazy JS gzip <= 300 KiB.
// node scripts/verify/os-bundle.mjs [--dist web/dist] [--baseline <bytes>] [--write-baseline] [--json out.json]
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
    json: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (A.help) { console.log('node scripts/verify/os-bundle.mjs [--dist web/dist] [--baseline <bytes>] [--baseline-file f] [--write-baseline] [--json out.json]'); process.exit(0); }

const DELTA_LIMIT = 2048;          // P4: entry gzip may grow by at most 2 KiB vs baseline
const OS_LAZY_LIMIT = 300 * 1024;  // P4: OS lazy JS gzip total
const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
let G;
try { G = analyze(A.dist); } catch (e) { console.error('FAIL: ' + e.message); process.exit(2); }
for (const w of G.warnings) console.warn('WARN: ' + w);
const { dist, rel, cssFiles, staticGraph, lazyJs, osLazy, markersOf } = G;

// ---- A5
const violations = [];
for (const f of staticGraph) {
  const reasons = [];
  if (NAME_RE.test(path.basename(f))) reasons.push('file name matches three|fiber|OsShell|features/os');
  const mk = markersOf(f); if (mk.length) reasons.push('contains ' + mk.join(','));
  if (reasons.length) violations.push({ file: rel(f), reasons });
}
const osLazyList = [...osLazy].sort();


// ---- sizes
const sizeOf = (files) => files.reduce((s, f) => s + gz(fs.readFileSync(f)), 0);
const entryJs = [...staticGraph].sort();
const entryGzip = sizeOf(entryJs);
const cssGzip = sizeOf(cssFiles.filter((f) => fs.existsSync(f)));
const osLazyGzip = sizeOf(osLazyList);

console.log(`dist: ${dist}`);
console.log(`\nEntry static graph (${entryJs.length} chunks):`);
for (const f of entryJs) console.log(`  ${rel(f)}  gzip ${gz(fs.readFileSync(f))} B`);
console.log(`\nEntry CSS (${cssFiles.length}):`);
for (const f of cssFiles) console.log(`  ${rel(f)}  gzip ${fs.existsSync(f) ? gz(fs.readFileSync(f)) : '?'} B`);
console.log(`\nLazy JS chunks not in entry static graph (${lazyJs.length}):`);
for (const f of lazyJs.sort()) console.log(`  ${rel(f)}${osLazy.has(f) ? '   [OS lazy]' : ''}`);
console.log(`\nOS lazy chunks (${osLazyList.length}):`);
for (const f of osLazyList) console.log(`  ${rel(f)}  gzip ${gz(fs.readFileSync(f))} B`);
console.log('\nSizes (gzip -9):');
console.log(`  web entry JS (static graph): ${entryGzip} B (${(entryGzip / 1024).toFixed(1)} KiB)`);
console.log(`  entry CSS                  : ${cssGzip} B (${(cssGzip / 1024).toFixed(1)} KiB)`);
console.log(`  OS lazy JS total           : ${osLazyGzip} B (${(osLazyGzip / 1024).toFixed(1)} KiB)  limit ${OS_LAZY_LIMIT} B`);

if (A['write-baseline']) {
  fs.writeFileSync(A['baseline-file'], JSON.stringify({ entryGzipBytes: entryGzip, cssGzipBytes: cssGzip, note: 'gzip -9 of entry static-graph JS; written by os-bundle.mjs --write-baseline' }, null, 2) + '\n');
  console.log(`\nBaseline written: ${A['baseline-file']}`);
}

const fails = [];
console.log('\nChecks:');
// A5
if (violations.length) { for (const v of violations) fails.push(`A5: static graph chunk ${v.file}: ${v.reasons.join('; ')}`); console.log('  A5 FAIL'); }
else console.log('  A5 PASS  (no three/r3f/OS chunk in entry static graph)');
// P4 delta
let baseline = null;
if (A.baseline != null) baseline = Number(A.baseline);
else if (fs.existsSync(A['baseline-file'])) { try { baseline = JSON.parse(fs.readFileSync(A['baseline-file'], 'utf8')).entryGzipBytes; } catch (e) { console.warn('WARN: cannot parse baseline file: ' + e.message); } }
if (baseline == null || !Number.isFinite(baseline)) console.log(`  P4a SKIP (no baseline: pass --baseline <bytes> or create ${path.relative(REPO, A['baseline-file'])} via --write-baseline)`);
else {
  const delta = entryGzip - baseline;
  if (delta > DELTA_LIMIT) { fails.push(`P4: entry gzip ${entryGzip} - baseline ${baseline} = +${delta} B > ${DELTA_LIMIT} B`); console.log(`  P4a FAIL delta ${delta >= 0 ? '+' : ''}${delta} B (limit +${DELTA_LIMIT})`); }
  else console.log(`  P4a PASS delta ${delta >= 0 ? '+' : ''}${delta} B (limit +${DELTA_LIMIT})`);
}
// P4 OS lazy
if (!osLazyList.length) console.log('  P4b PASS (WARNING: no OS chunks found - dist has no OS code / built from main?)');
else if (osLazyGzip > OS_LAZY_LIMIT) { fails.push(`P4: OS lazy JS gzip ${osLazyGzip} B > ${OS_LAZY_LIMIT} B`); console.log('  P4b FAIL'); }
else console.log(`  P4b PASS OS lazy ${osLazyGzip} B <= ${OS_LAZY_LIMIT} B`);

if (A.json) fs.writeFileSync(A.json, JSON.stringify({ dist, entryChunks: entryJs.map(rel), lazyChunks: lazyJs.map(rel), osLazy: osLazyList.map(rel), entryGzip, cssGzip, osLazyGzip, baseline, violations, fails }, null, 2));
console.log(fails.length ? `\nRESULT: FAIL\n  - ${fails.join('\n  - ')}` : '\nRESULT: PASS');
process.exit(fails.length ? 1 : 0);
