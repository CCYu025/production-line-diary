import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { exec } from "node:child_process";

import { loadStore, saveStore, nextId, dateToPhotoFolder } from "./lib/store.js";
import { aggregate, knownEquipment, knownCategories, severityFromDuration } from "./lib/aggregate.js";
import { writeSnapshotXlsx } from "./lib/xlsx.js";
import { deleteUnreferencedPhoto, movePhotosForDateChange } from "./lib/photos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DATA_DIR 沒設定時，用內建的範例資料夾開機（讓 clone 下來的人不用先準備真實資料
// 就能直接跑起來看）。你自己電腦上的正式資料夾路徑放在 .env 裡，不進版控。
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data", "example");
const PORT = Number(process.env.PORT) || 3000;
const PHOTOS_DIR = path.join(DATA_DIR, "照片");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));
app.use("/lib", express.static(path.join(__dirname, "lib")));
// 這個 static middleware 在啟動當下就算資料夾還不存在也能掛上去——
// express.static 是在「每次收到請求」時才去解析檔案路徑，不是啟動當下就掃描整個資料夾，
// 所以之後第一次上傳照片、資料夾才被建立出來，也不用重啟伺服器。
app.use("/photos", express.static(PHOTOS_DIR));

function safeFilename(originalName) {
  const base = path.basename(originalName).replace(/[^\w.一-鿿-]+/g, "_");
  return base || `photo-${Date.now()}.jpg`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const date = req.body.date;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return cb(new Error("上傳照片需要先提供合法的 date (YYYY-MM-DD)"));
      }
      const dir = path.join(PHOTOS_DIR, dateToPhotoFolder(date));
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const dir = path.join(PHOTOS_DIR, dateToPhotoFolder(req.body.date));
      let name = safeFilename(file.originalname);
      let counter = 1;
      const ext = path.extname(name);
      const stem = name.slice(0, name.length - ext.length);
      while (existsSync(path.join(dir, name))) {
        name = `${stem}-${counter}${ext}`;
        counter += 1;
      }
      cb(null, name);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    cb(null, /^image\//.test(file.mimetype));
  },
});

function validateRecordInput(body) {
  const errors = [];
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) errors.push("date 格式須為 YYYY-MM-DD");
  if (!body.time || !/^\d{2}:\d{2}$/.test(body.time)) errors.push("time 格式須為 HH:MM");
  if (!Number.isFinite(Number(body.duration)) || Number(body.duration) <= 0) errors.push("duration 須為正數");
  if (!body.equipment || !String(body.equipment).trim()) errors.push("equipment 為必填");
  if (!body.problem || !String(body.problem).trim()) errors.push("problem 為必填");
  return errors;
}

app.get("/api/meta", async (req, res) => {
  const store = await loadStore(DATA_DIR);
  res.json({
    schemaVersion: store.meta.schemaVersion,
    equipment: knownEquipment(store.records),
    categories: knownCategories(store.records),
  });
});

app.get("/api/records", async (req, res) => {
  const store = await loadStore(DATA_DIR);
  res.json({ records: store.records });
});

app.post("/api/records", async (req, res) => {
  const errors = validateRecordInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const store = await loadStore(DATA_DIR);
  const duration = Number(req.body.duration);
  const record = {
    id: nextId(store.records),
    date: req.body.date,
    shift: req.body.shift || "早",
    time: req.body.time,
    duration,
    equipment: String(req.body.equipment).trim(),
    category: String(req.body.category || "其他").trim(),
    problem: String(req.body.problem).trim(),
    severity: req.body.severity || severityFromDuration(duration),
    action: String(req.body.action || "").trim(),
    rootCause: req.body.rootCause ? String(req.body.rootCause).trim() : null,
    status: req.body.status || "待處理",
    photos: Array.isArray(req.body.photos) ? req.body.photos : [],
    updatedAt: null,
    deleted: false,
    deletedAt: null,
  };
  store.records.push(record);
  await saveStore(DATA_DIR, store);
  res.status(201).json({ record });
});

app.put("/api/records/:id", async (req, res) => {
  const id = Number(req.params.id);
  const store = await loadStore(DATA_DIR);
  const record = store.records.find((r) => r.id === id);
  if (!record) return res.status(404).json({ errors: ["找不到這筆紀錄"] });

  const merged = { ...record, ...req.body, id };
  const errors = validateRecordInput(merged);
  if (errors.length) return res.status(400).json({ errors });

  const oldDate = record.date;
  const oldPhotos = record.photos || [];
  const newPhotos = Array.isArray(merged.photos) ? merged.photos : record.photos;
  const newDate = merged.date;

  Object.assign(record, {
    date: newDate,
    shift: merged.shift,
    time: merged.time,
    duration: Number(merged.duration),
    equipment: String(merged.equipment).trim(),
    category: String(merged.category || "其他").trim(),
    problem: String(merged.problem).trim(),
    severity: merged.severity,
    action: String(merged.action || "").trim(),
    rootCause: merged.rootCause ? String(merged.rootCause).trim() : null,
    status: merged.status,
    photos: newPhotos,
    updatedAt: new Date().toISOString(),
  });
  await saveStore(DATA_DIR, store);

  // 日期改了但照片檔名沒變：把還留著的舊照片實體檔案搬到新日期的資料夾，
  // 不然畫面上的連結會指向一個不存在的路徑。
  const carriedOver = newPhotos.filter((fn) => oldPhotos.includes(fn));
  if (oldDate !== newDate && carriedOver.length) {
    await movePhotosForDateChange(PHOTOS_DIR, oldDate, newDate, carriedOver);
  }
  // 這次編輯拿掉的照片：如果沒有任何紀錄還參照它，就真的從硬碟刪掉，
  // 不然孤兒檔案會一直留著，下次上傳同名照片還會被誤判成「檔名衝突」而改名。
  const removed = oldPhotos.filter((fn) => !newPhotos.includes(fn));
  for (const fn of removed) {
    await deleteUnreferencedPhoto(PHOTOS_DIR, store.records, oldDate, fn);
  }

  res.json({ record });
});

app.post("/api/records/:id/delete", async (req, res) => {
  const id = Number(req.params.id);
  const store = await loadStore(DATA_DIR);
  const record = store.records.find((r) => r.id === id);
  if (!record) return res.status(404).json({ errors: ["找不到這筆紀錄"] });
  record.deleted = true;
  record.deletedAt = new Date().toISOString();
  await saveStore(DATA_DIR, store);
  res.json({ record });
});

app.post("/api/records/:id/restore", async (req, res) => {
  const id = Number(req.params.id);
  const store = await loadStore(DATA_DIR);
  const record = store.records.find((r) => r.id === id);
  if (!record) return res.status(404).json({ errors: ["找不到這筆紀錄"] });
  record.deleted = false;
  record.deletedAt = null;
  await saveStore(DATA_DIR, store);
  res.json({ record });
});

app.delete("/api/records/:id", async (req, res) => {
  const id = Number(req.params.id);
  const store = await loadStore(DATA_DIR);
  const record = store.records.find((r) => r.id === id);
  if (!record) return res.status(404).json({ errors: ["找不到這筆紀錄"] });
  if (!record.deleted) {
    return res.status(409).json({ errors: ["只有回收桶裡的紀錄才能永久刪除，請先軟刪除"] });
  }
  store.records = store.records.filter((r) => r.id !== id);
  await saveStore(DATA_DIR, store);

  for (const fn of record.photos || []) {
    await deleteUnreferencedPhoto(PHOTOS_DIR, store.records, record.date, fn);
  }

  res.status(204).end();
});

app.get("/api/aggregate", async (req, res) => {
  const store = await loadStore(DATA_DIR);
  const range = ["all", "month", "week"].includes(req.query.range) ? req.query.range : "all";
  res.json(aggregate(store.records, range));
});

app.post("/api/export-xlsx", async (req, res) => {
  const store = await loadStore(DATA_DIR);
  const outPath = path.join(DATA_DIR, "工作日誌.xlsx");
  await writeSnapshotXlsx(store.records, outPath);
  res.json({ path: outPath });
});

app.post("/api/photos", (req, res) => {
  upload.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ errors: [err.message] });
    if (!req.file) return res.status(400).json({ errors: ["缺少照片檔案"] });
    res.status(201).json({ filename: req.file.filename });
  });
});

// 前端在新增/編輯畫面選到檔案就立刻上傳；使用者在送出表單前把某張照片移除時，
// 呼叫這支把還沒被任何紀錄參照的檔案清掉，不要留下孤兒檔案。
app.delete("/api/photos/:date/:filename", async (req, res) => {
  const store = await loadStore(DATA_DIR);
  const deleted = await deleteUnreferencedPhoto(PHOTOS_DIR, store.records, req.params.date, req.params.filename);
  res.json({ deleted });
});

// 只有直接執行這支檔案時才啟動監聽；被測試檔 import 當模組用時不要自動開伺服器/開瀏覽器。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`產線日誌已啟動： http://localhost:${PORT}`);
    console.log(`資料夾： ${DATA_DIR}`);
    if (process.platform === "win32" && !process.env.NO_OPEN_BROWSER) {
      exec(`start "" "http://localhost:${PORT}"`);
    }
  });
}

export default app;
export { DATA_DIR };
