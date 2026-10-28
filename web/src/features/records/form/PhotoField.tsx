import { Camera, Trash2 } from "lucide-react";
import * as React from "react";
import { inputClass } from "@/components/Combobox";
import { PhotoThumb } from "@/components/PhotoThumb";
import { Button } from "@/components/ui/button";
import { photoUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Field } from "./fields";
import { MAX_CAPTION_LENGTH } from "./model";
import type { PhotoItem } from "./usePhotoUploads";

export interface ExistingPhoto {
  filename: string;
  caption: string;
}

interface PhotoFieldProps {
  /** 編輯模式：紀錄原本就有的照片（縮圖一律用紀錄「原本」的日期，不跟著表單的日期欄變） */
  existing?: readonly ExistingPhoto[];
  originalDate?: string;
  onRemoveExisting?: (filename: string) => void;
  onExistingCaption?: (filename: string, caption: string) => void;
  /** 本次新上傳的 */
  uploads: readonly PhotoItem[];
  onRemoveUpload: (id: string) => void;
  onUploadCaption: (id: string, caption: string) => void;
  onFiles: (files: File[]) => void;
  /** 新增畫面在手機上直接開相機（舊版行為）；編輯畫面不用 */
  capture?: boolean;
  error?: string | undefined;
}

function CaptionInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        aria-label={label}
        placeholder="圖片說明（選填，一句話）"
        maxLength={MAX_CAPTION_LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      {value.length > MAX_CAPTION_LENGTH * 0.7 ? (
        <span className="num self-end text-xs text-ink-muted">
          {value.length}/{MAX_CAPTION_LENGTH}
        </span>
      ) : null}
    </div>
  );
}

function PhotoRow({
  thumb,
  title,
  caption,
  removeLabel,
  onRemove,
  statusText,
  statusTone,
}: {
  thumb: React.ReactNode;
  title: string;
  caption: React.ReactNode;
  removeLabel: string;
  onRemove: () => void;
  statusText?: string | undefined;
  statusTone?: "error" | undefined;
}) {
  return (
    <li className="flex gap-3 rounded-md border border-line bg-surface-raised p-2">
      {thumb}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-ink-1">{title}</p>
          <Button variant="ghost" size="sm" className="shrink-0 text-ink-2" aria-label={removeLabel} onClick={onRemove}>
            <Trash2 aria-hidden="true" />
            移除
          </Button>
        </div>
        {statusText ? (
          <p
            {...(statusTone === "error" ? { "data-fx": "error-msg" } : {})}
            className={cn("[overflow-wrap:anywhere]", statusTone === "error" ? "text-sm font-medium text-critical" : "text-xs text-ink-muted")}
          >
            {statusText}
          </p>
        ) : null}
        {caption}
      </div>
    </li>
  );
}

/** 照片區：選檔當下立刻上傳（狀態由 usePhotoUploads 管），每張縮圖旁就能寫一句圖片說明。 */
export function PhotoField({
  existing = [],
  originalDate,
  onRemoveExisting,
  onExistingCaption,
  uploads,
  onRemoveUpload,
  onUploadCaption,
  onFiles,
  capture,
  error,
}: PhotoFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const total = existing.length + uploads.length;

  return (
    <Field
      name="photos"
      label={
        <>
          照片 <span className="text-xs font-normal text-ink-muted">可多張，每張都能加一句圖片說明（選填）</span>
        </>
      }
      error={error}
    >
      {(p) => (
        <div className="flex flex-col gap-3">
          <label
            htmlFor={p.id}
            className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-line-strong bg-surface px-4 py-4 text-center text-sm text-ink-2 transition-colors hover:border-accent hover:bg-accent-wash has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-text"
          >
            <Camera className="size-6 text-ink-muted" aria-hidden="true" />
            <span>{capture ? "點擊拍照／選擇照片" : "點擊新增照片"}</span>
            <input
              ref={inputRef}
              id={p.id}
              type="file"
              accept="image/*"
              multiple
              {...(capture ? { capture: "environment" as const } : {})}
              aria-describedby={p["aria-describedby"]}
              className="sr-only"
              onChange={(e) => {
                // 先複製出檔案再清空 input（同一張可以再選一次）
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) onFiles(files);
              }}
            />
          </label>

          {total > 0 ? (
            <ul className="flex flex-col gap-2" aria-label="已加入的照片">
              {existing.map((ph, i) => (
                <PhotoRow
                  key={`existing-${ph.filename}`}
                  thumb={<PhotoThumb src={photoUrl(originalDate ?? "", ph.filename)} alt={`既有照片 ${i + 1}`} />}
                  title={ph.filename}
                  removeLabel={`移除既有照片 ${ph.filename}`}
                  onRemove={() => onRemoveExisting?.(ph.filename)}
                  statusText="已儲存在這筆紀錄（移除後按「儲存變更」才會真的刪除）"
                  caption={
                    <CaptionInput
                      label={`既有照片 ${i + 1} 的圖片說明`}
                      value={ph.caption}
                      onChange={(v) => onExistingCaption?.(ph.filename, v)}
                    />
                  }
                />
              ))}
              {uploads.map((ph, i) => (
                <PhotoRow
                  key={ph.id}
                  thumb={
                    <PhotoThumb
                      src={ph.previewUrl}
                      alt={`新照片 ${i + 1}`}
                      state={ph.status === "uploading" ? "uploading" : ph.status === "error" ? "error" : "ready"}
                    />
                  }
                  title={ph.fileName}
                  removeLabel={`移除新照片 ${ph.fileName}`}
                  onRemove={() => onRemoveUpload(ph.id)}
                  statusText={
                    ph.status === "uploading"
                      ? "上傳中…"
                      : ph.status === "error"
                        ? `上傳失敗：${ph.error ?? "請移除後重試"}`
                        : undefined
                  }
                  statusTone={ph.status === "error" ? "error" : undefined}
                  caption={
                    ph.status === "error" ? null : (
                      <CaptionInput
                        label={`新照片 ${i + 1} 的圖片說明`}
                        value={ph.caption}
                        onChange={(v) => onUploadCaption(ph.id, v)}
                      />
                    )
                  }
                />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Field>
  );
}
