import * as React from "react";
import { SeverityBadge, StatusBadge } from "@/components/badges";
import { useConfirm } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { notify, toastUndoable } from "@/lib/feedback";
import type { Severity, Status } from "@/lib/types";

const SEVERITIES: Severity[] = ["輕微", "一般", "嚴重", "重大"];
const STATUSES: Status[] = ["待處理", "追蹤中", "已解決"];
// Tailwind 需要在原始碼裡看得到完整的 class 名稱才會產生樣式，所以用對照表而不是字串拼接。
const SWATCHES: Array<[name: string, bg: string]> = [
  ["page", "bg-page"],
  ["surface", "bg-surface"],
  ["surface-raised", "bg-surface-raised"],
  ["ink-1", "bg-ink-1"],
  ["ink-2", "bg-ink-2"],
  ["ink-muted", "bg-ink-muted"],
  ["line", "bg-line"],
  ["line-strong", "bg-line-strong"],
  ["accent", "bg-accent"],
  ["accent-wash", "bg-accent-wash"],
  ["good", "bg-good"],
  ["warning", "bg-warning"],
  ["serious", "bg-serious"],
  ["critical", "bg-critical"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface-raised p-5">
      <h2 className="mb-3 text-sm font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** 設計系統預覽（不在導覽裡，網址 #/_ui）：給開發時目視檢查 token、徽章、toast、確認對話框用。 */
export function UiPreviewPage() {
  const confirm = useConfirm();
  const [lastAnswer, setLastAnswer] = React.useState("尚未操作");

  return (
    <>
      <PageHeader title="元件預覽" description="設計系統的 token 與共用元件（開發用，不在導覽列）。" />
      <div className="flex flex-col gap-4">
        <Section title="嚴重度（顏色）">
          <div className="flex flex-wrap gap-2">
            {SEVERITIES.map((s) => (
              <SeverityBadge key={s} severity={s} />
            ))}
          </div>
        </Section>

        <Section title="處理狀態（形狀 ○ ◐ ●，中性色）">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </Section>

        <Section title="按鈕">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">主要</Button>
            <Button variant="secondary">次要</Button>
            <Button variant="ghost">幽靈</Button>
            <Button variant="destructive">刪除</Button>
            <Button variant="link">連結樣式</Button>
            <Button variant="primary" disabled>
              停用
            </Button>
          </div>
        </Section>

        <Section title="回饋：toast 與確認對話框">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => notify.success("已儲存")}>成功 toast</Button>
            <Button onClick={() => notify.error("儲存失敗：date 格式須為 YYYY-MM-DD、duration 須為正數")}>
              錯誤 toast
            </Button>
            <Button
              onClick={() => {
                const id = notify.loading("正在匯出 Excel…");
                window.setTimeout(() => notify.success("已匯出 Excel", { id }), 1800);
              }}
            >
              進行中 → 成功
            </Button>
            <Button
              onClick={() =>
                toastUndoable({
                  message: "已移到回收桶",
                  onUndo: () => new Promise((resolve) => window.setTimeout(resolve, 300)),
                })
              }
            >
              可撤銷 toast
            </Button>
            <Button
              onClick={async () => {
                const ok = await confirm({
                  title: "永久刪除這筆紀錄？",
                  description: "刪除後無法復原，附帶的照片也會一併刪除。",
                  confirmLabel: "永久刪除",
                  destructive: true,
                });
                setLastAnswer(ok ? "按了「永久刪除」" : "取消");
              }}
            >
              確認對話框
            </Button>
          </div>
          <p className="mt-3 text-sm text-ink-2" aria-live="polite">
            對話框結果：{lastAnswer}
          </p>
        </Section>

        <Section title="色票與數字">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {SWATCHES.map(([name, bg]) => (
              <li key={name} className="flex items-center gap-2 text-xs text-ink-2">
                <span className={`size-7 shrink-0 rounded-sm border border-line-strong ${bg}`} />
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-muted">
            這是 ink-muted 文字（輔助說明）。<span className="num">1234567890 分鐘</span>（等寬數字）
          </p>
        </Section>
      </div>
    </>
  );
}
