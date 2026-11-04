/*
 * 指令列（docs/os-mode-spec.md §4.5）：Radix Dialog（焦點鎖定、Esc 只關它），內容是一個 combobox ＋ listbox。
 * 指令的解析與自動完成是純函式（commands.ts）；這裡只負責 UI。
 * 導覽結果走 router 的 navigate()（由呼叫端提供，useBlocker 的離開確認照常生效），而且「先關閉指令列、再導覽」：
 * 指令列關閉、焦點還給原來的元素之後才執行，這樣離開確認對話框記住的是原來的欄位，而不是已經卸載的指令列。
 */
import * as Dialog from "@radix-ui/react-dialog";
import * as React from "react";
import { CRT_LABEL, getCrtLevel, setCrtLevel } from "../crt/settings";
import { COMMANDS, parseCommand, suggest, type ParsedCommand } from "./commands";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 導覽類指令：path 含 query（例如 /records?open=63） */
  onNavigate: (path: string) => void;
  onExit: () => void;
  /** 匯出 Excel（與側欄相同的動作） */
  onExport: () => void;
}

export function CommandPalette({ open, onOpenChange, onNavigate, onExit, onExport }: CommandPaletteProps) {
  const uid = React.useId();
  const listId = `${uid}-list`;
  const errorId = `${uid}-error`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const [value, setValue] = React.useState("");
  const [active, setActive] = React.useState(-1);
  const [error, setError] = React.useState<string | null>(null);
  const [help, setHelp] = React.useState(false);

  const returnFocus = React.useRef<HTMLElement | null>(null);
  const after = React.useRef<(() => void) | null>(null);

  // 開啟時記住原本的焦點（Radix 沒有 Trigger 可以還）並重設內容
  React.useLayoutEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setValue("");
    setActive(-1);
    setError(null);
    setHelp(false);
  }, [open]);

  const suggestions = React.useMemo(() => suggest(value), [value]);
  const expanded = open && !help && suggestions.length > 0;

  const flush = React.useCallback(() => {
    const fn = after.current;
    after.current = null;
    fn?.();
  }, []);

  // 保險：onCloseAutoFocus 沒有觸發時（例如內容尚未掛載就關閉），關閉後稍等一下仍執行待辦
  React.useEffect(() => {
    if (open || !after.current) return;
    const id = window.setTimeout(flush, 150);
    return () => window.clearTimeout(id);
  }, [open, flush]);

  const closeThen = (fn: () => void) => {
    after.current = fn;
    onOpenChange(false);
  };

  const run = (cmd: ParsedCommand) => {
    switch (cmd.type) {
      case "empty":
        return;
      case "error":
        setError(cmd.message);
        setHelp(false);
        return;
      case "help":
        setError(null);
        setHelp(true);
        return;
      case "exit":
        closeThen(onExit);
        return;
      case "export":
        closeThen(onExport);
        return;
      case "crt":
        if (cmd.level === null) {
          // 只問目前強度：顯示說明，不關閉
          setHelp(false);
          setError(`目前 CRT 強度：${CRT_LABEL[getCrtLevel()]}（crt off｜std｜max 切換）`);
          return;
        }
        // 立刻生效，不需要導覽；指令列關閉、焦點還給原來的元素
        setCrtLevel(cmd.level);
        closeThen(() => {});
        return;
      case "nav":
        closeThen(() => onNavigate(cmd.path));
        return;
    }
  };

  const submit = () => {
    const s = active >= 0 ? suggestions[active] : undefined;
    if (s) {
      // 還需要參數的（"rec "）：填入輸入框等使用者補完；其餘直接執行
      if (/\s$/.test(s.insert)) {
        setValue(s.insert);
        setActive(-1);
        return;
      }
      run(parseCommand(s.insert));
      return;
    }
    run(parseCommand(value));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case "ArrowDown":
        if (suggestions.length === 0) return;
        e.preventDefault();
        setActive((i) => (i + 1) % suggestions.length);
        return;
      case "ArrowUp":
        if (suggestions.length === 0) return;
        e.preventDefault();
        setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      case "Tab": {
        const s = suggestions[active >= 0 ? active : 0];
        if (!s) return;
        e.preventDefault();
        setValue(s.insert);
        setActive(-1);
        return;
      }
      case "Enter":
        e.preventDefault();
        submit();
        return;
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="os-palette-overlay" />
        <Dialog.Content
          className="os-palette"
          data-os="palette"
          onCloseAutoFocus={(e) => {
            // 焦點自己管：先還給原本的元素，再執行待辦的導覽
            e.preventDefault();
            const el = returnFocus.current;
            if (el && el.isConnected) el.focus({ preventScroll: true });
            flush();
          }}
        >
          <Dialog.Title className="sr-only">指令列</Dialog.Title>
          <Dialog.Description className="sr-only">輸入指令後按 Enter；輸入 help 查看所有指令。</Dialog.Description>
          <div className="os-palette-row">
            <span className="os-palette-prompt" aria-hidden="true">
              &gt;
            </span>
            <input
              className="os-palette-input"
              data-os="palette-input"
              role="combobox"
              aria-label="指令"
              aria-autocomplete="list"
              aria-expanded={expanded}
              aria-controls={listId}
              aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setActive(-1);
                setError(null);
                setHelp(false);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul id={listId} role="listbox" aria-label="指令建議" className="os-palette-list" data-os="palette-list" hidden={!expanded}>
            {expanded
              ? suggestions.map((s, i) => (
                  <li
                    key={s.command}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    data-active={i === active ? "true" : "false"}
                    className="os-palette-option"
                    // 不讓輸入框失焦
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (/\s$/.test(s.insert)) {
                        setValue(s.insert);
                        setActive(-1);
                      } else run(parseCommand(s.insert));
                    }}
                  >
                    <span className="os-palette-cmd">{s.command}</span>
                    <span className="os-palette-desc">{s.description}</span>
                  </li>
                ))
              : null}
          </ul>
          {error ? (
            <p className="os-palette-error" id={errorId} role="alert" data-os="palette-error">
              {error}
            </p>
          ) : null}
          {help ? (
            <dl className="os-palette-help" data-os="palette-help">
              {COMMANDS.map((c) => (
                <div key={c.usage}>
                  <dt>{c.usage}</dt>
                  <dd>{c.description}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
