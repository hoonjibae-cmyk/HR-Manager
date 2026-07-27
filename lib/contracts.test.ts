import { describe, it, expect } from "vitest";
import {
  governingContract,
  contractIssues,
  mirrorFromContract,
  templateKeyOf,
  paySchemeOf,
} from "./contracts";

const d = (s: string) => new Date(s + "T00:00:00Z");
const ct = (id: number, start: string, end: string | null, extra: any = {}) => ({
  id,
  startDate: d(start),
  endDate: end ? d(end) : null,
  templateKey: "MONTHLY",
  baseWage: 3_000_000,
  positionAllow: 0,
  mealAllow: 200_000,
  carAllow: 0,
  incThreshold: null,
  incPerStudent: null,
  ratioPercent: null,
  ...extra,
});

describe("governingContract — 그 시점을 지배하는 계약", () => {
  const list = [
    ct(1, "2024-03-01", "2025-02-28", { baseWage: 3_000_000 }),
    ct(2, "2025-03-01", "2026-02-28", { baseWage: 3_500_000 }),
    ct(3, "2026-03-01", null, { baseWage: 4_000_000 }),
  ];

  it("오늘 날짜가 속한 계약을 고른다", () => {
    expect(governingContract(list, d("2025-07-01"))!.id).toBe(2);
    expect(governingContract(list, d("2026-07-01"))!.id).toBe(3);
  });

  it("시작일 당일은 새 계약이 지배한다", () => {
    expect(governingContract(list, d("2025-03-01"))!.id).toBe(2);
    expect(governingContract(list, d("2025-02-28"))!.id).toBe(1);
  });

  it("미래 계약은 발효 전까지 무시한다", () => {
    const withFuture = [...list, ct(4, "2026-09-01", null, { baseWage: 5_000_000 })];
    expect(governingContract(withFuture, d("2026-07-27"))!.id).toBe(3);
    expect(governingContract(withFuture, d("2026-09-01"))!.id).toBe(4);
  });

  it("첫 계약 시작 전이면 없음", () => {
    expect(governingContract(list, d("2024-01-01"))).toBeNull();
  });

  it("같은 날 시작한 계약이 둘이면 나중에 만든 것", () => {
    const dup = [ct(5, "2025-03-01", null), ct(6, "2025-03-01", null)];
    expect(governingContract(dup, d("2025-06-01"))!.id).toBe(6);
  });
});

describe("contractIssues — 계약 일자 빈틈·중복 점검", () => {
  const emp = { hireDate: d("2024-03-01"), resignDate: null, active: true };

  it("빈틈 없이 이어지면 문제 없음", () => {
    const list = [ct(1, "2024-03-01", "2025-02-28"), ct(2, "2025-03-01", null)];
    expect(contractIssues(emp, list, d("2026-07-27"))).toEqual([]);
  });

  it("계약 사이 빈 기간을 잡아낸다", () => {
    const list = [ct(1, "2024-03-01", "2025-02-28"), ct(2, "2025-04-01", null)];
    const issues = contractIssues(emp, list, d("2026-07-27"));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("between");
    expect(issues[0].from.toISOString().slice(0, 10)).toBe("2025-03-01");
    expect(issues[0].to.toISOString().slice(0, 10)).toBe("2025-03-31");
  });

  it("입사일과 첫 계약 사이 공백을 잡아낸다", () => {
    const list = [ct(1, "2024-05-01", null)];
    const issues = contractIssues(emp, list, d("2026-07-27"));
    expect(issues[0].kind).toBe("before-first");
    expect(issues[0].to.toISOString().slice(0, 10)).toBe("2024-04-30");
  });

  it("마지막 계약이 끝났는데 재직 중이면 잡아낸다", () => {
    const list = [ct(1, "2024-03-01", "2026-02-28")];
    const issues = contractIssues(emp, list, d("2026-07-27"));
    expect(issues[0].kind).toBe("after-last");
    expect(issues[0].from.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("퇴사자는 퇴사일까지만 덮으면 된다", () => {
    const resigned = { hireDate: d("2024-03-01"), resignDate: d("2026-02-28"), active: false };
    const list = [ct(1, "2024-03-01", "2026-02-28")];
    expect(contractIssues(resigned, list, d("2026-07-27"))).toEqual([]);
  });

  it("기간이 겹치면 잡아낸다", () => {
    const list = [ct(1, "2024-03-01", "2025-06-30"), ct(2, "2025-03-01", null)];
    const issues = contractIssues(emp, list, d("2026-07-27"));
    expect(issues.some((i) => i.kind === "overlap")).toBe(true);
  });

  it("앞 계약 종료일이 비어 있는데 다음 계약이 있으면 겹침", () => {
    const list = [ct(1, "2024-03-01", null), ct(2, "2025-03-01", null)];
    const issues = contractIssues(emp, list, d("2026-07-27"));
    expect(issues[0].kind).toBe("overlap");
  });

  it("계약이 하나도 없으면 전 구간을 알린다", () => {
    const issues = contractIssues(emp, [], d("2026-07-27"));
    expect(issues[0].kind).toBe("before-first");
    expect(issues[0].to.toISOString().slice(0, 10)).toBe("2026-07-27");
  });
});

describe("mirrorFromContract — 카드에 비출 값", () => {
  it("계약 조건을 그대로 옮긴다", () => {
    const c = ct(1, "2026-01-01", null, {
      templateKey: "RATIO",
      incomeType: "FREELANCE",
      ratioPercent: 0.4,
      baseWage: 0,
    });
    expect(mirrorFromContract(c)).toEqual({
      payScheme: "RATIO",
      incomeType: "FREELANCE",
      baseWage: 0,
      positionAllow: 0,
      mealAllow: 200_000,
      carAllow: 0,
      incThreshold: null,
      incPerStudent: null,
      ratioPercent: 0.4,
      ratioMinGuarantee: null,
    });
  });

  it("계약에 세무구분이 없으면 카드 값을 유지한다", () => {
    expect(mirrorFromContract(ct(1, "2026-01-01", null))).not.toHaveProperty("incomeType");
  });
});

describe("templateKey ↔ payScheme", () => {
  it("왕복 변환", () => {
    for (const s of ["MONTHLY", "HOURLY", "RATIO", "INCENTIVE"])
      expect(paySchemeOf(templateKeyOf(s))).toBe(s);
    expect(paySchemeOf("REGULAR")).toBe("MONTHLY"); // 옛 서식 키
  });
});
