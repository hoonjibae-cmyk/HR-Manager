"use client";

import { useMemo, useState } from "react";

/* 목록 화면 공용 — 열 머리글 클릭 정렬 + 필터 셀렉트.
   명단이 수십 건 규모라 서버를 다시 부르지 않고 브라우저에서 바로 처리한다. */

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

/** 값 비교 — 빈 값은 방향과 무관하게 항상 뒤로 보낸다 */
function compare(a: any, b: any): number {
  const emptyA = a == null || a === "";
  const emptyB = b == null || b === "";
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  // 날짜는 YYYY-MM-DD 문자열로 넘어오므로 사전순 = 시간순
  return String(a).localeCompare(String(b), "ko");
}

/**
 * 정렬 상태와 정렬된 목록.
 * 같은 열을 누를 때마다 오름차순 → 내림차순 → 원래 순서로 돈다.
 */
export function useTableSort<T>(rows: T[], pick: (row: T, key: string) => any) {
  const [sort, setSort] = useState<SortState | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => compare(pick(x, sort.key), pick(y, sort.key)) * dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  const toggle = (key: string) =>
    setSort((s) =>
      s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null
    );

  return { sorted, sort, toggle };
}

/** 정렬 가능한 열 머리글 */
export function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
  align = "left",
  rowSpan,
  colSpan,
  title,
}: {
  label: React.ReactNode;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  className?: string;
  align?: "left" | "right" | "center";
  rowSpan?: number;
  colSpan?: number;
  title?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      className={`th cursor-pointer select-none hover:bg-slate-100 text-${align} ${className}`}
      onClick={() => onSort(sortKey)}
      rowSpan={rowSpan}
      colSpan={colSpan}
      title={title ?? "클릭해서 정렬"}
      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span
        className={`inline-flex items-center gap-1 ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        {label}
        <span className={active ? "text-brand-600" : "text-slate-300"}>
          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </span>
    </th>
  );
}

/** 필터 셀렉트 한 칸 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-slate-400 whitespace-nowrap">{label}</span>
      <select
        className={`input py-1 text-xs w-auto ${value ? "border-brand-300 text-brand-700" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">전체</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 필터 줄 — 초기화 버튼까지 한 묶음 */
export function FilterBar({
  children,
  shown,
  total,
  onReset,
  dirty,
}: {
  children: React.ReactNode;
  shown: number;
  total: number;
  onReset: () => void;
  dirty: boolean;
}) {
  return (
    <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2">
      {children}
      <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">
        {shown === total ? `${total}명` : `${shown} / ${total}명`}
      </span>
      {dirty && (
        <button className="text-xs text-slate-400 hover:text-slate-600" onClick={onReset}>
          필터 초기화
        </button>
      )}
    </div>
  );
}
