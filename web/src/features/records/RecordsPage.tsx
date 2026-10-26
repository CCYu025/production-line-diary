import { hasActiveFilter } from "@shared/aggregate";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useRecordFilterParams } from "@/lib/urlQuery";

/** 空殼（WP3a 實作）。目前只示範「篩選條件 ⇄ 網址 query」：試試看 #/records?status=待處理&equipment=F3 */
export function RecordsPage() {
  const [filter, setFilter] = useRecordFilterParams();
  const active = hasActiveFilter(filter);

  return (
    <>
      <PageHeader title="紀錄列表" description="新介面預覽版：這一頁尚未實作（預計於 WP3a 完成）。" />
      <div className="rounded-lg border border-dashed border-line-strong bg-surface p-6">
        <p className="font-bold">篩選條件會同步到網址</p>
        <p className="mt-1 text-sm text-ink-muted">
          {active
            ? "目前從網址讀到的條件如下；重新整理或按瀏覽器上一頁都會保留。"
            : "目前沒有任何條件。按下面的按鈕會把條件寫進網址（#/records?…）。"}
        </p>
        <pre className="num mt-3 overflow-x-auto rounded-md bg-page p-3 text-xs text-ink-2">
          {JSON.stringify(filter, null, 2)}
        </pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setFilter((f) => ({ ...f, status: "待處理" }))}>
            只看待處理
          </Button>
          <Button size="sm" onClick={() => setFilter((f) => ({ ...f, equipment: [...f.equipment, "F3"] }))}>
            加選設備 F3
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFilter({ ...filter, status: "", equipment: [] })}>
            清除條件
          </Button>
        </div>
      </div>
    </>
  );
}
