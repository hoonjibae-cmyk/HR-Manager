// 재계약 · 연봉협의 알림.
//
// 여기서 틀리면 ① 서명도 못 받았는데 경고가 사라지거나 ② 계약 공백이 생겼는데 조용하다.
// 둘 다 나중에 사람이 다치는 쪽이다.

import { describe, it, expect } from "vitest";
import {
  renewalAlerts,
  salaryReviewDue,
  addYears,
  daysLabel,
  RENEWAL_LEAD_DAYS,
  SALARY_REVIEW_EXEMPT_DEPTS,
  type RenewalEmployee,
  type RenewalContract,
} from "./renewal";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const TODAY = d("2026-08-15");

let seq = 1;
const ct = (over: Partial<RenewalContract> = {}): RenewalContract => ({
  id: seq++,
  startDate: d("2025-09-01"),
  endDate: d("2026-08-31"),
  status: "ACTIVE",
  hasScan: false,
  ...over,
});

const emp = (contracts: RenewalContract[], over: Partial<RenewalEmployee> = {}): RenewalEmployee => ({
  id: 1,
  name: "김지연",
  department: "교수부",
  payScheme: "INCENTIVE",
  contracts,
  ...over,
});

describe("N년 뒤 같은 날", () => {
  it("평범한 날짜", () => {
    expect(addYears(d("2025-09-01"), 1).toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  // 3월 1일로 넘어가면 기념일이 달을 넘는다
  it("**2월 29일은 평년에 2월 28일로 당긴다**", () => {
    expect(addYears(d("2024-02-29"), 1).toISOString().slice(0, 10)).toBe("2025-02-28");
    expect(addYears(d("2024-02-29"), 4).toISOString().slice(0, 10)).toBe("2028-02-29");
  });
});

describe("재계약 — 기간이 정해진 계약", () => {
  it("만료가 60일 안이면 알린다", () => {
    const a = renewalAlerts([emp([ct({ endDate: d("2026-08-31") })])], TODAY);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "RENEW", dueDate: "2026-08-31", daysLeft: 16, overdue: false });
  });

  it("아직 멀면 알리지 않는다", () => {
    expect(renewalAlerts([emp([ct({ endDate: d("2027-01-01") })])], TODAY)).toHaveLength(0);
  });

  // 공백이 진행 중이라는 뜻이라 더 급하다 — 내리면 아무도 모른 채 지나간다
  it("**만료일이 지나도 계속 띄운다** (overdue)", () => {
    const a = renewalAlerts([emp([ct({ endDate: d("2026-07-31") })])], TODAY);
    expect(a[0]).toMatchObject({ kind: "RENEW", daysLeft: -15, overdue: true });
    expect(daysLabel(a[0])).toBe("15일 지남");
  });
});

describe("**알림을 끄는 건 새 계약이 아니라 서명본 스캔이다**", () => {
  const current = ct({ id: 1, startDate: d("2025-09-01"), endDate: d("2026-08-31") });

  it("재계약서를 만들어 두기만 하면 경고가 그대로 있다", () => {
    const next = ct({ id: 2, startDate: d("2026-09-01"), endDate: null, hasScan: false });
    const a = renewalAlerts([emp([current, next])], TODAY);
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("RENEW");
  });

  it("그 새 계약에 서명본이 올라오면 경고가 사라진다", () => {
    const next = ct({ id: 2, startDate: d("2026-09-01"), endDate: null, hasScan: true });
    expect(renewalAlerts([emp([current, next])], TODAY)).toHaveLength(0);
  });

  // 지금 계약에 붙은 스캔은 '이번 계약의 원본' 이지 재계약 합의가 아니다
  it("**지금 계약에 스캔이 있어도 소용없다** — 뒤에 오는 계약의 스캔이어야 한다", () => {
    const signedNow = ct({ id: 1, startDate: d("2025-09-01"), endDate: d("2026-08-31"), hasScan: true });
    expect(renewalAlerts([emp([signedNow])], TODAY)).toHaveLength(1);
  });

  it("해지된 계약의 스캔은 세지 않는다", () => {
    const next = ct({ id: 2, startDate: d("2026-09-01"), hasScan: true, status: "TERMINATED" });
    expect(renewalAlerts([emp([current, next])], TODAY)).toHaveLength(1);
  });

  it("만료가 지난 뒤라도 서명본이 올라오면 사라진다", () => {
    const past = ct({ id: 1, startDate: d("2025-07-01"), endDate: d("2026-06-30") });
    const next = ct({ id: 2, startDate: d("2026-07-01"), endDate: null, hasScan: true });
    expect(renewalAlerts([emp([past, next])], TODAY)).toHaveLength(0);
  });
});

describe("연봉협의 — 기한 없는 계약", () => {
  const openEnded = (start: string, over: Partial<RenewalContract> = {}) =>
    ct({ startDate: d(start), endDate: null, ...over });

  it("첫 1주년이 60일 안이면 알린다", () => {
    // 2025-10-01 시작 → 2026-10-01 이 1주년 (오늘 8/15 기준 47일 뒤)
    const a = renewalAlerts([emp([openEnded("2025-10-01")])], TODAY);
    expect(a[0]).toMatchObject({ kind: "SALARY_REVIEW", dueDate: "2026-10-01", daysLeft: 47 });
  });

  it("1주년이 멀면 알리지 않는다", () => {
    expect(renewalAlerts([emp([openEnded("2026-01-01")])], TODAY)).toHaveLength(0);
  });

  // 협의가 안 된 채 지나간 것이므로 계속 띄운다
  it("**주년이 지났으면 지난 주년을 짚어 계속 띄운다**", () => {
    const a = renewalAlerts([emp([openEnded("2019-03-04")])], TODAY);
    expect(a[0]).toMatchObject({ kind: "SALARY_REVIEW", dueDate: "2026-03-04", overdue: true });
    expect(a[0].daysLeft).toBeLessThan(0);
  });

  it("해마다 되풀이된다 — 매번 가장 최근 주년을 짚는다", () => {
    expect(salaryReviewDue(d("2020-05-10"), d("2026-08-15")).date.toISOString().slice(0, 10)).toBe(
      "2026-05-10"
    );
    expect(salaryReviewDue(d("2020-05-10"), d("2027-01-20")).date.toISOString().slice(0, 10)).toBe(
      "2026-05-10"
    );
  });

  it("1년이 안 된 계약은 아직 아니다", () => {
    expect(renewalAlerts([emp([openEnded("2026-07-01")])], TODAY)).toHaveLength(0);
  });

  it("**조교팀은 뺀다**", () => {
    expect(SALARY_REVIEW_EXEMPT_DEPTS).toContain("조교팀");
    const a = renewalAlerts([emp([openEnded("2019-03-04")], { department: "조교팀" })], TODAY);
    expect(a).toHaveLength(0);
    // 다른 부서는 그대로 뜬다
    expect(renewalAlerts([emp([openEnded("2019-03-04")], { department: "교수부" })], TODAY)).toHaveLength(1);
  });

  // 기간제와 같은 원칙 — 합의의 증거는 서명본이다
  it("뒤에 서명본 붙은 계약이 있으면 사라진다", () => {
    const now = openEnded("2019-03-04");
    const next = ct({ id: 99, startDate: d("2026-09-01"), endDate: null, hasScan: true });
    expect(renewalAlerts([emp([now, next])], TODAY)).toHaveLength(0);
  });
});

describe("목록 정리", () => {
  it("지난 것이 위로, 그 안에서는 오래 지난 순", () => {
    const rows = renewalAlerts(
      [
        emp([ct({ endDate: d("2026-08-31") })], { id: 1, name: "곧만료" }),
        emp([ct({ endDate: d("2026-06-30") })], { id: 2, name: "많이지남" }),
        emp([ct({ endDate: d("2026-08-10") })], { id: 3, name: "조금지남" }),
      ],
      TODAY
    );
    expect(rows.map((r) => r.name)).toEqual(["많이지남", "조금지남", "곧만료"]);
  });

  it("오늘을 덮는 계약이 없으면 건드리지 않는다 (그건 계약 빈틈 경고가 맡는다)", () => {
    const future = ct({ startDate: d("2027-01-01"), endDate: d("2027-12-31") });
    expect(renewalAlerts([emp([future])], TODAY)).toHaveLength(0);
  });

  it("예고 창은 60일", () => {
    expect(RENEWAL_LEAD_DAYS).toBe(60);
  });

  it("남은 일수 표기", () => {
    const [a] = renewalAlerts([emp([ct({ endDate: d("2026-08-15") })])], TODAY);
    expect(daysLabel(a)).toBe("오늘");
  });
});
