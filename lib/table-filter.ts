// 목록 화면의 표 필터 — 순수 계산부 (React 무관, 테스트 있음).
// 화면 쪽 껍데기는 `components/TableTools.tsx` 의 `FilterSelect` 다.
//
// **필터는 여러 개를 고를 수 있다**(부서 = 교수부 + 조교팀). 고른 것이 하나도 없으면
// '전체' 다 — 빈 배열을 '아무것도 안 보임' 으로 읽으면 화면이 통째로 비어 버린다.

/** 고른 값들. 비어 있으면 '전체' 다 */
export type FilterValues = string[];

/**
 * 저장값 → 고른 값 목록.
 *
 * **옛 형식(단일 문자열)을 받아 준다** — 다중 선택을 넣기 전에 기억해 둔 값이
 * 브라우저에 그대로 남아 있다. `""` 는 '전체' 였으므로 빈 배열이 된다.
 */
export function normalizeFilter(v: unknown): FilterValues {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x !== "");
  if (typeof v === "string") return v === "" ? [] : [v];
  return [];
}

/** 저장된 필터 묶음(`{dept:"교수부", scheme:""}`)을 통째로 배열 형식으로 옮긴다 */
export function normalizeFilterSet<K extends string>(
  keys: readonly K[],
  saved: unknown
): Record<K, FilterValues> {
  const src = (saved ?? {}) as Record<string, unknown>;
  const out = {} as Record<K, FilterValues>;
  for (const k of keys) out[k] = normalizeFilter(src?.[k]);
  return out;
}

/**
 * 이 행이 고른 필터에 걸리는가.
 * 고른 것이 없으면 **모두 통과**시킨다(= 전체).
 */
export function matchesFilter(selected: FilterValues, value: string | null | undefined): boolean {
  if (!selected.length) return true;
  return value != null && selected.includes(value);
}

/** 체크 하나를 켜고 끈 뒤의 다음 상태 */
export function toggleFilter(selected: FilterValues, value: string): FilterValues {
  return selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value];
}

/** 무엇이든 하나라도 걸려 있는가 — '초기화' 를 띄울지 판단한다 */
export function anyFilterActive(set: Record<string, FilterValues>): boolean {
  return Object.values(set).some((v) => v.length > 0);
}

/**
 * 버튼에 적을 요약 — `전체` / `교수부` / `교수부 외 2`.
 * 고른 것을 다 늘어놓으면 버튼이 줄바꿈되어 필터 줄이 두 층이 된다.
 */
export function filterSummary(
  selected: FilterValues,
  labelOf: (value: string) => string,
  allLabel = "전체"
): string {
  if (!selected.length) return allLabel;
  if (selected.length === 1) return labelOf(selected[0]);
  return `${labelOf(selected[0])} 외 ${selected.length - 1}`;
}
