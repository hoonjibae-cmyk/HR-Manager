import { describe, it, expect } from "vitest";
import {
  compare,
  normalizeSort,
  nextSort,
  sortRows,
  sortOrderLabel,
  type SortKeys,
} from "./table-sort";

/** 부서·입사일·이름 — 다중 정렬을 보기 좋은 표본 */
const rows = [
  { name: "김가", dept: "교수부", hire: "2025-03-01", pay: 3_000_000 },
  { name: "박나", dept: "조교팀", hire: "2024-01-01", pay: 2_000_000 },
  { name: "이다", dept: "교수부", hire: "2026-01-01", pay: 3_000_000 },
  { name: "최라", dept: "교수부", hire: "2024-05-01", pay: 4_000_000 },
  { name: "정마", dept: "조교팀", hire: "2026-02-01", pay: 2_000_000 },
];
const pick = (r: (typeof rows)[number], k: string) => (r as any)[k];
const names = (list: typeof rows) => list.map((r) => r.name);

describe("compare — 빈 값은 방향과 무관하게 뒤로", () => {
  it("숫자·문자·불리언", () => {
    expect(compare(1, 2)).toBeLessThan(0);
    expect(compare("나", "가")).toBeGreaterThan(0);
    expect(compare(false, true)).toBeLessThan(0);
  });

  it("빈 값은 언제나 뒤 — 내림차순이라고 빈칸이 위로 오면 안 된다", () => {
    expect(compare(null, 1)).toBeGreaterThan(0);
    expect(compare(1, null)).toBeLessThan(0);
    expect(compare("", "가")).toBeGreaterThan(0);
    expect(compare(null, undefined)).toBe(0);
  });
});

describe("normalizeSort — 저장값을 믿지 않는다", () => {
  it("배열은 그대로", () => {
    const v = [{ key: "name", dir: "asc" }];
    expect(normalizeSort(v)).toEqual(v);
  });

  it("**옛 단일 정렬 형식**을 배열로 받아 준다", () => {
    // 다중 정렬을 넣기 전에 기억해 둔 값이 브라우저에 그대로 남아 있다
    expect(normalizeSort({ key: "name", dir: "desc" })).toEqual([{ key: "name", dir: "desc" }]);
  });

  it("망가진 값은 버린다", () => {
    expect(normalizeSort(null)).toEqual([]);
    expect(normalizeSort("asc")).toEqual([]);
    expect(normalizeSort({ key: "name" })).toEqual([]);
    expect(normalizeSort({ key: "name", dir: "sideways" })).toEqual([]);
    expect(normalizeSort([{ key: "name", dir: "asc" }, null, { nope: 1 }])).toEqual([
      { key: "name", dir: "asc" },
    ]);
  });
});

describe("nextSort — 그냥 클릭", () => {
  it("처음 누르면 오름차순", () => {
    expect(nextSort([], "name")).toEqual([{ key: "name", dir: "asc" }]);
  });

  it("오름 → 내림 → 원래 순서", () => {
    let s: SortKeys = nextSort([], "name");
    s = nextSort(s, "name");
    expect(s).toEqual([{ key: "name", dir: "desc" }]);
    s = nextSort(s, "name");
    expect(s).toEqual([]);
  });

  it("다른 열을 누르면 그 열 하나로 갈아 끼운다", () => {
    const s = nextSort([{ key: "name", dir: "desc" }], "dept");
    expect(s).toEqual([{ key: "dept", dir: "asc" }]);
  });

  it("**조건이 여럿일 때는 먼저 하나로 좁힌다** — 쌓인 것에서 빠져나올 길", () => {
    const many: SortKeys = [
      { key: "dept", dir: "asc" },
      { key: "hire", dir: "desc" },
    ];
    // 이미 들어 있는 열을 그냥 눌러도 바로 끄지 않고 그 열 하나만 남긴다
    expect(nextSort(many, "dept")).toEqual([{ key: "dept", dir: "asc" }]);
  });
});

describe("nextSort — Shift+클릭으로 조건 쌓기", () => {
  const append = { append: true };

  it("없는 열이면 뒤에 덧붙인다", () => {
    const s = nextSort([{ key: "dept", dir: "asc" }], "hire", append);
    expect(s).toEqual([
      { key: "dept", dir: "asc" },
      { key: "hire", dir: "asc" },
    ]);
  });

  it("이미 있는 열이면 **자리를 지키며** 방향만 뒤집는다", () => {
    const s = nextSort(
      [
        { key: "dept", dir: "asc" },
        { key: "hire", dir: "asc" },
      ],
      "dept",
      append
    );
    // 1순위가 그대로 dept 여야 한다 — 뒤로 밀리면 정렬 결과가 통째로 바뀐다
    expect(s).toEqual([
      { key: "dept", dir: "desc" },
      { key: "hire", dir: "asc" },
    ]);
  });

  it("내림차순에서 한 번 더 누르면 **그 조건만** 빠진다", () => {
    const s = nextSort(
      [
        { key: "dept", dir: "desc" },
        { key: "hire", dir: "asc" },
      ],
      "dept",
      append
    );
    expect(s).toEqual([{ key: "hire", dir: "asc" }]);
  });

  it("세 단계까지 쌓인다", () => {
    let s = nextSort([], "dept", append);
    s = nextSort(s, "pay", append);
    s = nextSort(s, "name", append);
    expect(s.map((x) => x.key)).toEqual(["dept", "pay", "name"]);
  });
});

describe("sortRows — 앞선 조건이 같을 때만 다음을 본다", () => {
  it("조건이 없으면 원래 순서 그대로 (같은 배열을 돌려준다)", () => {
    expect(sortRows(rows, pick, [])).toBe(rows);
  });

  it("한 조건", () => {
    expect(names(sortRows(rows, pick, [{ key: "hire", dir: "asc" }]))).toEqual([
      "박나",
      "최라",
      "김가",
      "이다",
      "정마",
    ]);
  });

  it("**부서로 묶고 그 안에서 최근 입사 순**", () => {
    const s: SortKeys = [
      { key: "dept", dir: "asc" },
      { key: "hire", dir: "desc" },
    ];
    expect(names(sortRows(rows, pick, s))).toEqual(["이다", "김가", "최라", "정마", "박나"]);
  });

  it("1순위를 뒤집으면 묶음 순서만 바뀌고 안쪽은 그대로", () => {
    const s: SortKeys = [
      { key: "dept", dir: "desc" },
      { key: "hire", dir: "desc" },
    ];
    expect(names(sortRows(rows, pick, s))).toEqual(["정마", "박나", "이다", "김가", "최라"]);
  });

  it("2순위까지 같으면 3순위를 본다", () => {
    const s: SortKeys = [
      { key: "dept", dir: "asc" },
      { key: "pay", dir: "asc" },
      { key: "name", dir: "desc" },
    ];
    // 교수부 300만: 김가·이다 → 이름 내림차순이라 이다가 먼저
    expect(names(sortRows(rows, pick, s)).slice(0, 2)).toEqual(["이다", "김가"]);
  });

  it("모든 조건이 같으면 원래 순서를 지킨다 (안정 정렬)", () => {
    const same = [
      { name: "가", dept: "A" },
      { name: "나", dept: "A" },
      { name: "다", dept: "A" },
    ];
    const out = sortRows(same, (r, k) => (r as any)[k], [{ key: "dept", dir: "desc" }]);
    expect(out.map((r) => r.name)).toEqual(["가", "나", "다"]);
  });

  it("원본 배열을 건드리지 않는다", () => {
    const before = names(rows);
    sortRows(rows, pick, [{ key: "name", dir: "desc" }]);
    expect(names(rows)).toEqual(before);
  });

  it("빈 값이 섞여도 방향과 무관하게 뒤로 간다", () => {
    const mixed = [{ v: 3 }, { v: null }, { v: 1 }];
    const p = (r: any, k: string) => r[k];
    expect(sortRows(mixed, p, [{ key: "v", dir: "asc" }]).map((r) => r.v)).toEqual([1, 3, null]);
    expect(sortRows(mixed, p, [{ key: "v", dir: "desc" }]).map((r) => r.v)).toEqual([3, 1, null]);
  });
});

describe("sortOrderLabel", () => {
  it("순번·열 이름·방향을 한 줄씩", () => {
    const s: SortKeys = [
      { key: "dept", dir: "asc" },
      { key: "hire", dir: "desc" },
    ];
    expect(sortOrderLabel(s, { dept: "부서", hire: "입사일" })).toBe("1. 부서 ↑\n2. 입사일 ↓");
  });

  it("이름을 모르는 열은 키를 그대로 쓴다", () => {
    expect(sortOrderLabel([{ key: "weird", dir: "asc" }])).toBe("1. weird ↑");
  });
});
