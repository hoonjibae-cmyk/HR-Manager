// 무급휴직이 급여 산정에 닿는 자리 — 엔진(computePayroll)·월중 계약 가중(applyMidMonthBlend)
import { describe, it, expect } from "vitest";
import { computePayroll, DEFAULT_RATES_2025, type EmployeePayInput, type TaxBracketRow } from "./payroll";
import { applyMidMonthBlend, type MonthContractTerms } from "./payroll-service";
import { monthPayDays, unpaidLeaveMetaOf, unpaidDaysBetween } from "./unpaid-leave";
import type { ScheduleDay } from "./constants";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const leave = (a: string, b: string) => ({ startDate: d(a), endDate: d(b) });
const HIRE = d("2024-03-04");

// 14~22시 · 휴게 30분 — 주 37.5시간
const schedule: ScheduleDay[] = (["mon", "tue", "wed", "thu", "fri"] as const)
  .map((day) => ({ day, work: true, start: "14:00", end: "22:00", breakH: 0.5 }) as ScheduleDay)
  .concat([
    { day: "sat", work: false, start: "00:00", end: "00:00", breakH: 0 },
    { day: "sun", work: false, start: "00:00", end: "00:00", breakH: 0 },
  ]);

const tax: TaxBracketRow[] = [
  { lo: 0, hi: 2000, tax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { lo: 2000, hi: null, tax: [50000, 40000, 30000, 20000, 10000, 0, 0, 0, 0, 0, 0] },
];

const monthly = (over: Partial<EmployeePayInput> = {}): EmployeePayInput => ({
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseWage: 3_000_000,
  positionAllow: 0,
  mealAllow: 200_000,
  carAllow: 0,
  dependents: 1,
  schedule,
  ...over,
});

/** 서비스가 하는 일 그대로 — 그 달 지급 일수에서 비율과 근거를 만든다 */
function monthInput(year: number, month: number, leaves: ReturnType<typeof leave>[], hire = HIRE, resign: Date | null = null) {
  const pd = monthPayDays(year, month, hire, resign, leaves);
  return { prorationRatio: pd.ratio, unpaidLeave: unpaidLeaveMetaOf(pd) };
}

describe("computePayroll — 무급휴직 (역일수 일할)", () => {
  it("★ 월급 300만(식대 20만 포함) · 11/16~11/30 무급 → 지급액 150만, 식대 10만", () => {
    const r = computePayroll(monthly(), monthInput(2026, 11, [leave("2026-11-16", "2026-11-30")]), DEFAULT_RATES_2025, tax);
    expect(r.baseP).toBe(1_400_000);
    expect(r.mealP).toBe(100_000);
    expect(r.gross).toBe(1_500_000);
  });

  it("★ 같은 날 수만큼 늦게 입사한 사람과 금액이 같다 — 입·퇴사 일할과 같은 방식", () => {
    const onLeave = computePayroll(monthly(), monthInput(2026, 11, [leave("2026-11-01", "2026-11-15")]), DEFAULT_RATES_2025, tax);
    const hired = computePayroll(monthly(), monthInput(2026, 11, [], d("2026-11-16")), DEFAULT_RATES_2025, tax);
    expect(onLeave.gross).toBe(hired.gross);
    expect(onLeave.baseP).toBe(hired.baseP);
    expect(onLeave.mealP).toBe(hired.mealP);
  });

  it("통상시급은 그대로다 — 월 금액끼리 나눈 값이라 쉰 날 수와 무관하다", () => {
    const full = computePayroll(monthly(), {}, DEFAULT_RATES_2025, tax);
    const half = computePayroll(monthly(), monthInput(2026, 11, [leave("2026-11-16", "2026-11-30")]), DEFAULT_RATES_2025, tax);
    expect(half.hourlyWage).toBe(full.hourlyWage);
    expect(half.hourlyWage).toBeGreaterThan(0);
  });

  it("산정 근거가 「재직비율」이 아니라 무급휴직 기간·일수로 적힌다", () => {
    const r = computePayroll(monthly(), monthInput(2026, 11, [leave("2026-11-16", "2026-11-30")]), DEFAULT_RATES_2025, tax);
    const note = r.notes.find((n) => n.includes("무급휴직"))!;
    expect(note).toContain("11/16~11/30(15일)");
    expect(note).toContain("15일 ÷ 30일");
    expect(r.notes.some((n) => n.includes("재직비율"))).toBe(false);
  });

  it("무급휴직이 없으면 예전 문구 그대로다", () => {
    const r = computePayroll(monthly(), { prorationRatio: 0.5 }, DEFAULT_RATES_2025, tax);
    expect(r.notes).toContain("일할계산 적용 (재직비율 50.0%)");
    expect(r.notes.some((n) => n.includes("무급휴직"))).toBe(false);
  });

  it("한 달을 통째로 쉬면 기본급·수당이 0원 — 직접 넣은 상여·연차수당은 그대로 지급된다", () => {
    const m = monthInput(2026, 11, [leave("2026-11-01", "2026-11-30")]);
    expect(m.prorationRatio).toBe(0);
    const zero = computePayroll(monthly({ positionAllow: 100_000 }), m, DEFAULT_RATES_2025, tax);
    expect(zero.gross).toBe(0);
    const withBonus = computePayroll(monthly(), { ...m, bonus: 500_000, unusedLeaveDays: 2 }, DEFAULT_RATES_2025, tax);
    expect(withBonus.bonusP).toBe(500_000);
    expect(withBonus.unusedLeaveP).toBeGreaterThan(0);
    expect(withBonus.gross).toBe(500_000 + withBonus.unusedLeaveP);
  });

  it("직책수당 등 월 정액 수당도 같은 비율로 준다", () => {
    const r = computePayroll(
      monthly({ positionAllow: 300_000 }),
      monthInput(2026, 11, [leave("2026-11-21", "2026-11-30")]), // 10일 무급 → 20/30
      DEFAULT_RATES_2025,
      tax
    );
    expect(r.positionP).toBe(200_000);
    expect(r.gross).toBe(Math.round((3_000_000 * 20) / 30) + 200_000);
  });

  it("포괄임금 약정분·경업금지 보상금도 총액과 함께 줄고, 항목 합계는 일할한 총액과 맞는다", () => {
    const emp = monthly({
      baseWage: 3_500_000,
      fixedBaseHours: 209,
      fixedOtHours: 20,
      nonCompetePay: 300_000,
    });
    const full = computePayroll(emp, {}, DEFAULT_RATES_2025, tax);
    const part = computePayroll(emp, monthInput(2026, 11, [leave("2026-11-25", "2026-11-30")]), DEFAULT_RATES_2025, tax); // 24/30
    expect(part.gross).toBe(Math.round((3_500_000 * 24) / 30));
    expect(part.nonCompeteP).toBe(Math.round((300_000 * 24) / 30));
    expect(part.overtimeP).toBe(Math.round((full.overtimeP * 24) / 30));
    expect(part.baseP + part.mealP + part.overtimeP + part.nightP + part.nonCompeteP).toBe(part.gross);
  });

  it("자동 공제 계산은 줄어든 급여를 기준으로 잰다", () => {
    const full = computePayroll(monthly(), {}, DEFAULT_RATES_2025, tax);
    const half = computePayroll(monthly(), monthInput(2026, 11, [leave("2026-11-16", "2026-11-30")]), DEFAULT_RATES_2025, tax);
    expect(half.taxableGross).toBe(1_400_000);
    expect(half.employmentD).toBeLessThan(full.employmentD);
    expect(half.healthD).toBeLessThan(full.healthD);
  });

  it("완전비율제는 일할하지 않는다 — 그 사실과 최저보장 확인을 근거에 적는다", () => {
    const emp: EmployeePayInput = {
      incomeType: "FREELANCE",
      payScheme: "RATIO",
      ratioEmployee: true,
      baseWage: 0,
      positionAllow: 0,
      mealAllow: 0,
      carAllow: 0,
      dependents: 1,
      schedule,
      ratioPercent: 0.4,
    } as EmployeePayInput;
    const base = computePayroll(emp, { classRevenue: 10_000_000 }, DEFAULT_RATES_2025, tax);
    const r = computePayroll(
      emp,
      { classRevenue: 10_000_000, ...monthInput(2026, 11, [leave("2026-11-16", "2026-11-30")]) },
      DEFAULT_RATES_2025,
      tax
    );
    expect(r.gross).toBe(base.gross);
    const note = r.notes.find((n) => n.includes("무급휴직"))!;
    expect(note).toContain("일할하지 않습니다");
    expect(note).toContain("최저보장");
  });

  it("시급제 — 출퇴근 기록이 있으면 시간은 그대로, 월 정액 수당만 일할한다", () => {
    const emp: EmployeePayInput = {
      incomeType: "EMPLOYEE",
      payScheme: "HOURLY",
      baseWage: 12_000,
      positionAllow: 0,
      mealAllow: 100_000,
      carAllow: 0,
      dependents: 1,
      schedule,
    };
    const r = computePayroll(
      emp,
      { workedHours: 60, weeklyHolidayHours: 8, ...monthInput(2026, 11, [leave("2026-11-16", "2026-11-30")]) },
      DEFAULT_RATES_2025,
      tax
    );
    expect(r.baseP).toBe(12_000 * 60);
    expect(r.weeklyHolidayP).toBe(12_000 * 8);
    expect(r.mealP).toBe(50_000);
    expect(r.notes.find((n) => n.includes("무급휴직"))).toContain("월 정액 수당만 15/30");
  });

  it("시급제 — 기록표 없이 어림잡은 달은 추정 시간에도 같은 비율이 걸린다", () => {
    const emp: EmployeePayInput = {
      incomeType: "EMPLOYEE",
      payScheme: "HOURLY",
      baseWage: 12_000,
      positionAllow: 0,
      mealAllow: 0,
      carAllow: 0,
      dependents: 1,
      schedule,
    };
    const full = computePayroll(emp, {}, DEFAULT_RATES_2025, tax);
    const half = computePayroll(emp, monthInput(2026, 11, [leave("2026-11-16", "2026-11-30")]), DEFAULT_RATES_2025, tax);
    expect(half.baseP).toBe(Math.round(full.baseP / 2));
    expect(half.notes.find((n) => n.includes("무급휴직"))).toContain("역일수 일할");
  });
});

describe("월중 계약 변경 + 무급휴직 — 구간 일수는 '급여가 나간 날' 이다", () => {
  const seg = (days: number, baseWage: number) => ({
    days,
    baseWage,
    positionAllow: 0,
    mealAllow: 200_000,
    carAllow: 0,
    ratioPercent: null,
  });

  /** 11월: 1~15일 300만, 16~30일 400만. 휴직을 뺀 구간 일수(서비스 `wageSegmentsFor` 가 하는 일) */
  function novSegs(leaves: ReturnType<typeof leave>[]): MonthContractTerms {
    const a = 15 - unpaidDaysBetween(d("2026-11-01"), d("2026-11-15"), leaves);
    const b = 15 - unpaidDaysBetween(d("2026-11-16"), d("2026-11-30"), leaves);
    return { segs: [seg(a, 3_000_000), seg(b, 4_000_000)], futureStart: null };
  }

  function payFor(leaves: ReturnType<typeof leave>[]) {
    // 그 달 말일 계약(400만)이 카드에 실려 온다 — employeesWithMonthTerms
    const payInput = monthly({ baseWage: 4_000_000 });
    const blend = applyMidMonthBlend(payInput, novSegs(leaves));
    const r = computePayroll(payInput, monthInput(2026, 11, leaves), DEFAULT_RATES_2025, tax);
    return { r, blend, payInput };
  }

  it("휴직이 없으면 예전 그대로 — (15×300만 + 15×400만) ÷ 30", () => {
    const { r, blend } = payFor([]);
    expect(r.gross).toBe(3_500_000);
    expect(blend?.info?.segments).toHaveLength(2);
  });

  it("★ 새 조건인 날만 쉬었으면 옛 조건의 급여는 온전히 나간다 (16~30일 무급 → 300만 × 15/30)", () => {
    const { r, blend, payInput } = payFor([leave("2026-11-16", "2026-11-30")]);
    expect(payInput.baseWage).toBe(3_000_000); // 가중이 300만 쪽으로만 실린다
    expect(r.gross).toBe(1_500_000);
    // 급여가 나간 구간이 하나뿐이라 명세서에 가중 식을 적지 않는다
    expect(blend?.info).toBeNull();
  });

  it("★ 옛 조건인 날만 쉬었으면 새 조건의 급여가 온전히 나간다 (1~15일 무급 → 400만 × 15/30)", () => {
    const { r } = payFor([leave("2026-11-01", "2026-11-15")]);
    expect(r.gross).toBe(2_000_000);
  });

  it("두 구간에 걸쳐 쉬면 Σ(조건 × 지급일수) ÷ 30 과 맞는다", () => {
    // 11/11~11/20 무급 → 300만 10일 + 400만 10일
    const { r, blend } = payFor([leave("2026-11-11", "2026-11-20")]);
    const expected = Math.round((3_000_000 * 10 + 4_000_000 * 10) / 30);
    expect(Math.abs(r.gross - expected)).toBeLessThanOrEqual(1);
    expect(blend?.info?.totalDays).toBe(20);
  });

  it("한 달을 통째로 쉬면 0원 — 가중할 날이 없어도 깨지지 않는다", () => {
    const { r, blend } = payFor([leave("2026-11-01", "2026-11-30")]);
    expect(r.gross).toBe(0);
    expect(blend).toBeNull();
  });
});
