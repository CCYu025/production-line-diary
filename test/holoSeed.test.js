// holo-seed（scripts/verify/holo-seed.mjs）：分布比例、安全檢查（拒絕 3000／3001、沒有 marker、路徑含「工作日誌」）、PNG 大小上限。
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { after, describe, it } from "node:test";
import { severityFromDuration } from "../backend/lib/aggregate.js";
import {
  distributionReport, encodePng, generateRecords, makeRng, MAX_PER_DAY, PHOTO_MAX_BYTES, planDays, quota, renderPhoto, seedScratch,
} from "../scripts/verify/holo-seed.mjs";

const pct = (records, key, v) => (records.filter((r) => r[key] === v).length / records.length) * 100;

describe("holo-seed：分布", () => {
  const { records, photoJobs } = generateRecords(5000, { seed: 7, end: "2026-11-01" });

  it("筆數、id 不重複", () => {
    assert.equal(records.length, 5000);
    assert.equal(new Set(records.map((r) => r.id)).size, 5000);
  });
  it("15 台設備、22 種分類", () => {
    assert.equal(new Set(records.map((r) => r.equipment)).size, 15);
    assert.equal(new Set(records.map((r) => r.category)).size, 22);
  });
  it("嚴重度約 13／66／20／1%", () => {
    assert.ok(Math.abs(pct(records, "severity", "輕微") - 13) < 0.1);
    assert.ok(Math.abs(pct(records, "severity", "一般") - 66) < 0.1);
    assert.ok(Math.abs(pct(records, "severity", "嚴重") - 20) < 0.1);
    assert.ok(Math.abs(pct(records, "severity", "重大") - 1) < 0.1);
  });
  it("10% 待處理、5% 追蹤中，其餘已解決", () => {
    assert.ok(Math.abs(pct(records, "status", "待處理") - 10) < 0.1);
    assert.ok(Math.abs(pct(records, "status", "追蹤中") - 5) < 0.1);
    assert.ok(Math.abs(pct(records, "status", "已解決") - 85) < 0.1);
  });
  it("單日最多 11 筆，時間跨度由筆數往回推到指定的最後一天", () => {
    const rep = distributionReport(records);
    assert.ok(rep.maxPerDay <= MAX_PER_DAY);
    assert.equal(rep.to, "2026-11-01");
    assert.ok(rep.days >= Math.ceil(5000 / MAX_PER_DAY) && rep.days <= 5000);
    assert.ok(rep.from < rep.to);
  });
  it("耗時是正整數，且與嚴重度的耗時規則一致", () => {
    for (const r of records) {
      assert.ok(Number.isInteger(r.duration) && r.duration > 0);
      assert.equal(severityFromDuration(r.duration), r.severity);
    }
  });
  it("日期、時間格式合法（補零）", () => {
    for (const r of records) {
      assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(r.time, /^([01]\d|2[0-3]):[0-5]\d$/);
      assert.ok(["早", "中", "晚"].includes(r.shift));
    }
  });
  it("平均每筆約 2 張照片，檔名安全且都有對應的產生工作", () => {
    const avg = photoJobs.length / records.length;
    assert.ok(Math.abs(avg - 2) < 0.1, `avg ${avg}`);
    for (const j of photoJobs) assert.match(j.filename, /^seed-\d+-\d+\.png$/);
    assert.equal(records.reduce((s, r) => s + r.photos.length, 0), photoJobs.length);
  });
  it("同一個 seed 產生同一份資料；--photos 0 沒有照片", () => {
    assert.deepEqual(generateRecords(300, { seed: 3, end: "2026-01-01" }), generateRecords(300, { seed: 3, end: "2026-01-01" }));
    assert.equal(generateRecords(100, { seed: 3, photos: 0 }).photoJobs.length, 0);
  });
  it("小規模（1k）也成立；quota 總和剛好等於總數", () => {
    const r1k = generateRecords(1000, { seed: 1 }).records;
    assert.ok(Math.abs(pct(r1k, "severity", "重大") - 1) < 0.2);
    assert.deepEqual(quota(1000, [0.13, 0.66, 0.2, 0.01]), [130, 660, 200, 10]);
    assert.equal(quota(7, [1, 1, 1]).reduce((a, b) => a + b, 0), 7);
    const days = planDays(500, makeRng(2));
    assert.equal(days.reduce((a, b) => a + b, 0), 500);
    assert.ok(days.every((n) => n >= 1 && n <= MAX_PER_DAY));
  });
});

describe("holo-seed：PNG", () => {
  it("每張照片 <= 50KB，是合法的 PNG（簽章、IHDR、IDAT 可解壓成完整像素）", () => {
    for (const [id, date] of [[1, "2026-01-01"], [20000, "2026-11-10"], [123456, "1999-12-31"]]) {
      const png = renderPhoto(id, date);
      assert.ok(png.length <= PHOTO_MAX_BYTES, `size ${png.length}`);
      assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      assert.equal(png.readUInt32BE(16), 200);
      assert.equal(png.readUInt32BE(20), 150);
      // 取出 IDAT 解壓縮，長度應為 (寬*3+1)*高
      const idatAt = png.indexOf("IDAT");
      const len = png.readUInt32BE(idatAt - 4);
      const raw = zlib.inflateSync(png.subarray(idatAt + 4, idatAt + 4 + len));
      assert.equal(raw.length, (200 * 3 + 1) * 150);
    }
  });
  it("文字真的畫上去了（不是純色）", () => {
    const png = renderPhoto(88, "2026-05-05");
    const idatAt = png.indexOf("IDAT");
    const raw = zlib.inflateSync(png.subarray(idatAt + 4, idatAt + 4 + png.readUInt32BE(idatAt - 4)));
    assert.ok(new Set([...raw].map((b) => b)).size > 2);
  });
  it("encodePng 對任意像素緩衝也可用", () => {
    const png = encodePng(2, 2, Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]));
    assert.equal(png.readUInt32BE(16), 2);
  });
});

describe("holo-seed：安全檢查（只寫進 serve.mjs 的暫存副本）", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "holo-seed-test-"));
  after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const marker = (port, info) => fs.writeFileSync(path.join(scratch, `serve-${port}.json`), JSON.stringify({ port, scratch, ...info }));

  it("拒絕 3000 與 3001（即使有 marker）", () => {
    for (const port of [3000, 3001]) {
      marker(port, { dataDir: path.join(scratch, `data-${port}-x`) });
      assert.throws(() => seedScratch(port, 10, { scratch }), /port 3000\/3001 is never allowed/);
    }
  });
  it("拒絕沒有 serve.mjs marker 的埠", () => {
    assert.throws(() => seedScratch(3190, 10, { scratch }), /no serve-3190\.json marker/);
  });
  it("拒絕 DATA_DIR 含真實資料夾名稱「工作日誌」", () => {
    const dataDir = path.join(scratch, "工作日誌-copy");
    fs.mkdirSync(dataDir, { recursive: true });
    marker(3191, { dataDir });
    assert.throws(() => seedScratch(3191, 10, { scratch }), /real-data folder name/);
    assert.equal(fs.existsSync(path.join(dataDir, "data.json")), false);
  });
  it("拒絕 DATA_DIR 不在暫存資料夾內", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "holo-seed-outside-"));
    marker(3192, { dataDir: outside });
    assert.throws(() => seedScratch(3192, 10, { scratch }), /not inside scratch/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
  it("通過檢查時才寫入 data.json 與照片並讀回驗證", () => {
    const dataDir = path.join(scratch, "data-3193-abc");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "data.json"), JSON.stringify({ _meta: { schemaVersion: "1.1" }, records: [] }));
    marker(3193, { dataDir });
    const r = seedScratch(3193, 300, { scratch, photos: 2, end: "2026-11-01" });
    assert.equal(r.records, 300);
    assert.ok(r.photos > 300 && r.photos < 900);
    const back = JSON.parse(fs.readFileSync(path.join(dataDir, "data.json"), "utf8"));
    assert.equal(back.records.length, 300);
    assert.equal(back._meta.schemaVersion, "1.1");
    for (const rec of back.records) for (const fn of rec.photos) {
      const f = path.join(dataDir, "照片", rec.date.replaceAll("-", ""), fn);
      assert.ok(fs.statSync(f).size <= PHOTO_MAX_BYTES);
    }
    assert.equal(fs.readdirSync(dataDir).filter((n) => n.includes(".tmp")).length, 0);
  });
});
