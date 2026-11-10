/*
 * 縮圖載入（three 版）：fetch → createImageBitmap（長邊 ≤ 256px）→ THREE.Texture。
 * 伺服器沒有縮圖服務，這裡抓的是原圖（最大 25MB）；解碼時就縮小，常駐的只有 ≤ 256px 的點陣圖。
 * key 格式：`<date>|<filename>`。
 */
import * as THREE from "three";
import { photoUrl } from "@/lib/api";
import { fitLongEdge, imageSize, MAX_EDGE, type ThumbResource } from "./thumbCache";

export interface ThumbTexture extends ThumbResource {
  texture: THREE.Texture;
  width: number;
  height: number;
}

export const thumbKey = (date: string, filename: string) => `${date}|${filename}`;
export function parseThumbKey(key: string): { date: string; filename: string } {
  const i = key.indexOf("|");
  return { date: key.slice(0, i), filename: key.slice(i + 1) };
}

export async function loadThumb(key: string): Promise<ThumbTexture> {
  const { date, filename } = parseThumbKey(key);
  const res = await fetch(photoUrl(date, filename));
  if (!res.ok) throw new Error(`thumb ${res.status}`);
  const blob = await res.blob();
  const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  const size = imageSize(head);
  let bitmap: ImageBitmap;
  if (size) {
    const fit = fitLongEdge(size.width, size.height, MAX_EDGE);
    bitmap = await createImageBitmap(blob, { resizeWidth: fit.width, resizeHeight: fit.height, resizeQuality: "medium" });
  } else {
    // 讀不到檔頭尺寸：先以寬度縮，太高再以高度重來
    bitmap = await createImageBitmap(blob, { resizeWidth: MAX_EDGE, resizeQuality: "medium" });
    if (bitmap.height > MAX_EDGE) {
      bitmap.close();
      bitmap = await createImageBitmap(blob, { resizeHeight: MAX_EDGE, resizeQuality: "medium" });
    }
  }
  const texture = new THREE.Texture(bitmap);
  texture.flipY = false; // ImageBitmap 不支援 flipY；幾何的 uv 已翻轉
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const out: ThumbTexture = {
    texture,
    width: bitmap.width,
    height: bitmap.height,
    dispose() {
      bitmap.close();
      texture.dispose();
    },
  };
  return out;
}
