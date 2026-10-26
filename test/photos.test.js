import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isPhotoReferenced,
  deleteUnreferencedPhoto,
  movePhotosForDateChange,
  sweepOrphanedPhotos,
} from "../backend/lib/photos.js";

function tmpPhotosDir() {
  return mkdtempSync(path.join(os.tmpdir(), "pld-photos-test-"));
}

function putFile(photosDir, date, filename, content = "x") {
  const dir = path.join(photosDir, date.replaceAll("-", ""));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), content);
}

test("isPhotoReferenced：真的還有紀錄用到才算 true", () => {
  const records = [{ date: "2026-09-22", photos: ["a.jpg"] }];
  assert.equal(isPhotoReferenced(records, "2026-09-22", "a.jpg"), true);
  assert.equal(isPhotoReferenced(records, "2026-09-22", "b.jpg"), false);
  assert.equal(isPhotoReferenced(records, "2026-09-21", "a.jpg"), false, "同檔名但日期不同，不算同一張");
});

test("deleteUnreferencedPhoto：這是修的那個 bug 的核心情境——移除照片後沒有任何紀錄再用到，檔案要真的被刪掉", async () => {
  const dir = tmpPhotosDir();
  try {
    putFile(dir, "2026-09-22", "S__34168836.jpg");
    const records = []; // 已經沒有任何紀錄參照這個檔名了

    const deleted = await deleteUnreferencedPhoto(dir, records, "2026-09-22", "S__34168836.jpg");
    assert.equal(deleted, true);
    assert.equal(existsSync(path.join(dir, "20260922", "S__34168836.jpg")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteUnreferencedPhoto：還有別的紀錄在用同一張照片，不能刪", async () => {
  const dir = tmpPhotosDir();
  try {
    putFile(dir, "2026-09-22", "shared.jpg");
    const records = [{ id: 2, date: "2026-09-22", photos: ["shared.jpg"] }];

    const deleted = await deleteUnreferencedPhoto(dir, records, "2026-09-22", "shared.jpg");
    assert.equal(deleted, false);
    assert.equal(existsSync(path.join(dir, "20260922", "shared.jpg")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteUnreferencedPhoto：檔案本來就不存在時安靜跳過，不丟例外", async () => {
  const dir = tmpPhotosDir();
  try {
    const deleted = await deleteUnreferencedPhoto(dir, [], "2026-09-22", "從沒存在過.jpg");
    assert.equal(deleted, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("movePhotosForDateChange：把還在用的照片搬到新日期的資料夾", async () => {
  const dir = tmpPhotosDir();
  try {
    putFile(dir, "2026-09-21", "a.jpg", "real-bytes");
    await movePhotosForDateChange(dir, "2026-09-21", "2026-09-22", ["a.jpg"]);

    assert.equal(existsSync(path.join(dir, "20260921", "a.jpg")), false, "舊資料夾不該再有這個檔案");
    assert.equal(existsSync(path.join(dir, "20260922", "a.jpg")), true, "新資料夾要有這個檔案");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("movePhotosForDateChange：日期沒變就什麼都不做", async () => {
  const dir = tmpPhotosDir();
  try {
    putFile(dir, "2026-09-21", "a.jpg");
    await movePhotosForDateChange(dir, "2026-09-21", "2026-09-21", ["a.jpg"]);
    assert.equal(existsSync(path.join(dir, "20260921", "a.jpg")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("movePhotosForDateChange：目的地已經有同名檔案時不覆蓋，也不丟例外", async () => {
  const dir = tmpPhotosDir();
  try {
    putFile(dir, "2026-09-21", "a.jpg", "old-content");
    putFile(dir, "2026-09-22", "a.jpg", "new-content-should-survive");
    await movePhotosForDateChange(dir, "2026-09-21", "2026-09-22", ["a.jpg"]);
    const kept = readFileSync(path.join(dir, "20260922", "a.jpg"), "utf8");
    assert.equal(kept, "new-content-should-survive");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function backdate(dir, date, filename, hoursAgo) {
  const file = path.join(dir, date.replaceAll("-", ""), filename);
  const past = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  utimesSync(file, past, past);
}

// sweepOrphanedPhotos 是 client 端清理徹底失效時（關分頁、手機返回鍵、分頁被
// 系統凍結在背景）的最後一道防線，跟 client 端邏輯完全獨立，只看硬碟實際檔案
// 跟 records 實際參照的照片兩邊對不上、且放了夠久的部分。
test("sweepOrphanedPhotos：沒有任何紀錄參照、放了超過安全時間的照片才會被清掉", async () => {
  const dir = tmpPhotosDir();
  try {
    putFile(dir, "2026-09-22", "orphan-old.jpg");
    backdate(dir, "2026-09-22", "orphan-old.jpg", 2);

    const removed = await sweepOrphanedPhotos(dir, []);
    assert.equal(removed, 1);
    assert.equal(existsSync(path.join(dir, "20260922", "orphan-old.jpg")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sweepOrphanedPhotos：剛上傳、還沒被參照的照片不能刪——可能是使用者正在填的表單，還沒送出", async () => {
  const dir = tmpPhotosDir();
  try {
    putFile(dir, "2026-09-22", "just-uploaded.jpg"); // mtime 就是現在，沒有 backdate

    const removed = await sweepOrphanedPhotos(dir, []);
    assert.equal(removed, 0);
    assert.equal(existsSync(path.join(dir, "20260922", "just-uploaded.jpg")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sweepOrphanedPhotos：有紀錄參照的照片，不管放了多久都不能刪", async () => {
  const dir = tmpPhotosDir();
  try {
    putFile(dir, "2026-09-22", "in-use.jpg");
    backdate(dir, "2026-09-22", "in-use.jpg", 999);
    const records = [{ date: "2026-09-22", photos: ["in-use.jpg"] }];

    const removed = await sweepOrphanedPhotos(dir, records);
    assert.equal(removed, 0);
    assert.equal(existsSync(path.join(dir, "20260922", "in-use.jpg")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sweepOrphanedPhotos：軟刪除的紀錄仍然算「有參照」，回收桶復原前不會被掃掉", async () => {
  const dir = tmpPhotosDir();
  try {
    putFile(dir, "2026-09-22", "in-trash.jpg");
    backdate(dir, "2026-09-22", "in-trash.jpg", 999);
    const records = [{ date: "2026-09-22", photos: ["in-trash.jpg"], deleted: true, deletedAt: "2026-09-22T00:00:00Z" }];

    const removed = await sweepOrphanedPhotos(dir, records);
    assert.equal(removed, 0);
    assert.equal(existsSync(path.join(dir, "20260922", "in-trash.jpg")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── WP1b：V3 路徑縱深防禦 ─────────────────────────

import { resolveInside, photoFileExists } from "../backend/lib/photos.js";

// 結構：<root>/secret.txt（資料夾外的檔案）、<root>/照片/（photosDir）
function tmpRootWithSecret() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pld-photos-trav-"));
  const photosDir = path.join(root, "照片");
  mkdirSync(photosDir, { recursive: true });
  writeFileSync(path.join(root, "secret.txt"), "不可被刪掉或搬走");
  return { root, photosDir };
}

test("V3 resolveInside：資料夾內的路徑通過；跑出去、絕對路徑、等於根目錄本身都丟錯", () => {
  const base = path.join(os.tmpdir(), "pld-resolve-base");
  assert.equal(resolveInside(base, "20260922", "a.jpg"), path.join(base, "20260922", "a.jpg"));
  assert.throws(() => resolveInside(base, "20260922", "../../x"));
  assert.throws(() => resolveInside(base, ".."));
  assert.throws(() => resolveInside(base, "20260922", path.resolve("/etc/passwd")));
  assert.throws(() => resolveInside(base));
  assert.throws(() => resolveInside(base, "..", "pld-resolve-base-evil", "x"), "前綴相同的兄弟資料夾也不算在裡面");
});

test("V3 deleteUnreferencedPhoto：檔名帶 ../ 想刪資料夾外的檔案 → 丟錯、檔案還在", async () => {
  const { root, photosDir } = tmpRootWithSecret();
  try {
    mkdirSync(path.join(photosDir, "20260922"), { recursive: true });
    for (const evil of ["../../secret.txt", "..\\..\\secret.txt", "../../../secret.txt"]) {
      await assert.rejects(deleteUnreferencedPhoto(photosDir, [], "2026-09-22", evil), /不合法的照片路徑/);
    }
    assert.ok(existsSync(path.join(root, "secret.txt")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V3 deleteUnreferencedPhoto：date 帶路徑也擋下", async () => {
  const { root, photosDir } = tmpRootWithSecret();
  try {
    await assert.rejects(deleteUnreferencedPhoto(photosDir, [], "../..", "secret.txt"));
    await assert.rejects(deleteUnreferencedPhoto(photosDir, [], "../../..", "secret.txt"));
    assert.ok(existsSync(path.join(root, "secret.txt")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V3 movePhotosForDateChange：清單裡有一個跑出去的檔名 → 整批不動（包含其他合法的）", async () => {
  const { root, photosDir } = tmpRootWithSecret();
  try {
    putFile(photosDir, "2026-09-22", "ok.jpg");
    await assert.rejects(
      movePhotosForDateChange(photosDir, "2026-09-22", "2026-09-23", ["ok.jpg", "../../secret.txt"]),
      /不合法的照片路徑/,
    );
    assert.ok(existsSync(path.join(photosDir, "20260922", "ok.jpg")), "合法的檔案也不該被搬");
    assert.ok(!existsSync(path.join(photosDir, "20260923", "ok.jpg")));
    assert.ok(existsSync(path.join(root, "secret.txt")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V3 photoFileExists：真的存在才 true；路徑跳脫一律當作不存在（不丟錯）", () => {
  const { root, photosDir } = tmpRootWithSecret();
  try {
    putFile(photosDir, "2026-09-22", "real.jpg");
    assert.equal(photoFileExists(photosDir, "2026-09-22", "real.jpg"), true);
    assert.equal(photoFileExists(photosDir, "2026-09-22", "nope.jpg"), false);
    assert.equal(photoFileExists(photosDir, "2026-09-23", "real.jpg"), false, "日期不同就是不同資料夾");
    assert.equal(photoFileExists(photosDir, "2026-09-22", "../../secret.txt"), false, "secret.txt 真的存在，但在資料夾外");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V3 既有行為不變：合法檔名照常刪除／搬移", async () => {
  const dir = tmpPhotosDir();
  try {
    putFile(dir, "2026-09-22", "a.jpg");
    putFile(dir, "2026-09-22", "b.jpg");
    await movePhotosForDateChange(dir, "2026-09-22", "2026-09-23", ["a.jpg"]);
    assert.ok(existsSync(path.join(dir, "20260923", "a.jpg")));
    assert.equal(await deleteUnreferencedPhoto(dir, [], "2026-09-22", "b.jpg"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
