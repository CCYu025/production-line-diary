import { CircleAlert } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** 欄位 id：錯誤時要聚焦到對應元素，所以集中在一處命名。 */
export const fieldId = (name: string) => `rf-${name}`;

export function ReviewTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ml-2 inline-flex items-center rounded-sm border border-serious bg-serious-wash px-1.5 text-xs font-bold text-ink-1",
        className,
      )}
    >
      請確認
    </span>
  );
}

interface FieldProps {
  name: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | undefined;
  /** 複製帶入後等待使用者確認 */
  review?: boolean;
  className?: string;
  /** 自訂輸入元件。拿到要放在元素上的 id／aria 屬性 */
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => React.ReactNode;
}

/** 標籤＋說明＋輸入元件＋欄位旁的錯誤訊息。錯誤同時以 aria-describedby / role=alert 傳給輔助科技。 */
export function Field({ name, label, hint, error, review, className, children }: FieldProps) {
  const id = fieldId(name);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-field={name} data-review={review ? "true" : undefined}>
      <label htmlFor={id} className="text-sm font-bold text-ink-1">
        {label}
        {review ? <ReviewTag /> : null}
      </label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": describedBy })}
      {hint ? (
        <p id={hintId} className="text-xs text-ink-muted [overflow-wrap:anywhere]">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-critical">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}

export const textareaClass =
  "min-h-24 w-full resize-y rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-base text-ink-1 " +
  "placeholder:text-ink-muted md:text-sm " +
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent-text " +
  "aria-[invalid=true]:border-critical";
