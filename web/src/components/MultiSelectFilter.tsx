import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { ResponsivePopover } from "@/components/ResponsivePopover";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface MultiSelectFilterProps {
  /** 名稱，例如「設備」「分類」 */
  label: string;
  /** 所有選項（呼叫端排好順序：依全部紀錄的總筆數） */
  options: readonly string[];
  /** 每個選項目前的筆數（facet counts：套用其他維度、不套用自己） */
  counts: Readonly<Record<string, number>>;
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

/**
 * 可搜尋的多選下拉（shadcn Popover + Command）。選項帶筆數；選了之後下拉保持開啟，才能接著加選。
 * 搜尋是子字串比對（不分大小寫）；離開下拉就清掉搜尋關鍵字（不然下次打開只剩被過濾的幾項，看起來像選項不見了）。
 */
export function MultiSelectFilter({ label, options, counts, selected, onChange }: MultiSelectFilterProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  const kw = query.trim().toLowerCase();
  const items = options.filter((o) => !kw || o.toLowerCase().includes(kw));
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const first = selected[0];
  const extra = selected.length - 1;

  return (
    <ResponsivePopover
      open={open}
      onOpenChange={handleOpenChange}
      title={`選擇${label}`}
      trigger={
        <button
          type="button"
          className={cn(
            "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border bg-surface-raised px-3 text-sm md:min-h-9",
            first ? "border-accent text-ink-1" : "border-line-strong text-ink-2 hover:text-ink-1",
          )}
        >
          <span className="truncate">{first ? `${label}：${first}` : label}</span>
          {extra > 0 ? (
            <span className="num rounded-full bg-accent px-1.5 text-xs font-bold text-accent-ink">+{extra}</span>
          ) : null}
          <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        </button>
      }
    >
      <Command shouldFilter={false} label={`搜尋${label}`}>
        <CommandInput value={query} onValueChange={setQuery} placeholder={`搜尋${label}…`} />
        <CommandList>
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">找不到符合的{label}</p>
          ) : (
            items.map((o) => {
              const on = selected.includes(o);
              const n = counts[o] ?? 0;
              return (
                <CommandItem
                  key={o}
                  value={o}
                  onSelect={() => toggle(o)}
                  data-checked={on}
                  className={cn("min-h-11 md:min-h-9", n === 0 && !on && "text-ink-muted")}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                      on ? "border-accent bg-accent text-accent-ink" : "border-line-strong",
                    )}
                  >
                    {on ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o}</span>
                  {on ? <span className="sr-only">（已選）</span> : null}
                  <span className="num text-xs text-ink-muted">{n}</span>
                </CommandItem>
              );
            })
          )}
        </CommandList>
        <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs text-ink-muted">
          <span>{selected.length ? `已選 ${selected.length} 項` : "可複選"}</span>
          {selected.length ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center px-2 text-accent-text hover:underline md:min-h-8"
              onClick={() => onChange([])}
            >
              清除
            </button>
          ) : null}
        </div>
      </Command>
    </ResponsivePopover>
  );
}
