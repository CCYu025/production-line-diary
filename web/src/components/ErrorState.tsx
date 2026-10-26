import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  /** 例如「載入紀錄失敗」 */
  title?: string;
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

/** 載入失敗：說明原因 + 重試按鈕（role="alert"，出現時會被唸出來）。 */
export function ErrorState({ title = "載入失敗", error, onRetry, retrying, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-critical bg-surface-raised p-5 sm:flex-row sm:items-center",
        className,
      )}
    >
      <TriangleAlert className="size-6 shrink-0 text-critical" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">{title}</p>
        <p className="text-sm text-ink-2">{errorMessage(error)}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? "animate-spin" : undefined} aria-hidden="true" />
          重試
        </Button>
      ) : null}
    </div>
  );
}
