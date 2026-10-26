import { ChevronLeft, ChevronRight, Copy, ImageOff, Pencil, Repeat, Trash2, X } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { SeverityBadge, StatusBadge } from "@/components/badges";
import { Lightbox } from "@/components/Lightbox";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { photoUrl } from "@/lib/api";
import { notify, toastUndoable } from "@/lib/feedback";
import type { DiaryRecord, Status } from "@/lib/types";
import { STATUS_ORDER } from "@shared/aggregate";
import { usePatchRecord, useSoftDeleteWithUndo } from "./useRecordMutations";

export interface RepeatInfo {
  label: string;
  count: number;
}

interface RecordDetailSheetProps {
  /** 要顯示的紀錄；null = 關閉 */
  record: DiaryRecord | null;
  /** 全部「有效」紀錄的時間順序（上一筆／下一筆走這個，不跟列表的篩選或排序） */
  sequence: readonly DiaryRecord[];
  /** 全部紀錄中出現最多次的問題；這筆就是它且次數 ≥ 3 才顯示「重複發生 ×N」 */
  topProblem: RepeatInfo | null;
  /** 切到另一筆（用 replace，所以瀏覽器「上一頁」一次就能關掉面板） */
  onNavigate: (id: number) => void;
  onClose: () => void;
  /** 關閉後焦點要回到的元素（列表裡被點的那一列） */
  getReturnFocus: () => HTMLElement | null;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-1 text-xs font-bold text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

/** 「處理」「根本原因」可能有多行／條列（資料本身存著換行字元），顯示全文一律 pre-wrap。 */
const multiline = "whitespace-pre-wrap break-words text-sm leading-relaxed";

export function RecordDetailSheet({ record, sequence, topProblem, onNavigate, onClose, getReturnFocus }: RecordDetailSheetProps) {
  const open = record !== null;
  // 面板關閉時內容還在做離場動畫：留住最後一筆，避免閃成空白
  const lastRecord = React.useRef<DiaryRecord | null>(null);
  if (record) lastRecord.current = record;
  const r = record ?? lastRecord.current;

  const idx = r ? sequence.findIndex((x) => x.id === r.id) : -1;
  const prev = idx > 0 ? sequence[idx - 1] : undefined;
  const next = idx >= 0 ? sequence[idx + 1] : undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        hideClose
        aria-describedby={undefined}
        className="gap-0 sm:max-w-none md:max-w-[480px]"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          (getReturnFocus() ?? document.getElementById("main"))?.focus({ preventScroll: true });
        }}
      >
        {r ? (
          <DetailBody
            key={r.id}
            r={r}
            position={idx >= 0 ? `${idx + 1} / ${sequence.length}` : ""}
            repeatCount={topProblem && topProblem.count >= 3 && topProblem.label === r.problem ? topProblem.count : 0}
            hasPrev={!!prev}
            hasNext={!!next}
            onPrev={() => prev && onNavigate(prev.id)}
            onNext={() => next && onNavigate(next.id)}
            onClose={onClose}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

interface DetailBodyProps {
  r: DiaryRecord;
  position: string;
  repeatCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

function DetailBody({ r, position, repeatCount, hasPrev, hasNext, onPrev, onNext, onClose }: DetailBodyProps) {
  const navigate = useNavigate();
  const { patch, isPending: patching } = usePatchRecord();
  const deleter = useSoftDeleteWithUndo();
  const [rootCauseDraft, setRootCauseDraft] = React.useState("");
  const [lightbox, setLightbox] = React.useState<number | null>(null);
  const lastLightbox = React.useRef(0);
  const showPhoto = (i: number | null) => {
    if (i !== null) lastLightbox.current = i;
    setLightbox(i);
  };

  const photos = (r.photos ?? []).map((filename) => ({
    filename,
    src: photoUrl(r.date, filename),
    caption: r.photoCaptions?.[filename] ?? "",
  }));

  const changeStatus = async (status: Status) => {
    try {
      await patch(r.id, { status });
      notify.success(`處理狀態已改為「${status}」`);
    } catch (err) {
      notify.error(err); // 下拉選單由紀錄資料控制，失敗時會自動回到原本的值
    }
  };

  const saveRootCause = async () => {
    const value = rootCauseDraft.trim();
    if (!value) return;
    try {
      await patch(r.id, { rootCause: value });
      notify.success("已儲存根本原因");
    } catch (err) {
      notify.error(err);
    }
  };

  const remove = async () => {
    try {
      await deleter.remove(r.id);
    } catch (err) {
      notify.error(err);
      return;
    }
    onClose();
    toastUndoable({ message: "已移到回收桶", onUndo: () => deleter.undo(r.id) });
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5 md:px-3">
        <SheetClose asChild>
          <Button variant="ghost" size="icon" aria-label="關閉">
            <X aria-hidden="true" />
          </Button>
        </SheetClose>
        {position ? <span className="num ml-1 text-sm text-ink-muted">{position}</span> : null}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="上一筆" disabled={!hasPrev} onClick={onPrev}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="下一筆" disabled={!hasNext} onClick={onNext}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <SheetTitle className="break-words text-xl leading-snug">{r.problem}</SheetTitle>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={r.severity} />
          <StatusBadge status={r.status} />
          {repeatCount > 0 ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-serious bg-serious-wash py-0.5 pl-2 pr-2.5 text-xs font-medium text-ink-1">
              <Repeat className="size-3.5" aria-hidden="true" />
              重複發生 ×{repeatCount}
            </span>
          ) : null}
          {r.updatedAt ? <span className="num text-xs text-ink-muted">已編輯 · {fmtDateTime(r.updatedAt)}</span> : null}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Fact label="日期">
            <span className="num">{r.date}</span>
          </Fact>
          <Fact label="時間">
            <span className="num">{r.time}</span>
          </Fact>
          <Fact label="班別">{r.shift}</Fact>
          <Fact label="耗時">
            <span className="num">{r.duration} 分</span>
          </Fact>
        </dl>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="設備">{r.equipment}</Fact>
          <Fact label="分類">{r.category}</Fact>
          {r.productCode ? <Fact label="品號">{r.productCode}</Fact> : null}
          {r.materialCategory ? <Fact label="原料類別">{r.materialCategory}</Fact> : null}
        </dl>

        <Section title="處理">
          <p className={multiline}>{r.action || "（未填寫）"}</p>
        </Section>

        <Section title="處理狀態">
          <select
            aria-label="處理狀態"
            value={r.status}
            disabled={patching}
            onChange={(e) => void changeStatus(e.target.value as Status)}
            className="h-11 w-full max-w-[12rem] rounded-md border border-line-strong bg-surface-raised px-3 text-sm md:h-10"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Section>

        <Section title="根本原因">
          {r.rootCause ? (
            <p className={multiline}>{r.rootCause}</p>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-line-strong bg-surface p-3">
              <p className="text-xs text-ink-muted">尚未填寫，建議於問題排除後回填，作為下次同類事件的參考</p>
              <textarea
                aria-label="根本原因"
                value={rootCauseDraft}
                onChange={(e) => setRootCauseDraft(e.target.value)}
                rows={3}
                placeholder="例如：模具脫模劑濃度不足，調整噴塗頻率與用量後觀察"
                className="w-full resize-y rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-sm placeholder:text-ink-muted"
              />
              <Button
                size="sm"
                variant="primary"
                className="self-start"
                disabled={!rootCauseDraft.trim() || patching}
                onClick={() => void saveRootCause()}
              >
                儲存根本原因
              </Button>
            </div>
          )}
        </Section>

        <Section title="照片">
          {photos.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-ink-muted">
              <ImageOff className="size-4" aria-hidden="true" />
              未附照片
            </p>
          ) : (
            <>
              <ul className={photos.length === 1 ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
                {photos.map((p, i) => (
                  <li key={p.filename} className="min-w-0">
                    <button
                      type="button"
                      data-photo-index={i}
                      onClick={() => showPhoto(i)}
                      className="block w-full overflow-hidden rounded-md border border-line bg-surface"
                      aria-label={`放大照片 ${i + 1}${p.caption ? `：${p.caption}` : ""}`}
                    >
                      <img src={p.src} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                    </button>
                    {p.caption ? <p className="mt-1 whitespace-pre-wrap break-words text-xs text-ink-2">{p.caption}</p> : null}
                  </li>
                ))}
              </ul>
              {photos.length > 1 ? <p className="mt-2 text-xs text-ink-muted">共 {photos.length} 張照片</p> : null}
            </>
          )}
        </Section>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 border-t border-line bg-surface-raised px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <Button className="flex-1" onClick={() => navigate(`/records/${r.id}/edit`)}>
          <Pencil aria-hidden="true" />
          編輯
        </Button>
        <Button className="flex-1" onClick={() => navigate(`/records/new?copy=${r.id}`)}>
          <Copy aria-hidden="true" />
          複製為新紀錄
        </Button>
        <Button
          className="max-[360px]:flex-1 border-critical text-critical hover:bg-serious-wash hover:text-critical"
          disabled={deleter.isPending}
          onClick={() => void remove()}
        >
          <Trash2 aria-hidden="true" />
          刪除
        </Button>
      </div>

      <Lightbox
        photos={photos}
        index={lightbox}
        onIndexChange={showPhoto}
        onClose={() => showPhoto(null)}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          document.querySelector<HTMLElement>(`[data-photo-index="${lastLightbox.current}"]`)?.focus();
        }}
      />
    </>
  );
}
