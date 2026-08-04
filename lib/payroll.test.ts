import { describe, it, expect } from "vitest";
import {
  computePayroll,
  computeWeeklyHours,
  lookupIncomeTax,
  floor10,
  blendWageTerms,
  inclusiveWageBreakdown,
  DEFAULT_RATES_2025,
  type EmployeePayInput,
  type TaxBracketRow,
} from "./payroll";
import type { ScheduleDay } from "./constants";
import { parkingDeductionOf } from "./constants";

const fullTime: ScheduleDay[] = [
  { day: "mon", work: true, start: "09:00", end: "18:00", breakH: 1 },
  { day: "tue", work: true, start: "09:00", end: "18:00", breakH: 1 },
  { day: "wed", work: true, start: "09:00", end: "18:00", breakH: 1 },
  { day: "thu", work: true, start: "09:00", end: "18:00", breakH: 1 },
  { day: "fri", work: true, start: "09:00", end: "18:00", breakH: 1 },
  { day: "sat", work: false, start: "00:00", end: "00:00", breakH: 0 },
  { day: "sun", work: false, start: "00:00", end: "00:00", breakH: 0 },
];

// 학원 강사 스케줄 (주 5일 15:00~22:00, 휴게 0.5)
const instructor: ScheduleDay[] = [
  { day: "mon", work: true, start: "15:00", end: "22:00", breakH: 0.5 },
  { day: "tue", work: true, start: "15:00", end: "22:00", breakH: 0.5 },
  { day: "wed", work: true, start: "15:00", end: "22:00", breakH: 0.5 },
  { day: "thu", work: true, start: "15:00", end: "22:00", breakH: 0.5 },
  { day: "fri", work: true, start: "15:00", end: "22:00", breakH: 0.5 },
  { day: "sat", work: false, start: "00:00", end: "00:00", breakH: 0 },
  { day: "sun", work: false, start: "00:00", end: "00:00", breakH: 0 },
];

const smallTaxTable: TaxBracketRow[] = [
  { lo: 0, hi: 2000, tax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { lo: 2000, hi: 3000, tax: [19520, 15330, 8930, 7440, 5960, 4480, 2760, 1130, 0, 0, 0] },
  { lo: 3000, hi: 4000, tax: [84850, 74350, 52250, 46630, 41010, 35390, 29770, 24150, 18530, 12910, 8290] },
  { lo: 4000, hi: null, tax: [200000, 180000, 160000, 140000, 120000, 100000, 90000, 80000, 70000, 60000, 50000] },
];

describe("floor10", () => {
  it("10원 미만 절사", () => {
    expect(floor10(81643.2)).toBe(81640);
    expect(floor10(13772.325)).toBe(13770);
    expect(floor10(99)).toBe(90);
  });
});

describe("computeWeeklyHours", () => {
  it("정규 09-18(휴게1) → 주 40시간, 주휴 8시간", () => {
    const r = computeWeeklyHours(fullTime);
    expect(r.weeklyContractual).toBe(40);
    expect(r.weeklyOvertime).toBe(0);
    expect(r.weeklyHoliday).toBe(8);
  });

  it("강사 15-22(휴게0.5) → 주 32.5시간, 주휴 6.5시간", () => {
    const r = computeWeeklyHours(instructor);
    expect(r.weeklyContractual).toBeCloseTo(32.5, 5);
    expect(r.weeklyHoliday).toBeCloseTo(6.5, 5);
  });

  it("1일 10시간 근무 → 연장 2시간 발생", () => {
    const long: ScheduleDay[] = [
      { day: "mon", work: true, start: "09:00", end: "20:00", breakH: 1 },
      { day: "tue", work: false, start: "00:00", end: "00:00", breakH: 0 },
      { day: "wed", work: false, start: "00:00", end: "00:00", breakH: 0 },
      { day: "thu", work: false, start: "00:00", end: "00:00", breakH: 0 },
      { day: "fri", work: false, start: "00:00", end: "00:00", breakH: 0 },
      { day: "sat", work: false, start: "00:00", end: "00:00", breakH: 0 },
      { day: "sun", work: false, start: "00:00", end: "00:00", breakH: 0 },
    ];
    const r = computeWeeklyHours(long);
    expect(r.weeklyContractual).toBe(8);
    expect(r.weeklyOvertime).toBe(2); // 10 - 1(휴게) = 10근로... 실근로 10 → 소정8 연장2
  });

  it("주 15시간 미만 → 주휴 0", () => {
    const part: ScheduleDay[] = [
      { day: "mon", work: true, start: "18:00", end: "22:00", breakH: 0 },
      { day: "tue", work: true, start: "18:00", end: "22:00", breakH: 0 },
      { day: "wed", work: false, start: "00:00", end: "00:00", breakH: 0 },
      { day: "thu", work: false, start: "00:00", end: "00:00", breakH: 0 },
      { day: "fri", work: false, start: "00:00", end: "00:00", breakH: 0 },
      { day: "sat", work: false, start: "00:00", end: "00:00", breakH: 0 },
      { day: "sun", work: false, start: "00:00", end: "00:00", breakH: 0 },
    ];
    const r = computeWeeklyHours(part); // 8시간/주
    expect(r.weeklyHoliday).toBe(0);
  });
});

describe("lookupIncomeTax", () => {
  it("구간/부양가족 조회", () => {
    // 3,200,000 → 3200천원 구간(3000~4000), 부양1 → index0
    expect(lookupIncomeTax(3_200_000, 1, smallTaxTable)).toBe(84850);
    // 부양 3명 → index2
    expect(lookupIncomeTax(3_200_000, 3, smallTaxTable)).toBe(52250);
    // 최고구간 초과
    expect(lookupIncomeTax(9_000_000, 1, smallTaxTable)).toBe(200000);
    // 과세 0
    expect(lookupIncomeTax(0, 1, smallTaxTable)).toBe(0);
  });
  it("부양가족 11명 초과는 11로 캡", () => {
    expect(lookupIncomeTax(3_200_000, 20, smallTaxTable)).toBe(8290);
  });
});

describe("computePayroll — 월급제 4대보험", () => {
  const emp: EmployeePayInput = {
    incomeType: "EMPLOYEE",
    payScheme: "MONTHLY",
    baseWage: 3_000_000,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    dependents: 1,
    schedule: fullTime,
  };

  it("4대보험 공제가 2025 요율로 계산된다", () => {
    const r = computePayroll(emp, {}, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.baseP).toBe(3_000_000);
    expect(r.gross).toBe(3_000_000);
    expect(r.pensionD).toBe(floor10(3_000_000 * 0.045)); // 135,000
    expect(r.employmentD).toBe(floor10(3_000_000 * 0.009)); // 27,000
    expect(r.healthD).toBe(floor10(3_000_000 * 0.03545)); // 106,350
    expect(r.longTermD).toBe(floor10(r.healthD * 0.1295)); // 13,770
    expect(r.incomeTaxD).toBe(84850);
    expect(r.localTaxD).toBe(floor10(84850 * 0.1)); // 8,480
    expect(r.net).toBe(r.gross - r.totalDeduct);
  });

  it("식대는 기본급 총액 안에 포함되고, 과세표준에서만 빠진다", () => {
    // 계약 총액 300만 · 그 중 식대 20만 비과세
    const withMeal = { ...emp, baseWage: 3_000_000, mealAllow: 200_000 };
    const r = computePayroll(withMeal, {}, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.baseP).toBe(2_800_000); // 명세서의 기본급 = 총액 − 비과세
    expect(r.mealP).toBe(200_000);
    expect(r.gross).toBe(3_000_000); // 총 지급액은 계약 총액 그대로 (더해지지 않음)
    expect(r.taxableGross).toBe(2_800_000); // 식대 제외
    expect(r.pensionD).toBe(floor10(2_800_000 * 0.045));
  });

  it("식대를 올려도 총 지급액은 그대로, 과세표준만 줄어든다", () => {
    const base = { ...emp, baseWage: 4_000_000, mealAllow: 0 };
    const withMeal = { ...base, mealAllow: 200_000 };
    const a = computePayroll(base, {}, DEFAULT_RATES_2025, smallTaxTable);
    const b = computePayroll(withMeal, {}, DEFAULT_RATES_2025, smallTaxTable);
    expect(a.gross).toBe(4_000_000);
    expect(b.gross).toBe(4_000_000); // 420만이 되지 않는다
    expect(b.baseP).toBe(3_800_000);
    expect(b.taxableGross).toBe(a.taxableGross - 200_000);
    expect(b.net).toBeGreaterThan(a.net); // 세금·보험료가 줄어 실수령은 늘어난다
  });

  it("차량유지비도 같은 방식으로 총액에 포함된다", () => {
    const r = computePayroll(
      { ...emp, baseWage: 4_000_000, mealAllow: 200_000, carAllow: 200_000 },
      {},
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.baseP).toBe(3_600_000);
    expect(r.gross).toBe(4_000_000);
    expect(r.taxableGross).toBe(3_600_000);
  });

  it("직책수당은 총액에 더해지는 별도 항목이다", () => {
    const r = computePayroll(
      { ...emp, baseWage: 4_000_000, mealAllow: 200_000, positionAllow: 300_000 },
      {},
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.gross).toBe(4_300_000);
  });

  it("비과세가 기본급보다 크면 0으로 막고 경고를 남긴다", () => {
    const r = computePayroll(
      { ...emp, baseWage: 150_000, mealAllow: 200_000 },
      {},
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.baseP).toBe(0);
    expect(r.notes.some((n) => n.includes("보다 큽니다"))).toBe(true);
  });
});

describe("computePayroll — 사업소득 3.3%", () => {
  it("4대보험 없이 3.3%만 공제", () => {
    const emp: EmployeePayInput = {
      incomeType: "FREELANCE",
      payScheme: "MONTHLY",
      baseWage: 4_000_000,
      positionAllow: 0,
      mealAllow: 0,
      carAllow: 0,
      dependents: 1,
      schedule: instructor,
    };
    const r = computePayroll(emp, {}, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.pensionD).toBe(0);
    expect(r.healthD).toBe(0);
    expect(r.incomeTaxD).toBe(floor10(4_000_000 * 0.03)); // 120,000
    expect(r.localTaxD).toBe(floor10(120_000 * 0.1)); // 12,000
    expect(r.totalDeduct).toBe(132_000); // 3.3%
    expect(r.net).toBe(3_868_000);
  });
});

describe("computePayroll — 인센티브", () => {
  it("학생수 초과분에 비례해 인센 지급", () => {
    const emp: EmployeePayInput = {
      incomeType: "FREELANCE",
      payScheme: "INCENTIVE",
      baseWage: 3_000_000,
      positionAllow: 0,
      mealAllow: 0,
      carAllow: 0,
      dependents: 1,
      schedule: instructor,
      incThreshold: 40,
      incPerStudent: 50_000,
    };
    const r = computePayroll(
      emp,
      { studentCount: 52 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.incentiveP).toBe((52 - 40) * 50_000); // 600,000
    expect(r.gross).toBe(3_600_000);
  });

  it("기준 이하이면 인센 0", () => {
    const emp: EmployeePayInput = {
      incomeType: "FREELANCE",
      payScheme: "INCENTIVE",
      baseWage: 3_000_000,
      positionAllow: 0,
      mealAllow: 0,
      carAllow: 0,
      dependents: 1,
      schedule: instructor,
      incThreshold: 40,
      incPerStudent: 50_000,
    };
    const r = computePayroll(emp, { studentCount: 30 }, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.incentiveP).toBe(0);
  });
});

describe("computePayroll — 완전비율제", () => {
  it("반 매출액 × 비율", () => {
    const emp: EmployeePayInput = {
      incomeType: "FREELANCE",
      payScheme: "RATIO",
      baseWage: 0,
      positionAllow: 0,
      mealAllow: 0,
      carAllow: 0,
      dependents: 1,
      schedule: instructor,
      ratioPercent: 0.5,
    };
    const r = computePayroll(
      emp,
      { classRevenue: 12_000_000 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.baseP).toBe(6_000_000);
    expect(r.gross).toBe(6_000_000);
    expect(r.incomeTaxD).toBe(floor10(6_000_000 * 0.03)); // 180,000
    expect(r.net).toBe(6_000_000 - 198_000);
  });
});

describe("computePayroll — 추가근로(법내연장) vs 법정연장 구분", () => {
  const emp: EmployeePayInput = {
    incomeType: "EMPLOYEE",
    payScheme: "MONTHLY",
    baseWage: 3_000_000,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    dependents: 1,
    schedule: instructor, // 주 32.5h — 법정한도(40h) 미만
  };

  it("추가h(법내연장)는 가산 없이 ×1.0", () => {
    const r = computePayroll(emp, { extraHours: 10 }, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.extraP).toBe(Math.round(10 * r.hourlyWage)); // 1.0배
    expect(r.gross).toBe(3_000_000 + r.extraP);
  });

  it("연장h(법정초과)는 ×1.5, 추가h와 독립적으로 합산", () => {
    const r = computePayroll(
      emp,
      { extraHours: 10, overtimeHours: 4 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.extraP).toBe(Math.round(10 * r.hourlyWage));
    expect(r.overtimeP).toBe(Math.round(4 * r.hourlyWage * 1.5));
    expect(r.gross).toBe(3_000_000 + r.extraP + r.overtimeP);
  });
});

describe("computePayroll — 퇴직유보금 (인센티브 × 1/12)", () => {
  const emp: EmployeePayInput = {
    incomeType: "FREELANCE",
    payScheme: "INCENTIVE",
    baseWage: 3_000_000,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    dependents: 1,
    schedule: instructor,
    incThreshold: 40,
    incPerStudent: 50_000,
  };

  it("인센티브 발생 시 원천액의 1/12(8.3%)를 공제(10원 절사)", () => {
    const r = computePayroll(emp, { studentCount: 52 }, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.incentiveP).toBe(600_000);
    expect(r.retentionD).toBe(floor10(600_000 / 12)); // 50,000
    expect(r.totalDeduct).toBe(r.incomeTaxD + r.localTaxD + r.retentionD);
  });

  it("인센티브 없으면 유보금 0", () => {
    const r = computePayroll(emp, { studentCount: 30 }, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.retentionD).toBe(0);
  });

  it("월급제(비인센티브)는 유보금 없음", () => {
    const m: EmployeePayInput = { ...emp, payScheme: "MONTHLY" };
    const r = computePayroll(m, {}, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.retentionD).toBe(0);
  });
});

describe("computePayroll — 일할계산 (월중 입·퇴사)", () => {
  it("월급제: 기본급·정액수당에 재직비율 적용", () => {
    const emp: EmployeePayInput = {
      incomeType: "EMPLOYEE",
      payScheme: "MONTHLY",
      baseWage: 3_000_000,
      positionAllow: 300_000,
      mealAllow: 200_000,
      carAllow: 0,
      dependents: 1,
      schedule: fullTime,
    };
    const r = computePayroll(emp, { prorationRatio: 0.5 }, DEFAULT_RATES_2025, smallTaxTable);
    // 기본급 300만 안에 식대 20만이 포함 → 과세 기본급 280만, 절반이면 140만
    expect(r.baseP).toBe(1_400_000);
    expect(r.positionP).toBe(150_000);
    expect(r.mealP).toBe(100_000);
    // 합계는 계약 총액(300만+직책 30만)의 절반 그대로
    expect(r.gross).toBe(1_650_000);
  });

  it("시급제: 추정근로시간·주휴수당에 재직비율 적용", () => {
    const emp: EmployeePayInput = {
      incomeType: "FREELANCE",
      payScheme: "HOURLY",
      baseWage: 12_000,
      positionAllow: 0,
      mealAllow: 0,
      carAllow: 0,
      dependents: 1,
      schedule: instructor, // 주 32.5h, 주휴 6.5h
    };
    const full = computePayroll(emp, {}, DEFAULT_RATES_2025, smallTaxTable);
    const half = computePayroll(emp, { prorationRatio: 0.5 }, DEFAULT_RATES_2025, smallTaxTable);
    expect(half.baseP).toBe(Math.round(12_000 * 32.5 * 4.345 * 0.5));
    expect(half.weeklyHolidayP).toBe(Math.round(12_000 * 6.5 * 4.345 * 0.5));
    expect(half.gross).toBeLessThan(full.gross);
  });

  it("비율제는 일할 미적용 (매출 기반)", () => {
    const emp: EmployeePayInput = {
      incomeType: "FREELANCE",
      payScheme: "RATIO",
      baseWage: 0,
      positionAllow: 0,
      mealAllow: 0,
      carAllow: 0,
      dependents: 1,
      schedule: instructor,
      ratioPercent: 0.5,
    };
    const r = computePayroll(
      emp,
      { classRevenue: 10_000_000, prorationRatio: 0.5 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.baseP).toBe(5_000_000); // 비율제는 그대로
  });
});

describe("computePayroll — 시급제 주휴수당", () => {
  it("주 15시간 이상이면 주휴수당 발생", () => {
    const emp: EmployeePayInput = {
      incomeType: "FREELANCE",
      payScheme: "HOURLY",
      baseWage: 12_000,
      positionAllow: 0,
      mealAllow: 0,
      carAllow: 0,
      dependents: 1,
      schedule: instructor, // 주 32.5h, 주휴 6.5h
    };
    const r = computePayroll(emp, {}, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.hourlyWage).toBe(12_000);
    // 주휴수당 = 시급 × 주휴시간 × 4.345
    expect(r.weeklyHolidayP).toBe(Math.round(12_000 * 6.5 * 4.345));
    expect(r.weeklyHolidayP).toBeGreaterThan(0);
  });
});

describe("computePayroll — 완전비율제 최저보장", () => {
  const emp: EmployeePayInput = {
    incomeType: "FREELANCE",
    payScheme: "RATIO",
    baseWage: 0,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    dependents: 1,
    schedule: fullTime,
    ratioPercent: 0.4,
    ratioMinGuarantee: 5_000_000,
  };

  it("수수료가 보장액에 못 미치면 보장액을 지급한다", () => {
    const r = computePayroll(emp, { classRevenue: 10_000_000 }, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.baseP).toBe(5_000_000); // 1000만 × 40% = 400만 → 보장 500만
    expect(r.notes.some((n) => n.includes("최저보장 적용"))).toBe(true);
  });

  it("수수료가 보장액을 넘으면 수수료 그대로", () => {
    const r = computePayroll(emp, { classRevenue: 20_000_000 }, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.baseP).toBe(8_000_000); // 2000만 × 40%
  });

  it("보장액이 없으면 종전대로 매출 × 비율", () => {
    const noFloor = { ...emp, ratioMinGuarantee: null };
    const r = computePayroll(noFloor, { classRevenue: 10_000_000 }, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.baseP).toBe(4_000_000);
    expect(r.notes.some((n) => n.includes("최저보장"))).toBe(false);
  });

  it("보장액 적용분도 사업소득 3.3% 원천징수 대상", () => {
    const r = computePayroll(emp, { classRevenue: 10_000_000 }, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.incomeTaxD).toBe(floor10(5_000_000 * 0.03));
  });
});

describe("inclusiveWageBreakdown — 포괄임금 분해", () => {
  // 실제 서명된 근로계약서 제4조를 그대로 재현할 수 있어야 한다.
  it("하수정 계약서 재현 (총액 500만 · 식대 20만 · 209h/4.345h/10.8625h)", () => {
    const iw = inclusiveWageBreakdown({
      baseWage: 5_000_000,
      mealAllow: 200_000,
      carAllow: 0,
      baseHours: 209,
      otHours: 4.345,
      nightHours: 10.8625,
    });
    expect(iw.hourlyWage).toBe(22_630); // 계약서 역산 22,629.7
    expect(iw.overtimePay).toBe(147_489);
    expect(iw.nightPay).toBe(122_907);
    expect(iw.basePay).toBe(4_529_604);
    // 항목 합계 = 기준급여
    expect(iw.basePay + iw.overtimePay + iw.nightPay + iw.nonTax).toBe(5_000_000);
  });

  it("최은희 계약서 재현 (총액 460만 · 172.062h — 주 33시간 스케줄 환산)", () => {
    const iw = inclusiveWageBreakdown({
      baseWage: 4_600_000,
      mealAllow: 200_000,
      baseHours: (33 + 6.6) * 4.345, // 172.062
      otHours: 4.345,
      nightHours: 10.8625,
    });
    expect(iw.overtimePay).toBe(162_928);
    expect(iw.nightPay).toBe(135_773);
    expect(iw.basePay).toBe(4_101_299);
    expect(iw.basePay + iw.overtimePay + iw.nightPay + iw.nonTax).toBe(4_600_000);
  });

  it("약정시간이 없으면 통상시급 = 기준급여 ÷ 산정시간, 기본급은 과세총액", () => {
    const iw = inclusiveWageBreakdown({
      baseWage: 3_000_000,
      mealAllow: 200_000,
      baseHours: 209,
    });
    expect(iw.hasFixed).toBe(false);
    expect(iw.hourlyWage).toBe(Math.round(3_000_000 / 209));
    expect(iw.overtimePay).toBe(0);
    expect(iw.nightPay).toBe(0);
    expect(iw.basePay).toBe(2_800_000);
  });

  it("일할계산은 모든 항목에 같은 비율로 걸리고 합계도 절반이 된다", () => {
    const iw = inclusiveWageBreakdown({
      baseWage: 5_000_000,
      baseHours: 209,
      otHours: 21.725,
      nightHours: 10.8625,
      prorate: 0.5,
    });
    expect(iw.basePay + iw.overtimePay + iw.nightPay).toBe(2_500_000);
  });
});

describe("computePayroll — 포괄임금(고정OT)", () => {
  const emp: EmployeePayInput = {
    incomeType: "EMPLOYEE",
    payScheme: "MONTHLY",
    baseWage: 5_000_000,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    dependents: 1,
    schedule: instructor,
    fixedBaseHours: 209,
    fixedOtHours: 21.725,
    fixedNightHours: 10.8625,
  };

  it("계약서 금액(기본급·시간외·야간)을 그대로 재현하고 합계는 총액", () => {
    const r = computePayroll(emp, {}, DEFAULT_RATES_2025, smallTaxTable);
    // 김지연 근로계약서 제4조: 기본급 4,230,448 / 시간외 659,616 / 야간 109,936
    expect(r.hourlyWage).toBe(20_241); // 5,000,000 ÷ 247.01875
    expect(r.baseP).toBe(4_230_448);
    expect(r.overtimeP).toBe(659_616);
    expect(r.nightP).toBe(109_936);
    expect(r.gross).toBe(5_000_000); // 약정분을 더해도 총액은 늘지 않는다
    expect(r.notes.some((n) => n.includes("포괄임금 분해"))).toBe(true);
  });

  it("약정시간을 넘긴 실근로만 추가 가산된다", () => {
    const r = computePayroll(emp, { overtimeHours: 10 }, DEFAULT_RATES_2025, smallTaxTable);
    const flat = computePayroll(emp, {}, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.overtimeP - flat.overtimeP).toBe(Math.round(10 * 20_241 * 1.5));
    expect(r.gross - flat.gross).toBe(Math.round(10 * 20_241 * 1.5));
  });

  it("식대는 총액 안에 포함되어 기본급에서만 빠진다", () => {
    const r = computePayroll(
      { ...emp, mealAllow: 200_000 },
      {},
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.mealP).toBe(200_000);
    expect(r.gross).toBe(5_000_000);
    expect(r.taxableGross).toBe(4_800_000);
    expect(r.baseP + r.overtimeP + r.nightP + r.mealP).toBe(5_000_000);
  });

  it("일할계산해도 항목 합계가 총액 × 비율", () => {
    const r = computePayroll(emp, { prorationRatio: 0.5 }, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.gross).toBe(2_500_000);
  });

  it("시급제·비율제에는 약정시간이 적용되지 않는다", () => {
    const hourly = computePayroll(
      { ...emp, payScheme: "HOURLY", baseWage: 15_000 },
      { workedHours: 100 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(hourly.overtimeP).toBe(0);
    expect(hourly.nightP).toBe(0);
  });

  it("약정시간이 없으면 종전 계산과 동일", () => {
    const plain = { ...emp, fixedBaseHours: null, fixedOtHours: null, fixedNightHours: null };
    const r = computePayroll(plain, {}, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.baseP).toBe(5_000_000);
    expect(r.overtimeP).toBe(0);
    expect(r.nightP).toBe(0);
  });
});

describe("blendWageTerms — 월중 계약 갱신 일할가중", () => {
  it("기본급 300만 → 400만, 16일 변경(30일 월) = 350만", () => {
    const b = blendWageTerms([
      { days: 15, baseWage: 3_000_000, positionAllow: 0, mealAllow: 200_000, carAllow: 0 },
      { days: 15, baseWage: 4_000_000, positionAllow: 0, mealAllow: 200_000, carAllow: 0 },
    ])!;
    expect(b.baseWage).toBe(3_500_000);
    expect(b.mealAllow).toBe(200_000); // 동일 조건은 그대로 유지
  });

  it("31일 월(16일 변경): 역일수 15/16 가중", () => {
    const b = blendWageTerms([
      { days: 15, baseWage: 3_000_000, positionAllow: 0, mealAllow: 0, carAllow: 0 },
      { days: 16, baseWage: 4_000_000, positionAllow: 0, mealAllow: 0, carAllow: 0 },
    ])!;
    expect(b.baseWage).toBe(Math.round((3_000_000 * 15 + 4_000_000 * 16) / 31));
  });

  it("시급 변경도 동일 규칙 (11,000 → 12,000)", () => {
    const b = blendWageTerms([
      { days: 15, baseWage: 11_000, positionAllow: 0, mealAllow: 0, carAllow: 0 },
      { days: 16, baseWage: 12_000, positionAllow: 0, mealAllow: 0, carAllow: 0 },
    ])!;
    expect(b.baseWage).toBe(Math.round((11_000 * 15 + 12_000 * 16) / 31)); // 11,516
  });

  it("단일 구간이면 해당 조건 그대로", () => {
    const b = blendWageTerms([
      { days: 31, baseWage: 3_000_000, positionAllow: 100_000, mealAllow: 200_000, carAllow: 0 },
    ])!;
    expect(b.baseWage).toBe(3_000_000);
    expect(b.positionAllow).toBe(100_000);
  });

  it("적용 일수 0 또는 빈 배열이면 null", () => {
    expect(blendWageTerms([])).toBeNull();
    expect(
      blendWageTerms([{ days: 0, baseWage: 1, positionAllow: 0, mealAllow: 0, carAllow: 0 }])
    ).toBeNull();
  });

  it("비율제 % 도 역일수 가중", () => {
    const b = blendWageTerms([
      { days: 15, baseWage: 0, positionAllow: 0, mealAllow: 0, carAllow: 0, ratioPercent: 0.4 },
      { days: 15, baseWage: 0, positionAllow: 0, mealAllow: 0, carAllow: 0, ratioPercent: 0.5 },
    ])!;
    expect(b.ratioPercent).toBeCloseTo(0.45, 10);
  });

  it("가중 기본급을 엔진에 넣으면 지급액에 반영 (월급제 350만)", () => {
    const blended = blendWageTerms([
      { days: 15, baseWage: 3_000_000, positionAllow: 0, mealAllow: 200_000, carAllow: 0 },
      { days: 15, baseWage: 4_000_000, positionAllow: 0, mealAllow: 200_000, carAllow: 0 },
    ])!;
    const emp: EmployeePayInput = {
      incomeType: "EMPLOYEE",
      payScheme: "MONTHLY",
      baseWage: blended.baseWage,
      positionAllow: blended.positionAllow,
      mealAllow: blended.mealAllow,
      carAllow: blended.carAllow,
      dependents: 1,
      schedule: fullTime,
    };
    const r = computePayroll(emp, {}, DEFAULT_RATES_2025, smallTaxTable);
    // 총액 350만 안에 식대 20만 포함 → 과세 기본급 330만 + 식대 20만 = 350만
    expect(r.baseP).toBe(3_300_000);
    expect(r.mealP).toBe(200_000);
    expect(r.gross).toBe(3_500_000);
  });
});

describe("computePayroll — 인센티브 가중 인원(명단 기반)", () => {
  const emp: EmployeePayInput = {
    incomeType: "FREELANCE",
    payScheme: "INCENTIVE",
    baseWage: 4_400_000,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    dependents: 1,
    schedule: instructor,
    incThreshold: 40,
    incPerStudent: 100_000,
  };

  it("23년 7월 김지연 실제 사례: 가중 61.625명 → 인센티브 2,162,500원", () => {
    const r = computePayroll(
      emp,
      { studentUnits: 61.625 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.incentiveP).toBe(2_162_500);
    expect(r.gross).toBe(4_400_000 + 2_162_500); // 6,562,500
    // 사업소득 3.3% = 216,550원
    expect(r.incomeTaxD + r.localTaxD).toBe(216_550);
  });

  it("가중 인원이 있으면 studentCount 대신 사용", () => {
    const r = computePayroll(
      emp,
      { studentCount: 45, studentUnits: 41.5 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.incentiveP).toBe(150_000); // (41.5-40) × 100,000
  });
});

describe("반올림 잔차 — 지급 합계는 언제나 계약 총액과 정확히 일치한다", () => {
  const sch: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri"].map((d) => ({
    day: d as ScheduleDay["day"],
    work: true,
    start: "14:00",
    end: "22:00",
    breakH: 0.5,
  }));

  const run = (o: {
    baseWage: number;
    scheme?: "MONTHLY" | "INCENTIVE";
    baseHours?: number | null;
    ot?: number;
    night?: number;
    meal?: number;
    car?: number;
    pos?: number;
    prorate?: number;
  }) =>
    computePayroll(
      {
        incomeType: "EMPLOYEE",
        payScheme: o.scheme ?? "MONTHLY",
        baseWage: o.baseWage,
        positionAllow: o.pos ?? 0,
        mealAllow: o.meal ?? 0,
        carAllow: o.car ?? 0,
        dependents: 1,
        schedule: sch,
        fixedBaseHours: o.baseHours ?? null,
        fixedOtHours: o.ot ?? 0,
        fixedNightHours: o.night ?? 0,
      } as EmployeePayInput,
      { prorationRatio: o.prorate ?? 1 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );

  it("포괄임금 약정이 있어도 총액이 1원도 어긋나지 않는다 (홍경지 3,400,000)", () => {
    // 고치기 전에는 약정 시간외·야간을 반올림 전 값으로 빼서 3,399,999 가 나왔다
    const r = run({ baseWage: 3_400_000, baseHours: 209, ot: 8, night: 8, meal: 200_000 });
    expect(r.gross).toBe(3_400_000);
  });

  it("반대로 1원이 더 붙지도 않는다 (김영서 2,700,000)", () => {
    const r = run({ baseWage: 2_700_000, baseHours: 209, ot: 5, night: 10, meal: 200_000 });
    expect(r.gross).toBe(2_700_000);
  });

  it("일할계산 + 식대 조합도 어긋나지 않는다 (약정시간이 없어도 새던 경우)", () => {
    const p = 30 / 31;
    const r = run({ baseWage: 3_400_000, baseHours: 209, meal: 200_000, prorate: p });
    expect(r.gross).toBe(Math.round(3_400_000 * p));
  });

  it("직책수당은 총액에 가산되고 그 합도 정확하다", () => {
    const r = run({ baseWage: 2_700_000, baseHours: 209, ot: 12, meal: 200_000, pos: 300_000 });
    expect(r.gross).toBe(3_000_000);
  });

  it("잔차는 전부 기본급이 흡수한다 — 항목 합계 = 기준급여", () => {
    const iw = inclusiveWageBreakdown({
      baseWage: 3_400_000,
      mealAllow: 200_000,
      baseHours: 209,
      otHours: 8,
      nightHours: 8,
    });
    expect(iw.basePay + iw.nonTax + iw.overtimePay + iw.nightPay).toBe(3_400_000);
    expect(iw.target).toBe(3_400_000);
  });

  it("여러 조건을 훑어도 총액이 항상 맞는다", () => {
    const off: string[] = [];
    for (const baseWage of [3_400_000, 2_700_000, 2_345_678, 1_999_999])
      for (const baseHours of [209, 174])
        for (const ot of [0, 5, 8, 12])
          for (const night of [0, 4, 10])
            for (const meal of [0, 200_000, 133_333])
              for (const pos of [0, 111_111])
                for (const prorate of [1, 0.5, 17 / 31]) {
                  const r = run({ baseWage, baseHours, ot, night, meal, pos, prorate });
                  const want = Math.round(baseWage * prorate) + Math.round(pos * prorate);
                  if (r.gross !== want)
                    off.push(`${baseWage}/${baseHours}/${ot}/${night}/${meal}/${pos}/${prorate}: ${r.gross} ≠ ${want}`);
                }
    expect(off).toEqual([]);
  });
});

describe("위탁계약(프리랜서) — 근로기준법 항목을 일절 싣지 않는다", () => {
  // 주2일 15시간 초과지만 위탁계약이라 주휴·연차·퇴직금·4대보험이 없는 케이스
  const hourly: ScheduleDay[] = ["mon", "thu"].map((d) => ({
    day: d as ScheduleDay["day"],
    work: true,
    start: "14:00",
    end: "22:00",
    breakH: 0.5,
  })); // 주 15시간

  const run = (o: any = {}) =>
    computePayroll(
      {
        incomeType: o.incomeType ?? "FREELANCE",
        payScheme: o.payScheme ?? "HOURLY",
        isContractor: o.isContractor ?? true,
        baseWage: o.baseWage ?? 20_000,
        positionAllow: 0,
        mealAllow: 0,
        carAllow: 0,
        dependents: 1,
        schedule: o.schedule ?? hourly,
        incThreshold: o.incThreshold ?? null,
        incPerStudent: o.incPerStudent ?? null,
      } as EmployeePayInput,
      o.month ?? { workedHours: 60, weeklyHolidayHours: 12 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );

  it("주 15시간을 넘겨도 주휴수당이 붙지 않는다", () => {
    const r = run();
    expect(r.weeklyHolidayP).toBe(0);
    expect(r.baseP).toBe(1_200_000); // 시급 20,000 × 60시간
    expect(r.gross).toBe(1_200_000);
    expect(r.notes.join()).toContain("위탁계약(프리랜서) — 주휴수당 미적용");
  });

  it("같은 조건이라도 위탁 체크를 풀면 주휴가 붙는다 (플래그가 실제로 작동함)", () => {
    const r = run({ isContractor: false });
    expect(r.weeklyHolidayP).toBe(240_000); // 20,000 × 12시간
    expect(r.gross).toBe(1_440_000);
  });

  it("4대보험을 떼지 않고 사업소득 3.3%로 처리한다", () => {
    const r = run();
    expect(r.pensionD).toBe(0);
    expect(r.healthD).toBe(0);
    expect(r.longTermD).toBe(0);
    expect(r.employmentD).toBe(0);
    expect(r.incomeTaxD).toBe(floor10(1_200_000 * 0.03));
  });

  it("세무구분이 실수로 근로소득이어도 보험료를 떼지 않고 안내를 남긴다", () => {
    const r = run({ incomeType: "EMPLOYEE" });
    expect(r.pensionD).toBe(0);
    expect(r.healthD).toBe(0);
    expect(r.notes.join()).toContain("세무구분을 '사업소득(3.3%)'으로 맞춰");
  });

  it("연장·야간·휴일 가산은 시간을 넣어도 0원", () => {
    const r = run({
      month: { workedHours: 60, extraHours: 5, overtimeHours: 5, nightHours: 5, holidayHours: 5 },
    });
    expect(r.extraP).toBe(0);
    expect(r.overtimeP).toBe(0);
    expect(r.nightP).toBe(0);
    expect(r.holidayP).toBe(0);
    expect(r.gross).toBe(1_200_000);
  });

  it("연차미사용수당도 없다", () => {
    const r = run({ month: { workedHours: 60, unusedLeaveDays: 5 } });
    expect(r.unusedLeaveP).toBe(0);
  });

  it("인센티브 계약이어도 퇴직유보금을 떼지 않는다", () => {
    const r = run({
      payScheme: "INCENTIVE",
      baseWage: 3_000_000,
      incThreshold: 10,
      incPerStudent: 100_000,
      month: { studentCount: 20 },
    });
    expect(r.incentiveP).toBe(1_000_000);
    expect(r.retentionD).toBe(0);
  });

  it("완전비율제는 체크하지 않아도 언제나 위탁으로 본다", () => {
    const r = computePayroll(
      {
        incomeType: "FREELANCE",
        payScheme: "RATIO",
        baseWage: 0,
        positionAllow: 0,
        mealAllow: 0,
        carAllow: 0,
        dependents: 1,
        schedule: hourly,
        ratioPercent: 0.5,
      } as EmployeePayInput,
      { classRevenue: 4_000_000, unusedLeaveDays: 3 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.unusedLeaveP).toBe(0);
    expect(r.pensionD).toBe(0);
    expect(r.gross).toBe(2_000_000);
  });

  it("위탁계약에는 포괄임금(고정OT) 분해를 적용하지 않아 총액이 그대로다", () => {
    const r = computePayroll(
      {
        incomeType: "FREELANCE",
        payScheme: "MONTHLY",
        isContractor: true,
        baseWage: 3_000_000,
        positionAllow: 0,
        mealAllow: 200_000,
        carAllow: 0,
        dependents: 1,
        schedule: hourly,
        fixedBaseHours: 209,
        fixedOtHours: 12,
        fixedNightHours: 8,
      } as EmployeePayInput,
      {},
      DEFAULT_RATES_2025,
      smallTaxTable
    );
    expect(r.overtimeP).toBe(0);
    expect(r.nightP).toBe(0);
    expect(r.baseP).toBe(2_800_000); // 300만 − 식대 20만
    expect(r.gross).toBe(3_000_000);
  });
});

describe("parkingDeductionOf — 월 정기주차 공제(50%)", () => {
  it("월 주차비의 절반을 공제한다", () => {
    expect(parkingDeductionOf(100_000)).toBe(50_000);
    expect(parkingDeductionOf(70_000)).toBe(35_000);
  });
  it("다른 공제와 같이 10원 절사", () => {
    expect(parkingDeductionOf(55_555)).toBe(27_770); // 27,777.5 → 27,770
  });
  it("입력이 없거나 0이면 공제하지 않는다", () => {
    expect(parkingDeductionOf(0)).toBe(0);
    expect(parkingDeductionOf(null)).toBe(0);
    expect(parkingDeductionOf(undefined)).toBe(0);
    expect(parkingDeductionOf(-10_000)).toBe(0);
  });
});

describe("퇴직유보금 — 인센티브 직원에게 항상, 위탁계약은 제외", () => {
  const run = (o: any) =>
    computePayroll(
      {
        incomeType: o.incomeType ?? "EMPLOYEE",
        payScheme: o.payScheme ?? "INCENTIVE",
        isContractor: o.isContractor ?? false,
        baseWage: 3_000_000,
        positionAllow: 0,
        mealAllow: 0,
        carAllow: 0,
        dependents: 1,
        schedule: instructor,
        incThreshold: 10,
        incPerStudent: 100_000,
      } as EmployeePayInput,
      { studentCount: o.students ?? 20 },
      DEFAULT_RATES_2025,
      smallTaxTable
    );

  it("인센티브가 발생하면 8.3%를 유보한다 (근로소득)", () => {
    const r = run({});
    expect(r.incentiveP).toBe(1_000_000);
    expect(r.retentionD).toBe(floor10(1_000_000 / 12));
  });

  it("사업소득(3.3%) 인센티브 강사도 유보 대상이다", () => {
    // 위탁계약 체크를 하지 않는 한 세무구분만으로는 빠지지 않는다
    expect(run({ incomeType: "FREELANCE" }).retentionD).toBe(floor10(1_000_000 / 12));
  });

  it("위탁계약(프리랜서)이면 유보하지 않는다 — 퇴직급여 대상이 아니다", () => {
    expect(run({ isContractor: true }).retentionD).toBe(0);
  });

  it("그 달 인센티브가 0이면 유보액도 0", () => {
    expect(run({ students: 5 }).retentionD).toBe(0);
  });
});
