// 경업금지 조항 · 경업금지 보상금 — 교수부 근로계약서(월급제 · 월급+인센티브)
//
// 못박는 것:
//  ① 보상금은 월 지급 총액 **안에서** 떼는 몫이다 — 지급계·과세표준·공제는 그대로, 기본급만 준다.
//     **통상시급은 총액에서 보상금을 뺀 금액으로 낸다**(v1.59.3 — 근로의 대가가 아니라 임금·근로소득의 모양으로
//     다루지 않는다). 그래서 수당 단가와 포괄임금 약정 시간외·야간 금액이 그만큼 내려가고, 퇴직급여 산정기준에도 넣지 않는다.
//  ② 계약서에는 보상금이 있을 때만 제8조가 들어가고 기타사항이 제9조로 밀린다. 없으면 예전과 한 글자도 다르지 않다.
//  ③ 명세서·퇴직급여·대시보드 추이가 같은 돈을 같은 자리에 센다.
//  ④ 교수부 필수 판정·입력 검사는 화면과 서버가 같은 함수를 쓴다.

import { describe, it, expect } from "vitest";
import {
  computePayroll,
  inclusiveWageBreakdown,
  blendWageTerms,
  floor10,
  DEFAULT_RATES_2025,
  type EmployeePayInput,
  type InsuranceRates,
  type TaxBracketRow,
} from "./payroll";
import type { ScheduleDay } from "./constants";
import {
  NON_COMPETE_MONTHS,
  NON_COMPETE_RADIUS_KM,
  NON_COMPETE_REQUIRED_MESSAGE,
  nonCompetePayApplies,
  nonCompeteRequired,
  normalizeNonCompetePay,
  nonCompetePayError,
  nonCompetePreview,
  resolveNonCompetePay,
  nonCompeteNonTaxOf,
  withNonCompeteNonTax,
  NON_COMPETE_NONTAX_RISK_NOTE,
} from "./non-compete";
import {
  contractHtml,
  pledgeSecurityHtml,
  type DocCompany,
  type DocContract,
  type DocEmployee,
} from "./documents";
import { payslipHtml, type DocPayroll } from "./documents-pay";
import {
  severanceBase,
  estimateContractBase,
  underMinimumWarning,
  DEFAULT_SEVERANCE_POLICY,
  type SeverancePayItems,
} from "./severance";
import { contractBaseOf, grossOf, overtimeOf, type TrendRecord } from "./payroll-trend";

// 학원 강사 스케줄 (주 5일 15:00~22:00, 휴게 0.5)
const instructor: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day, i) => ({
  day: day as ScheduleDay["day"],
  work: i < 5,
  start: i < 5 ? "15:00" : "00:00",
  end: i < 5 ? "22:00" : "00:00",
  breakH: i < 5 ? 0.5 : 0,
}));

const taxTable: TaxBracketRow[] = [
  { lo: 0, hi: 2000, tax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { lo: 2000, hi: 3000, tax: [19520, 15330, 8930, 7440, 5960, 4480, 2760, 1130, 0, 0, 0] },
  { lo: 3000, hi: 4000, tax: [84850, 74350, 52250, 46630, 41010, 35390, 29770, 24150, 18530, 12910, 8290] },
  { lo: 4000, hi: null, tax: [200000, 180000, 160000, 140000, 120000, 100000, 90000, 80000, 70000, 60000, 50000] },
];

/** 교수부 월급제 — 총액 350만(식대 20만 포함), 기본급 산정 209시간 */
const prof: EmployeePayInput = {
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseWage: 3_500_000,
  positionAllow: 0,
  mealAllow: 200_000,
  carAllow: 0,
  dependents: 1,
  schedule: instructor,
  fixedBaseHours: 209,
};

describe("급여 엔진 — 보상금은 총액 안에서 떼는 몫", () => {
  const without = computePayroll(prof, {}, DEFAULT_RATES_2025, taxTable);
  const withNc = computePayroll({ ...prof, nonCompetePay: 300_000 }, {}, DEFAULT_RATES_2025, taxTable);

  it("기본급이 보상금만큼 줄고 보상금이 따로 실린다 — 지급계는 그대로", () => {
    expect(without.baseP).toBe(3_300_000);
    expect(withNc.baseP).toBe(3_000_000);
    expect(withNc.nonCompeteP).toBe(300_000);
    expect(withNc.mealP).toBe(200_000);
    expect(withNc.gross).toBe(3_500_000);
    expect(withNc.gross).toBe(without.gross);
  });

  it("통상시급은 총액에서 보상금을 뺀 금액으로 낸다 — 보상금은 근로의 대가가 아니다(v1.59.3)", () => {
    expect(without.hourlyWage).toBe(Math.round(3_500_000 / 209)); // 16,746
    expect(withNc.hourlyWage).toBe(Math.round(3_200_000 / 209)); // 15,311 — 350만 − 보상금 30만
    expect(withNc.hourlyWage).toBe(15_311);
    // 보상금이 없는 320만 계약과 통상시급이 같다 — 보상금을 받는다고 수당 단가가 올라가지 않는다
    const lower = computePayroll({ ...prof, baseWage: 3_200_000 }, {}, DEFAULT_RATES_2025, taxTable);
    expect(withNc.hourlyWage).toBe(lower.hourlyWage);
    // 산정 안내문이 그 사실과 기준 금액을 적는다(과세 여부는 적지 않는다 — 회사 설정이 정한다)
    expect(withNc.notes).toContain(
      "경업금지 보상금 300,000원은 월 지급 총액에 포함된 금액으로, 근로계약서 제8조에 따라 임금 항목과 구분해 지급합니다 — " +
        "근로의 대가가 아니라 통상시급에는 넣지 않습니다(통상시급 15,311원 = 총액에서 보상금을 뺀 3,200,000원 기준)."
    );
    expect(withNc.notes.some((n) => n.includes("(과세)"))).toBe(false);
  });

  it("과세표준·공제·실수령은 보상금이 없을 때와 같다(수당이 없는 달 — 세무 처리는 회사 설정이 정한다)", () => {
    expect(withNc.taxableGross).toBe(without.taxableGross);
    expect(withNc.totalDeduct).toBe(without.totalDeduct);
    expect(withNc.net).toBe(without.net);
  });

  it("보상금이 없는 계약은 nonCompeteP 0 — 예전 결과와 같다", () => {
    expect(without.nonCompeteP).toBe(0);
    for (const v of [null, undefined, 0]) {
      const r = computePayroll({ ...prof, nonCompetePay: v }, {}, DEFAULT_RATES_2025, taxTable);
      expect(r).toEqual(without);
    }
  });

  it("연장수당·연차수당은 보상금을 뺀 통상시급으로 계산된다 — 보상금이 있으면 그만큼 단가가 낮다", () => {
    const m = { overtimeHours: 10, unusedLeaveDays: 2 };
    const a = computePayroll(prof, m, DEFAULT_RATES_2025, taxTable);
    const b = computePayroll({ ...prof, nonCompetePay: 300_000 }, m, DEFAULT_RATES_2025, taxTable);
    expect(a.overtimeP).toBe(Math.round(10 * 16_746 * 1.5)); // 251,190
    expect(b.overtimeP).toBe(Math.round(10 * 15_311 * 1.5)); // 229,665
    // 연차수당 = 일수 × 통상시급 × 1일 소정근로시간(15~22시·휴게 30분 = 6.5시간)
    expect(a.unusedLeaveP).toBe(Math.round(2 * 16_746 * 6.5)); // 217,698
    expect(b.unusedLeaveP).toBe(Math.round(2 * 15_311 * 6.5)); // 199,043
    // 고정 지급분(총액 350만)은 그대로이고 수당만 그 차이만큼 준다
    expect(a.gross - b.gross).toBe(a.overtimeP - b.overtimeP + (a.unusedLeaveP - b.unusedLeaveP));
    expect(b.baseP + b.mealP + b.nonCompeteP).toBe(3_500_000);
  });

  it("포괄임금 — 약정 시간외·야간도 보상금을 뺀 통상시급으로 내고, 줄어든 만큼은 잔액인 기본급에 남는다", () => {
    const incl = { ...prof, baseWage: 5_000_000, mealAllow: 0, fixedOtHours: 21.725, fixedNightHours: 10.8625 };
    const a = computePayroll(incl, {}, DEFAULT_RATES_2025, taxTable);
    const b = computePayroll({ ...incl, nonCompetePay: 500_000 }, {}, DEFAULT_RATES_2025, taxTable);
    // 보상금이 없는 계약은 예전 그대로 — 실제 서명된 계약서를 원 단위까지 재현한다
    expect(a.baseP).toBe(4_230_448); // 김지연 계약서 제4조
    expect(a.hourlyWage).toBe(20_241); // 500만 ÷ (209 + 1.5×21.725 + 0.5×10.8625)
    expect(a.overtimeP).toBe(659_616);
    expect(a.nightP).toBe(109_936);
    // 보상금 50만 — 통상시급 = 450만 ÷ 같은 시간. 약정 시간외·야간이 9할로 줄고(450 ÷ 500) 기본급이 잔액을 받는다
    expect(b.hourlyWage).toBe(18_217);
    expect(b.overtimeP).toBe(593_654);
    expect(b.nightP).toBe(98_942);
    expect(b.baseP).toBe(3_807_404);
    expect(b.nonCompeteP).toBe(500_000);
    // 합계는 언제나 계약 총액
    expect(b.baseP + b.overtimeP + b.nightP + b.nonCompeteP).toBe(5_000_000);
    expect(b.gross).toBe(5_000_000);
    // 임금 부분(총액 − 보상금 = 450만)이 보상금 없는 450만 계약과 똑같이 분해된다
    const plain450 = computePayroll({ ...incl, baseWage: 4_500_000 }, {}, DEFAULT_RATES_2025, taxTable);
    expect([b.hourlyWage, b.baseP, b.overtimeP, b.nightP]).toEqual([
      plain450.hourlyWage,
      plain450.baseP,
      plain450.overtimeP,
      plain450.nightP,
    ]);
  });

  it("일할계산 — 보상금도 같은 비율로 일할되고 합계는 round(총액 × 비율)", () => {
    const half = computePayroll({ ...prof, nonCompetePay: 300_000 }, { prorationRatio: 0.5 }, DEFAULT_RATES_2025, taxTable);
    expect(half.nonCompeteP).toBe(150_000);
    expect(half.baseP).toBe(1_500_000);
    expect(half.gross).toBe(1_750_000);

    const r = 13 / 30;
    const odd = computePayroll({ ...prof, nonCompetePay: 300_000 }, { prorationRatio: r }, DEFAULT_RATES_2025, taxTable);
    expect(odd.nonCompeteP).toBe(130_000);
    expect(odd.gross).toBe(Math.round(3_500_000 * r));
    expect(odd.baseP + odd.mealP + odd.nonCompeteP).toBe(odd.gross);
  });

  it("월급+인센티브도 같은 규칙 — 퇴직유보금은 여전히 인센티브 원천액만 본다", () => {
    const inc: EmployeePayInput = { ...prof, payScheme: "INCENTIVE", incThreshold: 40, incPerStudent: 20_000 };
    const r = computePayroll({ ...inc, nonCompetePay: 300_000 }, { studentCount: 50 }, DEFAULT_RATES_2025, taxTable);
    expect(r.nonCompeteP).toBe(300_000);
    expect(r.incentiveP).toBe(200_000);
    expect(r.retentionD).toBe(Math.round(200_000 / 12));
    expect(r.gross).toBe(3_500_000 + 200_000);
  });

  it("시급제·완전비율제·위탁계약에는 보상금을 싣지 않는다", () => {
    const hourly = computePayroll(
      { ...prof, payScheme: "HOURLY", baseWage: 15_000, nonCompetePay: 300_000 },
      { workedHours: 100 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(hourly.nonCompeteP).toBe(0);
    const ratio = computePayroll(
      { ...prof, payScheme: "RATIO", ratioPercent: 0.5, nonCompetePay: 300_000 },
      { classRevenue: 4_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(ratio.nonCompeteP).toBe(0);
    const contractor = computePayroll({ ...prof, isContractor: true, nonCompetePay: 300_000 }, {}, DEFAULT_RATES_2025, taxTable);
    expect(contractor.nonCompeteP).toBe(0);
    expect(contractor.baseP).toBe(3_300_000);
  });

  it("보상금이 기본급으로 남는 몫보다 크면 남는 몫까지만 떼고 알린다 — 합계는 총액을 넘지 않는다", () => {
    const r = computePayroll({ ...prof, baseWage: 1_000_000, nonCompetePay: 900_000 }, {}, DEFAULT_RATES_2025, taxTable);
    expect(r.nonCompeteP).toBe(800_000);
    expect(r.baseP).toBe(0);
    expect(r.gross).toBe(1_000_000);
    expect(r.notes.some((n) => n.includes("경업금지 보상금이 기본급으로 남는 금액보다 커서"))).toBe(true);
  });

  it("명세서 산출 근거에 보상금 안내가 남는다", () => {
    expect(withNc.notes.some((n) => n.includes("경업금지 보상금 300,000원"))).toBe(true);
    expect(without.notes.some((n) => n.includes("경업금지"))).toBe(false);
  });
});

describe("inclusiveWageBreakdown — 항목 합계는 언제나 총액", () => {
  it("보상금을 넣어도 기본급 + 비과세 + 약정수당 + 보상금 = target", () => {
    for (const prorate of [1, 0.5, 13 / 30, 17 / 31]) {
      const iw = inclusiveWageBreakdown({
        baseWage: 4_600_000,
        mealAllow: 200_000,
        carAllow: 100_000,
        baseHours: 172.062,
        otHours: 4.345,
        nightHours: 10.8625,
        nonCompetePay: 350_000,
        prorate,
      });
      const nonTaxPaid = Math.round(200_000 * prorate) + Math.round(100_000 * prorate);
      expect(iw.basePay + nonTaxPaid + iw.overtimePay + iw.nightPay + iw.nonCompetePay).toBe(iw.target);
      expect(iw.nonCompetePay).toBe(Math.round(350_000 * prorate));
      expect(iw.nonCompeteCapped).toBe(false);
    }
  });

  it("통상시급의 분자는 기준급여 − 보상금이다 — 약정 시간외도 그 통상시급으로 낸다(v1.59.3)", () => {
    const a = inclusiveWageBreakdown({ baseWage: 4_000_000, baseHours: 209, otHours: 10 });
    const b = inclusiveWageBreakdown({ baseWage: 4_000_000, baseHours: 209, otHours: 10, nonCompetePay: 400_000 });
    expect(a.hourlyBase).toBe(4_000_000);
    expect(a.hourlyWage).toBe(17_857); // 400만 ÷ (209 + 15)
    expect(b.hourlyBase).toBe(3_600_000);
    expect(b.hourlyWage).toBe(16_071); // 360만 ÷ (209 + 15)
    expect(a.overtimePay).toBe(267_857);
    expect(b.overtimePay).toBe(241_071);
    // 기본급은 잔액 — 보상금만큼 줄되, 약정 시간외가 준 만큼은 되돌아온다
    expect(a.basePay).toBe(3_732_143);
    expect(b.basePay).toBe(3_358_929);
    expect(b.basePay).toBe(a.basePay - 400_000 + (a.overtimePay - b.overtimePay));
    expect(b.basePay + b.overtimePay + b.nonCompetePay).toBe(b.target);
    // 통상시급은 월 금액끼리 나눈다 — 일할이 걸려도 같다(일할은 지급액에만 건다)
    const half = inclusiveWageBreakdown({ baseWage: 4_000_000, baseHours: 209, otHours: 10, nonCompetePay: 400_000, prorate: 0.5 });
    expect(half.hourlyWage).toBe(16_071);
    expect(half.hourlyBase).toBe(3_600_000);
    // 보상금이 총액보다 큰 잘못된 값이어도 분자가 음수가 되지 않는다
    expect(inclusiveWageBreakdown({ baseWage: 1_000_000, baseHours: 209, nonCompetePay: 2_000_000 }).hourlyWage).toBe(0);
    // 보상금이 없거나 0 이면 예전과 같다
    for (const v of [undefined, null, 0])
      expect(inclusiveWageBreakdown({ baseWage: 4_000_000, baseHours: 209, otHours: 10, nonCompetePay: v })).toEqual(a);
  });
});

describe("blendWageTerms — 월중 갱신으로 보상금이 생긴 달", () => {
  it("보상금도 총액처럼 역일수로 가중한다", () => {
    const b = blendWageTerms([
      { days: 15, baseWage: 3_500_000, positionAllow: 0, mealAllow: 200_000, carAllow: 0 },
      { days: 15, baseWage: 3_500_000, positionAllow: 0, mealAllow: 200_000, carAllow: 0, nonCompetePay: 300_000 },
    ])!;
    expect(b.baseWage).toBe(3_500_000);
    expect(b.nonCompetePay).toBe(150_000);
  });
});

describe("판정·검사 — 화면과 서버가 같은 함수", () => {
  it("월급제·인센티브 근로계약에만 둘 수 있다", () => {
    expect(nonCompetePayApplies({ payScheme: "MONTHLY" })).toBe(true);
    expect(nonCompetePayApplies({ payScheme: "INCENTIVE" })).toBe(true);
    expect(nonCompetePayApplies({ payScheme: "HOURLY" })).toBe(false);
    expect(nonCompetePayApplies({ payScheme: "RATIO" })).toBe(false);
    expect(nonCompetePayApplies({ payScheme: "MONTHLY", isContractor: true })).toBe(false);
  });

  it("교수부(이름 부분일치) 월급제·인센티브만 필수", () => {
    expect(nonCompeteRequired("교수부", { payScheme: "MONTHLY" })).toBe(true);
    expect(nonCompeteRequired("교수부(중등)", { payScheme: "INCENTIVE" })).toBe(true);
    expect(nonCompeteRequired("교수부", { payScheme: "HOURLY" })).toBe(false);
    expect(nonCompeteRequired("교수부", { payScheme: "RATIO" })).toBe(false);
    expect(nonCompeteRequired("교육운영팀", { payScheme: "MONTHLY" })).toBe(false);
    expect(nonCompeteRequired(null, { payScheme: "MONTHLY" })).toBe(false);
  });

  it("저장값 다듬기 — 빈칸·0 은 조항 없음(null), 대상이 아니면 지운다", () => {
    expect(normalizeNonCompetePay("300000", true)).toBe(300_000);
    expect(normalizeNonCompetePay(299_999.6, true)).toBe(300_000);
    expect(normalizeNonCompetePay("", true)).toBeNull();
    expect(normalizeNonCompetePay(0, true)).toBeNull();
    expect(normalizeNonCompetePay(300_000, false)).toBeNull();
  });

  const terms = {
    baseWage: 3_500_000,
    positionAllow: 0,
    mealAllow: 200_000,
    carAllow: 0,
    fixedBaseHours: 209,
    schedule: instructor,
  };

  it("음수·숫자 아님은 거른다", () => {
    expect(nonCompetePayError(terms, -1)).toContain("0 이상");
    expect(nonCompetePayError(terms, "abc")).toContain("0 이상");
    expect(nonCompetePayError(terms, "")).toBeNull();
    expect(nonCompetePayError(terms, null)).toBeNull();
    expect(nonCompetePayError(terms, 0)).toBeNull();
  });

  it("떼고 남는 기본급이 없으면 거른다", () => {
    expect(nonCompetePayError(terms, 3_299_999)).toBeNull();
    expect(nonCompetePayError(terms, 3_300_000)).toContain("기본급(3,300,000원)");
    expect(nonCompetePayError(terms, 4_000_000)).toContain("기본급이 남아야");
  });

  it("미리보기 — 기본급 변화·임금/보상금/총액·최저임금 비교 시급", () => {
    const p = nonCompetePreview({ ...terms, positionAllow: 100_000 }, 300_000);
    expect(p.baseHours).toBe(209);
    expect(p.basePayBefore).toBe(3_300_000);
    expect(p.basePayAfter).toBe(3_000_000);
    expect(p.monthlyTotal).toBe(3_600_000);
    expect(p.wageTotal).toBe(3_300_000);
    // (기본급 300만 + 직책 10만 + 식대 20만) ÷ 209
    expect(p.minWageHourly).toBe(Math.round(3_300_000 / 209));
  });

  it("기본급 산정시간을 안 적은 계약은 근로시간표로, 그것도 없으면 209시간(엔진과 같다)", () => {
    expect(nonCompetePreview({ ...terms, fixedBaseHours: null }, 0).baseHours).toBeCloseTo((32.5 + 6.5) * 4.345, 6);
    expect(nonCompetePreview({ ...terms, fixedBaseHours: null, schedule: [] }, 0).baseHours).toBe(209);
  });

  it("resolve — 요청에 없으면 카드 값, 시급제로 바꾸면 지운다, 넘치면 오류", () => {
    const base = { payScheme: "MONTHLY", isContractor: false, terms };
    expect(resolveNonCompetePay({ ...base, raw: undefined, fallback: 300_000 })).toEqual({ value: 300_000, error: null });
    expect(resolveNonCompetePay({ ...base, raw: null, fallback: 300_000 })).toEqual({ value: null, error: null });
    expect(resolveNonCompetePay({ ...base, raw: 250_000, fallback: 300_000 })).toEqual({ value: 250_000, error: null });
    expect(resolveNonCompetePay({ ...base, payScheme: "HOURLY", raw: 300_000, fallback: null })).toEqual({ value: null, error: null });
    expect(resolveNonCompetePay({ ...base, raw: 5_000_000, fallback: null }).error).toContain("기본급");
  });

  it("필수 안내 문구는 무엇을 해야 하는지와 빠져나갈 길을 함께 적는다", () => {
    expect(NON_COMPETE_REQUIRED_MESSAGE).toContain("경업금지 보상금");
    expect(NON_COMPETE_REQUIRED_MESSAGE).toContain("넣지 않음");
  });
});

/* ───────────────────────── 계약서 ───────────────────────── */

const company: DocCompany = {
  name: "주식회사 테스트학원",
  ceo: "홍길동",
  bizNo: "000-00-00000",
  phone: "02-000-0000",
  address: "서울특별시 어딘가 1",
  payday: 7,
  stamp: null,
};

const emp = (over: Partial<DocEmployee> = {}): DocEmployee =>
  ({
    name: "가상강사",
    department: "교수부",
    position: "강사",
    duty: "강의",
    email: "virtual@example.com",
    hireDate: new Date(Date.UTC(2026, 0, 2)),
    resignDate: null,
    incomeType: "EMPLOYEE",
    payScheme: "MONTHLY",
    baseWage: 3_500_000,
    positionAllow: 0,
    mealAllow: 200_000,
    carAllow: 0,
    schedule: JSON.stringify(instructor),
    ...over,
  }) as DocEmployee;

const ct = (over: Partial<DocContract> = {}): DocContract =>
  ({
    stage: "RENEWAL_1",
    templateKey: "MONTHLY",
    startDate: new Date(Date.UTC(2026, 11, 1)),
    endDate: new Date(Date.UTC(2027, 10, 30)),
    isProbation: false,
    probationMonths: 2,
    baseWage: 3_500_000,
    positionAllow: 0,
    mealAllow: 200_000,
    carAllow: 0,
    fixedBaseHours: 209,
    ...over,
  }) as DocContract;

const printedAt = new Date(Date.UTC(2026, 10, 5));
/** 태그를 걷어낸 본문 — `<b>` 로 끊긴 문장도 통째로 찾을 수 있게 */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
/** 표 칸처럼 태그가 경계인 곳은 공백으로 — 칸 내용이 서로 붙지 않게 */
const spaced = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("근로계약서 — 보상금이 있으면 제8조, 기타사항은 제9조", () => {
  const html = contractHtml({ employee: emp(), contract: ct({ nonCompetePay: 300_000 }), company, printedAt });
  const t = text(html);

  it("제4조에 보상금을 임금 항목과 구분해 적고, 통상시급의 산정에 포함하지 않는다고 못박는다(v1.59.3)", () => {
    expect(t).toContain(
      "3,500,000원을 기준급여로 하여 아래와 같은 항목으로 포괄하여 지급하며, 이 중 경업금지 보상금 300,000원은 제8조에 따른 경업금지 의무의 대가로서 임금 항목과 구분하여 지급하고, 근로의 대가가 아니므로 통상시급의 산정에 포함하지 아니한다."
    );
    expect(html).toContain('class="nc-row"');
    expect(spaced(html)).toContain("경업금지 보상금 (제8조) 300,000원 월 지급 총액 3,500,000원");
    // 기본급 = 350만 − 식대 20만 − 보상금 30만 (명세서와 같은 함수)
    expect(spaced(html)).toContain("기본급 (209시간) 3,000,000원");
  });

  it("제8조 — 범위·대가·반환·별도 법적 조치·동의", () => {
    expect(t).toContain("제 8조 (경업금지 및 경업금지 보상금)");
    expect(t).toContain(`근로계약 종료일로부터 ${NON_COMPETE_MONTHS}개월간`);
    expect(t).toContain(`반경 ${NON_COMPETE_RADIUS_KM}km 이내`);
    expect(t).toContain("원생·학부모 또는 강사를 유인");
    expect(t).toContain("매월 경업금지 보상금 300,000원을 제4조의 임금 항목과 구분하여 임금 지급일에 함께 지급한다");
    expect(t).toContain("그때까지 지급받은 경업금지 보상금 전액을");
    expect(t).toContain("서면 청구일로부터 30일 이내");
    expect(t).toContain("위약금이나 손해배상액의 예정이 아니며");
    expect(t).toContain("손해의 배상 청구, 위반행위의 금지 청구(가처분 포함)");
    expect(t).toContain("충분히 설명을 듣고 이해하였으며, 이에 동의한다");
    // 제8조 안에 동의자 서명란
    const art8 = t.slice(t.indexOf("제 8조"), t.indexOf("제 9조"));
    expect(art8).toContain("동 의 자 :");
  });

  it("기타사항이 제9조로 밀리고 조항 순서가 이어진다", () => {
    expect(t).toContain("제 9조 (기타사항)");
    expect(t).not.toContain("제 8조 (기타사항)");
    expect(t.indexOf("제 7조")).toBeLessThan(t.indexOf("제 8조 (경업금지"));
    expect(t.indexOf("제 8조 (경업금지")).toBeLessThan(t.indexOf("제 9조 (기타사항)"));
  });

  it("보안서약서와 범위가 같다 (6개월 · 반경 2km)", () => {
    const pledge = text(pledgeSecurityHtml({ employee: emp(), company, nonCompete: true }));
    expect(pledge).toContain(`근로계약 종료 후 ${NON_COMPETE_MONTHS}개월`);
    expect(pledge).toContain(`회사 반경 ${NON_COMPETE_RADIUS_KM}km 내에서 동일직종에 취업 또는 경영`);
  });
});

describe("근로계약서 — 보상금이 없으면 예전 그대로", () => {
  const plain = contractHtml({ employee: emp(), contract: ct(), company, printedAt });

  it("경업금지 조항·보상금 행이 없고 기타사항이 제8조", () => {
    expect(plain).not.toContain("경업금지");
    expect(plain).not.toContain("nc-row");
    expect(text(plain)).toContain("제 8조 (기타사항)");
    expect(text(plain)).toContain("3,500,000원을 기준급여로 하여 아래와 같은 임금 항목으로 포괄하여 지급한다.");
  });

  it("null · 0 · 생략이 모두 같은 문서", () => {
    for (const v of [null, 0, undefined]) {
      expect(contractHtml({ employee: emp(), contract: ct({ nonCompetePay: v }), company, printedAt })).toBe(plain);
    }
  });

  it("시급제·위탁계약에는 값이 남아 있어도 넣지 않는다", () => {
    const hourly = contractHtml({
      employee: emp({ payScheme: "HOURLY" }),
      contract: ct({ templateKey: "HOURLY", baseWage: 15_000, nonCompetePay: 300_000 }),
      company,
      printedAt,
    });
    expect(hourly).not.toContain("경업금지 보상금");
    const contractor = contractHtml({
      employee: emp(),
      contract: ct({ isContractor: true, nonCompetePay: 300_000 }),
      company,
      printedAt,
    });
    expect(contractor).not.toContain("경업금지 보상금");
  });
});

/* ───────────────────────── 명세서 ───────────────────────── */

const payroll: DocPayroll = {
  year: 2026,
  month: 12,
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseP: 3_000_000,
  extraP: 0,
  overtimeP: 0,
  nightP: 0,
  holidayP: 0,
  weeklyHolidayP: 0,
  positionP: 0,
  mealP: 200_000,
  carP: 0,
  nonCompeteP: 300_000,
  incentiveP: 0,
  bonusP: 0,
  unusedLeaveP: 0,
  gross: 3_500_000,
  pensionD: 0,
  employmentD: 0,
  healthD: 0,
  longTermD: 0,
  incomeTaxD: 0,
  localTaxD: 0,
  retentionD: 0,
  parkingD: 0,
  expenseD: 0,
  otherD: 0,
  totalDeduct: 0,
  net: 3_500_000,
  hourlyWage: 16_746,
};

describe("급여명세서 — 보상금 줄과 각주", () => {
  it("보상금이 있으면 따로 한 줄, 머리글은 '지급 항목', 근거·반환 의무 각주", () => {
    const t = spaced(payslipHtml({ employee: emp(), payroll, company }));
    expect(t).toContain("경업금지 보상금 300,000");
    expect(t).toContain("지급 항목");
    expect(t).not.toContain("임금 항목");
    expect(t).toContain("근로계약서 제8조의 경업금지 의무에 대한 대가");
    expect(t).toContain("지급받은 보상금 전액을 반환");
    // 과세·비과세는 명세서가 단정하지 않는다(v1.58.2) — 세무 처리는 세무대리인 지정값에 따른다
    expect(t).toContain(
      "월 지급 총액 중 임금과 구분해 지급하는 금액입니다. 근로의 대가가 아니므로 통상시급(수당 산정 기준)에 포함하지 않습니다(근로계약서 제4조). 경업금지 의무를 위반하면"
    );
    expect(t).not.toContain("금액입니다(과세)");
  });

  it("비과세로 처리해 산정한 달은 「경업금지 보상금(비과세)」 — 그 달 산정이 남긴 표시를 따른다(v1.59)", () => {
    const flagged = { ...payroll, breakdown: JSON.stringify({ nonCompeteNonTax: true }) };
    const t = spaced(payslipHtml({ employee: emp(), payroll: flagged, company }));
    expect(t).toContain("경업금지 보상금(비과세) 300,000");
    // 과세로 산정한 달(표시 없음)은 예전 그대로 — 아무 표시도 붙지 않는다
    const plain = spaced(payslipHtml({ employee: emp(), payroll, company }));
    expect(plain).toContain("경업금지 보상금 300,000");
    expect(plain).not.toContain("경업금지 보상금(비과세)");
    expect(spaced(payslipHtml({ employee: emp(), payroll: { ...payroll, breakdown: "{}" }, company }))).toBe(plain.replace(/\s+/g, " "));
  });

  it("없으면 예전 명세서 그대로 ('임금 항목', 경업금지 언급 없음)", () => {
    const html = payslipHtml({ employee: emp(), payroll: { ...payroll, nonCompeteP: 0, baseP: 3_300_000 }, company });
    expect(html).toContain("임금 항목");
    expect(html).not.toContain("경업금지");
    // 옛 기록(필드 자체가 없음)도 같다
    const { nonCompeteP: _omit, ...legacy } = payroll;
    expect(payslipHtml({ employee: emp(), payroll: { ...legacy, baseP: 3_300_000 }, company })).toBe(html);
  });
});

/* ───────────────────────── 비과세 처리 스위치 (v1.59) ───────────────────────── */

describe("비과세 처리 스위치 — 회사 설정(rates.nonCompeteNonTax)", () => {
  const ON: InsuranceRates = { ...DEFAULT_RATES_2025, nonCompeteNonTax: true };
  const withNc: EmployeePayInput = { ...prof, nonCompetePay: 300_000 };
  const off = computePayroll(withNc, {}, DEFAULT_RATES_2025, taxTable);
  const on = computePayroll(withNc, {}, ON, taxTable);

  it("꺼짐이 기본 — 없음·false 모두 보상금을 과세 급여에 넣는다(지금까지와 같다)", () => {
    expect(off.nonCompeteNonTaxP).toBe(0);
    expect(off.taxableGross).toBe(3_300_000); // 350만 − 식대 20만
    expect(computePayroll(withNc, {}, { ...DEFAULT_RATES_2025, nonCompeteNonTax: false }, taxTable)).toEqual(off);
  });

  it("켜면 보상금을 식대처럼 비과세로 — 4대보험·근로소득세 기준에서 빠진다", () => {
    expect(on.nonCompeteNonTaxP).toBe(300_000);
    expect(on.taxableGross).toBe(3_000_000); // 350만 − 식대 20만 − 보상금 30만
    expect(on.wageTaxable).toBe(3_000_000);
    expect(on.pensionD).toBe(floor10(3_000_000 * DEFAULT_RATES_2025.nationalPension));
    expect(on.healthD).toBe(floor10(3_000_000 * DEFAULT_RATES_2025.health));
    expect(on.employmentD).toBe(floor10(3_000_000 * DEFAULT_RATES_2025.employment));
    // 과세 급여가 300만인 사람(보상금 없이 총액 320만)과 법정공제가 같다
    const same = computePayroll({ ...prof, baseWage: 3_200_000 }, {}, DEFAULT_RATES_2025, taxTable);
    expect(same.taxableGross).toBe(3_000_000);
    for (const k of ["pensionD", "healthD", "longTermD", "employmentD", "incomeTaxD", "localTaxD"] as const)
      expect(on[k]).toBe(same[k]);
    // 떼는 돈이 줄어 실수령이 는다
    expect(on.totalDeduct).toBeLessThan(off.totalDeduct);
    expect(on.net).toBe(on.gross - on.totalDeduct);
  });

  it("달라지는 것은 세무 처리뿐 — 지급액 계·기본급·보상금·통상시급은 그대로", () => {
    for (const k of ["gross", "baseP", "nonCompeteP", "mealP", "hourlyWage", "overtimeP", "nightP"] as const)
      expect(on[k]).toBe(off[k]);
    // 통상시급이 그대로라 연장·연차수당도 같다
    const m = { overtimeHours: 10, unusedLeaveDays: 2 };
    const a = computePayroll(withNc, m, DEFAULT_RATES_2025, taxTable);
    const b = computePayroll(withNc, m, ON, taxTable);
    expect(b.overtimeP).toBe(a.overtimeP);
    expect(b.unusedLeaveP).toBe(a.unusedLeaveP);
    expect(b.gross).toBe(a.gross);
  });

  it("보상금이 없는 직원은 켜도 꺼도 같다", () => {
    expect(computePayroll(prof, {}, ON, taxTable)).toEqual(computePayroll(prof, {}, DEFAULT_RATES_2025, taxTable));
  });

  it("위탁·사업소득(3.3%)에는 닿지 않는다 — 지급총액에 그대로 3.3%", () => {
    // 위탁(완전비율제) — 수수료 40% + 보상금 3%
    const tut: EmployeePayInput = {
      ...prof,
      payScheme: "RATIO",
      incomeType: "FREELANCE",
      baseWage: 0,
      mealAllow: 0,
      ratioPercent: 0.4,
      nonCompeteRatio: 0.03,
    };
    const m = { classRevenue: 10_000_000 };
    const a = computePayroll(tut, m, DEFAULT_RATES_2025, taxTable);
    const b = computePayroll(tut, m, ON, taxTable);
    expect(a.nonCompeteP).toBe(300_000);
    expect(b).toEqual(a);
    expect(b.nonCompeteNonTaxP).toBe(0);
    expect(b.incomeTaxD).toBe(floor10(4_300_000 * 0.03));
    // 세무구분이 사업소득인 월급제(위탁 아님)도 3.3% 라 닿지 않는다
    const free: EmployeePayInput = { ...withNc, incomeType: "FREELANCE" };
    expect(computePayroll(free, {}, ON, taxTable)).toEqual(computePayroll(free, {}, DEFAULT_RATES_2025, taxTable));
  });

  it("비율제 근로계약 — 상한 500만이면 자동 계산 기준이 500만 − 식대 20만 − 보상금 45만 = 435만", () => {
    const ratio: EmployeePayInput = {
      incomeType: "EMPLOYEE",
      payScheme: "RATIO",
      ratioEmployee: true,
      ratioWageCap: 5_000_000,
      baseWage: 0,
      positionAllow: 0,
      mealAllow: 200_000,
      carAllow: 0,
      dependents: 1,
      schedule: instructor,
      ratioPercent: 0.4,
      nonCompeteRatio: 0.03,
    };
    const m = { classRevenue: 15_000_000 };
    const a = computePayroll(ratio, m, DEFAULT_RATES_2025, taxTable);
    const b = computePayroll(ratio, m, ON, taxTable);
    expect(a.wageTaxable).toBe(4_800_000);
    expect(b.wageTaxable).toBe(4_350_000);
    expect(b.nonCompeteNonTaxP).toBe(450_000);
    expect(b.healthD).toBe(floor10(4_350_000 * DEFAULT_RATES_2025.health));
    // 상한 가르기·별도 사업장 몫·지급액은 그대로 — 상한은 여전히 비율급 + 보상금의 합에 걸린다
    for (const k of ["gross", "baseP", "mealP", "nonCompeteP", "bizIncomeP", "bizTaxD", "bizLocalTaxD", "hourlyWage"] as const)
      expect(b[k]).toBe(a[k]);
    expect(b.bizIncomeP).toBe(1_450_000);
  });

  it("산정 근거에 비과세로 처리했다는 사실을 남긴다(꺼져 있으면 없다)", () => {
    expect(on.notes.some((n) => n.includes("경업금지 보상금 300,000원을 비과세로 처리했습니다"))).toBe(true);
    expect(off.notes.some((n) => n.includes("비과세로 처리했습니다"))).toBe(false);
  });
});

describe("그 달 산정이 남긴 비과세 처리 표시 — nonCompeteNonTaxOf / withNonCompeteNonTax", () => {
  it("표시가 있을 때만 참 — 없음·깨진 값·다른 형은 거짓", () => {
    expect(nonCompeteNonTaxOf(JSON.stringify({ nonCompeteNonTax: true }))).toBe(true);
    expect(nonCompeteNonTaxOf("{}")).toBe(false);
    expect(nonCompeteNonTaxOf(null)).toBe(false);
    expect(nonCompeteNonTaxOf(undefined)).toBe(false);
    expect(nonCompeteNonTaxOf("깨진 값")).toBe(false);
    expect(nonCompeteNonTaxOf(JSON.stringify({ nonCompeteNonTax: "true" }))).toBe(false);
  });

  it("표시만 고치고 다른 근거는 그대로 둔다", () => {
    const base = JSON.stringify({ notes: ["가"], taxableGross: 3_300_000 });
    const turnedOn = withNonCompeteNonTax(base, true)!;
    expect(JSON.parse(turnedOn)).toEqual({ notes: ["가"], taxableGross: 3_300_000, nonCompeteNonTax: true });
    expect(JSON.parse(withNonCompeteNonTax(turnedOn, false)!)).toEqual({ notes: ["가"], taxableGross: 3_300_000 });
  });

  it("바뀔 것이 없으면 받은 값을 그대로 돌려준다(쓸데없이 다시 쓰지 않는다)", () => {
    const base = JSON.stringify({ notes: [] });
    expect(withNonCompeteNonTax(base, false)).toBe(base);
    const flagged = JSON.stringify({ nonCompeteNonTax: true });
    expect(withNonCompeteNonTax(flagged, true)).toBe(flagged);
    expect(withNonCompeteNonTax(null, false)).toBeNull();
  });

  it("근거가 비어 있으면 표시만 담아 만들고, 못 읽는 값은 건드리지 않는다", () => {
    expect(withNonCompeteNonTax(null, true)).toBe('{"nonCompeteNonTax":true}');
    expect(withNonCompeteNonTax("깨진 값", true)).toBe("깨진 값");
    expect(withNonCompeteNonTax("[1,2]", true)).toBe("[1,2]");
  });

  it("설정 화면의 경고는 무엇을 떠안는지와 먼저 할 일을 함께 적는다", () => {
    expect(NON_COMPETE_NONTAX_RISK_NOTE).toContain("열거된 항목");
    expect(NON_COMPETE_NONTAX_RISK_NOTE).toContain("추징");
    expect(NON_COMPETE_NONTAX_RISK_NOTE).toContain("세무대리인과 확인한 뒤");
  });
});

/* ───────────────────────── 퇴직급여 · 추이 ───────────────────────── */

describe("퇴직급여 — 보상금은 산정기준 임금에 넣지 않는다(v1.59.3 — 근로의 대가가 아니다)", () => {
  it("산정기준 임금 = 월 지급 총액 − 보상금, 뺀 사실은 제외 목록에 사유와 함께 남는다", () => {
    const items: SeverancePayItems = {
      baseP: 3_000_000,
      weeklyHolidayP: 0,
      positionP: 0,
      mealP: 200_000,
      carP: 0,
      nonCompeteP: 300_000,
      unusedLeaveP: 0,
      incentiveP: 0,
      bonusP: 0,
      extraP: 0,
      overtimeP: 0,
      nightP: 0,
      holidayP: 0,
      extraHours: 0,
      overtimeHours: 0,
      nightHours: 0,
      holidayHours: 0,
      holidayOverHours: 0,
      hourlyWage: 16_746,
      payScheme: "MONTHLY",
    };
    const b = severanceBase(items);
    expect(b.base).toBe(3_200_000); // 350만 − 보상금 30만
    expect(b.included.some(([l]) => l.includes("경업금지"))).toBe(false);
    expect(b.excluded).toContainEqual(["경업금지 보상금", 300_000, "근로의 대가가 아닌 경업금지 의무의 대가"]);
    // 산입 범위 설정을 전부 켜도 들어가지 않는다 — 설정은 임금 항목 가운데 무엇을 넣을지를 정하는 자리다
    const all = severanceBase(items, {
      ...DEFAULT_SEVERANCE_POLICY,
      includeIncentive: true,
      includeBonus: true,
      includeOvertime: true,
      includeUnusedLeave: true,
    });
    expect(all.base).toBe(3_200_000);
    // 법정 하한 경고도 띄우지 않는다(임금 항목을 뺀 것이 아니다)
    expect(underMinimumWarning(b)).toBeNull();
    // 보상금이 없는 기록은 예전 그대로
    const none = severanceBase({ ...items, baseP: 3_300_000, nonCompeteP: 0 });
    expect(none.base).toBe(3_500_000);
    expect(none.excluded.some(([l]) => l.includes("경업금지"))).toBe(false);
  });

  it("계약 추산도 같은 금액을 낸다 — 급여 기록에서 뽑은 값과 섞여도 누계가 매끄럽다", () => {
    const terms = {
      payScheme: "MONTHLY",
      baseWage: 3_500_000,
      positionAllow: 0,
      mealAllow: 200_000,
      carAllow: 0,
      isContractor: false,
      nonCompetePay: 300_000,
    };
    const est = estimateContractBase(terms);
    expect(est.base).toBe(3_200_000);
    expect(est.note).toContain("계약 월 급여총액 3,500,000원(식대·차량유지비·포괄임금 약정분 포함) − 경업금지 보상금 300,000원(근로의 대가 아님)");
    // 급여 엔진이 낸 그 달 기록의 산정기준과 같다
    const r = computePayroll({ ...prof, nonCompetePay: 300_000 }, {}, DEFAULT_RATES_2025, taxTable);
    const hours = { extraHours: 0, overtimeHours: 0, nightHours: 0, holidayHours: 0, holidayOverHours: 0 };
    expect(severanceBase({ ...r, ...hours, payScheme: "MONTHLY" }).base).toBe(est.base);
    // 직책수당은 총액 밖의 항목이라 그대로 더한다
    expect(estimateContractBase({ ...terms, positionAllow: 100_000 }).base).toBe(3_300_000);
    // 보상금이 없으면 예전 그대로
    const plain = estimateContractBase({ ...terms, nonCompetePay: null });
    expect(plain.base).toBe(3_500_000);
    expect(plain.note).not.toContain("경업금지");
    // 일할은 뺀 뒤의 금액에 건다
    expect(estimateContractBase(terms, { prorate: 0.5 }).base).toBe(1_600_000);
  });
});

describe("대시보드 추이 — 어느 갈래로 보든 합계가 같다", () => {
  it("보상금은 '계약 기본급' 에 들고 지급액 계와 맞는다", () => {
    const r: TrendRecord = {
      year: 2026,
      month: 12,
      department: "교수부",
      payScheme: "MONTHLY",
      baseP: 3_000_000,
      weeklyHolidayP: 0,
      positionP: 0,
      mealP: 200_000,
      carP: 0,
      nonCompeteP: 300_000,
      incentiveP: 50_000,
      bonusP: 0,
      unusedLeaveP: 0,
      extraP: 0,
      overtimeP: 0,
      nightP: 0,
      holidayP: 0,
      extraHours: 0,
      overtimeHours: 0,
      nightHours: 0,
      holidayHours: 0,
      holidayOverHours: 0,
      hourlyWage: 16_746,
    };
    expect(contractBaseOf(r)).toBe(3_500_000);
    expect(grossOf(r)).toBe(3_550_000);
    expect(contractBaseOf(r) + r.incentiveP + overtimeOf(r) + r.bonusP + r.unusedLeaveP).toBe(grossOf(r));
  });
});
