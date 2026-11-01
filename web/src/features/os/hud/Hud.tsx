import type { Channel } from "../channels";

export interface HudProps {
  channel: Channel;
  /** 轉場進行中（交接點之前）或在工作站：HUD 不可見也不可操作 */
  active: boolean;
  onEnter: () => void;
  buttonRef: React.Ref<HTMLButtonElement>;
}

/** 控制室的 HUD（X0：只有一個真實的頻道按鈕＋回到網頁模式的提示）。 */
export function Hud({ channel, active, onEnter, buttonRef }: HudProps) {
  const inert = active ? undefined : { inert: "" };
  return (
    <div className="os-hud" data-os="hud" data-active={active ? "true" : "false"} {...(inert as object)}>
      <h1 className="sr-only">PLD/OS 1995 控制室</h1>
      <button ref={buttonRef} type="button" className="os-hud-button" data-os="hud-ch02" onClick={onEnter}>
        {channel.id} {channel.name}
      </button>
      <p className="os-hud-hint">
        網頁介面：網址加上 <code>?mode=web</code>，或 <a href="?mode=web">按這裡</a>
      </p>
    </div>
  );
}
