/*
 * H1 的終端板內容（docs/holo-mode-spec.md §4.3 的欄位部分）：一個真的 <input>（問題）、一個 <textarea>（處理，多行）、
 * 一個現有的 Combobox（設備，直接 import，不改它）。兩種定位方法共用同一份內容。
 * 內容區：不透明的 --surface 背景，沒有掃描線、光暈或模糊。
 */
import * as React from "react";
import { Combobox, inputClass } from "@/components/Combobox";
import { slateProbe } from "./probe";

const EQUIPMENT = ["F3", "F4", "G5", "G6", "F7", "F8", "原材區", "RB2"];

export interface SlateProps {
  /** 選字開始／結束（compositionstart／compositionend），給「選字期間凍結位置」用 */
  onComposition?: (composing: boolean) => void;
}

export function Slate({ onComposition }: SlateProps) {
  const [problem, setProblem] = React.useState("");
  const [action, setAction] = React.useState("");
  const [equipment, setEquipment] = React.useState("");
  const formRef = React.useRef<HTMLFormElement>(null);

  // 探針：用原生捕捉階段的監聽，看到的是瀏覽器實際送出的事件（含 isComposing、keyCode 229）
  React.useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const fieldOf = (t: EventTarget | null) => (t as HTMLElement | null)?.getAttribute?.("data-field") ?? (t as HTMLElement | null)?.id ?? "";
    const log = (e: Event) => {
      if (!slateProbe.enabled) return;
      const k = e as KeyboardEvent;
      const i = e as InputEvent;
      slateProbe.push({
        t: performance.now(),
        type: e.type,
        key: k.key,
        keyCode: k.keyCode,
        isComposing: (k as { isComposing?: boolean }).isComposing,
        defaultPrevented: e.defaultPrevented,
        field: fieldOf(e.target),
        value: (e.target as HTMLInputElement | null)?.value,
        data: i.data,
      });
    };
    const types = ["keydown", "keyup", "compositionstart", "compositionupdate", "compositionend", "beforeinput", "input"];
    for (const t of types) form.addEventListener(t, log, true);
    // keydown 的 defaultPrevented 要在事件跑完後才知道：冒泡階段補記
    const after = (e: Event) => {
      if (!slateProbe.enabled) return;
      const k = e as KeyboardEvent;
      slateProbe.push({ t: performance.now(), type: "keydown-after", key: k.key, isComposing: k.isComposing, defaultPrevented: e.defaultPrevented, field: fieldOf(e.target) });
    };
    form.addEventListener("keydown", after, false);
    return () => {
      for (const t of types) form.removeEventListener(t, log, true);
      form.removeEventListener("keydown", after, false);
    };
  }, []);

  const startComposition = () => {
    slateProbe.compositions++;
    slateProbe.composing = true;
    onComposition?.(true);
  };
  const endComposition = () => {
    slateProbe.composing = false;
    onComposition?.(false);
  };

  return (
    <form
      ref={formRef}
      className="holo-slate"
      data-holo="slate"
      aria-label="終端板"
      onSubmit={(e) => {
        e.preventDefault();
        slateProbe.submits++;
      }}
      onCompositionStart={startComposition}
      onCompositionEnd={endComposition}
    >
      <header className="holo-slate-bar">
        <span>CH-02 ▸ REC #63 ▸ 2026-11-07 14:20</span>
        <span aria-hidden="true">[ESC] 放下</span>
      </header>
      <div className="holo-slate-body">
        <label className="holo-slate-row" htmlFor="holo-problem">
          <span className="holo-slate-label">問題▸</span>
          <input id="holo-problem" data-field="problem" className={inputClass} value={problem} onChange={(e) => setProblem(e.target.value)} autoComplete="off" />
        </label>
        <label className="holo-slate-row" htmlFor="holo-action">
          <span className="holo-slate-label">處理▸</span>
          <textarea id="holo-action" data-field="action" className={`${inputClass} h-24 py-2 leading-relaxed`} value={action} onChange={(e) => setAction(e.target.value)} />
        </label>
        <div className="holo-slate-row">
          <label className="holo-slate-label" htmlFor="holo-equipment">
            設備▸
          </label>
          <Combobox id="holo-equipment" data-field="equipment" value={equipment} onValueChange={setEquipment} options={EQUIPMENT} />
        </div>
        <div className="holo-slate-actions">
          <button type="submit" className="holo-slate-btn" data-field="submit">
            儲存
          </button>
          <button type="button" className="holo-slate-btn" data-field="cancel">
            取消
          </button>
        </div>
      </div>
    </form>
  );
}
