import { describe, it, expect } from "vitest";
import {
  computePayroll,
  computeWeeklyHours,
  lookupIncomeTax,
  floor10,
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

  it("식대 비과세는 과세표준에서 제외된다", () => {
    const withMeal = { ...emp, mealAllow: 200_000, baseWage: 2_800_000 };
    const r = computePayroll(withMeal, {}, DEFAULT_RATES_2025, smallTaxTable);
    expect(r.gross).toBe(3_000_000); // 2.8M + 식대 0.2M
    expect(r.taxableGross).toBe(2_800_000); // 식대 제외
    expect(r.pensionD).toBe(floor10(2_800_000 * 0.045));
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
