"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Empty } from "@/components/ui";
import CompGrantButton from "@/components/CompGrantButton";
import {
  useTableSort,
  useStoredState,
  SortTh,
  FilterSelect,
  FilterBar,
} from "@/components/TableTools";

export interface LeaveRow {
  id: number;
  name: string;
  department: string | null;
  position: string | null;
  /** 법정 연차 발생 대상인가 */
  eligible: boolean;
  /** 계약에서 미적용으로 못박았는지 (근로시간 자동 판정과 구분해 보여주기 위함) */
  forcedOff: boolean;
  weeklyContractual: number;
  hireDate: string;
  serviceLabel: string;
  /** 근속일수 — 근속 열 정렬용 ("1년 6개월" 같은 라벨은 사전순이 뒤죽박죽이라) */
  serviceDays: number;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  granted: number;
  used: number;
  remaining: number;
  compGranted: number;
  compUsed: number;
  compRemaining: number;
  rangeStatutory: number;
  rangeComp: number;
}

function pick(r: LeaveRow, key: string): any {
  switch (key) {
    case "name":
      return r.name;
    case "department":
      return `${r.department ?? ""} ${r.position ?? ""}`.trim();
    case "service":
      return r.serviceDays;
    case "period":
      return r.periodStart;
    default:
      return (r as any)[key];
  }
}

/** 브라우저에 기억해 두는 필터 — 다음에 들어와도 이대로 걸려 있다 */
const DEFAULT_FILTER = { dept: "", eligible: "" };

export default function LeaveTable({
  rows,
  rangeLabel,
}: {
  rows: LeaveRow[];
  rangeLabel: React.ReactNode;
}) {
  // 이름 검색은 기억하지 않는다 — 그때그때 한 사람 찾는 동작이지 기본값이 아니다
  const [q, setQ] = useState("");
  const [f, setF, clearFilter] = useStoredState("leave.filter", DEFAULT_FILTER);
  const { dept, eligible } = f;
  const set = (k: keyof typeof DEFAULT_FILTER) => (v: string) =>
    setF((p) => ({ ...p, [k]: v }));

  const depts = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.department).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b, "ko")
      ),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (eligible === "yes" && !r.eligible) return false;
      if (eligible === "no" && r.eligible) return false;
      if (dept && r.department !== dept) return false;
      if (needle && !`${r.name}${r.department ?? ""}${r.position ?? ""}`.toLowerCase().includes(needle))
        return false;
      return true;
    });
  }, [rows, q, dept, eligible]);

  const { sorted, sort, toggle, resetSort } = useTableSort(filtered, pick, "leave.sort");
  // 정렬도 기억하므로 '되돌릴 게 있는지' 판단에 함께 넣는다
  const dirty = !!(q || dept || eligible || sort);

  return (
    // 남은 화면 높이를 채우고 행만 안에서 스크롤한다 — 조회 기간·필터 줄과 머리글은 늘 보인다
    <div className="card flex flex-col flex-1 min-h-0">
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <span className="font-bold text-slate-800">직원별 연차 현황</span>
        {rangeLabel}
      </div>

      <FilterBar
        shown={filtered.length}
        total={rows.length}
        dirty={dirty}
        onReset={() => {
          setQ("");
          clearFilter();
          resetSort();
        }}
      >
        <input
          className="input py-1 text-xs w-36"
          placeholder="이름 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <FilterSelect
          label="연차 대상"
          value={eligible}
          onChange={set("eligible")}
          options={[
            { value: "yes", label: "적용 대상" },
            { value: "no", label: "미적용" },
          ]}
        />
        <FilterSelect
          label="부서"
          value={dept}
          onChange={set("dept")}
          options={depts.map((d) => ({ value: d, label: d }))}
        />
      </FilterBar>

      {sorted.length === 0 ? (
        <Empty>
          {rows.length === 0 ? "연차 대상 직원이 없습니다." : "조건에 맞는 직원이 없습니다."}
        </Empty>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky-head">
              <tr>
                <SortTh label="직원" sortKey="name" sort={sort} onSort={toggle} rowSpan={2} />
                <SortTh label="근속" sortKey="service" sort={sort} onSort={toggle} rowSpan={2} />
                <SortTh
                  label="이번 연차기간"
                  sortKey="period"
                  sort={sort}
                  onSort={toggle}
                  rowSpan={2}
                />
                <th className="th text-center border-l border-slate-200" colSpan={3}>
                  본래 연차 <span className="font-normal text-slate-400">(이번 기간)</span>
                </th>
                <th className="th text-center border-l border-slate-200" colSpan={3}>
                  대휴보상연차
                </th>
                <th className="th text-center border-l border-slate-200" colSpan={2}>
                  기간 내 사용
                </th>
                <th className="th" rowSpan={2}></th>
              </tr>
              <tr>
                <SortTh
                  label="발생"
                  sortKey="granted"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  className="border-l border-slate-200"
                />
                <SortTh label="사용" sortKey="used" sort={sort} onSort={toggle} align="right" />
                <SortTh label="잔여" sortKey="remaining" sort={sort} onSort={toggle} align="right" />
                <SortTh
                  label="발생"
                  sortKey="compGranted"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  className="border-l border-slate-200"
                />
                <SortTh label="사용" sortKey="compUsed" sort={sort} onSort={toggle} align="right" />
                <SortTh
                  label="잔여"
                  sortKey="compRemaining"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                />
                <SortTh
                  label="연차"
                  sortKey="rangeStatutory"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  className="border-l border-slate-200"
                />
                <SortTh label="대휴" sortKey="rangeComp" sort={sort} onSort={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="td">
                    <Link
                      href={`/leave/${r.id}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {r.name}
                    </Link>
                    {!r.eligible && (
                      <span className="ml-2 pill bg-slate-100 text-slate-500">연차 미적용</span>
                    )}
                    <div className="text-xs text-slate-400">
                      {r.department} {r.position}
                    </div>
                    {!r.eligible && (
                      <div className="text-[11px] text-slate-400">
                        주 소정 {r.weeklyContractual.toFixed(1)}시간
                        {r.forcedOff ? " · 계약상 미적용" : " · 15시간 미만"}
                      </div>
                    )}
                  </td>
                  <td className="td text-slate-500 text-xs">{r.serviceLabel}</td>
                  <td className="td text-slate-500 text-xs tnum whitespace-nowrap">
                    {r.periodStart} ~ {r.periodEnd}
                    <div className="text-slate-300">{r.periodLabel}</div>
                  </td>
                  <td className="td text-right tnum border-l border-slate-100">{r.granted}</td>
                  <td className="td text-right tnum text-slate-500">{r.used}</td>
                  <td className="td text-right tnum font-bold text-brand-600">{r.remaining}</td>
                  <td className="td text-right tnum border-l border-slate-100">{r.compGranted}</td>
                  <td className="td text-right tnum text-slate-500">{r.compUsed}</td>
                  <td className="td text-right tnum font-bold text-emerald-600">
                    {r.compRemaining}
                  </td>
                  <td className="td text-right tnum border-l border-slate-100">
                    {r.rangeStatutory || "-"}
                  </td>
                  <td className="td text-right tnum">{r.rangeComp || "-"}</td>
                  <td className="td text-right">
                    <CompGrantButton employeeId={r.id} employeeName={r.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
