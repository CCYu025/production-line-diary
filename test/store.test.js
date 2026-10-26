import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadStore, saveStore, nextId, dateToPhotoFolder, emptyStore, SCHEMA_VERSION } from "../backend/lib/store.js";

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "pld-store-test-"));
}

test("loadStore 在檔案不存在時回傳空資料，不丟例外", async () => {
  const dir = tmpDir();
  try {
    const store = await loadStore(dir);
    assert.deepEqual(store.records, []);
    assert.equal(store.meta.schemaVersion, SCHEMA_VERSION);
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
    assert.equal(reloaded.meta.schemaVersion, SCHEMA_VERSION);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("equipmentMap 也是 saveStore/loadStore 會一起讀寫的資料，不會被漏掉", async () => {
  const dir = tmpDir();
  try {
    const store = emptyStore();
    store.equipmentMap = [{ equipment: "F3", productCode: "PC-001", materialCategory: "膠料A" }];
    await saveStore(dir, store);

    const reloaded = await loadStore(dir);
    assert.deepEqual(reloaded.equipmentMap, [{ equipment: "F3", productCode: "PC-001", materialCategory: "膠料A" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("emptyStore / loadStore（檔案不存在）都內建 equipmentMap: []，不是 undefined", async () => {
  assert.deepEqual(emptyStore().equipmentMap, []);
  const dir = tmpDir();
  try {
    const store = await loadStore(dir);
    assert.deepEqual(store.equipmentMap, []);
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

// ───────────────────────── WP1b：H2 / H3 / H4 ─────────────────────────

import {
  withStore,
  renameWithRetry,
  backupBeforeFirstSaveOfDay,
  StoreCorruptError,
  BACKUP_KEEP,
} from "../backend/lib/store.js";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

function rec(id) {
  return { id, date: "2026-09-22", problem: `p${id}` };
}

function localStamp(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// ---- H2：withStore ----

test("H2 withStore：40 個同時進來的「讀 → 改 → 寫」全部成功，id 不重複、沒有遺失", async () => {
  const dir = tmpDir();
  try {
    const ids = await Promise.all(
      Array.from({ length: 40 }, () =>
        withStore(dir, async (store) => {
          const id = nextId(store.records);
          // 故意在「讀」跟「寫」之間讓出事件迴圈，沒有鎖的話一定會撞
          await new Promise((r) => setTimeout(r, 1));
          store.records.push(rec(id));
          await store.save();
          return id;
        }),
      ),
    );
    assert.equal(new Set(ids).size, 40);
    const reloaded = await loadStore(dir);
    assert.equal(reloaded.records.length, 40);
    assert.deepEqual(
      reloaded.records.map((r) => r.id).sort((a, b) => a - b),
      Array.from({ length: 40 }, (_, i) => i + 1),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H2 withStore：回呼丟例外就不寫入、例外原樣丟出，後面排隊的請求照常執行", async () => {
  const dir = tmpDir();
  try {
    await withStore(dir, async (store) => {
      store.records.push(rec(1));
      await store.save();
    });
    const failing = withStore(dir, async (store) => {
      store.records.push(rec(2)); // 改了記憶體但沒存
      throw new Error("boom");
    });
    const after = withStore(dir, async (store) => {
      store.records.push(rec(nextId(store.records)));
      await store.save();
      return store.records.length;
    });
    await assert.rejects(failing, /boom/);
    assert.equal(await after, 2, "boom 那次的修改不可殘留");
    assert.deepEqual((await loadStore(dir)).records.map((r) => r.id), [1, 2]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H2 withStore：不同資料夾各自一把鎖，互不等待；回傳值就是回呼的回傳值", async () => {
  const a = tmpDir();
  const b = tmpDir();
  try {
    const order = [];
    const slow = withStore(a, async () => {
      await new Promise((r) => setTimeout(r, 60));
      order.push("a");
      return "A";
    });
    const fast = withStore(b, async () => {
      order.push("b");
      return "B";
    });
    assert.deepEqual([await slow, await fast], ["A", "B"]);
    assert.deepEqual(order, ["b", "a"]);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("H2 withStore：store.save 不會出現在寫進 data.json 的內容裡", async () => {
  const dir = tmpDir();
  try {
    await withStore(dir, async (store) => {
      store.records.push(rec(1));
      await store.save();
    });
    const raw = JSON.parse(readFileSync(path.join(dir, "data.json"), "utf8"));
    assert.deepEqual(Object.keys(raw).sort(), ["_meta", "equipmentMap", "records"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- H3：rename 重試、解析失敗不覆寫 ----

test("H3 renameWithRetry：遇到 EPERM / EBUSY / EACCES 會重試，之後成功就當作成功", async () => {
  for (const code of ["EPERM", "EBUSY", "EACCES"]) {
    let calls = 0;
    const fakeRename = async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error(code), { code });
    };
    await renameWithRetry("a", "b", { rename: fakeRename, delays: [1, 1, 1, 1, 1] });
    assert.equal(calls, 3, `${code}：失敗 2 次後第 3 次成功`);
  }
});

test("H3 renameWithRetry：重試用完（預設 5 次重試＝共 6 次嘗試）仍失敗才丟錯", async () => {
  let calls = 0;
  const fakeRename = async () => {
    calls += 1;
    throw Object.assign(new Error("locked"), { code: "EBUSY" });
  };
  await assert.rejects(renameWithRetry("a", "b", { rename: fakeRename, delays: [1, 1, 1, 1, 1] }), /locked/);
  assert.equal(calls, 6);
});

test("H3 renameWithRetry：其他錯誤（例如 ENOENT）不重試，直接丟", async () => {
  let calls = 0;
  const fakeRename = async () => {
    calls += 1;
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
  await assert.rejects(renameWithRetry("a", "b", { rename: fakeRename, delays: [1, 1, 1] }), /missing/);
  assert.equal(calls, 1);
});

test("H3 renameWithRetry：預設退避時間是 50→800ms 的遞增序列（總共不超過幾秒）", async () => {
  const started = Date.now();
  let calls = 0;
  await renameWithRetry("a", "b", {
    rename: async () => {
      calls += 1;
      if (calls < 2) throw Object.assign(new Error("x"), { code: "EPERM" });
    },
  });
  const elapsed = Date.now() - started;
  assert.equal(calls, 2);
  assert.ok(elapsed >= 40 && elapsed < 1500, `第一次退避約 50ms，實際 ${elapsed}ms`);
});

test("H3 loadStore：data.json 不是合法 JSON → 丟 StoreCorruptError，原檔不動", async () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "data.json");
    writeFileSync(file, '{"records": [');
    await assert.rejects(loadStore(dir), StoreCorruptError);
    await assert.rejects(loadStore(dir), /data\.json 無法解析/);
    assert.equal(readFileSync(file, "utf8"), '{"records": [');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H3 withStore：data.json 損毀時回呼根本不會執行、也不會寫入或產生備份", async () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "data.json");
    writeFileSync(file, "not json at all");
    let ran = false;
    await assert.rejects(
      withStore(dir, async (store) => {
        ran = true;
        await store.save();
      }),
      StoreCorruptError,
    );
    assert.equal(ran, false);
    assert.equal(readFileSync(file, "utf8"), "not json at all");
    assert.equal(existsSync(path.join(dir, "backups")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H3 loadStore：最上層不是物件（例如陣列）也視為損毀", async () => {
  const dir = tmpDir();
  try {
    writeFileSync(path.join(dir, "data.json"), "[]");
    await assert.rejects(loadStore(dir), StoreCorruptError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H3 saveStore：寫入成功後目錄裡沒有殘留的 .tmp 檔", async () => {
  const dir = tmpDir();
  try {
    await saveStore(dir, emptyStore());
    await saveStore(dir, emptyStore());
    assert.deepEqual(readdirSync(dir).filter((n) => n.includes(".tmp-")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- H4：每日備份 ----

test("H4：第一次存檔（還沒有 data.json）不產生備份；之後同一天第一次寫入前，備份的是「寫入前」的內容", async () => {
  const dir = tmpDir();
  try {
    const a = emptyStore();
    a.records.push(rec(1));
    await saveStore(dir, a);
    assert.equal(existsSync(path.join(dir, "backups")), false, "全新安裝沒有東西可備份");

    const b = emptyStore();
    b.records.push(rec(1), rec(2));
    await saveStore(dir, b);

    const backupFile = path.join(dir, "backups", `data-${localStamp(new Date())}.json`);
    assert.ok(existsSync(backupFile), "同一天第一次「覆蓋」前要備份");
    assert.equal(JSON.parse(readFileSync(backupFile, "utf8")).records.length, 1, "備份是寫入前（只有 1 筆）的內容");

    const c = emptyStore();
    c.records.push(rec(1), rec(2), rec(3));
    await saveStore(dir, c);
    assert.equal(
      JSON.parse(readFileSync(backupFile, "utf8")).records.length,
      1,
      "同一天第二次寫入不可覆蓋當天的備份",
    );
    assert.equal((await loadStore(dir)).records.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H4：備份檔名用「本地」日曆日（跨午夜的清晨不會變成前一天）", async () => {
  const dir = tmpDir();
  try {
    writeFileSync(path.join(dir, "data.json"), JSON.stringify(emptyStore()));
    const early = new Date(2026, 0, 5, 0, 30, 0); // 本地 2026-01-05 00:30（UTC+8 時 UTC 還是 1/4）
    const target = await backupBeforeFirstSaveOfDay(dir, early);
    assert.equal(path.basename(target), "data-20260105.json");
    const late = new Date(2026, 0, 5, 23, 59, 0);
    assert.equal(await backupBeforeFirstSaveOfDay(dir, late), null, "同一個本地日不再備份第二次");
    const nextDay = new Date(2026, 0, 6, 0, 1, 0);
    assert.equal(path.basename(await backupBeforeFirstSaveOfDay(dir, nextDay)), "data-20260106.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H4：只保留最新的 14 份備份，其他檔案不受影響", async () => {
  const dir = tmpDir();
  try {
    writeFileSync(path.join(dir, "data.json"), JSON.stringify(emptyStore()));
    const backups = path.join(dir, "backups");
    mkdirSync(backups, { recursive: true });
    for (let day = 1; day <= 20; day++) {
      writeFileSync(path.join(backups, `data-202001${String(day).padStart(2, "0")}.json`), "{}");
    }
    writeFileSync(path.join(backups, "notes.txt"), "不是備份檔，不能被清掉");

    await backupBeforeFirstSaveOfDay(dir, new Date(2026, 5, 1, 12, 0, 0));
    const names = readdirSync(backups).filter((n) => /^data-\d{8}\.json$/.test(n)).sort();
    assert.equal(names.length, BACKUP_KEEP);
    assert.equal(BACKUP_KEEP, 14);
    assert.equal(names.at(-1), "data-20260601.json", "最新的一份在");
    assert.equal(names[0], "data-20200108.json", "最舊的 7 份被清掉（0101–0107）");
    assert.ok(existsSync(path.join(backups, "notes.txt")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("H4：備份失敗（backups 被一個同名檔案擋住）只記 log，不擋住 saveStore", async () => {
  const dir = tmpDir();
  try {
    await saveStore(dir, emptyStore());
    writeFileSync(path.join(dir, "backups"), "我是檔案不是資料夾");
    const s = emptyStore();
    s.records.push(rec(1));
    const originalError = console.error;
    console.error = () => {};
    try {
      await saveStore(dir, s);
    } finally {
      console.error = originalError;
    }
    assert.equal((await loadStore(dir)).records.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
