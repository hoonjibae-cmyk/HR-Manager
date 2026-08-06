"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeSort,
  nextSort,
  sortRows,
  sortOrderLabel,
  type SortClickOpts,
  type SortDir,
  type SortKeys,
  type SortState,
} from "@/lib/table-sort";

// 정렬 계산은 lib/table-sort.ts 에 있다(순수 함수, 테스트 있음). 여기서는 화면만 맡는다.
export { normalizeSort, nextSort, sortRows, sortOrderLabel };
export type { SortClickOpts, SortDir, SortKeys, SortState };

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
 *
 * `normalize` 를 주면 **저장값을 그대로 믿지 않고** 한 번 걸러서 쓴다 —
 * 저장 형식이 바뀐 뒤에도 옛 값이 브라우저에 남아 있어 화면을 깨뜨릴 수 있다.
 */
export function useStoredState<T>(key: string | null, initial: T, normalize?: (v: unknown) => T) {
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
      // { v: ... } 로 감싼다 — 정렬은 빈 값(원래 순서)도 저장할 값이라
      // '저장한 적 없음' 과 구분해야 한다
      if (raw) {
        const saved = JSON.parse(raw).v;
        setValue(normalize ? normalize(saved) : merged(initial, saved));
      }
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

/**
 * 정렬 상태와 정렬된 목록. **정렬 조건을 여러 개 쌓을 수 있다.**
 *
 *  · 그냥 클릭 — 이 열 **하나로만** 정렬한다. 같은 열을 다시 누르면
 *    오름차순 → 내림차순 → 원래 순서로 돈다.
 *  · **Shift(또는 Ctrl/⌘) + 클릭** — 조건을 **뒤에 덧붙인다**. 이미 들어 있는 열이면
 *    오름차순 → 내림차순 → 그 조건만 빼기로 돈다.
 *    (예: 부서 오름차순 → Shift+입사일 내림차순 = 부서별로 묶고 그 안에서 최근 입사 순)
 *
 * 앞선 조건이 같을 때만 다음 조건을 본다 — 흔한 표 정렬 규칙 그대로다.
 * `storageKey` 를 주면 마지막 정렬을 브라우저에 기억해 다음에 올 때 그대로 되살린다.
 */
export function useTableSort<T>(
  rows: T[],
  pick: (row: T, key: string) => any,
  storageKey?: string
) {
  const [sort, setSort, resetSort] = useStoredState<SortKeys>(
    storageKey ?? null,
    [],
    normalizeSort
  );

  const sorted = useMemo(
    () => sortRows(rows, pick, sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sort]
  );

  const toggle = (key: string, opts: SortClickOpts = {}) =>
    setSort((prev) => nextSort(prev, key, opts));

  return { sorted, sort, toggle, resetSort, hasSort: sort.length > 0 };
}

/**
 * 정렬 가능한 열 머리글.
 * 조건이 둘 이상이면 **순번 배지**를 달아 어느 것이 먼저인지 보이게 한다.
 */
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
  sort: SortKeys;
  onSort: (key: string, opts?: SortClickOpts) => void;
  className?: string;
  align?: "left" | "right" | "center";
  rowSpan?: number;
  colSpan?: number;
  title?: string;
}) {
  const at = sort.findIndex((s) => s.key === sortKey);
  const active = at >= 0;
  const dir = active ? sort[at].dir : null;
  const hint = "클릭: 이 열로 정렬 · Shift(⌘/Ctrl)+클릭: 정렬 조건 추가";
  return (
    <th
      className={`th cursor-pointer select-none hover:bg-slate-100 text-${align} ${className}`}
      // 수식키를 누른 채 클릭하면 조건을 덧붙인다 (표 정렬의 흔한 관습)
      onClick={(e) => onSort(sortKey, { append: e.shiftKey || e.metaKey || e.ctrlKey })}
      rowSpan={rowSpan}
      colSpan={colSpan}
      title={title ? `${title}\n${hint}` : hint}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span
        className={`inline-flex items-center gap-1 ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        {label}
        <span className={active ? "text-brand-600" : "text-slate-300"}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
        {/* 조건이 하나뿐이면 순번은 군더더기다 */}
        {active && sort.length > 1 && (
          <span
            className="text-[9px] leading-none font-bold text-brand-600 bg-brand-50 rounded px-1 py-0.5"
            title={`정렬 ${at + 1}순위`}
          >
            {at + 1}
          </span>
        )}
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
  sort,
  sortLabels,
}: {
  children: React.ReactNode;
  shown: number;
  total: number;
  onReset: () => void;
  dirty: boolean;
  unit?: string;
  /** 정렬 조건 — 둘 이상이면 몇 단계인지 배지로 알린다 */
  sort?: SortKeys;
  /** 정렬키 → 사람이 읽는 열 이름. 배지 툴팁에 순서를 풀어 쓴다 */
  sortLabels?: Record<string, string>;
}) {
  // 조건이 하나뿐이면 머리글 화살표만으로 충분하다 — 배지는 여러 단계일 때만 뜻이 있다
  const multi = (sort?.length ?? 0) > 1;
  const order = multi ? sortOrderLabel(sort!, sortLabels) : "";
  return (
    <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2">
      {children}
      <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">
        {shown === total ? `${total}${unit}` : `${shown} / ${total}${unit}`}
      </span>
      {multi && (
        <span
          className="pill bg-brand-50 text-brand-600 whitespace-nowrap"
          title={`정렬 순서\n${order}\n\n열 머리글을 Shift(⌘/Ctrl)+클릭하면 조건을 더할 수 있습니다.`}
        >
          정렬 {sort!.length}단계
        </span>
      )}
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
