import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// 前端（web/dist）掛在 `/`：用假的 dist 與暫存的 DATA_DIR 測，不依賴真的建置。
const tmp = mkdtempSync(path.join(os.tmpdir(), "pld-webui-test-"));
const distDir = path.join(tmp, "dist");
const dataDir = path.join(tmp, "data");
mkdirSync(path.join(distDir, "assets"), { recursive: true });
mkdirSync(path.join(dataDir, "照片", "20260101"), { recursive: true });
writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>fake-ui</title><div id=root></div>");
writeFileSync(path.join(distDir, "assets", "app-abc123.js"), "console.log('app')");
writeFileSync(path.join(dataDir, "照片", "20260101", "a.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
process.env.DATA_DIR = dataDir;
process.env.WEB_DIST_DIR = distDir;
process.env.WEB_BUILD_ERROR_FILE = path.join(tmp, "no-such-error.log");
process.env.NO_OPEN_BROWSER = "1";

const { default: app } = await import("../backend/server.js");

let server;
let base;
let port;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
});

/** fetch 不能改 Host，要測 DNS rebinding 用 node:http。 */
function rawRequest(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("`/` 直接是新介面（index.html），而且每次都要重新驗證（no-cache）", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /fake-ui/);
  assert.equal(res.headers.get("cache-control"), "no-cache");
});

test("dist 裡的 assets 以 `/assets/…` 送出", async () => {
  const res = await fetch(`${base}/assets/app-abc123.js`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /console\.log/);
});

test("舊的 /next/ 網址轉址到 /（路徑與 query 保留；hash 由瀏覽器自己帶）", async () => {
  const cases = [
    ["/next", "/"],
    ["/next/", "/"],
    ["/next/?x=1", "/?x=1"],
    ["/next/assets/app-abc123.js", "/assets/app-abc123.js"],
    ["/next/assets/app-abc123.js?v=2", "/assets/app-abc123.js?v=2"],
  ];
  for (const [from, to] of cases) {
    const res = await fetch(`${base}${from}`, { redirect: "manual" });
    assert.equal(res.status, 302, from);
    assert.equal(res.headers.get("location"), to, from);
  }
});

test("轉址不會變成站外網址（//evil.com 這類）", async () => {
  const res = await rawRequest("/next//evil.com/x");
  assert.equal(res.status, 302);
  const raw = await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port, path: "/next//evil.com/x" }, (r) => resolve(r.headers.location));
  });
  assert.equal(raw, "/evil.com/x");
});

test("舊介面的檔案已移除：/lib/aggregate.js、/frontend/index.html 都是 404", async () => {
  assert.equal((await fetch(`${base}/lib/aggregate.js`)).status, 404);
  assert.equal((await fetch(`${base}/frontend/index.html`)).status, 404);
  assert.equal((await fetch(`${base}/index.html`)).status, 200); // dist 自己的 index.html
});

test("照片仍然在 /photos/<yyyymmdd>/<檔名> 送出", async () => {
  const res = await fetch(`${base}/photos/20260101/a.jpg`);
  assert.equal(res.status, 200);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0xff, 0xd8, 0xff]);
  assert.equal((await fetch(`${base}/photos/20260101/nope.jpg`)).status, 404);
});

test("切換到 `/` 後，本機 CSRF 檢查（S1）仍然有效：沒帶 X-Requested-With 的寫入回 403", async () => {
  const noHeader = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(noHeader.status, 403);
  const withHeader = await fetch(`${base}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "production-line-diary" },
    body: "{}",
  });
  assert.equal(withHeader.status, 400); // 進到驗證了
});

test("切換到 `/` 後，DNS rebinding 防護（S2）仍然有效：Host 不是 localhost 一律 403，連首頁與照片都擋", async () => {
  for (const p of ["/", "/api/meta", "/photos/20260101/a.jpg", "/next/"]) {
    const res = await rawRequest(p, { Host: "evil.example.com" });
    assert.equal(res.status, 403, p);
  }
  assert.equal((await rawRequest("/", { Host: `localhost:${port}` })).status, 200);
});

test("未知的 /api 路徑仍回 JSON 404，不是前端頁面", async () => {
  const res = await fetch(`${base}/api/xxx`);
  assert.equal(res.status, 404);
  assert.deepEqual((await res.json()).errors.length, 1);
});
