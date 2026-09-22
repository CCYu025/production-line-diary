import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "pld-api-test-"));
process.env.DATA_DIR = dataDir;
process.env.NO_OPEN_BROWSER = "1";

const { default: app } = await import("../backend/server.js");

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

test("全新資料夾：GET /api/records 回傳空陣列", async () => {
  const res = await fetch(`${base}/api/records`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.records, []);
});

test("POST /api/records 缺必填欄位回傳 400", async () => {
  const res = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: "2026-09-22" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.length > 0);
});

let createdId;

test("POST /api/records 建立一筆紀錄", async () => {
  const res = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: "2026-09-22",
      shift: "早",
      time: "09:00",
      duration: 10,
      equipment: "F7",
      category: "沾模",
      problem: "半製品附於上模",
      action: "洗模",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.record.id);
  assert.equal(body.record.severity, "輕微"); // 10 分鐘 -> 輕微，自動推算
  assert.equal(body.record.status, "待處理"); // 預設值
  assert.equal(body.record.deleted, false);
  createdId = body.record.id;
});

test("GET /api/meta 會列出剛剛新增那筆紀錄的設備/分類", async () => {
  const res = await fetch(`${base}/api/meta`);
  const body = await res.json();
  assert.ok(body.equipment.includes("F7"));
  assert.ok(body.categories.includes("沾模"));
});

test("PUT /api/records/:id 更新狀態與根本原因，並記錄 updatedAt", async () => {
  const res = await fetch(`${base}/api/records/${createdId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "已解決", rootCause: "脫模劑濃度不足" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.record.status, "已解決");
  assert.equal(body.record.rootCause, "脫模劑濃度不足");
  assert.ok(body.record.updatedAt);
});

test("軟刪除 -> 清單裡看不到、回收桶裡看得到 -> 復原 -> 清單裡又出現", async () => {
  let res = await fetch(`${base}/api/records/${createdId}/delete`, { method: "POST" });
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.record.deleted, true);
  assert.ok(body.record.deletedAt);

  res = await fetch(`${base}/api/records`);
  body = await res.json();
  const stillThere = body.records.find((r) => r.id === createdId);
  assert.equal(stillThere.deleted, true, "軟刪除後紀錄還在檔案裡，只是標記為已刪除");

  res = await fetch(`${base}/api/records/${createdId}/restore`, { method: "POST" });
  body = await res.json();
  assert.equal(body.record.deleted, false);
  assert.equal(body.record.deletedAt, null);
});

test("永久刪除前必須先軟刪除，否則回傳 409", async () => {
  const res = await fetch(`${base}/api/records/${createdId}`, { method: "DELETE" });
  assert.equal(res.status, 409);
});

test("軟刪除後才能永久刪除，之後這筆紀錄徹底消失", async () => {
  await fetch(`${base}/api/records/${createdId}/delete`, { method: "POST" });
  const res = await fetch(`${base}/api/records/${createdId}`, { method: "DELETE" });
  assert.equal(res.status, 204);

  const listRes = await fetch(`${base}/api/records`);
  const body = await listRes.json();
  assert.equal(body.records.find((r) => r.id === createdId), undefined);
});

test("PUT 到不存在的 id 回傳 404", async () => {
  const res = await fetch(`${base}/api/records/999999`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "已解決" }),
  });
  assert.equal(res.status, 404);
});

test("POST /api/photos 上傳照片後，檔案可以從 /photos/<日期資料夾>/ 存取到", async () => {
  const form = new FormData();
  form.append("date", "2026-09-22");
  const bytes = new Uint8Array([1, 2, 3, 4]);
  form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "test.jpg");

  const uploadRes = await fetch(`${base}/api/photos`, { method: "POST", body: form });
  assert.equal(uploadRes.status, 201);
  const uploadBody = await uploadRes.json();
  assert.equal(uploadBody.filename, "test.jpg");

  const fileRes = await fetch(`${base}/photos/20260922/test.jpg`);
  assert.equal(fileRes.status, 200);
  const buf = new Uint8Array(await fileRes.arrayBuffer());
  assert.deepEqual(Array.from(buf), [1, 2, 3, 4]);
});

test("POST /api/photos 缺日期回傳 400", async () => {
  const form = new FormData();
  const bytes = new Uint8Array([1]);
  form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "test2.jpg");
  const res = await fetch(`${base}/api/photos`, { method: "POST", body: form });
  assert.equal(res.status, 400);
});

test("POST /api/export-xlsx 會在 DATA_DIR 產生工作日誌.xlsx", async () => {
  const res = await fetch(`${base}/api/export-xlsx`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.path.endsWith("工作日誌.xlsx"));
});
