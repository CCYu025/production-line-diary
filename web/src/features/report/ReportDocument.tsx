import { aggregate } from "@shared/aggregate";
import * as React from "react";
import { photoUrl } from "@/lib/api";
import type { DiaryRecord } from "@/lib/types";
import {
  buildRankTable,
  dayHeader,
  groupByDay,
  photoGridClass,
  rangeLabel,
  type RankTable,
  type ReportRange,
} from "./reportModel";
import "./report.css";

/*
 * 報表本體（舊 UI 的 #report-output）。報紙式版面全部在 report.css，這裡只負責結構——
 * class 名稱與 DOM 結構刻意和舊報表完全一致，「開新視窗」直接複製這個元素的 outerHTML。
 * 欄位規則（來自 docs/refactor-plan.md §2）：
 *   - 品號／原料類別「有值才顯示」（原材區、RB2 沒有品號，顯示「—」會像資料漏填）
 *   - 日期分組標題只有跨多天才加（單日報表封面已寫日期）
 *   - 「處理」「根本原因」全文，.txt 是 white-space: pre-wrap
 *   - 圖說前面一律有「圖N」編號
 */

export interface ReportData extends ReportRange {
  /** 範圍內的有效紀錄，已依時間排序（舊 → 新） */
  records: DiaryRecord[];
  /** 產出時間，已格式化（M/D HH:MM） */
  generatedAt: string;
}

function Kpi({ label, value, unit }: { label: string; value: string | number; unit: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value}
        <span className="unit">{unit}</span>
      </div>
      <div className="kpi-sub" />
    </div>
  );
}

function RankBlock({ title, unitWord, table }: { title: string; unitWord: string; table: RankTable }) {
  return (
    <section className="rank-blk">
      <h4>
        <span>{title}</span>
        <em>
          共 {table.totalItems} {unitWord}
          {table.rest ? `・前 ${table.top.length} 名` : ""}
        </em>
      </h4>
      {/* 排行表用 grid，不是 <table>（理由見 report.css）；用 ARIA role 補上表格語意 */}
      <div className="rank-tb" role="table" aria-label={`${title}排行`}>
        <div className="rr hd" role="row">
          <span role="columnheader" aria-label="名次" />
          <span role="columnheader">項目</span>
          <span className="bar" aria-hidden="true" />
          <span className="n" role="columnheader">
            次數
          </span>
          <span className="p" role="columnheader">
            占比
          </span>
          <span className="mn" role="columnheader">
            累計耗時
          </span>
        </div>
        {[...table.top, ...(table.rest ? [table.rest] : [])].map((r) => (
          <div key={r.isRest ? "rest" : r.rank} className={r.isRest ? "rr rest" : "rr"} role="row">
            <span className="rk" role="cell">
              {r.rank}
            </span>
            <span className="nm" role="cell" title={r.label}>
              {r.label}
            </span>
            <span className="bar" role="cell" aria-hidden="true">
              {r.barPct === null ? null : <i style={{ width: `${r.barPct}%` }} />}
            </span>
            <span className="n" role="cell">
              {r.count}
              <small>次</small>
            </span>
            <span className="p" role="cell">
              {r.pct}%
            </span>
            <span className="mn" role="cell">
              {Number(r.minutes).toLocaleString()}
              <small>分</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="f">
      <div className="k">{label}</div>
      <div className={className ? `v ${className}` : "v"}>{children}</div>
    </div>
  );
}

function TextBlock({ label, text }: { label: string; text: string | null | undefined }) {
  return (
    <div className="rr-block">
      <div className="k">{label}</div>
      <p className={text ? "txt" : "txt none"}>{text || "（未填寫）"}</p>
    </div>
  );
}

function ReportRecord({ r }: { r: DiaryRecord }) {
  const photos = r.photos ?? [];
  const gridClass = photoGridClass(photos.length);
  const captions = r.photoCaptions ?? {};
  return (
    <article className="report-record">
      <div className="rr-strip">
        <div>
          <div className="k">時間</div>
          <div className="v t">
            <span>{r.date}</span>
            {r.time}
          </div>
        </div>
        <div>
          <div className="k">設備</div>
          <div className="v">{r.equipment}</div>
        </div>
        <div>
          <div className="k">分類</div>
          <div className="v">{r.category}</div>
        </div>
      </div>
      <div className="rr-cols">
        <aside className="rr-side">
          <Fact label="班別">{r.shift}</Fact>
          <Fact label="耗時" className="m">
            {r.duration}
            <small>分</small>
          </Fact>
          <Fact label="處理狀態">{r.status}</Fact>
          <Fact label="嚴重度">
            <span className="rr-sev">
              <i data-sev={r.severity} />
              {r.severity}
            </span>
          </Fact>
          {r.productCode ? <Fact label="品號">{r.productCode}</Fact> : null}
          {r.materialCategory ? <Fact label="原料類別">{r.materialCategory}</Fact> : null}
        </aside>
        <div className="rr-main">
          <h3 className="rr-head">{r.problem}</h3>
          <TextBlock label="處理" text={r.action} />
          <TextBlock label="根本原因" text={r.rootCause} />
          {gridClass ? (
            <div className={`rr-photos ${gridClass}`}>
              {photos.map((filename, i) => (
                <figure className="rp-item" key={filename}>
                  <img src={photoUrl(r.date, filename)} alt={captions[filename] || `圖${i + 1}`} />
                  <figcaption className="rp-cap">
                    <span className="fn">圖{i + 1}</span>
                    {captions[filename] ?? ""}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function RecordDetails({ records }: { records: DiaryRecord[] }) {
  const groups = groupByDay(records);
  const multiDay = groups.length > 1;
  return (
    <div id="report-records">
      <div className="report-sec">
        <span>紀錄明細</span>
        <span>共 {records.length} 筆</span>
      </div>
      {groups.map((g) => {
        const header = multiDay ? dayHeader(g) : null;
        return (
          <React.Fragment key={g.date}>
            {header ? (
              <div className="report-day">
                <span className="dd">{header.title}</span>
                <span className="dm">{header.summary}</span>
              </div>
            ) : null}
            {g.records.map((r) => (
              <ReportRecord key={r.id} r={r} />
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/**
 * 報表。`ref` 指到最外層 #report-output（「開新視窗」要複製它的 outerHTML）。
 * 統計用 `aggregate(records, "all")`——records 已經是範圍內的有效紀錄，所以範圍用 "all"。
 */
export const ReportDocument = React.forwardRef<HTMLDivElement, { data: ReportData }>(function ReportDocument(
  { data },
  ref,
) {
  const { records, generatedAt } = data;
  const agg = React.useMemo(() => aggregate(records, "all"), [records]);
  const categoryTable = React.useMemo(() => buildRankTable(agg.categoryRanked, agg.totalEvents), [agg]);
  const equipmentTable = React.useMemo(() => buildRankTable(agg.equipmentRanked, agg.totalEvents), [agg]);
  const label = rangeLabel(data);

  if (!records.length) {
    return (
      <div id="report-output" ref={ref}>
        <div className="report-header">
          <h2>設備紀錄表</h2>
          <div className="meta">
            日期範圍：{label}　產出時間：{generatedAt}
          </div>
        </div>
        <div className="report-empty">這段日期範圍內沒有紀錄</div>
      </div>
    );
  }

  return (
    <div id="report-output" ref={ref}>
      <div className="report-header">
        <h2>設備紀錄表</h2>
        <div className="meta">
          日期範圍：{label}　共 {records.length} 筆　產出時間：{generatedAt}
        </div>
      </div>
      <div className="report-summary">
        <Kpi label="事件數" value={agg.totalEvents} unit="筆" />
        <Kpi label="累計時間" value={agg.totalMinutes} unit="分" />
        <Kpi label="平均耗時" value={agg.avg.toFixed(1)} unit="分/件" />
        <Kpi label="追蹤中" value={agg.trackingRows.length} unit="筆" />
      </div>
      <div className="report-stats">
        <RankBlock title="問題分類" unitWord="類" table={categoryTable} />
        <RankBlock title="設備" unitWord="台" table={equipmentTable} />
      </div>
      <RecordDetails records={records} />
    </div>
  );
});
