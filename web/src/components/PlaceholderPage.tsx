import { PageHeader } from "@/components/PageHeader";

/** 尚未實作的頁面空殼（WP2 只要外殼＋路由；實際內容在 WP3a–d）。 */
export function PlaceholderPage({ title, workPackage }: { title: string; workPackage: string }) {
  return (
    <>
      <PageHeader title={title} description="新介面預覽版：這一頁尚未實作。" />
      <div className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center">
        <p className="font-bold">{title}</p>
        <p className="mt-1 text-sm text-ink-muted">預計於 {workPackage} 完成。舊介面（網址 /）仍可正常使用。</p>
      </div>
    </>
  );
}
