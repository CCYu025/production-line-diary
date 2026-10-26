import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// web/dist 不存在（建置失敗）時：`/` 要回「介面建置失敗」頁，絕不是空白頁；API 與照片照常。
const tmp = mkdtempSync(path.join(os.tmpdir(), "pld-webui-fail-test-"));
const errorLog = path.join(tmp, "build-error.log");
writeFileSync(errorLog, '建置失敗（結束碼 1）\n\nerror: <script>alert("x")</script> & more\n', "utf8");
process.env.DATA_DIR = path.join(tmp, "data");
process.env.WEB_DIST_DIR = path.join(tmp, "dist-does-not-exist");
process.env.WEB_BUILD_ERROR_FILE = errorLog;
process.env.NO_OPEN_BROWSER = "1";

const { default: app } = await import("../backend/server.js");
const { buildFailedPageHtml, BUILD_FAILED_TITLE } = await import("../backend/lib/webUi.js");

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
});

test("沒有 web/dist：`/` 回 503 的「介面建置失敗」頁，說明怎麼處理並顯示錯誤紀錄（已跳脫）", async () => {
  for (const p of ["/", "/index.html"]) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 503, p);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const html = await res.text();
    assert.ok(html.includes(BUILD_FAILED_TITLE));
    assert.ok(html.includes("npm run build"));
    assert.ok(html.includes("建置失敗（結束碼 1）"));
    assert.ok(!html.includes("<script>alert"), "錯誤紀錄必須跳脫，不能變成可執行的標籤");
    assert.ok(html.includes("&lt;script&gt;"));
  }
});

test("失敗頁不影響 API；/next/ 照樣轉址到 /（然後看到失敗頁，不是空白）", async () => {
  assert.equal((await fetch(`${base}/api/meta`)).status, 200);
  const res = await fetch(`${base}/next/`);
  assert.equal(res.status, 503);
  assert.equal(new URL(res.url).pathname, "/");
});

test("其他沒有的路徑（含沒有的照片）是一般 404，不是失敗頁", async () => {
  assert.equal((await fetch(`${base}/photos/20260101/x.jpg`)).status, 404);
  assert.equal((await fetch(`${base}/assets/x.js`)).status, 404);
});

test("buildFailedPageHtml：沒有錯誤紀錄時仍有處理步驟", () => {
  const html = buildFailedPageHtml("");
  assert.ok(html.includes(BUILD_FAILED_TITLE));
  assert.ok(html.includes("npm install"));
  assert.ok(html.includes("沒有找到建置的錯誤紀錄"));
});
