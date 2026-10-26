import { Lock } from "lucide-react";
import { inputClass } from "@/components/Combobox";
import { Button } from "@/components/ui/button";
import { Field, ReviewTag } from "./fields";
import { formatDateSummary, SHIFTS, type FieldErrors, type FormValues, type ReviewField } from "./model";

export const DATE_LOCK_HINT = "已上傳照片，要改日期請先移除照片";

interface DateTimeFieldsProps {
  values: Pick<FormValues, "date" | "time" | "shift">;
  errors: FieldErrors;
  review: readonly ReviewField[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 有上傳中／已上傳未送出的照片：日期鎖住 */
  dateLocked: boolean;
  onChange: (field: "date" | "time" | "shift", value: string) => void;
}

/**
 * 日期／時間／班別預設「現在」，收合成一行摘要「2026/10/26 14:05・早班〔修改〕」；
 * 點〔修改〕展開。複製帶入、或日期時間有錯誤時由外層展開（並標「請確認」）。
 */
export function DateTimeFields({ values, errors, review, open, onOpenChange, dateLocked, onChange }: DateTimeFieldsProps) {
  const needsReview = review.some((f) => f === "date" || f === "time" || f === "shift");

  return (
    <div role="group" aria-labelledby="rf-when-label" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span id="rf-when-label" className="text-sm font-bold">
          發生時間
        </span>
        <span className="num text-sm text-ink-1" data-testid="date-summary">
          {formatDateSummary(values)}
        </span>
        {needsReview && !open ? <ReviewTag className="ml-0" /> : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-accent-text"
          aria-expanded={open}
          aria-controls="rf-when-panel"
          onClick={() => onOpenChange(!open)}
        >
          {open ? "收合" : "修改"}
        </Button>
      </div>

      {dateLocked ? (
        <p className="flex items-center gap-1.5 text-xs text-ink-2" data-testid="date-lock-hint">
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          {DATE_LOCK_HINT}
        </p>
      ) : null}

      <div id="rf-when-panel" hidden={!open} className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field name="date" label="日期" error={errors.date} review={review.includes("date")} className="col-span-2 md:col-span-1">
          {(p) => (
            <input
              {...p}
              type="date"
              value={values.date}
              disabled={dateLocked}
              onChange={(e) => onChange("date", e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        <Field name="time" label="時間" error={errors.time} review={review.includes("time")}>
          {(p) => (
            <input
              {...p}
              type="time"
              value={values.time}
              onChange={(e) => onChange("time", e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        <Field name="shift" label="班別" error={errors.shift} review={review.includes("shift")}>
          {(p) => (
            <select {...p} value={values.shift} onChange={(e) => onChange("shift", e.target.value)} className={inputClass}>
              {SHIFTS.map((s) => (
                <option key={s} value={s}>
                  {s}班
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
    </div>
  );
}
