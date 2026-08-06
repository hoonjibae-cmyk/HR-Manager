// 목록 화면의 표 정렬 — 순수 계산부 (React 무관, 테스트 있음).
// 화면 쪽 껍데기는 `components/TableTools.tsx` 의 `useTableSort` / `SortTh` 다.
//
// **정렬 조건을 여러 개 쌓을 수 있다.** 앞선 조건이 같을 때만 다음 조건을 본다 —
// 흔한 표 정렬 규칙 그대로다(예: 부서로 묶고 그 안에서 입사일 역순).

export type SortDir = "asc" | "desc";

/** 정렬 조건 한 개 */
export interface SortState {
  key: string;
  dir: SortDir;
}

/** 정렬 조건 목록 — 앞에 있는 것이 1순위다 */
export type SortKeys = SortState[];

/** 정렬 열을 누를 때 함께 온 수식키 (Shift/Ctrl/⌘ 면 조건을 '추가' 한다) */
export interface SortClickOpts {
  append?: boolean;
}

/** 값이 비었는가 — 0 과 false 는 '빈 값' 이 아니다 */
export const isEmptyValue = (v: any): boolean => v == null || v === "";

/**
 * 값 비교 — **빈 값은 항상 뒤로** 보낸다.
 *
 * ⚠ 이 결과에 방향(-1)을 곱하면 빈 값이 앞으로 튀어나온다. 그래서 `sortRows` 는
 * **빈 값 판정을 방향 적용 밖에서** 먼저 한다. 이 함수를 직접 쓸 때도 같은 점에 주의할 것.
 */
export function compare(a: any, b: any): number {
  const emptyA = isEmptyValue(a);
  const emptyB = isEmptyValue(b);
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  // 날짜는 YYYY-MM-DD 문자열로 넘어오므로 사전순 = 시간순
  return String(a).localeCompare(String(b), "ko");
}

/** 한 건이 정렬 조건인가 — localStorage 에서 온 값을 믿지 않는다 */
export const isSortState = (v: any): v is SortState =>
  !!v && typeof v === "object" && typeof v.key === "string" && (v.dir === "asc" || v.dir === "desc");

/**
 * 저장값 → 정렬 조건 목록.
 *
 * **옛 형식(단일 `{key,dir}`)을 받아 준다** — 다중 정렬을 넣기 전에 기억해 둔 값이
 * 브라우저에 그대로 남아 있다. 그대로 두면 배열인 줄 알고 훑다가 화면이 깨진다.
 */
export function normalizeSort(v: unknown): SortKeys {
  if (Array.isArray(v)) return v.filter(isSortState);
  if (isSortState(v)) return [v]; // 옛 단일 정렬 형식
  return [];
}

/**
 * 열 머리글을 눌렀을 때의 다음 정렬 상태.
 *
 *  · 그냥 클릭 — 이 열 **하나로만** 정렬한다. 같은 열을 다시 누르면
 *    오름차순 → 내림차순 → 원래 순서로 돈다.
 *    (여러 조건이 걸려 있을 때 그냥 클릭하면 **그 열 하나로 갈아 끼운다** —
 *     쌓인 조건을 지우는 길이 있어야 빠져나올 수 있다.)
 *  · **append** (Shift/⌘/Ctrl + 클릭) — 조건을 **뒤에 덧붙인다**.
 *    이미 들어 있는 열이면 오름차순 → 내림차순 → 그 조건만 빼기로 돈다.
 */
export function nextSort(prev: SortKeys, key: string, opts: SortClickOpts = {}): SortKeys {
  const at = prev.findIndex((s) => s.key === key);

  if (!opts.append) {
    // 조건이 여럿이면 먼저 이 열 하나로 좁힌다 (바로 끄면 쌓인 것이 통째로 날아간다)
    if (at < 0 || prev.length > 1) return [{ key, dir: "asc" }];
    return prev[0].dir === "asc" ? [{ key, dir: "desc" }] : [];
  }

  if (at < 0) return [...prev, { key, dir: "asc" }];
  const cur = prev[at];
  if (cur.dir === "asc") return prev.map((s, i) => (i === at ? { key, dir: "desc" as SortDir } : s));
  return prev.filter((_, i) => i !== at);
}

/**
 * 조건 순서대로 정렬한다. 앞선 조건이 같을 때만 다음 조건을 본다.
 * 모든 조건이 같으면 **원래 순서를 지킨다**(Array.sort 는 안정 정렬이다).
 *
 * **빈 값은 오름·내림과 무관하게 언제나 뒤로** 간다 — 방향을 곱하기 *전에* 가려낸다.
 * 내림차순이라고 빈칸이 맨 위로 올라오면 볼 것이 없는 행이 화면 첫 줄을 차지한다.
 * 그리고 둘 다 비었으면 그 조건은 '같다' 로 보고 다음 조건으로 넘어간다.
 */
export function sortRows<T>(rows: T[], pick: (row: T, key: string) => any, sort: SortKeys): T[] {
  if (!sort.length) return rows;
  return [...rows].sort((x, y) => {
    for (const s of sort) {
      const a = pick(x, s.key);
      const b = pick(y, s.key);
      const ea = isEmptyValue(a);
      const eb = isEmptyValue(b);
      if (ea !== eb) return ea ? 1 : -1; // 빈 쪽이 뒤 (방향 무관)
      if (ea) continue; // 둘 다 비었으면 다음 조건을 본다
      const c = compare(a, b);
      if (c !== 0) return s.dir === "asc" ? c : -c;
    }
    return 0;
  });
}

/** 정렬 순서를 사람이 읽는 한 줄로 — 배지 툴팁에 쓴다 */
export function sortOrderLabel(sort: SortKeys, labels?: Record<string, string>): string {
  return sort
    .map((s, i) => `${i + 1}. ${labels?.[s.key] ?? s.key} ${s.dir === "asc" ? "↑" : "↓"}`)
    .join("\n");
}
