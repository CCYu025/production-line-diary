import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { exec } from "node:child_process";

import { loadStore, withStore, nextId, dateToPhotoFolder } from "./lib/store.js";
import {
  aggregate,
  knownEquipment,
  knownCategories,
  knownProductCodes,
  knownMaterialCategories,
  severityFromDuration,
} from "./lib/aggregate.js";
import { writeSnapshotXlsx } from "./lib/xlsx.js";
import {
  deleteUnreferencedPhoto,
  movePhotosForDateChange,
  sweepOrphanedPhotos,
  photoFileExists,
} from "./lib/photos.js";
import { sanitizePhotoCaptions } from "./lib/photoCaptions.js";
import { mountWebUi } from "./lib/webUi.js";
import {
  isRealDate,
  isSafeFilename,
  normalizeRecordFields,
  parseId,
  pickRecordFields,
  validateRecord,
} from "./lib/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DATA_DIR 沒設定時，用內建的範例資料夾開機（讓 clone 下來的人不用先準備真實資料
// 就能直接跑起來看）。你自己電腦上的正式資料夾路徑放在 .env 裡，不進版控。
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data", "example");
const PORT = Number(process.env.PORT) || 3000;
const PHOTOS_DIR = path.join(DATA_DIR, "照片");
// 前端建置產物（web/dist）與 scripts/ensure-web-build.js 留下的建置錯誤紀錄。
// 可用環境變數覆寫（給測試用；平常不用設）。
const WEB_DIST_DIR = process.env.WEB_DIST_DIR
  ? path.resolve(process.env.WEB_DIST_DIR)
  : path.join(__dirname, "..", "web", "dist");
const WEB_BUILD_ERROR_FILE = process.env.WEB_BUILD_ERROR_FILE
  ? path.resolve(process.env.WEB_BUILD_ERROR_FILE)
  : path.join(__dirname, "..", ".web-build-error.log");

/** 路由裡用來中止請求（在 withStore 回呼裡丟出來就不會寫入）並指定 HTTP 狀態碼。 */
class HttpError extends Error {
  constructor(status, message) {
    const list = Array.isArray(message) ? message : [message];
    super(list.join("；"));
    this.status = status;
    this.errors = list;
  }
}

const app = express();

// S2：擋 DNS rebinding。惡意網站可以把自己的網域解析成 127.0.0.1，瀏覽器就會把它當成
// 同源去讀這個本機服務；這種請求的 Host 會是惡意網域，不是 localhost。
// 這裡只檢查「主機名稱」必須是 localhost / 127.0.0.1 / [::1]，不綁定特定 port——
// 伺服器實際監聽的 port 由 PORT 環境變數決定（測試用 ephemeral port），
// 而 rebinding 攻擊靠的是換主機名稱，port 不構成防線。
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
app.use((req, res, next) => {
  if (!LOCAL_HOST.test(req.headers.host || "")) {
    return res.status(403).json({ errors: ["不允許的 Host，只接受 localhost／127.0.0.1／[::1]"] });
  }
  next();
});

// S1：本機 CSRF。所有會改資料的 /api 請求都要帶自訂 header——跨站網頁帶自訂 header
// 會觸發 CORS preflight，而這個伺服器不會回應 preflight，所以別的網站送不出這種請求。
const CSRF_VALUE = "production-line-diary";
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (req.get("x-requested-with") !== CSRF_VALUE) {
    return res.status(403).json({ errors: ["缺少 X-Requested-With 標頭，請求已被拒絕"] });
  }
  next();
});

app.use(express.json());
// 這個 static middleware 在啟動當下就算資料夾還不存在也能掛上去——
// express.static 是在「每次收到請求」時才去解析檔案路徑，不是啟動當下就掃描整個資料夾，
// 所以之後第一次上傳照片、資料夾才被建立出來，也不用重啟伺服器。
app.use("/photos", express.static(PHOTOS_DIR));
// 前端：`/` 是 web/dist（沒有建置產物時回「介面建置失敗」頁），舊的 /next/… 網址轉址到 /…。見 lib/webUi.js。
mountWebUi(app, { distDir: WEB_DIST_DIR, errorLogFile: WEB_BUILD_ERROR_FILE });

function safeFilename(originalName) {
  const base = path
    .basename(originalName)
    .replace(/[^\w.一-鿿-]+/g, "_")
    // 連續的點收成一個——含 ".." 的檔名會被 isSafeFilename 當成路徑跳脫而擋下，
    // 上傳端先處理掉，才不會出現「上傳成功卻無法存進紀錄」的檔名
    .replace(/\.{2,}/g, ".");
  return !base || base === "." ? `photo-${Date.now()}.jpg` : base;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const date = req.body.date;
      if (!isRealDate(date)) {
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

/** 送出前先確認：列出的照片都真的在 照片/<date>/ 裡（V4：照片與日期必須一致）。 */
function assertPhotosExist(date, filenames) {
  const missing = filenames.filter((fn) => !photoFileExists(PHOTOS_DIR, date, fn));
  if (missing.length) {
    throw new HttpError(
      400,
      `照片與日期不一致：在 ${date} 的照片資料夾找不到 ${missing.map((fn) => `「${fn}」`).join("、")}。` +
        "若中途改過日期，請先移除這些照片再重新上傳。",
    );
  }
}

/** 寫入完成「之後」才做的檔案清理：失敗只記 log，不讓已經存好的請求變成 500。 */
async function bestEffort(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`${label}失敗：`, err.message);
  }
}

app.get("/api/meta", async (req, res) => {
  const store = await loadStore(DATA_DIR);
  res.json({
    schemaVersion: store.meta.schemaVersion,
    equipment: knownEquipment(store.records),
    categories: knownCategories(store.records),
    productCodes: knownProductCodes(store.records),
    materialCategories: knownMaterialCategories(store.records),
    equipmentMap: store.equipmentMap,
  });
});

app.get("/api/records", async (req, res) => {
  const store = await loadStore(DATA_DIR);
  res.json({ records: store.records });
});

app.post("/api/records", async (req, res) => {
  const fields = pickRecordFields(req.body);
  // shift / severity / status 缺省（沒帶或 null）才套預設；帶了就必須是允許值
  for (const key of ["shift", "severity", "status"]) {
    if (fields[key] === null) delete fields[key];
  }
  // 新增是整筆全新的資料，所有必填欄位都要驗證（PUT 才只驗證有帶的欄位）
  const errors = validateRecord(fields, Object.keys(fields), { full: true });
  if (errors.length) return res.status(400).json({ errors });
  const norm = normalizeRecordFields(fields);
  const photos = norm.photos ?? [];
  assertPhotosExist(norm.date, photos);

  const record = await withStore(DATA_DIR, async (store) => {
    const rec = {
      id: nextId(store.records),
      date: norm.date,
      shift: norm.shift ?? "早",
      time: norm.time,
      duration: norm.duration,
      equipment: norm.equipment,
      category: norm.category ?? "其他",
      problem: norm.problem,
      severity: norm.severity ?? severityFromDuration(norm.duration),
      action: norm.action ?? "",
      rootCause: norm.rootCause ?? null,
      status: norm.status ?? "待處理",
      productCode: norm.productCode ?? null,
      materialCategory: norm.materialCategory ?? null,
      photos,
      updatedAt: null,
      deleted: false,
      deletedAt: null,
    };
    rec.photoCaptions = sanitizePhotoCaptions(norm.photoCaptions, rec.photos);
    store.records.push(rec);
    await store.save();
    return rec;
  });
  res.status(201).json({ record });
});

app.put("/api/records/:id", async (req, res) => {
  const id = parseId(req.params.id);
  const picked = pickRecordFields(req.body); // 白名單：body 裡的 id / deleted / updatedAt… 一律忽略

  const record = await withStore(DATA_DIR, async (store) => {
    const record = id === null ? undefined : store.records.find((r) => r.id === id);
    if (!record) throw new HttpError(404, "找不到這筆紀錄");

    // 只驗證 body 有帶的欄位：舊資料裡的怪值（duration 0、時間 "9:30"、空設備…）
    // 不該擋住「只改狀態／只填根本原因」這類請求；整筆編輯表單會帶全部欄位，所以仍會被要求修正。
    const errors = validateRecord(picked, Object.keys(picked));
    if (errors.length) throw new HttpError(400, errors);
    const norm = normalizeRecordFields(picked);

    const oldDate = record.date;
    const oldPhotos = record.photos || [];
    const newPhotos = norm.photos ?? oldPhotos;
    const newDate = norm.date ?? oldDate;

    // V4：這次新加入的照片必須已經在「新日期」的資料夾裡；原本就有的照片稍後會跟著搬過去
    assertPhotosExist(
      newDate,
      newPhotos.filter((fn) => !oldPhotos.includes(fn)),
    );

    const updates = { ...norm, updatedAt: new Date().toISOString() };
    if ("photos" in norm || "photoCaptions" in norm) {
      updates.photoCaptions = sanitizePhotoCaptions("photoCaptions" in norm ? norm.photoCaptions : record.photoCaptions, newPhotos);
    }
    Object.assign(record, updates);
    await store.save();

    // 以下的檔案動作都在鎖內、存檔成功之後才做（失敗只記 log，資料已經存好了）
    // 日期改了但照片檔名沒變：把還留著的舊照片實體檔案搬到新日期的資料夾，
    // 不然畫面上的連結會指向一個不存在的路徑。
    const carriedOver = newPhotos.filter((fn) => oldPhotos.includes(fn));
    if (oldDate !== newDate && carriedOver.length) {
      await bestEffort("搬移照片", () => movePhotosForDateChange(PHOTOS_DIR, oldDate, newDate, carriedOver));
    }
    // 這次編輯拿掉的照片：如果沒有任何紀錄還參照它，就真的從硬碟刪掉，
    // 不然孤兒檔案會一直留著，下次上傳同名照片還會被誤判成「檔名衝突」而改名。
    const removed = oldPhotos.filter((fn) => !newPhotos.includes(fn));
    for (const fn of removed) {
      await bestEffort("刪除照片", () => deleteUnreferencedPhoto(PHOTOS_DIR, store.records, oldDate, fn));
    }
    return record;
  });
  res.json({ record });
});

app.post("/api/records/:id/delete", async (req, res) => {
  const id = parseId(req.params.id);
  const record = await withStore(DATA_DIR, async (store) => {
    const rec = store.records.find((r) => r.id === id);
    if (!rec) throw new HttpError(404, "找不到這筆紀錄");
    rec.deleted = true;
    rec.deletedAt = new Date().toISOString();
    await store.save();
    return rec;
  });
  res.json({ record });
});

app.post("/api/records/:id/restore", async (req, res) => {
  const id = parseId(req.params.id);
  const record = await withStore(DATA_DIR, async (store) => {
    const rec = store.records.find((r) => r.id === id);
    if (!rec) throw new HttpError(404, "找不到這筆紀錄");
    rec.deleted = false;
    rec.deletedAt = null;
    await store.save();
    return rec;
  });
  res.json({ record });
});

app.delete("/api/records/:id", async (req, res) => {
  const id = parseId(req.params.id);
  await withStore(DATA_DIR, async (store) => {
    const record = store.records.find((r) => r.id === id);
    if (!record) throw new HttpError(404, "找不到這筆紀錄");
    if (!record.deleted) throw new HttpError(409, "只有回收桶裡的紀錄才能永久刪除，請先軟刪除");
    store.records = store.records.filter((r) => r.id !== id);
    await store.save();

    for (const fn of record.photos || []) {
      await bestEffort("刪除照片", () => deleteUnreferencedPhoto(PHOTOS_DIR, store.records, record.date, fn));
    }
  });
  res.status(204).end();
});

// 設備 -> 品號／原料類別的「目前對照表」，不是每筆紀錄都要填一次。
// 換線頻率低（你說大概 2-3 個月才變一次），所以設計成獨立的一張小表，
// 平常新增紀錄時前端會拿這張表自動帶入，只有真的換線了才需要回來改這裡；
// 已經寫進紀錄裡的 productCode/materialCategory 是「當時的事實」，不會因為
// 這張表之後被改掉而跟著變動。
app.put("/api/equipment-map", async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ errors: ["body 必須是陣列"] });
  const cleaned = [];
  for (const entry of req.body) {
    if (!entry || typeof entry !== "object") continue;
    // 欄位只能是文字（或空值）；物件／陣列／數字會被 String() 變成 "[object Object]" 之類的垃圾，直接拒絕
    for (const key of ["equipment", "productCode", "materialCategory"]) {
      const v = entry[key];
      if (v !== undefined && v !== null && typeof v !== "string") {
        return res.status(400).json({ errors: [`設備對照表的 ${key} 必須是文字`] });
      }
    }
    const equipment = String(entry.equipment || "").trim();
    if (!equipment) continue;
    cleaned.push({
      equipment,
      productCode: entry.productCode ? String(entry.productCode).trim() : null,
      materialCategory: entry.materialCategory ? String(entry.materialCategory).trim() : null,
    });
  }
  await withStore(DATA_DIR, async (store) => {
    store.equipmentMap = cleaned;
    await store.save();
  });
  res.json({ equipmentMap: cleaned });
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
  const { date, filename } = req.params;
  if (!isRealDate(date)) return res.status(400).json({ errors: ["date 須為真實存在的日期，格式 YYYY-MM-DD"] });
  if (!isSafeFilename(filename)) return res.status(400).json({ errors: ["不合法的照片檔名"] });
  // 放在鎖內：「確認沒有紀錄參照」到「刪檔」之間，不能有新增紀錄剛好插進來參照這個檔案
  const deleted = await withStore(DATA_DIR, (store) => deleteUnreferencedPhoto(PHOTOS_DIR, store.records, date, filename));
  res.json({ deleted });
});

// 未知的 /api 路徑一律回 JSON 404（不要落到 Express 預設的 HTML 錯誤頁）
app.use("/api", (req, res) => {
  res.status(404).json({ errors: ["找不到這個 API 路徑"] });
});

// H1：統一的錯誤中介層。Express 5 會把 async handler 的 rejection 送到這裡，
// 任何一個請求失敗都只會回 JSON 錯誤，不會讓整個程序結束。
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ errors: err.errors });
  // body-parser 的錯誤（JSON 壞掉、body 太大…）本來就是 4xx
  if (err.type === "entity.parse.failed") return res.status(400).json({ errors: ["請求內容不是合法的 JSON"] });
  const status = Number(err.status ?? err.statusCode);
  if (status >= 400 && status < 500) return res.status(status).json({ errors: [err.message] });
  console.error(`${req.method} ${req.originalUrl} 失敗：`, err);
  res.status(500).json({ errors: [err.message || "伺服器內部錯誤"] });
});

// client 端放棄新增/編輯時會主動清掉還沒送出的照片，但關分頁、手機按返回鍵、
// 系統把分頁凍結在背景這些情況，client 完全沒機會執行清理——這支是最後一道
// 防線，不管 client 端發生什麼事，伺服器自己會定期把硬碟上「沒有任何紀錄
// 參照、且放了超過安全時間」的照片清掉。啟動時跑一次、之後每小時跑一次，
// 涵蓋「伺服器長時間開著不重啟」的實際使用情境（單機工具，不會天天重啟）。
async function runPhotoSweep() {
  try {
    const store = await loadStore(DATA_DIR);
    const removed = await sweepOrphanedPhotos(PHOTOS_DIR, store.records);
    if (removed > 0) console.log(`照片孤兒檔清理：刪除 ${removed} 個檔案`);
  } catch (err) {
    console.error("照片孤兒檔清理失敗：", err.message);
  }
}

// 只有直接執行這支檔案時才啟動監聽；被測試檔 import 當模組用時不要自動開伺服器/開瀏覽器。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // 最後一道保險：萬一有漏網的 rejection，記 log 就好，不要讓程序結束
  process.on("unhandledRejection", (reason) => console.error("未處理的 Promise rejection：", reason));
  app.listen(PORT, "127.0.0.1", (err) => {
    // Express 5：監聽失敗（例如 port 被占用）時 callback 會收到 error
    if (err) {
      console.error(`無法在 127.0.0.1:${PORT} 啟動：`, err.message);
      process.exit(1);
    }
    console.log(`產線日誌已啟動： http://localhost:${PORT}`);
    console.log(`資料夾： ${DATA_DIR}`);
    if (process.platform === "win32" && !process.env.NO_OPEN_BROWSER) {
      exec(`start "" "http://localhost:${PORT}"`);
    }
  });
  runPhotoSweep();
  setInterval(runPhotoSweep, 60 * 60 * 1000);
}

export default app;
export { DATA_DIR };
