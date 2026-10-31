import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LightboxPhoto {
  src: string;
  caption?: string;
}

interface LightboxProps {
  photos: readonly LightboxPhoto[];
  /** 目前看第幾張；null = 關閉 */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** 關閉後把焦點還給縮圖 */
  onCloseAutoFocus?: (event: Event) => void;
}

const iconBtn =
  "inline-flex size-11 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-30";

/**
 * 照片燈箱：圖說顯示在照片下方；Esc 關閉、←／→ 切換（只切換這筆紀錄的照片）。
 * 底層是 Radix Dialog（焦點鎖定、關閉後焦點回到觸發元素）；疊在詳情面板上時 Esc 只會關掉燈箱。
 */
export function Lightbox({ photos, index, onIndexChange, onClose, onCloseAutoFocus }: LightboxProps) {
  const open = index !== null && photos[index] !== undefined;
  const photo = open && index !== null ? photos[index] : undefined;
  const multiple = photos.length > 1;

  const go = (delta: number) => {
    if (index === null) return;
    const next = index + delta;
    if (next >= 0 && next < photos.length) onIndexChange(next);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[70] bg-black/85",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          data-fx="lightbox"
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              go(-1);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              go(1);
            }
          }}
          // 點到照片以外的空白處關閉（照片、圖說、按鈕本身不會）
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 p-4 outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            {multiple && index !== null ? `照片 ${index + 1} / ${photos.length}` : "照片"}
          </DialogPrimitive.Title>
          {photo ? (
            <>
              {/* FX-36：以 src 當 key，換張照片就重新掛載，cyber 下新圖淡入（標準主題沒有動畫，視覺不變）；焦點在對話框／按鈕上，不在 <img> */}
              <img
                key={photo.src}
                src={photo.src}
                alt={photo.caption || "照片"}
                className="max-h-[calc(100%-5rem)] max-w-full rounded-md object-contain shadow-pop"
              />
              {photo.caption ? (
                <p className="max-w-xl whitespace-pre-wrap rounded-md bg-black/60 px-3 py-2 text-center text-sm text-white">
                  {photo.caption}
                </p>
              ) : null}
            </>
          ) : null}
          <DialogPrimitive.Close className={cn(iconBtn, "absolute right-3 top-3")} aria-label="關閉照片">
            <X className="size-5" aria-hidden="true" />
          </DialogPrimitive.Close>
          {multiple ? (
            <>
              <button
                type="button"
                className={cn(iconBtn, "absolute left-3 top-1/2 -translate-y-1/2")}
                aria-label="上一張照片"
                disabled={index === 0}
                onClick={() => go(-1)}
              >
                <ChevronLeft className="size-6" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={cn(iconBtn, "absolute right-3 top-1/2 -translate-y-1/2")}
                aria-label="下一張照片"
                disabled={index === photos.length - 1}
                onClick={() => go(1)}
              >
                <ChevronRight className="size-6" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
