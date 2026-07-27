import { describe, it, expect } from "vitest";
import {
  computePayroll,
  computeWeeklyHours,
  lookupIncomeTax,
  floor10,
  blendWageTerms,
  DEFAULT_RATES_2025,
  type EmployeePayInput,
  type TaxBracketRow,
} from "./payroll";
import type { ScheduleDay } from "./constants";

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
