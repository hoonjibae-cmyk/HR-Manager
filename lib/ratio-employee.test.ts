import { describe, it, expect } from "vitest";
import {
  computePayroll,
  splitRatioPay,
  businessWithholding,
  floor10,
  DEFAULT_RATES_2025,
  type EmployeePayInput,
  type TaxBracketRow,
} from "./payroll";
import {
  isContractorContract,
  isRatioEmployee,
  paySchemeLabelOf,
  RATIO_EMPLOYEE_LABEL,
  type ScheduleDay,
} from "./constants";
import {
  DEFAULT_RATIO_WAGE_CAP,
  parseRatioWageCap,
  normalizeRatioTerms,
  recordSplit,
  bizPayerMissing,
  bizPayerOf,
} from "./ratio-employee";
import {
  nonCompeteRatioApplies,
  nonCompeteRatioRequired,
  nonCompeteRatioRequiredMessage,
  resolveNonCompeteRatio,
} from "./non-compete";

// 학원 강사 — 주 5일 14:00~22:00, 휴게 30분 → 1일 7.5h · 주 37.5h · 주휴 7.5h
const teacher: ScheduleDay[] = [
  { day: "mon", work: true, start: "14:00", end: "22:00", breakH: 0.5 },
  { day: "tue", work: true, start: "14:00", end: "22:00", breakH: 0.5 },
  { day: "wed", work: true, start: "14:00", end: "22:00", breakH: 0.5 },
  { day: "thu", work: true, start: "14:00", end: "22:00", breakH: 0.5 },
  { day: "fri", work: true, start: "14:00", end: "22:00", breakH: 0.5 },
  { day: "sat", work: false, start: "00:00", end: "00:00", breakH: 0 },
  { day: "sun", work: false, start: "00:00", end: "00:00", breakH: 0 },
];
// (37.5 + 7.5) × 4.345
const MONTH_HOURS = 195.525;

const taxTable: TaxBracketRow[] = [
  { lo: 0, hi: 4000, tax: [50000, 40000, 30000, 20000, 10000, 0, 0, 0, 0, 0, 0] },
  { lo: 4000, hi: 6000, tax: [300000, 280000, 260000, 240000, 220000, 200000, 180000, 160000, 140000, 120000, 100000] },
  { lo: 6000, hi: null, tax: [500000, 480000, 460000, 440000, 420000, 400000, 380000, 360000, 340000, 320000, 300000] },
];

function ratioEmp(over: Partial<EmployeePayInput> = {}): EmployeePayInput {
  return {
    incomeType: "EMPLOYEE",
    payScheme: "RATIO",
    ratioEmployee: true,
    ratioWageCap: DEFAULT_RATIO_WAGE_CAP,
    baseWage: 0,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    dependents: 1,
    schedule: teacher,
    ratioPercent: 0.4,
    ...over,
  };
}

describe("isContractorContract — 비율제 근로계약", () => {
  it("완전비율제는 기본이 위탁이다(지금까지와 같다)", () => {
    expect(isContractorContract({ payScheme: "RATIO" })).toBe(true);
    expect(isContractorContract({ payScheme: "RATIO", isContractor: false })).toBe(true);
    expect(isContractorContract({ payScheme: "RATIO", ratioEmployee: false })).toBe(true);
  });
  it("비율제 근로계약이면 위탁이 아니다 — 위탁 체크가 남아 있어도", () => {
    expect(isContractorContract({ payScheme: "RATIO", ratioEmployee: true })).toBe(false);
    expect(isContractorContract({ payScheme: "RATIO", ratioEmployee: true, isContractor: true })).toBe(false);
  });
  it("비율제가 아니면 위탁 체크만 본다(근로 표시는 뜻이 없다)", () => {
    expect(isContractorContract({ payScheme: "HOURLY", isContractor: true, ratioEmployee: true })).toBe(true);
    expect(isContractorContract({ payScheme: "MONTHLY", ratioEmployee: true })).toBe(false);
  });
  it("라벨이 위탁/근로를 갈라 적는다", () => {
    expect(isRatioEmployee({ payScheme: "RATIO", ratioEmployee: true })).toBe(true);
    expect(isRatioEmployee({ payScheme: "MONTHLY", ratioEmployee: true })).toBe(false);
    expect(paySchemeLabelOf({ payScheme: "RATIO", ratioEmployee: true })).toBe(RATIO_EMPLOYEE_LABEL);
    expect(paySchemeLabelOf({ payScheme: "RATIO" })).toBe("완전비율제(위탁)");
    expect(paySchemeLabelOf({ payScheme: "MONTHLY" })).toBe("월급제");
  });
  it("경업금지 보상금 비율은 비율제 근로계약에도 붙는다(v1.58) — 위탁 ↔ 근로를 바꿔도 값이 산다", () => {
    expect(nonCompeteRatioApplies({ payScheme: "RATIO" })).toBe(true);
    expect(nonCompeteRatioApplies({ payScheme: "MONTHLY" })).toBe(false);
    expect(
      resolveNonCompeteRatio({ raw: 0.03, fallback: null, payScheme: "RATIO", ratioPercent: 0.4, ratioEmployee: true })
    ).toEqual({ value: 0.03, error: null });
    // 조건 수정에서 보상금 칸을 건드리지 않고 계약 형태만 바꾸면 저장값이 그대로 간다
    expect(
      resolveNonCompeteRatio({ raw: undefined, fallback: 0.03, payScheme: "RATIO", ratioPercent: 0.4, ratioEmployee: true })
    ).toEqual({ value: 0.03, error: null });
    // 완전비율제가 아니게 바꾸면 지운다
    expect(
      resolveNonCompeteRatio({ raw: undefined, fallback: 0.03, payScheme: "MONTHLY", ratioPercent: null })
    ).toEqual({ value: null, error: null });
  });
  it("필수는 위탁이면 언제나, 비율제 근로계약이면 교수부만(월급제 교수부와 같은 규칙)", () => {
    expect(nonCompeteRatioRequired({ payScheme: "RATIO" })).toBe(true);
    expect(nonCompeteRatioRequired({ payScheme: "RATIO" }, "교육운영팀")).toBe(true);
    expect(nonCompeteRatioRequired({ payScheme: "RATIO", ratioEmployee: true }, "교수부")).toBe(true);
    expect(nonCompeteRatioRequired({ payScheme: "RATIO", ratioEmployee: true }, "교수부(중등)")).toBe(true);
    expect(nonCompeteRatioRequired({ payScheme: "RATIO", ratioEmployee: true }, "교육운영팀")).toBe(false);
    expect(nonCompeteRatioRequired({ payScheme: "RATIO", ratioEmployee: true })).toBe(false);
    expect(nonCompeteRatioRequired({ payScheme: "MONTHLY" }, "교수부")).toBe(false);
    expect(nonCompeteRatioRequiredMessage(true)).toContain("근로계약서(비율급)");
    expect(nonCompeteRatioRequiredMessage(false)).toContain("강의위탁계약서");
    expect(nonCompeteRatioRequiredMessage(true)).toContain("보상금을 두지 않음");
  });
  it("위탁·임금 비율과 합쳐 매출의 100% 를 넘으면 거른다 — 문구가 갈린다", () => {
    const base = { raw: 0.7, fallback: null, payScheme: "RATIO", ratioPercent: 0.4 };
    expect(resolveNonCompeteRatio({ ...base, ratioEmployee: true }).error).toContain("임금 비율(40%)");
    expect(resolveNonCompeteRatio(base).error).toContain("위탁 비율(40%)");
  });
});

describe("splitRatioPay / businessWithholding", () => {
  it("상한이 없으면 전액 근로소득", () => {
    expect(splitRatioPay(6_000_000, null)).toEqual({ wage: 6_000_000, biz: 0 });
    expect(splitRatioPay(6_000_000, 0)).toEqual({ wage: 6_000_000, biz: 0 });
  });
  it("상한 이하면 가르지 않는다", () => {
    expect(splitRatioPay(4_000_000, 5_000_000)).toEqual({ wage: 4_000_000, biz: 0 });
    expect(splitRatioPay(5_000_000, 5_000_000)).toEqual({ wage: 5_000_000, biz: 0 });
  });
  it("상한을 넘는 부분만 사업소득", () => {
    expect(splitRatioPay(6_543_210, 5_000_000)).toEqual({ wage: 5_000_000, biz: 1_543_210 });
  });
  it("상한 안에 함께 세는 보상금이 있으면 그만큼 비율급의 자리가 줄어든다(v1.58.1)", () => {
    // 비율급 600만 + 보상금 45만 → 근로소득 500만이 되도록 비율급 455만, 별도 사업장 145만
    expect(splitRatioPay(6_000_000, 5_000_000, 450_000)).toEqual({ wage: 4_550_000, biz: 1_450_000 });
    // 합이 상한 이하면 가르지 않는다
    expect(splitRatioPay(4_500_000, 5_000_000, 450_000)).toEqual({ wage: 4_500_000, biz: 0 });
    expect(splitRatioPay(4_550_000, 5_000_000, 450_000)).toEqual({ wage: 4_550_000, biz: 0 });
    // 보상금만으로 상한을 넘는 극단 — 별도 사업장 몫은 비율급을 넘지 않는다(보상금은 이 회사 몫)
    expect(splitRatioPay(3_000_000, 5_000_000, 6_000_000)).toEqual({ wage: 0, biz: 3_000_000 });
    // 상한이 없으면 보상금과 무관하게 전액 근로소득
    expect(splitRatioPay(6_000_000, null, 450_000)).toEqual({ wage: 6_000_000, biz: 0 });
  });
  it("사업소득 원천징수 = 3% + 그 10%, 각각 10원 절사", () => {
    expect(businessWithholding(1_543_210, DEFAULT_RATES_2025)).toEqual({ tax: 46_290, local: 4_620 });
    expect(businessWithholding(0, DEFAULT_RATES_2025)).toEqual({ tax: 0, local: 0 });
  });
});

describe("computePayroll — 비율제 근로자", () => {
  it("상한 500만: 근로분만 4대보험·근로소득세, 초과분은 사업소득 3.3%", () => {
    const r = computePayroll(ratioEmp(), { classRevenue: 15_000_000 }, DEFAULT_RATES_2025, taxTable);
    expect(r.baseP).toBe(6_000_000); // 매출 × 40%
    expect(r.gross).toBe(6_000_000);
    expect(r.bizIncomeP).toBe(1_000_000);
    expect(r.wageTaxable).toBe(5_000_000);
    // 4대보험은 500만 기준
    expect(r.pensionD).toBe(225_000);
    expect(r.employmentD).toBe(45_000);
    expect(r.healthD).toBe(177_250);
    expect(r.longTermD).toBe(22_950);
    expect(r.incomeTaxD).toBe(300_000); // 간이세액표 4,000~6,000천원 구간 — 600만이 아니라 500만으로 찾는다
    expect(r.localTaxD).toBe(30_000);
    // 초과분 100만 — 3% + 0.3%
    expect(r.bizTaxD).toBe(30_000);
    expect(r.bizLocalTaxD).toBe(3_000);
    expect(r.totalDeduct).toBe(225_000 + 45_000 + 177_250 + 22_950 + 300_000 + 30_000 + 30_000 + 3_000);
    expect(r.net).toBe(r.gross - r.totalDeduct);
    expect(r.notes.some((n) => n.includes("별도 사업장"))).toBe(true);
  });

  it("통상시급은 근로분 ÷ 월 환산시간(소정+주휴) — 연차수당·연장수당이 이걸 쓴다", () => {
    const r = computePayroll(
      ratioEmp(),
      { classRevenue: 15_000_000, unusedLeaveDays: 2, extraHours: 10 },
      DEFAULT_RATES_2025,
      taxTable
    );
    const hw = Math.round(5_000_000 / MONTH_HOURS);
    expect(r.hourlyWage).toBe(hw); // 25,572
    expect(r.unusedLeaveP).toBe(Math.round(2 * hw * 7.5)); // 1일 소정 7.5시간
    expect(r.extraP).toBe(10 * hw);
    // 상한은 비율급에만 — 근로자라서 받는 돈(연차·연장수당)은 언제나 근로소득
    expect(r.bizIncomeP).toBe(1_000_000);
    expect(r.wageTaxable).toBe(r.gross - 1_000_000);
  });

  it("상한이 없으면 전액 근로소득(국민연금은 기준소득월액 상한에서 멈춘다)", () => {
    const r = computePayroll(
      ratioEmp({ ratioWageCap: null }),
      { classRevenue: 20_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(r.gross).toBe(8_000_000);
    expect(r.bizIncomeP).toBe(0);
    expect(r.bizTaxD).toBe(0);
    expect(r.pensionD).toBe(floor10(DEFAULT_RATES_2025.pensionBaseMax * 0.045));
    expect(r.healthD).toBe(floor10(8_000_000 * DEFAULT_RATES_2025.health));
    expect(r.hourlyWage).toBe(Math.round(8_000_000 / MONTH_HOURS));
  });

  it("비율급이 상한에 못 미치면 가르지 않는다", () => {
    const r = computePayroll(ratioEmp(), { classRevenue: 10_000_000 }, DEFAULT_RATES_2025, taxTable);
    expect(r.gross).toBe(4_000_000);
    expect(r.bizIncomeP).toBe(0);
    expect(r.wageTaxable).toBe(4_000_000);
  });

  it("최저보장은 비율급 전체에 걸린다(근로기준법 §47 보장급)", () => {
    const r = computePayroll(
      ratioEmp({ ratioMinGuarantee: 2_500_000 }),
      { classRevenue: 3_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(r.baseP).toBe(2_500_000);
    expect(r.bizIncomeP).toBe(0);
  });

  it("세무구분이 사업소득이면 가르지 않고 전액 3.3% — 근로자 규칙(통상시급)은 그대로", () => {
    const r = computePayroll(
      ratioEmp({ incomeType: "FREELANCE" }),
      { classRevenue: 15_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(r.bizIncomeP).toBe(0);
    expect(r.pensionD).toBe(0);
    expect(r.incomeTaxD).toBe(180_000);
    expect(r.localTaxD).toBe(18_000);
    expect(r.hourlyWage).toBe(Math.round(6_000_000 / MONTH_HOURS));
  });

  it("경업금지 보상금 비율 — 비율급과 별도로 매출 × 비율, 근로소득이고 상한은 비율급과 합쳐 잰다(v1.58.1)", () => {
    const r = computePayroll(
      ratioEmp({ nonCompeteRatio: 0.03 }),
      { classRevenue: 15_000_000, extraHours: 10 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(r.baseP).toBe(6_000_000); // 비율급 40% — 보상금이 끼어들지 않는다
    expect(r.nonCompeteP).toBe(450_000); // 1,500만 × 3%
    // 상한 500만은 비율급 + 보상금의 합에 걸린다 — 넘는 145만(600 + 45 − 500)이 비율급에서 빠져 별도 사업장으로
    expect(r.bizIncomeP).toBe(1_450_000);
    // 통상시급 = (근로분 비율급 455만 + 보상금 45만 = 상한 500만) ÷ 월 환산시간
    const hw = Math.round(5_000_000 / MONTH_HOURS);
    expect(r.hourlyWage).toBe(hw);
    expect(r.extraP).toBe(10 * hw);
    expect(r.gross).toBe(6_000_000 + 450_000 + 10 * hw);
    // 4대보험 기준 = 상한 500만 + 상한 밖 근로소득(연장수당)
    expect(r.wageTaxable).toBe(5_000_000 + 10 * hw);
    expect(r.healthD).toBe(floor10(r.wageTaxable * DEFAULT_RATES_2025.health));
    expect(r.employmentD).toBe(floor10(r.wageTaxable * DEFAULT_RATES_2025.employment));
    // 별도 사업장 몫(3.3%)은 145만에
    expect(r.bizTaxD).toBe(43_500);
    expect(r.bizLocalTaxD).toBe(4_350);
    expect(r.net).toBe(r.gross - r.totalDeduct);
    expect(r.notes.some((n) => n.includes("근로계약서 제8조") && n.includes("비율급과 합쳐"))).toBe(true);
    expect(r.notes.some((n) => n.includes("경업금지 보상금 450,000원의 합계 중 5,000,000원은 근로소득"))).toBe(true);
    expect(r.notes.some((n) => n.includes("경업금지 보상금 포함"))).toBe(true);
  });

  it("보장급(§47)으로 올려 준 몫은 상한과 무관하게 이 회사의 임금 — 상한은 ① 산식 금액에만 건다", () => {
    // 매출 1,000만 × 40% = 400만 < 보장급 600만 → 비율급 600만. ① 산식 금액(400만)은 상한 안이라 가르지 않는다
    const a = computePayroll(
      ratioEmp({ ratioMinGuarantee: 6_000_000 }),
      { classRevenue: 10_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(a.baseP).toBe(6_000_000);
    expect(a.bizIncomeP).toBe(0);
    expect(a.wageTaxable).toBe(6_000_000);
    // 매출 1,200만: ① 480만 + 보상금 36만 = 516만 → 16만만 별도 사업장(용역위탁계약서 제3조와 같은 식).
    // 보장급 520만과의 차이 40만은 이 회사 임금으로 남는다
    const b = computePayroll(
      ratioEmp({ ratioMinGuarantee: 5_200_000, nonCompeteRatio: 0.03 }),
      { classRevenue: 12_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(b.baseP).toBe(5_200_000);
    expect(b.nonCompeteP).toBe(360_000);
    expect(b.bizIncomeP).toBe(160_000);
    expect(b.wageTaxable).toBe(5_200_000 - 160_000 + 360_000);
  });

  it("보상금은 보장급(§47)과 무관하게 언제나 매출 × 비율", () => {
    const r = computePayroll(
      ratioEmp({ ratioMinGuarantee: 2_500_000, nonCompeteRatio: 0.03 }),
      { classRevenue: 3_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(r.baseP).toBe(2_500_000);
    expect(r.nonCompeteP).toBe(90_000);
    expect(r.gross).toBe(2_590_000);
    expect(r.bizIncomeP).toBe(0);
  });

  it("상한 없는 비율제 근로자 — 보상금까지 전액 근로소득", () => {
    const r = computePayroll(
      ratioEmp({ ratioWageCap: null, nonCompeteRatio: 0.025 }),
      { classRevenue: 10_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(r.nonCompeteP).toBe(250_000);
    expect(r.gross).toBe(4_250_000);
    expect(r.wageTaxable).toBe(4_250_000);
    expect(r.bizIncomeP).toBe(0);
    expect(r.hourlyWage).toBe(Math.round(4_250_000 / MONTH_HOURS));
  });

  it("근로시간표가 비면 209시간으로 환산한다(통상시급 0 으로 수당이 사라지지 않게)", () => {
    const r = computePayroll(
      ratioEmp({ schedule: [] }),
      { classRevenue: 10_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(r.hourlyWage).toBe(Math.round(4_000_000 / 209));
    expect(r.notes.some((n) => n.includes("209시간"))).toBe(true);
  });

  it("위탁 비율제는 그대로다 — 3.3%, 통상시급 0, 연장·연차수당 없음", () => {
    const r = computePayroll(
      ratioEmp({ ratioEmployee: false, incomeType: "FREELANCE" }),
      { classRevenue: 15_000_000, unusedLeaveDays: 2, extraHours: 10 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(r.gross).toBe(6_000_000);
    expect(r.hourlyWage).toBe(0);
    expect(r.unusedLeaveP).toBe(0);
    expect(r.extraP).toBe(0);
    expect(r.bizIncomeP).toBe(0);
    expect(r.incomeTaxD).toBe(180_000);
    expect(r.pensionD).toBe(0);
  });

  it("다른 급여형태에는 아무 영향이 없다 — 근로 표시·상한이 남아 있어도", () => {
    const base: EmployeePayInput = {
      incomeType: "EMPLOYEE",
      payScheme: "MONTHLY",
      baseWage: 6_000_000,
      positionAllow: 0,
      mealAllow: 0,
      carAllow: 0,
      dependents: 1,
      schedule: teacher,
    };
    const a = computePayroll(base, {}, DEFAULT_RATES_2025, taxTable);
    const b = computePayroll(
      { ...base, ratioEmployee: true, ratioWageCap: 5_000_000 },
      {},
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(b).toEqual(a);
    expect(a.bizIncomeP).toBe(0);
  });
});

describe("recordSplit — 지급처별로 가르기", () => {
  it("나눈 두 몫을 더하면 원래 기록이다", () => {
    const r = computePayroll(ratioEmp(), { classRevenue: 15_000_000 }, DEFAULT_RATES_2025, taxTable);
    const s = recordSplit(r);
    expect(s.biz).not.toBeNull();
    expect(s.biz!.gross).toBe(1_000_000);
    expect(s.biz!.totalDeduct).toBe(33_000);
    expect(s.biz!.net).toBe(967_000);
    expect(s.wage.gross).toBe(5_000_000);
    expect(s.wage.gross + s.biz!.gross).toBe(r.gross);
    expect(s.wage.totalDeduct + s.biz!.totalDeduct).toBe(r.totalDeduct);
    expect(s.wage.net + s.biz!.net).toBe(r.net);
    expect(s.wage.net).toBe(s.wage.gross - s.wage.totalDeduct);
  });
  it("가를 것이 없으면 기록 그대로 · biz 는 null", () => {
    expect(recordSplit({ gross: 100, totalDeduct: 10, net: 90 })).toEqual({
      wage: { gross: 100, totalDeduct: 10, net: 90 },
      biz: null,
    });
    expect(recordSplit({ gross: 100, totalDeduct: 10, net: 90, bizIncomeP: 0, bizTaxD: 0 }).biz).toBeNull();
  });
});

describe("parseRatioWageCap / normalizeRatioTerms", () => {
  it("빈칸은 상한 없음, 쉼표·'원' 은 받는다", () => {
    expect(parseRatioWageCap("")).toEqual({ value: null });
    expect(parseRatioWageCap(null)).toEqual({ value: null });
    expect(parseRatioWageCap("5,000,000원")).toEqual({ value: 5_000_000 });
    expect(parseRatioWageCap(4_999_999.6)).toEqual({ value: 5_000_000 });
  });
  it("0 이하·숫자 아님·지나치게 큰 값은 거른다", () => {
    expect(parseRatioWageCap(0).error).toBeTruthy();
    expect(parseRatioWageCap(-1).error).toBeTruthy();
    expect(parseRatioWageCap("abc").error).toBeTruthy();
    expect(parseRatioWageCap(500_000_000).error).toBeTruthy();
  });
  it("비율제가 아니면 근로 표시·상한을 지운다", () => {
    expect(normalizeRatioTerms({ payScheme: "MONTHLY", ratioEmployee: true, ratioWageCap: 5e6 })).toEqual({
      ratioEmployee: false,
      ratioWageCap: null,
      isContractor: false,
    });
    expect(normalizeRatioTerms({ payScheme: "HOURLY", isContractor: true }).isContractor).toBe(true);
  });
  it("위탁 비율제는 상한을 지우고 위탁 체크를 켠다", () => {
    expect(normalizeRatioTerms({ payScheme: "RATIO", ratioEmployee: false, ratioWageCap: 5e6 })).toEqual({
      ratioEmployee: false,
      ratioWageCap: null,
      isContractor: true,
    });
  });
  it("비율제 근로자는 위탁 체크를 끄고 세무구분을 근로소득으로 맞춘다", () => {
    expect(
      normalizeRatioTerms({ payScheme: "RATIO", ratioEmployee: true, ratioWageCap: "5,000,000", isContractor: true })
    ).toEqual({ ratioEmployee: true, ratioWageCap: 5_000_000, isContractor: false, incomeType: "EMPLOYEE" });
    expect(normalizeRatioTerms({ payScheme: "RATIO", ratioEmployee: true, ratioWageCap: "" }).ratioWageCap).toBeNull();
    expect(normalizeRatioTerms({ payScheme: "RATIO", ratioEmployee: true, ratioWageCap: -5 }).error).toBeTruthy();
  });
  it("보내지 않은 칸은 저장값을 지키고(조건 수정), 보낸 값이 이긴다", () => {
    const saved = { ratioEmployee: true, ratioWageCap: 5_000_000 };
    expect(normalizeRatioTerms({ payScheme: "RATIO" }, saved)).toMatchObject({ ratioEmployee: true, ratioWageCap: 5_000_000 });
    expect(normalizeRatioTerms({ payScheme: "RATIO", ratioWageCap: null }, saved).ratioWageCap).toBeNull();
    expect(normalizeRatioTerms({ payScheme: "RATIO", ratioEmployee: false }, saved).ratioEmployee).toBe(false);
  });
});

describe("별도 사업장 정보", () => {
  it("필수 넷이 다 있어야 쓴다 · 약칭이 비면 상호", () => {
    expect(bizPayerMissing(null)).toEqual(["상호", "사업자등록번호", "대표자", "주소"]);
    expect(bizPayerMissing({ bizPayerName: "유쌤아카데미", bizPayerBizNo: " " })).toEqual([
      "사업자등록번호",
      "대표자",
      "주소",
    ]);
    const full = {
      bizPayerName: "유쌤아카데미",
      bizPayerBizNo: "123-45-67890",
      bizPayerCeo: "홍길동",
      bizPayerAddress: "경기도 하남시",
    };
    expect(bizPayerMissing(full)).toEqual([]);
    expect(bizPayerOf(full)).toMatchObject({ name: "유쌤아카데미", alias: "유쌤아카데미", phone: "" });
    expect(bizPayerOf({ ...full, bizPayerAlias: "유쌤A" })!.alias).toBe("유쌤A");
    expect(bizPayerOf({ ...full, bizPayerCeo: "" })).toBeNull();
  });
});
