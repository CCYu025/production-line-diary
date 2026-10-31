import type * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";

/** 窄螢幕（≤ 720px，與舊 UI 同一個斷點）：下拉改成貼底的面板。 */
export const useIsNarrow = () => useMediaQuery("(max-width: 720px)");

interface ResponsivePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 觸發用的 <button>（會被 asChild 包起來，焦點環、aria-expanded 由 Radix 處理） */
  trigger: React.ReactNode;
  /** 窄螢幕底部面板的標題（輔助科技也會唸） */
  title: string;
  children: React.ReactNode;
  contentClassName?: string;
}

/**
 * 桌面：Popover（錨定在按鈕下方）；窄螢幕：貼底的 Sheet。兩者都有焦點鎖定、Esc 關閉、
 * 關閉後焦點回到觸發按鈕（因為都有 Trigger）。
 */
export function ResponsivePopover({ open, onOpenChange, trigger, title, children, contentClassName }: ResponsivePopoverProps) {
  const narrow = useIsNarrow();
  if (narrow) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" aria-describedby={undefined} className="gap-0 pb-4">
          <SheetHeader className="pb-2">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className={cn("w-80 p-0", contentClassName)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}
