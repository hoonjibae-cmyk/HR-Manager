"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Pill, Empty } from "@/components/ui";
import { INCOME_TYPE_LABEL, PAY_SCHEME_LABEL } from "@/lib/constants";
import { won } from "@/lib/format";
import { useTableSort, SortTh, FilterSelect, FilterBar } from "@/components/TableTools";

export interface EmployeeRow {
  id: number;
  empNo: string;
  name: string;
  department: string | null;
  position: string | null;
  incomeType: string;
  payScheme: string;
  baseWage: number;
  ratioPercent: number | null;
  hireDate: string; // YYYY-MM-DD
  resignDate: string | null;
  active: boolean;
  hasSlack: boolean;
  contractIssueCount: number;
}

/** 정렬 키 → 비교할 값 */
function pick(e: EmployeeRow, key: string): any {
  switch (key) {
    case "department":
      return `${e.department ?? ""} ${e.position ?? ""}`.trim();
    case "incomeType":
      return INCOME_TYPE_LABEL[e.incomeType] ?? e.incomeType;
    case "payScheme":
      return PAY_SCHEME_LABEL[e.payScheme] ?? e.payScheme;
    // 비율제는 기준액 개념이 달라(매출 대비 %) 금액과 섞어 줄 세울 수 없다.
    // 금액 기준으로 정렬하고 비율제는 0 으로 모인다.
    case "amount":
      return e.payScheme === "RATIO" ? 0 : e.baseWage;
    case "slack":
      return e.hasSlack;
    case "active":
      return e.active;
    default:
      return (e as any)[key];
  }
}

export default function EmployeeTable({ rows }: { rows: EmployeeRow[] }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [scheme, setScheme] = useState("");
  const [income, setIncome] = useState("");
  const [status, setStatus] = useState("");

  const depts = useMemo(
    () =>
      Array.from(new Set(rows.map((e) => e.department).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b, "ko")
      ),
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((e) => {
      if (dept === "__none" ? !!e.department : dept && e.department !== dept) return false;
      if (scheme && e.payScheme !== scheme) return false;
      if (income && e.incomeType !== income) return false;
      if (status === "active" && !e.active) return false;
      if (status === "resigned" && e.active) return false;
      if (
        needle &&
        ![e.name, e.empNo, e.position, e.department]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))
      )
        return false;
      return true;
    });
  }, [rows, q, dept, scheme, income, status]);

  const { sorted, sort, toggle } = useTableSort(filtered, pick);
  const dirty = !!(q || dept || scheme || income || status);
  const reset = () => {
    setQ("");
    setDept("");
    setScheme("");
    setIncome("");
    setStatus("");
  };

  return (
    <div className="card overflow-hidden">
      <FilterBar shown={filtered.length} total={rows.length} dirty={dirty} onReset={reset}>
        <input
          className="input py-1 text-xs w-40"
          placeholder="이름·사번·직책 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <FilterSelect
          label="부서"
          value={dept}
          onChange={setDept}
          options={[
            ...depts.map((d) => ({ value: d, label: d })),
            { value: "__none", label: "(부서 미지정)" },
          ]}
        />
        <FilterSelect
          label="급여형태"
          value={scheme}
          onChange={setScheme}
          options={Object.entries(PAY_SCHEME_LABEL).map(([v, l]) => ({ value: v, label: l }))}
        />
        <FilterSelect
          label="세무/보험"
          value={income}
          onChange={setIncome}
          options={Object.entries(INCOME_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))}
        />
        <FilterSelect
          label="재직상태"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "재직" },
            { value: "resigned", label: "퇴직" },
          ]}
        />
      </FilterBar>

      {sorted.length === 0 ? (
        <Empty>{rows.length === 0 ? "등록된 직원이 없습니다." : "조건에 맞는 직원이 없습니다."}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <SortTh label="사번" sortKey="empNo" sort={sort} onSort={toggle} />
                <SortTh label="성명" sortKey="name" sort={sort} onSort={toggle} />
                <SortTh label="부서 / 직책" sortKey="department" sort={sort} onSort={toggle} />
                <SortTh label="구분" sortKey="incomeType" sort={sort} onSort={toggle} />
                <SortTh label="급여형태" sortKey="payScheme" sort={sort} onSort={toggle} />
                <SortTh
                  label="기준액"
                  sortKey="amount"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  title="금액 기준 정렬 — 완전비율제는 매출 대비 %라 함께 줄 세우지 않습니다"
                />
                <SortTh label="입사일" sortKey="hireDate" sort={sort} onSort={toggle} />
                <SortTh label="슬랙" sortKey="slack" sort={sort} onSort={toggle} />
                <SortTh label="상태" sortKey="active" sort={sort} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="td tnum text-slate-400">{e.empNo}</td>
                  <td className="td">
                    <Link
                      href={`/employees/${e.id}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {e.name}
                    </Link>
                  </td>
                  <td className="td">
                    <div>{e.department}</div>
                    <div className="text-xs text-slate-400">{e.position}</div>
                    {e.contractIssueCount > 0 && (
                      <div className="text-[11px] text-amber-600 mt-0.5">계약 기간 확인 필요</div>
                    )}
                  </td>
                  <td className="td">
                    <Pill kind={e.incomeType}>{INCOME_TYPE_LABEL[e.incomeType]}</Pill>
                  </td>
                  <td className="td">
                    <Pill kind={e.payScheme}>{PAY_SCHEME_LABEL[e.payScheme]}</Pill>
                  </td>
                  <td className="td text-right tnum">
                    {e.payScheme === "RATIO"
                      ? `${((e.ratioPercent ?? 0) * 100).toFixed(0)}%`
                      : e.payScheme === "HOURLY"
                      ? `${won(e.baseWage)}/h`
                      : `${won(e.baseWage)}`}
                  </td>
                  <td className="td tnum text-slate-500">{e.hireDate}</td>
                  <td className="td">
                    {e.hasSlack ? (
                      <span className="pill bg-emerald-50 text-emerald-700">연동됨</span>
                    ) : (
                      <span className="pill bg-slate-100 text-slate-400">미연동</span>
                    )}
                  </td>
                  <td className="td">
                    {e.active ? <Pill kind="ACTIVE">재직</Pill> : <Pill kind="CANCELED">퇴직</Pill>}
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
