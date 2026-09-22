import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStore, saveStore, nextId, dateToPhotoFolder, emptyStore } from "../backend/lib/store.js";

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "pld-store-test-"));
}

test("loadStore 在檔案不存在時回傳空資料，不丟例外", async () => {
  const dir = tmpDir();
  try {
    const store = await loadStore(dir);
    assert.deepEqual(store.records, []);
    assert.equal(store.meta.schemaVersion, "1.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveStore 寫入後 loadStore 讀回同樣的內容", async () => {
  const dir = tmpDir();
  try {
    const store = emptyStore();
    store.records.push({ id: 1, date: "2026-09-22", problem: "測試" });
    await saveStore(dir, store);

    assert.ok(existsSync(path.join(dir, "data.json")));
    const reloaded = await loadStore(dir);
    assert.equal(reloaded.records.length, 1);
    assert.equal(reloaded.records[0].problem, "測試");
    assert.equal(reloaded.meta.schemaVersion, "1.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveStore 寫入是「先寫暫存檔再 rename」——不會留下 .tmp 檔案", async () => {
  const dir = tmpDir();
  try {
    await saveStore(dir, emptyStore());
    const files = readdirSync(dir);
    assert.deepEqual(files, ["data.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nextId 在空陣列回傳 1，否則回傳目前最大 id + 1", () => {
  assert.equal(nextId([]), 1);
  assert.equal(nextId([{ id: 3 }, { id: 7 }, { id: 2 }]), 8);
});

test("dateToPhotoFolder 把日期的減號拿掉", () => {
  assert.equal(dateToPhotoFolder("2026-09-21"), "20260921");
});
