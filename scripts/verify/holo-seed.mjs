// holo-seed: synthetic records + small synthetic photos for the HOLO performance checks (docs/holo-mode-spec.md section 11.2).
//   node scripts/verify/holo-seed.mjs <port> <count> [--scratch dir] [--photos 2] [--seed 1] [--end YYYY-MM-DD]
//
// SAFETY: only writes into the DATA_DIR of a scratch server started by serve.mjs. assertScratchServer() (safety.mjs) must pass first:
// it refuses ports 3000/3001, a port without a serve.mjs marker, and any DATA_DIR containing the real-data folder name.
// The data is written DIRECTLY (data.json via temp file + rename, photos under 照片/<YYYYMMDD>/); posting 20k records through the API
// would rewrite the whole data.json 20k times. The running server reads data.json on every request, so no restart is needed.
//
// Distribution (section 1.4): 15 equipment, 22 categories; severity 13% 輕微 / 66% 一般 / 20% 嚴重 / 1% 重大;
// status 10% 待處理 / 5% 追蹤中 / rest 已解決; at most 11 records per day, the time span follows from the count (working back from --end, default today);
// photos: binomial(2N, 1/2) per record (mean N, default 2), each a flat-colour PNG with the id and the date drawn in a built-in 5x7 font (<= 50 KB).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertScratchServer, DEFAULT_SCRATCH, REAL_FOLDER_NAME } from './safety.mjs';
import { toISODate } from '../../backend/lib/aggregate.js';

export const MAX_PER_DAY = 11;
export const PHOTO_MAX_BYTES = 50 * 1024;
export const SEVERITY_WEIGHTS = [['輕微', 0.13], ['一般', 0.66], ['嚴重', 0.2], ['重大', 0.01]];
export const STATUS_WEIGHTS = [['待處理', 0.1], ['追蹤中', 0.05], ['已解決', 0.85]];
export const EQUIPMENT = ['F3', 'F4', 'G5', 'G6', 'F7', 'F8', '原材區', 'RB2', 'CCD', '輸送線A', '輸送線B', '包裝機', '切斷機', '烘乾爐', '品檢站'];
export const CATEGORIES = [
  '取料異常', '尺寸異常', '沾模', '真空異常', '氣壓不足', '溫度異常', '卡料', '感測器異常', '馬達過載', '潤滑不足', 'CCD異常', '外觀不良',
  '換線調機', '模具損壞', '參數漂移', '通訊中斷', '緊急停機', '刀具磨耗', '密封不良', '輸送偏位', '記憶體不足', '其他',
];
// 單日筆數的權重：1..11，平均約 4
const PER_DAY_WEIGHTS = [16, 17, 15, 13, 11, 9, 7, 5, 3.5, 2.5, 1.5];
const SHIFTS = [['早', 6, 14], ['中', 14, 22], ['晚', 22, 30]]; // 晚班 22:00–05:59（小時 +24 取餘數）
const DURATION_RANGE = { 輕微: [1, 10], 一般: [11, 15], 嚴重: [16, 20], 重大: [21, 90] }; // 與 severityFromDuration() 一致

/** mulberry32：確定性亂數（同一個 seed 產生同一份資料） */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 最大餘數法：把 total 依權重分成整數份（總和剛好等於 total）。 */
export function quota(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((s, n) => s + n, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function labelsFromQuota(total, pairs, rnd) {
  const counts = quota(total, pairs.map((p) => p[1]));
  const list = [];
  counts.forEach((n, i) => { for (let k = 0; k < n; k++) list.push(pairs[i][0]); });
  return shuffle(list, rnd);
}

/** 依權重（遞減，像真實資料：少數設備／分類佔大宗，每一種至少出現一次）分配 */
function skewedLabels(total, names, rnd) {
  const weights = names.map((_, i) => 1 / (i + 2));
  const counts = quota(Math.max(0, total - names.length), weights).map((n) => n + 1);
  const list = [];
  if (total < names.length) return shuffle(names.slice(0, total).slice(), rnd);
  counts.forEach((n, i) => { for (let k = 0; k < n; k++) list.push(names[i]); });
  return shuffle(list, rnd);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + delta)); // 本地日期曆法運算
}

/** 單日筆數：回傳由舊到新的每日筆數（總和 = count，每天 1..MAX_PER_DAY） */
export function planDays(count, rnd) {
  const days = [];
  let left = count;
  const cum = PER_DAY_WEIGHTS.reduce((a, w) => { a.push((a.at(-1) ?? 0) + w); return a; }, []);
  while (left > 0) {
    const r = rnd() * cum.at(-1);
    let n = cum.findIndex((c) => r < c) + 1;
    n = Math.min(n, left, MAX_PER_DAY);
    days.push(n);
    left -= n;
  }
  return days.reverse(); // 最後（最新）一天可能不滿，這裡讓不滿的落在最舊那天
}

/**
 * @returns {{records: object[], photoJobs: {id:number, date:string, filename:string}[]}}
 */
export function generateRecords(count, { seed = 1, photos = 2, end = toISODate(new Date()) } = {}) {
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  const rnd = makeRng(seed);
  const severities = labelsFromQuota(count, SEVERITY_WEIGHTS, rnd);
  const statuses = labelsFromQuota(count, STATUS_WEIGHTS, rnd);
  const equipment = skewedLabels(count, EQUIPMENT, rnd);
  const categories = skewedLabels(count, CATEGORIES, rnd);
  const perDay = planDays(count, rnd);
  const dates = [];
  perDay.forEach((n, i) => { const iso = addDays(end, -(perDay.length - 1 - i)); for (let k = 0; k < n; k++) dates.push(iso); });
  const records = [];
  const photoJobs = [];
  let id = 0;
  for (let i = 0; i < count; i++) {
    id++;
    const [shift, h0, h1] = SHIFTS[Math.floor(rnd() * SHIFTS.length)];
    const hour = (h0 + Math.floor(rnd() * (h1 - h0))) % 24;
    const [lo, hi] = DURATION_RANGE[severities[i]];
    const date = dates[i];
    const nPhotos = binomial(Math.round(photos * 2), rnd);
    const files = [];
    for (let k = 1; k <= nPhotos; k++) { const filename = `seed-${id}-${k}.png`; files.push(filename); photoJobs.push({ id, date, filename }); }
    records.push({
      id, date, shift, time: `${pad(hour)}:${pad(Math.floor(rnd() * 60))}`,
      duration: lo + Math.floor(rnd() * (hi - lo + 1)),
      equipment: equipment[i], category: categories[i],
      problem: `合成：${categories[i]}（#${id}）`, severity: severities[i], action: '合成資料：已處理',
      rootCause: null, status: statuses[i], productCode: null, materialCategory: null,
      photos: files, updatedAt: null, deleted: false, deletedAt: null,
    });
  }
  // 讓同一天內依時間排序（id 仍依序遞增，不影響顯示順序規則）
  return { records, photoJobs };
}

function binomial(n, rnd) { let k = 0; for (let i = 0; i < n; i++) if (rnd() < 0.5) k++; return k; }

/* ------------------------------------------------------------------ PNG (zlib only) + 5x7 bitmap font */
const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'], '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 8-bit RGB PNG from a width*height*3 pixel buffer. */
export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

const PALETTE = [[34, 90, 120], [60, 110, 80], [120, 90, 40], [110, 60, 90], [70, 70, 120], [120, 70, 60], [50, 100, 100], [100, 100, 50]];

function drawText(rgb, width, text, x0, y0, scale, color) {
  let x = x0;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r][c] !== '1') continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const o = ((y0 + r * scale + dy) * width + x + c * scale + dx) * 3;
        rgb[o] = color[0]; rgb[o + 1] = color[1]; rgb[o + 2] = color[2];
      }
    }
    x += 6 * scale;
  }
}

/** Flat colour + "#id" and the date, 200x150. */
export function renderPhoto(id, date) {
  const W = 200, H = 150;
  const bg = PALETTE[id % PALETTE.length];
  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { rgb[i * 3] = bg[0]; rgb[i * 3 + 1] = bg[1]; rgb[i * 3 + 2] = bg[2]; }
  drawText(rgb, W, `#${id}`, 10, 20, 5, [240, 240, 240]);
  drawText(rgb, W, date, 10, 90, 3, [240, 240, 240]);
  return encodePng(W, H, rgb);
}

/* ------------------------------------------------------------------ writing into a scratch server's DATA_DIR */
/**
 * Refuse to write through an existing link (or anything that is not a regular file): a symlink named like our target would make writeFileSync follow it
 * to wherever it points. Refusing (instead of unlink + write) is fail-closed: a link where only regular files should be means the scratch folder was
 * tampered with, which is worth stopping for rather than silently repairing.
 */
export function assertWritableTarget(file) {
  let st;
  try { st = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (!st.isFile()) throw new Error(`${file} exists and is not a regular file (link?); refusing to write through it`);
}

export function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  // 'wx': the temp file must not exist (a symlink OR a hard link planted at that name would otherwise be written THROUGH to its target).
  // The rename then replaces data.json itself (it never follows a link at the destination).
  fs.writeFileSync(tmp, data, { flag: 'wx' });
  fs.renameSync(tmp, file);
}

const SEED_PHOTO_RE = /^seed-\d+-\d+\.png$/;
const DATE_DIR_RE = /^\d{8}$/;

const isInside = (parent, child) => {
  const r = path.relative(parent, child);
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
};

/**
 * Second safety layer, run after assertScratchServer() and before anything is deleted or written: resolve junctions / symlinks (realpath) and
 * require the REAL location of DATA_DIR (and of 照片 and data.json when they exist) to still be inside the REAL scratch folder and not contain the
 * real-data folder name. assertScratchServer() only compares path strings, so a junction inside the scratch folder pointing outside would pass it.
 * (Kept here, not in safety.mjs: nothing about the other scripts' checks changes.)
 */
export function assertRealPathsInScratch(scratch, dataDir) {
  const realScratch = fs.realpathSync(path.resolve(scratch));
  const check = (p, what) => {
    const real = fs.realpathSync(p);
    if (real.includes(REAL_FOLDER_NAME)) throw new Error(`${what} resolves to ${real}, which contains the real-data folder name`);
    if (!isInside(realScratch, real)) throw new Error(`${what} resolves to ${real}, which is outside the scratch folder ${realScratch} (junction/symlink?)`);
    return real;
  };
  const realData = check(dataDir, 'DATA_DIR');
  for (const rel of ['data.json', '照片']) {
    const f = path.join(dataDir, rel);
    if (fs.existsSync(f) || isLink(f)) {
      const real = check(f, rel);
      if (!isInside(realData, real)) throw new Error(`${rel} resolves outside DATA_DIR (${real})`);
    }
  }
  return realData;
}
function isLink(f) { try { return fs.lstatSync(f).isSymbolicLink(); } catch { return false; } }

/**
 * Every check that can refuse, run BEFORE anything is deleted or written, so a refusal leaves the scratch folder exactly as it was:
 *  - real paths (junction / symlink) of DATA_DIR, data.json, 照片;
 *  - data.json must be a regular file (or absent); the temp file name must not exist at all;
 *  - every date folder the run will write into must be a real directory (not a link) that resolves inside scratch (or not exist yet);
 *  - every photo target must be absent or a regular file. A regular file with that name is a previous seed photo that cleanSeedPhotos() unlinks first
 *    (unlink removes only the name, so a hard link elsewhere is never written through); anything else (symlink, folder...) is refused here.
 * The photo writes below use the 'wx' flag as well, so nothing is ever written into an existing file.
 */
export function preflightSeed({ scratch, dataDir, photoRoot, photoJobs, file }) {
  assertRealPathsInScratch(scratch, dataDir);
  assertWritableTarget(file);
  const tmp = `${file}.tmp-${process.pid}`;
  if (fs.existsSync(tmp) || isLink(tmp)) throw new Error(`${tmp} already exists; refusing to write through it`);
  const checkedDirs = new Set();
  for (const job of photoJobs) {
    const dir = path.join(photoRoot, job.date.replaceAll('-', ''));
    if (!checkedDirs.has(dir)) {
      checkedDirs.add(dir);
      if (isLink(dir)) throw new Error(`${dir} is a link; refusing to write through it`);
      if (fs.existsSync(dir)) {
        if (!fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`);
        assertRealPathsInScratch(scratch, dir);
      }
    }
    assertWritableTarget(path.join(dir, job.filename));
  }
}

/**
 * Remove the photos a previous holo-seed run left behind: only files named seed-<id>-<n>.png directly inside 照片/<YYYYMMDD>/
 * (and a date folder that becomes empty). Anything else (example photos, other names, other folders) is never touched.
 * Only call after assertScratchServer() passed. @returns number of files removed.
 */
export function cleanSeedPhotos(photoRoot) {
  if (!fs.existsSync(photoRoot)) return 0;
  let removed = 0;
  for (const d of fs.readdirSync(photoRoot, { withFileTypes: true })) {
    if (!d.isDirectory() || !DATE_DIR_RE.test(d.name)) continue;
    const dir = path.join(photoRoot, d.name);
    let here = 0;
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isFile() && SEED_PHOTO_RE.test(f.name)) { fs.unlinkSync(path.join(dir, f.name)); here++; }
    }
    removed += here;
    // only a folder that became empty BECAUSE of this cleanup is removed; a date folder that was already empty is not ours
    if (here > 0 && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
  return removed;
}

/**
 * Write `count` synthetic records (and photos) into the scratch DATA_DIR of the serve.mjs server on `port`, then read it back and verify.
 * @returns {{dataDir:string, records:number, photos:number, report:object}}
 */
export function seedScratch(port, count, { scratch = DEFAULT_SCRATCH, photos = 2, seed = 1, end, log = () => {} } = {}) {
  const info = assertScratchServer(`http://127.0.0.1:${port}/`, scratch); // throws unless this is a serve.mjs scratch server
  const dataDir = info.dataDir;
  const file = path.join(dataDir, 'data.json');
  const photoRoot = path.join(dataDir, '照片');
  const { records, photoJobs } = generateRecords(count, { seed, photos, end });
  preflightSeed({ scratch, dataDir, photoRoot, photoJobs, file }); // all refusals happen here: nothing has been deleted or written yet
  const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) : { _meta: { schemaVersion: '1.1', app: '產線日誌', exportedAt: new Date().toISOString() } };
  // 先寫照片（資料指到的檔案要先存在），再一次寫 data.json
  const cleaned = cleanSeedPhotos(photoRoot); // the previous run's seed photos (the records that pointed at them are replaced below)
  if (cleaned) log(`removed ${cleaned} photos from a previous holo-seed run`);
  const made = new Set();
  for (const job of photoJobs) {
    const dir = path.join(photoRoot, job.date.replaceAll('-', ''));
    if (!made.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      made.add(dir);
    }
    fs.writeFileSync(path.join(dir, job.filename), renderPhoto(job.id, job.date), { flag: 'wx' }); // never into an existing file
  }
  store.records = records;
  store._meta = { ...(store._meta ?? {}), exportedAt: new Date().toISOString(), holoSeed: { count, seed, photos } };
  writeAtomic(file, JSON.stringify(store, null, 2));
  log(`wrote ${records.length} records, ${photoJobs.length} photos -> ${dataDir}`);

  // 讀回驗證
  const back = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = new Set(back.records.map((r) => r.id));
  if (back.records.length !== count) throw new Error(`verify: expected ${count} records, read back ${back.records.length}`);
  if (ids.size !== count) throw new Error('verify: duplicate ids');
  let nPhotos = 0;
  for (const r of back.records) for (const fn of r.photos) {
    nPhotos++;
    if (!fs.existsSync(path.join(photoRoot, r.date.replaceAll('-', ''), fn))) throw new Error(`verify: missing photo file ${r.date}/${fn}`);
  }
  return { dataDir, records: count, photos: nPhotos, report: distributionReport(back.records) };
}

export function distributionReport(records) {
  const n = records.length;
  const pct = (key, vals) => Object.fromEntries(vals.map((v) => [v, +((records.filter((r) => r[key] === v).length / n) * 100).toFixed(2)]));
  const perDay = new Map();
  for (const r of records) perDay.set(r.date, (perDay.get(r.date) ?? 0) + 1);
  const dates = [...perDay.keys()].sort();
  return {
    count: n,
    equipment: new Set(records.map((r) => r.equipment)).size,
    categories: new Set(records.map((r) => r.category)).size,
    severityPct: pct('severity', SEVERITY_WEIGHTS.map((p) => p[0])),
    statusPct: pct('status', STATUS_WEIGHTS.map((p) => p[0])),
    maxPerDay: Math.max(...perDay.values()),
    days: perDay.size,
    from: dates[0], to: dates.at(-1),
    photosPerRecord: +(records.reduce((s, r) => s + r.photos.length, 0) / n).toFixed(2),
  };
}

/* ------------------------------------------------------------------ CLI */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: A, positionals } = parseArgs({
    allowPositionals: true,
    options: { scratch: { type: 'string', default: DEFAULT_SCRATCH }, photos: { type: 'string', default: '2' }, seed: { type: 'string', default: '1' }, end: { type: 'string' }, help: { type: 'boolean', default: false } },
  });
  if (A.help || positionals.length < 2) { console.log('node scripts/verify/holo-seed.mjs <port> <count> [--scratch dir] [--photos 2] [--seed 1] [--end YYYY-MM-DD]\n(only works against a serve.mjs scratch server; the server needs no restart)'); process.exit(A.help ? 0 : 2); }
  const port = Number(positionals[0]);
  const count = Number(positionals[1]);
  try {
    const r = seedScratch(port, count, { scratch: A.scratch, photos: Number(A.photos), seed: Number(A.seed), end: A.end, log: (m) => console.log('holo-seed: ' + m) });
    console.log('holo-seed: verified', JSON.stringify(r.report, null, 2));
  } catch (e) {
    console.error('holo-seed: ' + e.message);
    process.exit(2);
  }
}
