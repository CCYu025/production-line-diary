import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "pld-api-test-"));
process.env.DATA_DIR = dataDir;
process.env.NO_OPEN_BROWSER = "1";

const { default: app } = await import("../backend/server.js");

// S1：所有非 GET 的 /api 請求都要帶這個標頭。測試裡的 fetch 預設幫忙帶上，
// 要測「沒帶」的情況時用 rawFetch。
const rawFetch = globalThis.fetch;
const fetch = (url, opts = {}) =>
  rawFetch(url, { ...opts, headers: { "X-Requested-With": "production-line-diary", ...opts.headers } });

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

async function uploadPhoto(date, name, bytes = [1, 2, 3]) {
  const form = new FormData();
  form.append("date", date);
  form.append("photo", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), name);
  const res = await fetch(`${base}/api/photos`, { method: "POST", body: form });
  assert.equal(res.status, 201);
  return (await res.json()).filename;
}

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

// 重現使用者實際回報的 bug：編輯紀錄時移除一張照片、重新上傳「同一張」，
// 結果硬碟上多出一份 xxx-1.jpg、原始檔案變成沒人參照的孤兒。
//
// 前端實際的操作順序是「先上傳新檔案，才送出移除舊檔案的 PUT」（見
// frontend/index.html 的 saveEdit），所以第二次上傳當下舊檔名還在被參照、
// 一定會被改名成 S__same-1.jpg——這點修不掉也不必修。真正該修的是:
// PUT 完成、確認舊檔名沒有任何紀錄再參照之後，那個孤兒檔案要被清掉，
// 不能留著佔位置、誤導使用者以為多了一張重複照片。
test("編輯時移除照片並重新上傳同名檔案：舊的孤兒檔案要被清掉", async () => {
  const createRes = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: "2026-09-23",
      shift: "早",
      time: "09:00",
      duration: 10,
      equipment: "F3",
      category: "沾模",
      problem: "半製品表面髒污",
    }),
  });
  const { record } = await createRes.json();

  const uploadOnce = async () => {
    const form = new FormData();
    form.append("date", "2026-09-23");
    form.append("photo", new Blob([new Uint8Array([9, 9, 9])], { type: "image/jpeg" }), "S__same.jpg");
    const res = await fetch(`${base}/api/photos`, { method: "POST", body: form });
    return (await res.json()).filename;
  };

  const firstFilename = await uploadOnce();
  assert.equal(firstFilename, "S__same.jpg");
  await fetch(`${base}/api/records/${record.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photos: [firstFilename] }),
  });

  // 使用者在編輯畫面移除這張照片、重新選了同一個檔案再上傳一次
  const secondFilename = await uploadOnce();
  assert.equal(secondFilename, "S__same-1.jpg", "第二次上傳當下舊檔名還被參照，預期會被改名");

  const updateRes = await fetch(`${base}/api/records/${record.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photos: [secondFilename] }),
  });
  assert.equal(updateRes.status, 200);

  const orphanRes = await fetch(`${base}/photos/20260923/S__same.jpg`);
  assert.equal(orphanRes.status, 404, "第一次上傳的孤兒檔案應該已被刪除，不該還能存取到");

  const newRes = await fetch(`${base}/photos/20260923/${secondFilename}`);
  assert.equal(newRes.status, 200, "紀錄實際參照的那張照片必須還能正常存取");
});

test("永久刪除紀錄時，該紀錄專屬的照片檔案也要一併清掉", async () => {
  const createRes = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: "2026-09-24",
      shift: "早",
      time: "09:00",
      duration: 10,
      equipment: "F4",
      category: "尺寸異常",
      problem: "厚度下限",
    }),
  });
  const { record } = await createRes.json();

  const form = new FormData();
  form.append("date", "2026-09-24");
  form.append("photo", new Blob([new Uint8Array([1, 2])], { type: "image/jpeg" }), "purge-test.jpg");
  const uploadRes = await fetch(`${base}/api/photos`, { method: "POST", body: form });
  const filename = (await uploadRes.json()).filename;

  await fetch(`${base}/api/records/${record.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photos: [filename] }),
  });

  await fetch(`${base}/api/records/${record.id}/delete`, { method: "POST" });
  await fetch(`${base}/api/records/${record.id}`, { method: "DELETE" });

  const res = await fetch(`${base}/photos/20260924/${filename}`);
  assert.equal(res.status, 404, "紀錄被永久刪除後，它專屬的照片檔案不該再留在硬碟上");
});

test("DELETE /api/photos/:date/:filename：沒有紀錄參照時，把還沒送出表單就被移除的照片清掉", async () => {
  const form = new FormData();
  form.append("date", "2026-09-25");
  form.append("photo", new Blob([new Uint8Array([5, 5])], { type: "image/jpeg" }), "not-yet-attached.jpg");
  const uploadRes = await fetch(`${base}/api/photos`, { method: "POST", body: form });
  const filename = (await uploadRes.json()).filename;

  // 還沒有任何紀錄的 PUT 把這個檔名寫進 photos[]，模擬使用者在送出表單前就把它移除
  const delRes = await fetch(`${base}/api/photos/2026-09-25/${filename}`, { method: "DELETE" });
  assert.equal(delRes.status, 200);
  assert.deepEqual(await delRes.json(), { deleted: true });

  const checkRes = await fetch(`${base}/photos/20260925/${filename}`);
  assert.equal(checkRes.status, 404);
});

test("DELETE /api/photos/:date/:filename：如果已經有紀錄參照了，不會誤刪", async () => {
  const form = new FormData();
  form.append("date", "2026-09-25");
  form.append("photo", new Blob([new Uint8Array([6, 6])], { type: "image/jpeg" }), "still-in-use.jpg");
  const uploadRes = await fetch(`${base}/api/photos`, { method: "POST", body: form });
  const filename = (await uploadRes.json()).filename;

  const createRes = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: "2026-09-25", shift: "早", time: "09:00", duration: 10,
      equipment: "F3", category: "沾模", problem: "測試", photos: [filename],
    }),
  });
  const { record } = await createRes.json();

  await fetch(`${base}/api/photos/2026-09-25/${filename}`, { method: "DELETE" });
  const checkRes = await fetch(`${base}/photos/20260925/${filename}`);
  assert.equal(checkRes.status, 200, "紀錄還在用這張照片，不該被刪掉");

  // 清理
  await fetch(`${base}/api/records/${record.id}/delete`, { method: "POST" });
  await fetch(`${base}/api/records/${record.id}`, { method: "DELETE" });
});

// 這次修復的核心：新增紀錄改成「選到檔案就立刻上傳」而不是「送出表單時才上傳」，
// 所以就算 POST /api/records 的建立步驟被呼叫兩次（例如使用者手滑點了兩次），
// 照片本身只會被上傳一次，不會因為重跑上傳流程而多出 -1 的重複檔案。
test("同一個已上傳的照片檔名被兩筆不同紀錄參照時，兩筆都讀得到、且互不影響彼此的刪除", async () => {
  const form = new FormData();
  form.append("date", "2026-09-25");
  form.append("photo", new Blob([new Uint8Array([7, 7])], { type: "image/jpeg" }), "shared-across-records.jpg");
  const uploadRes = await fetch(`${base}/api/photos`, { method: "POST", body: form });
  const filename = (await uploadRes.json()).filename;

  const createOne = async () => {
    const res = await fetch(`${base}/api/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-25", shift: "早", time: "09:00", duration: 10,
        equipment: "F3", category: "沾模", problem: "共用照片測試", photos: [filename],
      }),
    });
    return (await res.json()).record;
  };
  const recA = await createOne();
  const recB = await createOne();

  await fetch(`${base}/api/records/${recA.id}/delete`, { method: "POST" });
  await fetch(`${base}/api/records/${recA.id}`, { method: "DELETE" });

  const stillThere = await fetch(`${base}/photos/20260925/${filename}`);
  assert.equal(stillThere.status, 200, "recB 還在參照這張照片，recA 被刪掉不該連累它");

  await fetch(`${base}/api/records/${recB.id}/delete`, { method: "POST" });
  await fetch(`${base}/api/records/${recB.id}`, { method: "DELETE" });
  const goneNow = await fetch(`${base}/photos/20260925/${filename}`);
  assert.equal(goneNow.status, 404, "兩筆都刪掉之後，這張照片才該真的消失");
});

test("POST/PUT /api/records 會正確存取 productCode 與 materialCategory，未填時是 null", async () => {
  const createRes = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: "2026-09-26", shift: "早", time: "09:00", duration: 10,
      equipment: "F3", category: "沾模", problem: "測試品號欄位",
      productCode: "PC-001", materialCategory: "膠料A",
    }),
  });
  const created = (await createRes.json()).record;
  assert.equal(created.productCode, "PC-001");
  assert.equal(created.materialCategory, "膠料A");

  const createRes2 = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: "2026-09-26", shift: "早", time: "09:05", duration: 10,
      equipment: "F4", category: "缺料", problem: "沒有填品號",
    }),
  });
  const created2 = (await createRes2.json()).record;
  assert.equal(created2.productCode, null);
  assert.equal(created2.materialCategory, null);

  const updateRes = await fetch(`${base}/api/records/${created2.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productCode: "PC-002" }),
  });
  const updated = (await updateRes.json()).record;
  assert.equal(updated.productCode, "PC-002");
});

test("GET /api/meta 會回傳 productCodes / materialCategories / equipmentMap", async () => {
  const res = await fetch(`${base}/api/meta`);
  const body = await res.json();
  assert.ok(body.productCodes.includes("PC-001"));
  assert.ok(body.materialCategories.includes("膠料A"));
  assert.ok(Array.isArray(body.equipmentMap));
});

test("PUT /api/equipment-map 儲存設備對照表，GET /api/meta 讀得到，且空設備代號會被過濾掉", async () => {
  const putRes = await fetch(`${base}/api/equipment-map`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      { equipment: "F3", productCode: "PC-001", materialCategory: "膠料A" },
      { equipment: "  ", productCode: "應該被丟掉", materialCategory: null },
      { equipment: "F4", productCode: "PC-002", materialCategory: null },
    ]),
  });
  assert.equal(putRes.status, 200);
  const putBody = await putRes.json();
  assert.equal(putBody.equipmentMap.length, 2);

  const metaRes = await fetch(`${base}/api/meta`);
  const metaBody = await metaRes.json();
  assert.deepEqual(metaBody.equipmentMap, [
    { equipment: "F3", productCode: "PC-001", materialCategory: "膠料A" },
    { equipment: "F4", productCode: "PC-002", materialCategory: null },
  ]);
});

test("PUT /api/equipment-map body 不是陣列時回傳 400", async () => {
  const res = await fetch(`${base}/api/equipment-map`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notAnArray: true }),
  });
  assert.equal(res.status, 400);
});

test("photoCaptions：建立時清理；沒帶 photoCaptions 的 PUT 保留原說明；移除照片時說明一起拿掉", async () => {
  const json = { "Content-Type": "application/json" };
  await uploadPhoto("2026-09-24", "a.jpg");
  await uploadPhoto("2026-09-24", "b.jpg");
  let res = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      date: "2026-09-24", time: "10:00", duration: 5, equipment: "F3", problem: "圖片說明測試",
      photos: ["a.jpg", "b.jpg"],
      photoCaptions: { "a.jpg": "  模具表面裂痕  ", "ghost.jpg": "不存在的照片", "b.jpg": "   " },
    }),
  });
  assert.equal(res.status, 201);
  const { record } = await res.json();
  assert.deepEqual(record.photoCaptions, { "a.jpg": "模具表面裂痕" });

  res = await fetch(`${base}/api/records/${record.id}`, {
    method: "PUT", headers: json, body: JSON.stringify({ status: "追蹤中" }),
  });
  assert.deepEqual((await res.json()).record.photoCaptions, record.photoCaptions);

  res = await fetch(`${base}/api/records/${record.id}`, {
    method: "PUT", headers: json, body: JSON.stringify({ photos: ["b.jpg"] }),
  });
  assert.deepEqual((await res.json()).record.photoCaptions, {});
});

// ───────────────────────── WP1b 後端強化：H1–H4、V1–V4、S1–S2 ─────────────────────────

import http from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";

const JSON_HEADERS = { "Content-Type": "application/json" };

function validBody(overrides = {}) {
  return {
    date: "2026-10-01", shift: "早", time: "09:00", duration: 10,
    equipment: "F3", category: "沾模", problem: "強化測試", ...overrides,
  };
}

async function postRecord(overrides, headers = JSON_HEADERS) {
  return fetch(`${base}/api/records`, { method: "POST", headers, body: JSON.stringify(validBody(overrides)) });
}

function requestWithHost(host, pathname = "/api/records") {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request(
      { host: u.hostname, port: u.port, path: pathname, method: "GET", headers: { Host: host } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---- S1 ----

test("S1：非 GET 的 /api 請求沒帶 X-Requested-With 一律 403，帶錯值也 403，GET 不受影響", async () => {
  const bare = { "Content-Type": "application/json" };
  let res = await rawFetch(`${base}/api/records`, { method: "POST", headers: bare, body: JSON.stringify(validBody()) });
  assert.equal(res.status, 403);
  assert.ok((await res.json()).errors.length > 0);

  res = await rawFetch(`${base}/api/records`, {
    method: "POST",
    headers: { ...bare, "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(validBody()),
  });
  assert.equal(res.status, 403);

  for (const [method, url] of [
    ["PUT", "/api/records/1"],
    ["DELETE", "/api/records/1"],
    ["POST", "/api/records/1/delete"],
    ["POST", "/api/records/1/restore"],
    ["PUT", "/api/equipment-map"],
    ["POST", "/api/export-xlsx"],
    ["POST", "/api/photos"],
    ["DELETE", "/api/photos/2026-10-01/x.jpg"],
  ]) {
    res = await rawFetch(`${base}${url}`, { method, headers: bare, body: method === "PUT" ? "[]" : undefined });
    assert.equal(res.status, 403, `${method} ${url} 沒帶標頭應該 403`);
  }

  res = await rawFetch(`${base}/api/records`);
  assert.equal(res.status, 200, "GET 不需要標頭");
});

test("S1：被拒絕的請求不會寫入任何資料", async () => {
  const before = (await (await fetch(`${base}/api/records`)).json()).records.length;
  await rawFetch(`${base}/api/records`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(validBody()) });
  const after = (await (await fetch(`${base}/api/records`)).json()).records.length;
  assert.equal(after, before);
});

// ---- S2 ----

test("S2：Host 只接受 localhost / 127.0.0.1 / [::1]（任意 port），其他一律 403", async () => {
  const port = new URL(base).port;
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, "localhost", "LOCALHOST:3000"]) {
    assert.equal(await requestWithHost(host), 200, `${host} 應該放行`);
  }
  for (const host of ["evil.example.com", `evil.example.com:${port}`, `localhost.evil.com:${port}`, "127.0.0.1.evil.com"]) {
    assert.equal(await requestWithHost(host), 403, `${JSON.stringify(host)} 應該被擋`);
  }
});

test("S2：Host 檢查也套用在靜態檔與照片，不只 /api", async () => {
  assert.equal(await requestWithHost("evil.example.com", "/"), 403);
  assert.equal(await requestWithHost("evil.example.com", "/photos/20260922/test.jpg"), 403);
});

// ---- H1 ----

test("H1：壞掉的 JSON body 回 400 {errors}，伺服器繼續服務", async () => {
  const res = await fetch(`${base}/api/records`, { method: "POST", headers: JSON_HEADERS, body: "{not json" });
  assert.equal(res.status, 400);
  assert.ok(Array.isArray((await res.json()).errors));
  assert.equal((await fetch(`${base}/api/records`)).status, 200);
});

test("H1：沒有 body 的 POST 回 400（不是 500／當機）", async () => {
  const res = await fetch(`${base}/api/records`, { method: "POST" });
  assert.equal(res.status, 400);
});

test("H1 + H3：data.json 損毀時 GET／寫入都回 500 {errors}，原檔絕不被覆寫，修好後恢復正常", async () => {
  const file = path.join(dataDir, "data.json");
  const original = readFileSync(file, "utf8");
  const corrupt = '{"records": [ {"id": 1, ';
  writeFileSync(file, corrupt);
  try {
    let res = await fetch(`${base}/api/records`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.ok(body.errors[0].includes("data.json"));

    res = await postRecord({});
    assert.equal(res.status, 500);
    res = await fetch(`${base}/api/equipment-map`, { method: "PUT", headers: JSON_HEADERS, body: "[]" });
    assert.equal(res.status, 500);
    assert.equal(readFileSync(file, "utf8"), corrupt, "損毀的 data.json 不可被覆寫");
  } finally {
    writeFileSync(file, original);
  }
  assert.equal((await fetch(`${base}/api/records`)).status, 200, "修復後伺服器仍正常（沒有因為前面的失敗而結束）");
});

test("H1：multer 的錯誤（缺 date）仍然回 400", async () => {
  const form = new FormData();
  form.append("photo", new Blob([new Uint8Array([1])], { type: "image/jpeg" }), "x.jpg");
  const res = await fetch(`${base}/api/photos`, { method: "POST", body: form });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors[0]);
});

// ---- H2 ----

test("H2：20 個同時進來的 POST → 20 個不同的 id、沒有任何一筆遺失", async () => {
  const before = (await (await fetch(`${base}/api/records`)).json()).records.length;
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => postRecord({ problem: `並發測試 ${i}`, time: `10:${String(i).padStart(2, "0")}` })),
  );
  for (const r of results) assert.equal(r.status, 201);
  const ids = (await Promise.all(results.map((r) => r.json()))).map((b) => b.record.id);
  assert.equal(new Set(ids).size, 20, "id 不可重複");

  const { records } = await (await fetch(`${base}/api/records`)).json();
  assert.equal(records.length, before + 20, "20 筆都要存進去");
  for (let i = 0; i < 20; i++) {
    assert.ok(records.some((r) => r.problem === `並發測試 ${i}`), `缺少並發測試 ${i}`);
  }
  const allIds = records.map((r) => r.id);
  assert.equal(new Set(allIds).size, allIds.length, "整份資料裡也不可有重複 id");
});

test("H2：同時 PUT 同一筆紀錄的不同欄位，兩個修改都保留（沒有互相覆蓋）", async () => {
  const { record } = await (await postRecord({ problem: "並發 PUT" })).json();
  const put = (payload) =>
    fetch(`${base}/api/records/${record.id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  const [a, b] = await Promise.all([put({ status: "追蹤中" }), put({ rootCause: "同時寫入的根本原因" })]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const { records } = await (await fetch(`${base}/api/records`)).json();
  const saved = records.find((r) => r.id === record.id);
  assert.equal(saved.status, "追蹤中");
  assert.equal(saved.rootCause, "同時寫入的根本原因");
});

test("H2：一個請求失敗（400/404）不會卡住後面排隊的請求", async () => {
  const bad = fetch(`${base}/api/records/999999`, { method: "PUT", headers: JSON_HEADERS, body: "{}" });
  const good = postRecord({ problem: "失敗請求之後的請求" });
  const [badRes, goodRes] = await Promise.all([bad, good]);
  assert.equal(badRes.status, 404);
  assert.equal(goodRes.status, 201);
});

// ---- H4（透過 API）----

test("H4：同一天第一次寫入前，現有 data.json 會被複製到 backups/data-YYYYMMDD.json", async () => {
  const dir = path.join(dataDir, "backups");
  assert.ok(existsSync(dir), "前面已經有過寫入，backups 資料夾應該存在");
  const names = readdirSync(dir).filter((n) => /^data-\d{8}\.json$/.test(n));
  assert.ok(names.length >= 1);
  JSON.parse(readFileSync(path.join(dir, names[0]), "utf8")); // 備份是合法 JSON
});

// ---- V1 ----

test("V1：severity / status / shift 不在允許值內 → 400；缺省時才用預設", async () => {
  for (const bad of [{ severity: "超級嚴重" }, { status: "不存在" }, { shift: "夜" }, { shift: "" }, { severity: 3 }]) {
    const res = await postRecord(bad);
    assert.equal(res.status, 400, `${JSON.stringify(bad)} 應該被拒絕`);
  }
  const res = await postRecord({ duration: 30 });
  const { record } = await res.json();
  assert.equal(record.severity, "重大");
  assert.equal(record.status, "待處理");
  assert.equal(record.shift, "早");

  const explicit = await (await postRecord({ severity: "一般", status: "追蹤中", shift: "晚" })).json();
  assert.equal(explicit.record.severity, "一般");
  assert.equal(explicit.record.status, "追蹤中");
  assert.equal(explicit.record.shift, "晚");
});

test("V1：PUT 的 enum 也要驗證，被拒絕時紀錄不變", async () => {
  const { record } = await (await postRecord({})).json();
  for (const bad of [{ severity: "x" }, { status: "完成" }, { shift: "夜班" }]) {
    const res = await fetch(`${base}/api/records/${record.id}`, {
      method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(bad),
    });
    assert.equal(res.status, 400);
  }
  const { records } = await (await fetch(`${base}/api/records`)).json();
  const saved = records.find((r) => r.id === record.id);
  assert.equal(saved.severity, record.severity);
  assert.equal(saved.updatedAt, null);
});

test("V1：PUT 只收白名單欄位——id / deleted / deletedAt / updatedAt / 任意欄位都不能被 body 改掉", async () => {
  const { record } = await (await postRecord({ problem: "白名單測試" })).json();
  const res = await fetch(`${base}/api/records/${record.id}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      id: 999999, deleted: true, deletedAt: "2020-01-01T00:00:00.000Z", updatedAt: "1999-01-01",
      evil: "x", __proto__: { polluted: true }, status: "追蹤中",
    }),
  });
  assert.equal(res.status, 200);
  const { record: saved } = await res.json();
  assert.equal(saved.id, record.id);
  assert.equal(saved.deleted, false);
  assert.equal(saved.deletedAt, null);
  assert.equal("evil" in saved, false);
  assert.notEqual(saved.updatedAt, "1999-01-01");
  assert.equal(saved.status, "追蹤中", "白名單裡的欄位照常更新");
});

test("V1：POST 也不會把 body 裡的 id / deleted 等內部欄位寫進去", async () => {
  const res = await postRecord({ id: 12345, deleted: true, deletedAt: "x", updatedAt: "y", extra: 1 });
  const { record } = await res.json();
  assert.notEqual(record.id, 12345);
  assert.equal(record.deleted, false);
  assert.equal(record.deletedAt, null);
  assert.equal(record.updatedAt, null);
  assert.equal("extra" in record, false);
});

// ---- V2 ----

test("V2：不存在的日期（2026-02-30、2026-13-01、閏年判斷）→ 400", async () => {
  for (const date of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31", "2025-02-29", "abcd-ef-gh", "2026-1-1"]) {
    assert.equal((await postRecord({ date })).status, 400, `${date} 應該被拒絕`);
  }
  assert.equal((await postRecord({ date: "2028-02-29" })).status, 201, "閏年 2/29 是真實日期");
});

test("V2：time 必須是 00:00–23:59", async () => {
  for (const time of ["24:00", "23:60", "99:99", "9:00", "09:0", "ab:cd", ""]) {
    assert.equal((await postRecord({ time })).status, 400, `${JSON.stringify(time)} 應該被拒絕`);
  }
  for (const time of ["00:00", "23:59"]) assert.equal((await postRecord({ time })).status, 201);
});

test("V2：PUT 改成不存在的日期／時間 → 400", async () => {
  const { record } = await (await postRecord({})).json();
  for (const bad of [{ date: "2026-02-30" }, { time: "24:00" }]) {
    const res = await fetch(`${base}/api/records/${record.id}`, {
      method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(bad),
    });
    assert.equal(res.status, 400);
  }
});

test("V2：上傳照片時 date 不是真實日期 → 400（multer 錯誤路徑）", async () => {
  const form = new FormData();
  form.append("date", "2026-02-30");
  form.append("photo", new Blob([new Uint8Array([1])], { type: "image/jpeg" }), "x.jpg");
  assert.equal((await fetch(`${base}/api/photos`, { method: "POST", body: form })).status, 400);
});

// ---- V3 ----

test("V3：photos[] 含路徑跳脫或不安全的檔名 → 400（POST 與 PUT）", async () => {
  const badNames = [
    "../x.jpg", "..", "a/b.jpg", "a\\b.jpg", "..\\x.jpg", "/etc/passwd", "C:\\win.ini", "c:evil.jpg",
    "a..b.jpg", "bad\u0000.jpg", "bad\n.jpg", "", ".", 123, null, { a: 1 },
  ];
  const { record } = await (await postRecord({})).json();
  for (const name of badNames) {
    const post = await postRecord({ photos: [name] });
    assert.equal(post.status, 400, `POST photos:[${JSON.stringify(name)}] 應該被拒絕`);
    const put = await fetch(`${base}/api/records/${record.id}`, {
      method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ photos: [name] }),
    });
    assert.equal(put.status, 400, `PUT photos:[${JSON.stringify(name)}] 應該被拒絕`);
  }
  assert.equal((await postRecord({ photos: "a.jpg" })).status, 400, "photos 不是陣列");
});

test("V3：DELETE /api/photos/:date/:filename 驗證 date 與檔名，路徑跳脫打不到資料夾外的檔案", async () => {
  const dataFile = path.join(dataDir, "data.json");
  assert.ok(existsSync(dataFile));
  const attempts = [
    "/api/photos/2026-09-25/..%2F..%2Fdata.json",
    "/api/photos/2026-09-25/..%2F..%2F..%2Fdata.json",
    "/api/photos/2026-09-25/..%5C..%5Cdata.json",
    "/api/photos/2026-09-25/%2E%2E%2F%2E%2E%2Fdata.json",
    "/api/photos/..%2F..%2F/data.json",
    "/api/photos/2026-02-30/x.jpg",
    "/api/photos/abcd/x.jpg",
    "/api/photos/2026-09-25/a..b.jpg",
  ];
  for (const url of attempts) {
    const res = await fetch(`${base}${url}`, { method: "DELETE" });
    assert.ok([400, 404].includes(res.status), `${url} 應該被拒絕，實際 ${res.status}`);
    assert.notEqual(res.status, 200, `${url} 不可以成功`);
  }
  assert.ok(existsSync(dataFile), "data.json 不可被路徑跳脫刪掉");
});

test("V3：上傳檔名含 .. 會被收斂成單一個點，所以仍可存進紀錄", async () => {
  const name = await uploadPhoto("2026-10-02", "a..b...jpg");
  assert.equal(name, "a.b.jpg");
  const res = await postRecord({ date: "2026-10-02", photos: [name] });
  assert.equal(res.status, 201);
});

// ---- V4 ----

test("V4：POST 時引用不存在的照片 → 400，訊息說明「照片與日期不一致」", async () => {
  const res = await postRecord({ photos: ["not-uploaded.jpg"] });
  assert.equal(res.status, 400);
  const { errors } = await res.json();
  assert.ok(errors[0].includes("照片與日期不一致"), errors[0]);
  assert.ok(errors[0].includes("not-uploaded.jpg"));
});

test("V4：照片是用別的日期上傳的（選照片後才改日期）→ POST 400，且不會寫入", async () => {
  const name = await uploadPhoto("2026-10-03", "wrong-date.jpg");
  const before = (await (await fetch(`${base}/api/records`)).json()).records.length;
  const res = await postRecord({ date: "2026-10-04", photos: [name] });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors[0].includes("照片與日期不一致"));
  const after = (await (await fetch(`${base}/api/records`)).json()).records.length;
  assert.equal(after, before);
  // 日期對的時候就可以
  assert.equal((await postRecord({ date: "2026-10-03", photos: [name] })).status, 201);
});

test("V4：PUT 新加入的照片必須存在於「新日期」的資料夾", async () => {
  const { record } = await (await postRecord({ date: "2026-10-05" })).json();
  const onOldDate = await uploadPhoto("2026-10-05", "put-old-date.jpg");
  let res = await fetch(`${base}/api/records/${record.id}`, {
    method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ date: "2026-10-06", photos: [onOldDate] }),
  });
  assert.equal(res.status, 400, "照片在舊日期資料夾，新日期資料夾沒有 → 拒絕");
  assert.ok((await res.json()).errors[0].includes("照片與日期不一致"));

  const onNewDate = await uploadPhoto("2026-10-06", "put-new-date.jpg");
  res = await fetch(`${base}/api/records/${record.id}`, {
    method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ date: "2026-10-06", photos: [onNewDate] }),
  });
  assert.equal(res.status, 200);
  assert.equal((await fetch(`${base}/photos/20261006/${onNewDate}`)).status, 200);
});

test("V4：PUT 改日期時，原本就在紀錄裡的照片照舊跟著搬到新日期資料夾", async () => {
  const name = await uploadPhoto("2026-10-07", "carry-over.jpg");
  const { record } = await (await postRecord({ date: "2026-10-07", photos: [name] })).json();
  const res = await fetch(`${base}/api/records/${record.id}`, {
    method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ date: "2026-10-08" }),
  });
  assert.equal(res.status, 200);
  assert.equal((await fetch(`${base}/photos/20261008/${name}`)).status, 200, "照片已搬到新日期");
  assert.equal((await fetch(`${base}/photos/20261007/${name}`)).status, 404, "舊資料夾不再有");
});

test("V4：PUT 不碰照片時（舊資料的照片檔案就算不在硬碟上）也能照常更新其他欄位", async () => {
  // 直接寫一筆照片檔案不存在的舊式紀錄進 data.json（模擬歷史資料／檔案被使用者手動移走）
  const file = path.join(dataDir, "data.json");
  const store = JSON.parse(readFileSync(file, "utf8"));
  const id = Math.max(0, ...store.records.map((r) => r.id)) + 1;
  store.records.push({
    id, date: "2026-10-09", shift: "早", time: "08:00", duration: 5, equipment: "F3", category: "其他",
    problem: "舊紀錄", severity: "輕微", action: "", rootCause: null, status: "待處理", productCode: null,
    materialCategory: null, photos: ["long-gone.jpg"], updatedAt: null, deleted: false, deletedAt: null,
  });
  writeFileSync(file, JSON.stringify(store));
  const res = await fetch(`${base}/api/records/${id}`, {
    method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ status: "已解決" }),
  });
  assert.equal(res.status, 200);
});
