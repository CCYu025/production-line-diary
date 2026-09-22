// 照片檔案的生命週期管理：紀錄的 photos[] 只是「參照」，實際檔案在
// <DATA_DIR>/照片/<date>/ 底下。移除參照時，這裡負責判斷檔案是否真的
// 沒有任何紀錄再用到了、能不能安全刪掉；改紀錄日期時，負責把仍在用的
// 舊檔案搬到新日期的資料夾，避免連結斷掉。
//
// 這支檔案是為了修一個實際發生過的 bug 才寫的：編輯紀錄時把照片從
// photos[] 移除，卻從來沒刪過硬碟上的檔案；使用者之後重新上傳同一張
// 照片，因為舊檔案還占著原本的檔名，新檔案被改名成 xxx-1.jpg，
// 看起來就像「同一張照片多了一份一樣的」。

import path from "node:path";
import { existsSync } from "node:fs";
import { rm, mkdir, rename } from "node:fs/promises";
import { dateToPhotoFolder } from "./store.js";

export function isPhotoReferenced(records, date, filename) {
  return records.some((r) => r.date === date && (r.photos || []).includes(filename));
}

/**
 * 如果 records 裡已經沒有任何紀錄還參照這個 (date, filename)，就刪掉硬碟上的檔案。
 * @returns {Promise<boolean>} 是否真的刪除了檔案
 */
export async function deleteUnreferencedPhoto(photosDir, records, date, filename) {
  if (isPhotoReferenced(records, date, filename)) return false;
  const file = path.join(photosDir, dateToPhotoFolder(date), filename);
  if (existsSync(file)) {
    await rm(file, { force: true });
    return true;
  }
  return false;
}

/**
 * 紀錄的日期被改掉、但照片檔名沒變時，把還在用的照片實體檔案
 * 從舊日期資料夾搬到新日期資料夾，維持 photoUrl(date, filename) 連結有效。
 */
export async function movePhotosForDateChange(photosDir, oldDate, newDate, filenames) {
  if (oldDate === newDate || !filenames.length) return;
  const oldDir = path.join(photosDir, dateToPhotoFolder(oldDate));
  const newDir = path.join(photosDir, dateToPhotoFolder(newDate));
  await mkdir(newDir, { recursive: true });
  for (const filename of filenames) {
    const from = path.join(oldDir, filename);
    const to = path.join(newDir, filename);
    if (existsSync(from) && !existsSync(to)) {
      await rename(from, to);
    }
  }
}
