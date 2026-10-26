import { ImageOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PhotoThumbProps {
  src: string;
  alt: string;
  /** uploading：轉圈（fetch 沒有上傳進度，所以不是百分比）；error：失敗；其餘正常顯示 */
  state?: "ready" | "uploading" | "error";
  className?: string;
}

/** 照片縮圖（80px 方形）。上傳中顯示轉圈、失敗顯示警示圖樣，狀態同時用文字（螢幕閱讀器）傳達。 */
export function PhotoThumb({ src, alt, state = "ready", className }: PhotoThumbProps) {
  return (
    <div
      className={cn(
        "relative size-20 shrink-0 overflow-hidden rounded-md border border-line-strong bg-surface",
        state === "error" && "border-critical",
        className,
      )}
    >
      {src && state !== "error" ? (
        <img src={src} alt={alt} className={cn("size-full object-cover", state === "uploading" && "opacity-50")} />
      ) : null}
      {state === "uploading" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-6 animate-spin text-accent-text" aria-hidden="true" />
          <span className="sr-only">上傳中</span>
        </div>
      ) : null}
      {state === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center text-critical">
          <ImageOff className="size-6" aria-hidden="true" />
          <span className="sr-only">上傳失敗</span>
        </div>
      ) : null}
    </div>
  );
}
