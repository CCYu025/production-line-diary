import * as React from "react";

export interface StationFrameProps {
  /** 頻道代號（右上角台標） */
  tag: string;
  onBack: () => void;
  onSkipToMain: () => void;
  children: React.ReactNode;
}

/**
 * 工作站的 CRT 外框（docs/os-mode-spec.md §4.6）：圓角螢幕邊框、左上「◀ HUB」、右上頻道台標。
 * 外框的裝飾（頂列）與 <main> 並排，不與 <main> 的範圍重疊；頁面在 .os-screen 內捲動。
 */
export function StationFrame({ tag, onBack, onSkipToMain, children }: StationFrameProps) {
  return (
    <div className="os-frame" data-os="frame">
      <button type="button" className="os-skip" onClick={onSkipToMain}>
        跳到主要內容
      </button>
      <div className="os-frame-bar" data-os-chrome>
        <button type="button" className="os-back" data-os="back" onClick={onBack}>
          ◀ HUB
        </button>
        {/* data-os="tag"：進入／短轉場的台標在交接點讀這個元素的矩形（getBoundingClientRect 一次），縮到這個位置 */}
        <span className="os-tag" data-os="tag" aria-hidden="true">
          {tag}
        </span>
      </div>
      <div className="os-screen" data-os="screen">
        <div className="os-screen-inner">{children}</div>
      </div>
    </div>
  );
}
