"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { won } from "@/lib/format";
import {
  useTableSort,
  useStoredState,
  SortTh,
  FilterSelect,
  FilterBar,
} from "@/components/TableTools";
import type { SeveranceRow, SeveranceTotals } from "@/lib/severance-service";

const STATUS_LABEL: Record<string, string> = {
  DC: "DC 부담금",
  PROVISION: "충당금",
  EXCLUDED: "대상 아님",
  UNKNOWN: "판정 보류",
};

const STATUS_TONE: Record<string, string> = {
  DC: "bg-brand-50 text-brand-700",
  PROVISION: "bg-amber-50 text-amber-700",
  EXCLUDED: "bg-slate-100 text-slate-400",
  UNKNOWN: "bg-rose-50 text-rose-700",
};

export default function SeveranceTable({
  year,
  month,
  rows,
  totals,
  warnings,
}: {
  year: number;
  month: number;
  rows: SeveranceRow[];
  totals: SeveranceTotals;
  warnings: string[];
}) {
  const [q, setQ] = useState("");
  const [dept, setDept, resetDept] = useStoredState("yoossam.table.severance.dept", "");
  const [status, setStatus, resetStatus] = useStoredState("yoossam.table.severance.status", "");
  const [open, setOpen] = useState<SeveranceRow | null>(null);

  const depts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter(Boolean) as string[])).sort(),
    [rows]
  );

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!dept || r.department === dept) &&
          (!status || r.status === status) &&
          (!q || r.name.includes(q) || r.empNo.includes(q))
      ),
    [rows, dept, status, q]
  );

  const { sorted, sort, toggle, resetSort } = useTableSort(
    filtered,
    (r, k) =>
      k === "service"
        ? r.serviceMonths
        : k === "hours"
          ? r.weeklyContractual
          : (r as any)[k],
    "yoossam.table.severance.sort"
  );

  const dirty = !!(dept || status || sort);
  const reset = () => {
    resetDept();
    resetStatus();
    resetSort();
  };

  // 거른 묶음의 소계 — 카드(전체)와 나란히 읽히도록 표 맨 아래 고정 줄에 둔다
  const sub = useMemo(() => {
    let dc = 0;
    let provision = 0;
    let retention = 0;
    for (const r of sorted) {
      if (r.status === "DC") dc += r.amount;
      else if (r.status === "PROVISION") provision += r.amount;
      retention += r.retention;
    }
    return { dc, provision, retention };
  }, [sorted]);

  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card
          label="이번 달 DC 부담금"
          value={won(totals.dc)}
          sub={`${totals.dcCount}명 · 실제 납입`}
          tone="brand"
        />
        <Card
          label="이번 달 충당금"
          value={won(totals.provision)}
          sub={`${totals.provisionCount}명 · 근속 1년 미만`}
          tone="amber"
        />
        <Card
          label="충당금 누계"
          value={won(totals.provisionCumulative)}
          sub="DC 전환 시 소급 납입할 몫"
          tone="amber"
        />
        <Card
          label="인센티브 퇴직유보금"
          value={won(totals.retention)}
          sub="별도 통장 송금분 (기존)"
          tone="slate"
        />
      </div>

      {(warnings.length > 0 || totals.unknownCount > 0 || totals.noPayrollCount > 0) && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 mb-4 space-y-1">
          {totals.unknownCount > 0 && (
            <div>
              ⚠ <b>{totals.unknownCount}명</b>은 근로시간표가 없어 <b>판정을 보류</b>했습니다 —
              주 소정근로시간을 모르면 초단시간(주 15시간 미만)인지 가릴 수 없습니다. 직원 정보에
              근로시간표를 넣어 주세요. <b>제외가 아니라 미판정</b>이므로 그대로 두면 적립이 빠집니다.
            </div>
          )}
          {totals.noPayrollCount > 0 && (
            <div>
              ⚠ 대상자 중 <b>{totals.noPayrollCount}명</b>은 이 달 급여가 아직 산정되지 않아 금액이
              0원입니다. 급여를 산정하면 자동으로 채워집니다.
            </div>
          )}
          {warnings.slice(0, 3).map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
          {warnings.length > 3 && <div className="text-amber-600">…외 {warnings.length - 3}건</div>}
        </div>
      )}

      <div className="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <FilterBar shown={sorted.length} total={rows.length} onReset={reset} dirty={dirty}>
          <input
            className="input py-1 text-xs w-40"
            placeholder="이름·사번 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <FilterSelect
            label="부서"
            value={dept}
            onChange={setDept}
            options={depts.map((d) => ({ value: d, label: d }))}
          />
          <FilterSelect
            label="구분"
            value={status}
            onChange={setStatus}
            options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </FilterBar>

        <div className="flex-1 min-h-0 overflow-auto">
          <table className="table">
            <thead className="sticky-head">
              <SortHead sort={sort} onSort={toggle} />
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.employeeId}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => setOpen(r)}
                >
                  <td className="td">
                    <Link
                      href={`/employees/${r.employeeId}`}
                      className="font-medium text-slate-700 hover:text-brand-600"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.name}
                    </Link>
                    <div className="text-[11px] text-slate-400">{r.empNo}</div>
                  </td>
                  <td className="td text-slate-500">{r.department ?? "—"}</td>
                  <td className="td text-slate-500">{r.paySchemeLabel}</td>
                  <td className="td text-slate-500 tnum">{r.hireDate}</td>
                  <td className="td text-slate-500 tnum">{r.serviceLabel}</td>
                  <td className="td text-right text-slate-500 tnum">
                    {r.status === "UNKNOWN" ? "—" : `${r.weeklyContractual}h`}
                  </td>
                  <td className="td">
                    <span className={`pill ${STATUS_TONE[r.status]}`} title={r.statusReason}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="td text-right tnum text-slate-500">
                    {r.noPayroll ? (
                      <span className="text-slate-300">급여 미산정</span>
                    ) : (
                      won(r.base)
                    )}
                  </td>
                  <td className="td text-right tnum font-semibold text-slate-800">
                    {r.amount ? won(r.amount) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-right tnum text-slate-500">
                    {r.retention ? won(r.retention) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-right tnum text-slate-500">
                    {r.cumulative ? won(r.cumulative) : <span className="text-slate-300">—</span>}
                    {r.cumulativeProvision > 0 && r.status === "DC" && (
                      <div
                        className="text-[11px] text-amber-600"
                        title="DC 가입 전 기간에 쌓은 충당금 — 소급 납입 대상입니다"
                      >
                        소급 {won(r.cumulativeProvision)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!sorted.length && (
                <tr>
                  <td className="td text-center text-slate-400 py-8" colSpan={11}>
                    해당하는 직원이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
            {sorted.length > 0 && (
              <tfoot className="sticky-foot">
                <tr>
                  <td className="td font-semibold text-slate-600" colSpan={8}>
                    {dirty ? "거른 묶음 소계" : "합계"}
                  </td>
                  <td className="td text-right tnum font-bold text-slate-800">
                    {won(sub.dc + sub.provision)}
                  </td>
                  <td className="td text-right tnum text-slate-600">{won(sub.retention)}</td>
                  <td className="td" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {open && <DetailPanel row={open} year={year} month={month} onClose={() => setOpen(null)} />}
    </>
  );
}

function SortHead({ sort, onSort }: { sort: any; onSort: (k: string) => void }) {
  return (
    <tr>
      <SortTh label="성명" sortKey="name" sort={sort} onSort={onSort} />
      <SortTh label="부서" sortKey="department" sort={sort} onSort={onSort} />
      <SortTh label="급여형태" sortKey="payScheme" sort={sort} onSort={onSort} />
      <SortTh label="입사일" sortKey="hireDate" sort={sort} onSort={onSort} />
      <SortTh label="근속" sortKey="service" sort={sort} onSort={onSort} />
      <SortTh label="주 소정" sortKey="hours" sort={sort} onSort={onSort} align="right" />
      <SortTh label="구분" sortKey="status" sort={sort} onSort={onSort} />
      <SortTh
        label="산정기준 임금"
        sortKey="base"
        sort={sort}
        onSort={onSort}
        align="right"
        title="계약서에 합의된 월 급여총액 — 포괄임금 약정 시간외·야간은 포함, 상여·인센티브·그 달 발생한 오버타임은 제외 (설정에 따라 다름)"
      />
      <SortTh label="이번 달 적립" sortKey="amount" sort={sort} onSort={onSort} align="right" />
      <SortTh
        label="인센티브 유보금"
        sortKey="retention"
        sort={sort}
        onSort={onSort}
        align="right"
        title="인센티브 원천액의 1/12 — 별도 통장으로 송금하는 기존 적립분"
      />
      <SortTh label="누계" sortKey="cumulative" sort={sort} onSort={onSort} align="right" />
    </tr>
  );
}

function Card({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "brand" | "amber" | "slate";
}) {
  const tones = {
    brand: "bg-brand-50 border-brand-100 text-brand-700",
    amber: "bg-amber-50 border-amber-100 text-amber-700",
    slate: "bg-slate-50 border-slate-200 text-slate-600",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-xl font-bold tnum mt-1">{value}</div>
      <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>
    </div>
  );
}

/** 한 사람의 산정 근거 — 무엇을 넣고 무엇을 뺐는지 그대로 펼친다 */
function DetailPanel({
  row,
  year,
  month,
  onClose,
}: {
  row: SeveranceRow;
  year: number;
  month: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="card w-full max-w-lg my-8 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-bold text-slate-800 text-lg">
              {row.name} · {year}년 {month}월
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {row.paySchemeLabel} · 입사 {row.hireDate} · 근속 {row.serviceLabel}
            </p>
          </div>
          <button className="btn-ghost" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className={`rounded-lg p-3 text-sm mb-4 ${STATUS_TONE[row.status]}`}>
          <b>{STATUS_LABEL[row.status]}</b>
          <div className="text-xs mt-1 opacity-90">{row.statusReason}</div>
        </div>

        {row.noPayroll ? (
          <p className="text-sm text-slate-500">
            이 달 급여가 아직 산정되지 않았습니다. 급여를 산정하면 적립액이 자동으로 채워집니다.
          </p>
        ) : (
          <>
            <table className="w-full text-sm mb-4">
              <tbody>
                {row.included.map(([label, v]) => (
                  <tr key={label} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-500">{label}</td>
                    <td className="py-1.5 text-right tnum">{won(v)}</td>
                  </tr>
                ))}
                <tr className="border-b-2 border-slate-200">
                  <td className="py-1.5 font-semibold">산정기준 임금</td>
                  <td className="py-1.5 text-right tnum font-semibold">{won(row.base)}</td>
                </tr>
                <tr>
                  <td className="py-2 font-semibold text-brand-700">
                    ÷ 12 = {row.status === "DC" ? "DC 부담금" : "충당금"}
                  </td>
                  <td className="py-2 text-right tnum font-bold text-brand-700 text-base">
                    {won(row.amount)}
                  </td>
                </tr>
              </tbody>
            </table>

            {row.excluded.length > 0 && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs mb-4">
                <div className="font-semibold text-slate-600 mb-1.5">산정기준에서 뺀 항목</div>
                {row.excluded.map(([label, v, why]) => (
                  <div key={label} className="flex justify-between gap-3 py-0.5">
                    <span className="text-slate-500">
                      {label} <span className="text-slate-400">({why})</span>
                    </span>
                    <span className="tnum text-slate-400">{won(v)}</span>
                  </div>
                ))}
              </div>
            )}

            {row.warning && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 mb-4">
                ⚠ {row.warning}
              </div>
            )}
          </>
        )}

        <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-1">
          <Line label="충당금 누계 (근속 1년 미만분)" value={won(row.cumulativeProvision)} />
          <Line label="DC 부담금 누계" value={won(row.cumulativeDc)} />
          <Line label="합계" value={won(row.cumulative)} bold />
          {row.retention > 0 && (
            <Line label="이 달 인센티브 퇴직유보금 (별도 통장)" value={won(row.retention)} />
          )}
          {row.cumulativeProvision > 0 && (
            <p className="text-slate-400 pt-1 leading-relaxed">
              계속근로가 1년을 넘기면 퇴직급여는 <b>입사일부터 전체 기간</b>에 대해 지급 의무가
              생깁니다(근로자퇴직급여보장법 §8①). 위 충당금 누계가 <b>DC 가입 시 소급 납입할 몫</b>
              입니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "font-semibold text-slate-700" : ""}`}>
      <span className={bold ? "" : "text-slate-500"}>{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
}
