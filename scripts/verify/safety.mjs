// Safety helpers shared by the verify scripts. Zero deps.
//
//  * checkScratchServer / assertScratchServer(url, scratch)  proof that a port serves a serve.mjs scratch copy
//  * exportTargetInScratch(url, scratch)   MUST be ok before any script clicks 匯出 Excel (no export is performed by the check)
//  * seedPhoto / seedTrash                  idempotent data seeding for c1 `lightbox` / `dialog` and the E6 lightbox check
//                                           (scratch servers only; they refuse anything else)
//
// Export finding (backend/server.js): POST /api/export-xlsx writes `path.join(DATA_DIR, "工作日誌.xlsx")`
// (writeSnapshotXlsx in backend/lib/xlsx.js receives that path; no env var or request parameter moves it).
// With serve.mjs, DATA_DIR is the scratch copy, so the export stays inside it. The helper re-verifies this from the
// served worktree's source on every run and fails closed if the route changes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REAL_FOLDER_NAME = '工作日誌';
export const DEFAULT_SCRATCH = path.join(os.tmpdir(), 'pld-verify');
export const CSRF = { 'X-Requested-With': 'production-line-diary' };

const inside = (parent, child) => {
  const r = path.relative(path.resolve(parent), path.resolve(child));
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
};
export const portOf = (url) => Number(new URL(url).port || 80);

export function scratchInfo(url, scratch = DEFAULT_SCRATCH) {
  const f = path.join(path.resolve(scratch), `serve-${portOf(url)}.json`);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

/** {ok, reason?, info?}. ok only if serve.mjs wrote a marker for this port and its DATA_DIR is inside `scratch`. */
export function checkScratchServer(url, scratch = DEFAULT_SCRATCH) {
  const u = new URL(url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return { ok: false, reason: `host ${u.hostname} is not local` };
  if ([3000, 3001].includes(portOf(url))) return { ok: false, reason: 'port 3000/3001 is never allowed' };
  const info = scratchInfo(url, scratch);
  if (!info) return { ok: false, reason: `no serve-${portOf(url)}.json marker in ${path.resolve(scratch)} (start the server with serve.mjs --scratch <dir> and pass the same --scratch here)` };
  if (info.dataDir.includes(REAL_FOLDER_NAME)) return { ok: false, reason: 'DATA_DIR contains the real-data folder name' };
  if (!inside(scratch, info.dataDir)) return { ok: false, reason: `DATA_DIR ${info.dataDir} is not inside scratch ${scratch}` };
  return { ok: true, info };
}
export function assertScratchServer(url, scratch) {
  const r = checkScratchServer(url, scratch);
  if (!r.ok) throw new Error('scratch check failed for ' + url + ': ' + r.reason);
  return r.info;
}

/**
 * Call before clicking 匯出 Excel. Static + marker based (nothing is exported by the check).
 * @returns {{ok:boolean, reason?:string, outPath?:string, evidence?:string[]}}  not ok => skip the export click and say so.
 */
export function exportTargetInScratch(url, scratch = DEFAULT_SCRATCH) {
  const s = checkScratchServer(url, scratch);
  if (!s.ok) return { ok: false, reason: s.reason };
  const { dataDir, root } = s.info;
  const evidence = [`DATA_DIR=${dataDir}`];
  let src;
  try { src = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8'); } catch (e) { return { ok: false, reason: 'cannot read backend/server.js of the served root: ' + e.message }; }
  const m = /app\.post\(\s*["']\/api\/export-xlsx["'][\s\S]*?\n\}\);/.exec(src);
  if (!m) return { ok: false, reason: 'route /api/export-xlsx not found in backend/server.js (changed?) - skip the export click' };
  const route = m[0];
  const out = /const\s+outPath\s*=\s*path\.join\(\s*DATA_DIR\s*,\s*["'`]([^"'`/\\]+)["'`]\s*\)/.exec(route);
  if (!out) return { ok: false, reason: 'export outPath is no longer path.join(DATA_DIR, "<file>"); cannot prove it stays inside scratch - skip the export click' };
  if (!/writeSnapshotXlsx\(\s*store\.records\s*,\s*outPath\s*\)/.test(route)) return { ok: false, reason: 'export route does not write exactly outPath' };
  if (/process\.env|req\.(body|query|params)/.test(route)) return { ok: false, reason: 'export route reads env/request values; target not provable' };
  if (!/const\s+DATA_DIR\s*=\s*process\.env\.DATA_DIR/.test(src)) return { ok: false, reason: 'DATA_DIR definition changed' };
  const outPath = path.join(dataDir, out[1]);
  if (!inside(scratch, outPath)) return { ok: false, reason: `resolved export target ${outPath} is outside scratch` };
  evidence.push(`route: outPath = path.join(DATA_DIR, "${out[1]}")`, `resolved: ${outPath}`);
  return { ok: true, outPath, evidence };
}

// ---------------------------------------------------------------- data seeding (scratch servers only)
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const readJson = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const recordsOf = async (origin) => { const body = await (await fetch(origin + '/api/records')).json(); return body.records ?? body; };

/** Attach a 1x1 PNG to record `id` (idempotent). Returns the record. */
export async function seedPhoto(base, scratch, id = 3) {
  assertScratchServer(base, scratch);
  const origin = new URL(base).origin;
  const rec = (await recordsOf(origin)).find((r) => r.id === id);
  if (!rec) throw new Error('seedPhoto: record ' + id + ' not found');
  if (rec.photos?.length) return rec;
  const fd = new FormData();
  fd.append('date', rec.date);
  fd.append('photo', new Blob([PNG_1X1], { type: 'image/png' }), 'verify-seed.png');
  const up = await fetch(origin + '/api/photos', { method: 'POST', headers: CSRF, body: fd });
  const upj = await readJson(up);
  if (up.status !== 201) throw new Error('seedPhoto upload failed ' + up.status + ' ' + JSON.stringify(upj));
  const put = await fetch(origin + '/api/records/' + id, { method: 'PUT', headers: { ...CSRF, 'Content-Type': 'application/json' }, body: JSON.stringify({ photos: [...(rec.photos ?? []), upj.filename] }) });
  if (!put.ok) throw new Error('seedPhoto attach failed ' + put.status + ' ' + JSON.stringify(await readJson(put)));
  return (await readJson(put)).record;
}

/** Move record `id` to the trash (idempotent) so /trash has an item with 永久刪除. */
export async function seedTrash(base, scratch, id = 4) {
  assertScratchServer(base, scratch);
  const origin = new URL(base).origin;
  const rec = (await recordsOf(origin)).find((r) => r.id === id);
  if (!rec) throw new Error('seedTrash: record ' + id + ' not found');
  if (rec.deleted) return rec;
  const r = await fetch(origin + '/api/records/' + id + '/delete', { method: 'POST', headers: CSRF });
  if (!r.ok) throw new Error('seedTrash failed ' + r.status);
  return (await readJson(r)).record;
}

/** First non-deleted record id of the served data (read only; for direct /records/<id>/edit URLs). */
export async function firstRecordId(base) {
  const rec = (await recordsOf(new URL(base).origin)).find((r) => !r.deleted);
  return rec?.id ?? null;
}
