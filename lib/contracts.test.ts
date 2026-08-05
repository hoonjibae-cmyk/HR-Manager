import { describe, it, expect } from "vitest";
import {
  governingContract,
  contractIssues,
  mirrorFromContract,
  templateKeyOf,
  paySchemeOf,
  effectiveContractStatus,
  planContractTimeline,
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
      incRevenuePercent: null,
      ratioPercent: 0.4,
      ratioMinGuarantee: null,
      isContractor: true, // 완전비율제는 성질상 언제나 위탁계약
      fixedBaseHours: null,
      fixedOtHours: null,
      fixedNightHours: null,
    });
  });

  it("위탁계약 체크는 계약에서 카드로 그대로 옮겨진다", () => {
    const c = ct(1, "2026-01-01", null, { templateKey: "HOURLY", isContractor: true });
    expect(mirrorFromContract(c).isContractor).toBe(true);
  });

  it("체크하지 않은 근로계약은 위탁이 아니다", () => {
    const c = ct(1, "2026-01-01", null, { templateKey: "HOURLY" });
    expect(mirrorFromContract(c).isContractor).toBe(false);
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

describe("effectiveContractStatus — 저장된 status 가 뒤처져도 화면은 사실대로", () => {
  const today = d("2026-07-27");
  it("종료일이 지났으면 EXPIRED", () => {
    expect(effectiveContractStatus({ endDate: d("2025-10-31"), status: "ACTIVE" }, today)).toBe("EXPIRED");
  });
  it("아직 유효하면 ACTIVE", () => {
    expect(effectiveContractStatus({ endDate: d("2026-12-31"), status: "ACTIVE" }, today)).toBe("ACTIVE");
    expect(effectiveContractStatus({ endDate: null, status: "ACTIVE" }, today)).toBe("ACTIVE");
  });
  it("종료일 당일은 아직 유효", () => {
    expect(effectiveContractStatus({ endDate: d("2026-07-27"), status: "ACTIVE" }, today)).toBe("ACTIVE");
  });
  it("사람이 정한 상태는 날짜로 뒤집지 않는다", () => {
    expect(effectiveContractStatus({ endDate: d("2020-01-01"), status: "DRAFT" }, today)).toBe("DRAFT");
    expect(effectiveContractStatus({ endDate: null, status: "TERMINATED" }, today)).toBe("TERMINATED");
  });
});

describe("planContractTimeline — 계약 이력 정리", () => {
  const today = d("2026-07-27");
  const c = (id: number, start: string, end: string | null, status = "ACTIVE") => ({
    id, startDate: d(start), endDate: end ? d(end) : null, status,
  });

  it("기한 없는 계약을 새 계약이 덮으면 그 전날로 닫고 EXPIRED", () => {
    const fixes = planContractTimeline([c(1, "2024-01-01", null), c(2, "2025-03-01", null)], today);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].id).toBe(1);
    expect(fixes[0].endDate!.toISOString().slice(0, 10)).toBe("2025-02-28");
    expect(fixes[0].status).toBe("EXPIRED");
  });

  it("종료일이 이미 지났는데 ACTIVE 로 남아 있으면 EXPIRED 로 내린다", () => {
    // 종료일을 손댈 필요가 없어 예전에는 상태가 그대로 남았다
    const fixes = planContractTimeline([c(1, "2021-11-02", "2022-11-01"), c(2, "2022-12-01", null)], today);
    expect(fixes).toEqual([{ id: 1, status: "EXPIRED" }]);
  });

  it("과거 날짜로 나중에 끼워 넣은 계약도 뒤 계약에 맞춰 닫힌다", () => {
    // 2024 계약을 먼저 만들고 2023 계약을 나중에 추가한 경우
    const fixes = planContractTimeline(
      [c(9, "2024-11-01", "2025-10-31"), c(7, "2023-11-01", "2025-10-31")],
      today
    );
    const f7 = fixes.find((f) => f.id === 7)!;
    expect(f7.endDate!.toISOString().slice(0, 10)).toBe("2024-10-31");
    expect(f7.status).toBe("EXPIRED");
    // 마지막 계약도 종료일이 지났으므로 EXPIRED
    expect(fixes.find((f) => f.id === 9)).toEqual({ id: 9, status: "EXPIRED" });
  });

  it("마지막 계약이 유효하면 ACTIVE 로 되살린다", () => {
    const fixes = planContractTimeline([c(1, "2026-01-01", null, "EXPIRED")], today);
    expect(fixes).toEqual([{ id: 1, status: "ACTIVE" }]);
  });

  it("이미 맞으면 아무것도 바꾸지 않는다", () => {
    const list = [c(1, "2024-01-01", "2025-02-28", "EXPIRED"), c(2, "2025-03-01", null, "ACTIVE")];
    expect(planContractTimeline(list, today)).toEqual([]);
  });

  it("종료일을 늘리지는 않는다 — 빈 기간은 사람이 판단할 몫", () => {
    const list = [c(1, "2024-01-01", "2024-06-30", "EXPIRED"), c(2, "2025-03-01", null)];
    expect(planContractTimeline(list, today)).toEqual([]);
  });

  it("TERMINATED 는 건드리지 않는다", () => {
    const fixes = planContractTimeline([c(1, "2024-01-01", null, "TERMINATED"), c(2, "2025-03-01", null)], today);
    expect(fixes[0].id).toBe(1);
    expect(fixes[0].endDate!.toISOString().slice(0, 10)).toBe("2025-02-28");
    expect("status" in fixes[0]).toBe(false); // 상태는 그대로 둔다
  });

  it("DRAFT 는 이력에서 제외한다", () => {
    const list = [c(1, "2024-01-01", null), c(2, "2025-03-01", null, "DRAFT")];
    const fixes = planContractTimeline(list, today);
    expect(fixes).toEqual([]); // 초안은 앞 계약을 닫지 않는다
  });

  it("미래 시작 계약이 있어도 현재 계약을 미리 닫아 둔다", () => {
    const list = [c(1, "2025-03-01", null), c(2, "2026-09-01", null)];
    const fixes = planContractTimeline(list, today);
    // 2026-08-31 로 닫히지만 아직 지나지 않았으므로 ACTIVE 유지
    expect(fixes[0].endDate!.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(fixes[0].status).toBeUndefined();
  });
});
