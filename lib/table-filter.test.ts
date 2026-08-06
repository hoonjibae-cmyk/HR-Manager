import { describe, it, expect } from "vitest";
import {
  normalizeFilter,
  normalizeFilterSet,
  matchesFilter,
  toggleFilter,
  anyFilterActive,
  filterSummary,
} from "./table-filter";

describe("normalizeFilter — 저장값을 믿지 않는다", () => {
  it("배열은 그대로 (빈 문자열은 버린다)", () => {
    expect(normalizeFilter(["교수부", "조교팀"])).toEqual(["교수부", "조교팀"]);
    expect(normalizeFilter(["교수부", "", null, 3])).toEqual(["교수부"]);
  });

  it("**옛 단일 선택 형식**을 배열로 받아 준다", () => {
    // 다중 선택을 넣기 전에 기억해 둔 값이 브라우저에 그대로 남아 있다
    expect(normalizeFilter("교수부")).toEqual(["교수부"]);
  });

  it("옛 '전체'(빈 문자열)는 빈 배열이다", () => {
    expect(normalizeFilter("")).toEqual([]);
  });

  it("망가진 값은 빈 배열", () => {
    expect(normalizeFilter(null)).toEqual([]);
    expect(normalizeFilter(undefined)).toEqual([]);
    expect(normalizeFilter(42)).toEqual([]);
    expect(normalizeFilter({ dept: "교수부" })).toEqual([]);
  });
});

describe("normalizeFilterSet — 필터 묶음을 통째로 옮긴다", () => {
  const KEYS = ["dept", "scheme", "status"] as const;

  it("옛 형식 묶음을 배열 형식으로", () => {
    expect(normalizeFilterSet(KEYS, { dept: "교수부", scheme: "", status: "active" })).toEqual({
      dept: ["교수부"],
      scheme: [],
      status: ["active"],
    });
  });

  it("저장값에 없는 키는 빈 배열로 메운다 — 나중에 필터가 늘어도 안 깨진다", () => {
    expect(normalizeFilterSet(KEYS, { dept: ["교수부"] })).toEqual({
      dept: ["교수부"],
      scheme: [],
      status: [],
    });
  });

  it("저장값 자체가 없거나 망가져도 안전하다", () => {
    const empty = { dept: [], scheme: [], status: [] };
    expect(normalizeFilterSet(KEYS, null)).toEqual(empty);
    expect(normalizeFilterSet(KEYS, "nope")).toEqual(empty);
  });
});

describe("matchesFilter", () => {
  it("고른 것이 없으면 전부 통과 — 빈 배열은 '전체' 다", () => {
    // 여기를 '아무것도 안 보임' 으로 읽으면 화면이 통째로 빈다
    expect(matchesFilter([], "교수부")).toBe(true);
    expect(matchesFilter([], null)).toBe(true);
  });

  it("고른 값 중 하나면 통과", () => {
    expect(matchesFilter(["교수부", "조교팀"], "조교팀")).toBe(true);
    expect(matchesFilter(["교수부", "조교팀"], "경영지원")).toBe(false);
  });

  it("값이 비어 있으면 (부서 미입력) 필터가 걸린 이상 걸러진다", () => {
    expect(matchesFilter(["교수부"], null)).toBe(false);
    expect(matchesFilter(["교수부"], undefined)).toBe(false);
  });
});

describe("toggleFilter", () => {
  it("없으면 넣고 있으면 뺀다", () => {
    expect(toggleFilter([], "교수부")).toEqual(["교수부"]);
    expect(toggleFilter(["교수부"], "조교팀")).toEqual(["교수부", "조교팀"]);
    expect(toggleFilter(["교수부", "조교팀"], "교수부")).toEqual(["조교팀"]);
  });

  it("마지막 하나를 빼면 '전체' 로 돌아간다", () => {
    expect(toggleFilter(["교수부"], "교수부")).toEqual([]);
  });

  it("원본을 건드리지 않는다", () => {
    const before = ["교수부"];
    toggleFilter(before, "조교팀");
    expect(before).toEqual(["교수부"]);
  });
});

describe("anyFilterActive", () => {
  it("하나라도 걸려 있으면 참", () => {
    expect(anyFilterActive({ dept: [], scheme: [] })).toBe(false);
    expect(anyFilterActive({ dept: ["교수부"], scheme: [] })).toBe(true);
  });
});

describe("filterSummary — 버튼에 적을 요약", () => {
  const label = (v: string) => ({ MONTHLY: "월급제", HOURLY: "시급제" })[v] ?? v;

  it("안 고르면 '전체'", () => {
    expect(filterSummary([], label)).toBe("전체");
  });

  it("하나면 그 이름", () => {
    expect(filterSummary(["MONTHLY"], label)).toBe("월급제");
  });

  it("여럿이면 '첫 이름 외 N' — 다 늘어놓으면 버튼이 줄바꿈된다", () => {
    expect(filterSummary(["MONTHLY", "HOURLY"], label)).toBe("월급제 외 1");
    expect(filterSummary(["MONTHLY", "HOURLY", "RATIO"], label)).toBe("월급제 외 2");
  });

  it("'전체' 문구를 바꿀 수 있다", () => {
    expect(filterSummary([], label, "제한 없음")).toBe("제한 없음");
  });
});
