import { Check, Plus } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** 表單輸入框共用的樣式（Combobox、表單欄位共用）。手機 16px 避免 iOS 聚焦時自動放大。 */
export const inputClass =
  "h-11 w-full rounded-md border border-line-strong bg-surface-raised px-3 text-base text-ink-1 " +
  "placeholder:text-ink-muted md:h-10 md:text-sm " +
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent-text " +
  "disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-muted " +
  "aria-[invalid=true]:border-critical";

export interface ComboboxProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "role" | "type"> {
  value: string;
  onValueChange: (value: string) => void;
  /** 建議清單。可以自由輸入清單以外的新值（creatable）。 */
  options: readonly string[];
  /** 輸入的字不在清單裡時，清單最後一列的文字，預設「新增「x」」 */
  createLabel?: (value: string) => string;
  /** 最多顯示幾筆建議 */
  maxOptions?: number;
}

/**
 * 可輸入的 Combobox（ARIA 1.2 combobox + listbox）：可選既有建議，也可以直接輸入新值。
 * 鍵盤：↓↑ 移動、Enter 選取目前高亮的項目（沒有高亮就照一般輸入框處理）、Esc 收合、Tab 離開。
 * 輸入框一直保有焦點（選項用 aria-activedescendant 指向），所以手機上不會因為點選項而收起鍵盤。
 */
export function Combobox({
  id,
  value,
  onValueChange,
  options,
  createLabel = (v) => `新增「${v}」`,
  maxOptions = 50,
  className,
  onKeyDown,
  onFocus,
  onBlur,
  autoComplete = "off",
  ...rest
}: ComboboxProps) {
  const reactId = React.useId();
  const baseId = id ?? reactId;
  const listboxId = `${baseId}-listbox`;
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  // 使用者「打過字」才依輸入過濾；剛聚焦時列出全部，才看得到其他選項
  const [typed, setTyped] = React.useState(false);
  const listRef = React.useRef<HTMLUListElement>(null);

  const query = value.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    const list = typed && query ? options.filter((o) => o.toLowerCase().includes(query)) : options;
    return list.slice(0, maxOptions);
  }, [options, query, typed, maxOptions]);
  const canCreate = typed && value.trim() !== "" && !options.includes(value.trim());
  const rows: Array<{ kind: "option" | "create"; text: string }> = [
    ...filtered.map((text) => ({ kind: "option" as const, text })),
    ...(canCreate ? [{ kind: "create" as const, text: value.trim() }] : []),
  ];

  const optionId = (i: number) => `${baseId}-opt-${i}`;

  React.useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    setActive(-1);
    setTyped(false);
  };

  const pick = (text: string) => {
    onValueChange(text);
    close();
  };

  return (
    <div className="relative">
      <input
        {...rest}
        id={baseId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        autoComplete={autoComplete}
        value={value}
        className={cn(inputClass, className)}
        onChange={(e) => {
          onValueChange(e.target.value);
          setTyped(true);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={(e) => {
          setOpen(true);
          onFocus?.(e);
        }}
        onClick={() => setOpen(true)}
        onBlur={(e) => {
          close();
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) setOpen(true);
            else if (rows.length) setActive((a) => (a + 1) % rows.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) setOpen(true);
            else if (rows.length) setActive((a) => (a <= 0 ? rows.length - 1 : a - 1));
          } else if (e.key === "Enter") {
            // Enter 在這裡永遠不送出整張表單：有反白的建議就選它，否則只是「確認目前打的值」並收起清單
            // （設備／分類在欄位裡打完字按 Enter，不該意外送出還沒填完的紀錄）
            e.preventDefault();
            if (open && active >= 0 && rows[active]) pick(rows[active].text);
            else close();
          } else if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }
        }}
      />
      {open && rows.length > 0 ? (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={rest["aria-label"] ?? "建議清單"}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-md border border-line-strong bg-surface-raised py-1 shadow-pop"
        >
          {rows.map((row, i) => (
            <li
              key={`${row.kind}-${row.text}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // mousedown 不可讓輸入框失焦（失焦會先收起清單，click 就送不出去）
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(row.text)}
              onMouseMove={() => setActive(i)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-base md:min-h-9 md:text-sm",
                i === active ? "bg-accent-wash" : "hover:bg-surface",
                row.kind === "create" && "text-accent-text",
              )}
            >
              {row.kind === "create" ? (
                <Plus className="size-4 shrink-0" aria-hidden="true" />
              ) : row.text === value ? (
                <Check className="size-4 shrink-0 text-accent-text" aria-hidden="true" />
              ) : (
                <span className="size-4 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 break-words">{row.kind === "create" ? createLabel(row.text) : row.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
