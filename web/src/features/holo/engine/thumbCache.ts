/*
 * 照片縮圖的解碼與釋放（docs/holo-mode-spec.md §10.1 HP7；H1 雛形）。
 *  - 同一時間最多 MAX_LIVE（24）張處於「解碼中」或「已常駐」；超過的排隊。
 *  - 縮圖離開視野 TTL_MS（30 秒）後釋放（呼叫資源的 dispose：bitmap.close()、texture.dispose()）。
 *  - 額外規則：槽位用完而又有新的可見縮圖在排隊時，立刻釋放「不在視野內、最久沒看到」的常駐縮圖（比 30 秒更早，只為了騰出槽位）；
 *    可見的縮圖永遠不會被擠掉，所以呼叫端的可見集合不能超過 MAX_LIVE。
 *  - 換場景或卸載時 disposeAll()：全部釋放；解碼中的在完成時立即釋放。
 * 核心（ThumbCache）不依賴 three／DOM，載入函式由外面注入，方便用假時鐘測試；three 版本的載入函式在 thumbLoader.ts。
 */

export const MAX_LIVE = 24;
export const TTL_MS = 30_000;
export const MAX_EDGE = 256;
/** 解碼失敗的 key 隔多久才再試 */
export const FAIL_COOLDOWN_MS = 60_000;

export interface ThumbResource {
  dispose(): void;
}

export interface ThumbCacheOptions<T extends ThumbResource> {
  load: (key: string) => Promise<T>;
  max?: number;
  ttlMs?: number;
  now?: () => number;
}

interface Entry<T> {
  key: string;
  state: "decoding" | "resident";
  resource: T | null;
  lastSeen: number;
}

export interface ThumbStats {
  decoding: number;
  resident: number;
  queued: number;
  /** 累計：開始解碼的次數、釋放的次數 */
  started: number;
  released: number;
}

export class ThumbCache<T extends ThumbResource> {
  private readonly entries = new Map<string, Entry<T>>();
  private queue: string[] = [];
  private visible = new Set<string>();
  private readonly failed = new Map<string, number>();
  private readonly max: number;
  private readonly ttl: number;
  private readonly now: () => number;
  private disposed = false;
  private started = 0;
  private released = 0;

  constructor(private readonly opts: ThumbCacheOptions<T>) {
    this.max = opts.max ?? MAX_LIVE;
    this.ttl = opts.ttlMs ?? TTL_MS;
    this.now = opts.now ?? (() => performance.now());
  }

  /** 已解碼的資源；還沒好（或沒要過）回傳 null */
  get(key: string): T | null {
    const e = this.entries.get(key);
    return e?.state === "resident" ? e.resource : null;
  }

  /** 目前視野內想看的縮圖（依優先順序）。沒要過的排隊；不在名單內的排隊項目取消。 */
  setVisible(keys: readonly string[]): void {
    if (this.disposed) return;
    const t = this.now();
    this.visible = new Set(keys);
    for (const k of this.visible) {
      const e = this.entries.get(k);
      if (e) e.lastSeen = t;
    }
    // 取消不再需要的排隊項目
    this.queue = this.queue.filter((k) => this.visible.has(k));
    for (const k of keys) {
      if (this.entries.has(k) || this.queue.includes(k)) continue;
      const failedAt = this.failed.get(k);
      if (failedAt !== undefined && t - failedAt < FAIL_COOLDOWN_MS) continue;
      this.queue.push(k);
    }
    this.pump();
  }

  /** 定期呼叫：釋放離開視野超過 TTL 的縮圖。 */
  sweep(): void {
    if (this.disposed) return;
    const t = this.now();
    for (const e of Array.from(this.entries.values())) {
      if (e.state === "resident" && !this.visible.has(e.key) && t - e.lastSeen >= this.ttl) this.release(e);
    }
    this.pump();
  }

  stats(): ThumbStats {
    let decoding = 0;
    let resident = 0;
    for (const e of this.entries.values()) {
      if (e.state === "decoding") decoding++;
      else resident++;
    }
    return { decoding, resident, queued: this.queue.length, started: this.started, released: this.released };
  }

  disposeAll(): void {
    this.disposed = true;
    this.queue = [];
    this.visible.clear();
    for (const e of Array.from(this.entries.values())) {
      if (e.state === "resident") this.release(e);
      else this.entries.delete(e.key); // 解碼中：完成時（finish）看到被移除就直接釋放
    }
  }

  private live(): number {
    return this.entries.size;
  }

  private release(e: Entry<T>): void {
    this.entries.delete(e.key);
    this.released++;
    try {
      e.resource?.dispose();
    } catch {
      /* 釋放失敗不影響其他縮圖 */
    }
    e.resource = null;
  }

  private evictOldestHidden(): boolean {
    let victim: Entry<T> | null = null;
    for (const e of this.entries.values()) {
      if (e.state !== "resident" || this.visible.has(e.key)) continue;
      if (!victim || e.lastSeen < victim.lastSeen) victim = e;
    }
    if (!victim) return false;
    this.release(victim);
    return true;
  }

  private pump(): void {
    while (this.queue.length && !this.disposed) {
      if (this.live() >= this.max && !this.evictOldestHidden()) return;
      const key = this.queue.shift()!;
      this.start(key);
    }
  }

  private start(key: string): void {
    const entry: Entry<T> = { key, state: "decoding", resource: null, lastSeen: this.now() };
    this.entries.set(key, entry);
    this.started++;
    this.opts.load(key).then(
      (res) => this.finish(entry, res),
      () => this.fail(entry),
    );
  }

  private finish(entry: Entry<T>, res: T): void {
    if (this.entries.get(entry.key) !== entry) {
      // 解碼期間已被 disposeAll 移除：直接釋放
      this.released++;
      try {
        res.dispose();
      } catch {
        /* ignore */
      }
      return;
    }
    entry.state = "resident";
    entry.resource = res;
    this.pump();
  }

  private fail(entry: Entry<T>): void {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    this.failed.set(entry.key, this.now());
    this.pump();
  }
}

/* ---------- 圖片尺寸（讀檔頭，不解碼）：長邊縮到 MAX_EDGE 用 ---------- */

/** 從 PNG／JPEG 檔頭讀出寬高；讀不到回傳 null。bytes 只需要檔案開頭的一段（建議 64KB）。 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
      i += 2 + len;
    }
  }
  return null;
}

/** 等比例縮到長邊 ≤ max（不放大） */
export function fitLongEdge(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!(long > max)) return { width, height };
  const s = max / long;
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}
