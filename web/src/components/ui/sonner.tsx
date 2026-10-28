import { CircleAlert, CircleCheck, Info, Loader2 } from "lucide-react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { useThemePreference } from "@/lib/useThemePreference";

/**
 * 全域 toast 容器（sonner）。容器本身是 aria-live="polite" 區域，新訊息會被輔助科技唸出來。
 * 配色用 index.css 裡的 [data-sonner-toaster] 變數對應到語意 token，跟著淺色／深色走。
 * cyber 主題永遠是深色，所以傳 theme="dark"；標準主題不傳（維持 sonner 預設，行為與以前完全相同）。
 * 要發 toast 請用 @/lib/feedback 的 notify / toastUndoable，不要直接 import sonner。
 */
export function Toaster(props: ToasterProps) {
  const cyber = useThemePreference() === "cyber";
  return (
    <SonnerToaster
      {...(cyber ? { theme: "dark" as const } : {})}
      position="bottom-right"
      offset={24}
      mobileOffset={{ bottom: 96, left: 16, right: 16 }}
      visibleToasts={4}
      closeButton
      icons={{
        success: <CircleCheck className="size-5 text-good" aria-hidden="true" />,
        error: <CircleAlert className="size-5 text-critical" aria-hidden="true" />,
        info: <Info className="size-5 text-accent-text" aria-hidden="true" />,
        loading: <Loader2 className="size-5 animate-spin text-ink-2" aria-hidden="true" />,
      }}
      toastOptions={{
        classNames: {
          toast: "font-sans text-sm",
          actionButton: "min-h-8 px-3",
        },
      }}
      {...props}
    />
  );
}
