import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 破壞性操作（永久刪除…）：確認鈕用紅色 */
  destructive?: boolean;
  /** 對話框關閉後要把焦點還給誰；預設是呼叫當下的焦點元素 */
  returnFocusTo?: HTMLElement | null;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * 全域確認對話框。用法：
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "永久刪除這筆紀錄？", description: "無法復原…", destructive: true }))) return;
 * 回傳 Promise<boolean>：按確認 true；按取消、Esc 皆為 false。
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [open, setOpen] = React.useState(false);
  const pendingRef = React.useRef<Pending | null>(null);
  // 對話框是用程式叫出來的（沒有 <Trigger>），Radix 不知道關閉後該把焦點還給誰，所以自己記住。
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  const confirm = React.useCallback<ConfirmFn>((options) => {
    // 前一個還沒回答的對話框視同取消
    pendingRef.current?.resolve(false);
    returnFocusRef.current =
      options.returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
      setOpen(true);
    });
  }, []);

  const settle = (ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setOpen(false);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) settle(false);
        }}
      >
        <AlertDialogContent
          // cyber 主題：永久刪除這類破壞性對話框要有 critical 斜紋上緣（只在 destructive 時輸出）
          {...(pending?.destructive ? { "data-variant": "destructive" } : {})}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            {pending?.description ? <AlertDialogDescription>{pending.description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>{pending?.cancelLabel ?? "取消"}</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.destructive ? "destructive" : "primary"}
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel ?? "確認"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm 必須在 <ConfirmProvider> 裡使用");
  return ctx;
}
