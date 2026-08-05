"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* 목록 화면 공용 — 열 머리글 클릭 정렬 + 필터 셀렉트.
   명단이 수십 건 규모라 서버를 다시 부르지 않고 브라우저에서 바로 처리한다. */

/* ==================== 화면 설정 기억하기 ==================== */

const STORE_PREFIX = "yoossam.table.";

/** 저장값에 없는 항목은 기본값으로 메운다 — 나중에 필터가 늘어도 옛 저장값이 깨지지 않는다 */
function merged<T>(initial: T, saved: unknown): T {
  const plain = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  return plain(initial) && plain(saved) ? ({ ...(initial as any), ...(saved as any) } as T) : (saved as T);
}

/**
 * 화면 설정(필터·정렬)을 **브라우저에** 기억해 다음에 올 때 그대로 되살린다.
 *
 * 서버가 아니라 localStorage 에 두는 이유: 관리자 로그인이 비밀번호 공유 방식이라
 * 서버에 저장하면 **모두가 같은 값**을 쓰게 된다. 브라우저에 두어야 쓰는 사람마다 자기 설정이 된다.
 * (계정 모델이 생기면 그때 서버로 옮긴다.)
 *
 * 첫 그림은 반드시 기본값으로 그린다 — 서버가 그린 HTML 과 달라지면 하이드레이션이 어긋난다.
 * 화면이 붙은 뒤에 저장값을 얹으므로 아주 잠깐 기본 상태가 보였다가 바뀐다.
 *
 * `key` 가 없으면 그냥 useState 처럼 동작한다(기억하지 않는다).
 */
export function useStoredState<T>(key: string | null, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  // 기본값은 첫 렌더 것으로 고정한다 — 객체 리터럴이면 매 렌더 새로 만들어지기 때문
  const base = useRef(initial);
  const isDefault = (v: T) => JSON.stringify(v) === JSON.stringify(base.current);

  useEffect(() => {
    if (!key) {
      setLoaded(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(STORE_PREFIX + key);
      // { v: ... } 로 감싼다 — 정렬은 null(원래 순서)도 저장할 값이라
      // '저장한 적 없음' 과 구분해야 한다
      if (raw) setValue(merged(initial, JSON.parse(raw).v));
    } catch {}
    setLoaded(true);
    // initial 은 매 렌더 새 객체일 수 있어 의존성에서 뺀다 (첫 렌더 값을 쓴다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!loaded || !key) return;
    try {
      // 기본값으로 돌아왔으면 아예 지운다 — 안 그러면 '초기화' 직후 이 이펙트가
      // 기본값을 도로 써 넣어 기억해 둔 것이 영영 사라지지 않는다
      if (isDefault(value)) window.localStorage.removeItem(STORE_PREFIX + key);
      else window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify({ v: value }));
    } catch {
      // 사파리 비공개 모드 등 저장이 막힌 경우 — 기억만 못 할 뿐 화면은 그대로 쓴다
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, loaded]);

  /** 기본값으로 되돌리고 기억해 둔 것도 지운다 */
  const clear = useCallback(() => {
    setValue(base.current);
    try {
      if (key) window.localStorage.removeItem(STORE_PREFIX + key);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, setValue, clear] as const;
}

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
 * `storageKey` 를 주면 마지막 정렬을 브라우저에 기억해 다음에 올 때 그대로 되살린다.
 */
export function useTableSort<T>(
  rows: T[],
  pick: (row: T, key: string) => any,
  storageKey?: string
) {
  const [sort, setSort, resetSort] = useStoredState<SortState | null>(storageKey ?? null, null);

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

  return { sorted, sort, toggle, resetSort };
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

/**
 * 필터 줄 — 초기화 버튼까지 한 묶음.
 *
 * 고른 값은 **이 브라우저에 기억**해 다음에 올 때 그대로 되살린다. 그래서 걸러진 화면을
 * 전체인 줄 알고 볼 위험이 있어, 뭔가 걸려 있으면 `기억됨` 표시와 초기화를 함께 띄운다.
 * 이름 검색칸은 기억하지 않는다 — 그때그때 한 사람 찾는 동작이지 기본값이 아니다.
 */
export function FilterBar({
  children,
  shown,
  total,
  onReset,
  dirty,
  unit = "명",
}: {
  children: React.ReactNode;
  shown: number;
  total: number;
  onReset: () => void;
  dirty: boolean;
  unit?: string;
}) {
  return (
    <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2">
      {children}
      <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">
        {shown === total ? `${total}${unit}` : `${shown} / ${total}${unit}`}
      </span>
      {dirty && (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span
            className="pill bg-brand-50 text-brand-600"
            title="필터와 정렬을 이 브라우저에 기억해 뒀습니다. 다음에 들어와도 이대로 보입니다."
          >
            기억됨
          </span>
          <button
            className="text-xs text-slate-400 hover:text-slate-600"
            onClick={onReset}
            title="필터와 정렬을 기본값으로 되돌리고 기억해 둔 것도 지웁니다"
          >
            초기화
          </button>
        </span>
      )}
    </div>
  );
}
