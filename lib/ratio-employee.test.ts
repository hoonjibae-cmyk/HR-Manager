import { describe, it, expect } from "vitest";
import {
  computePayroll,
  splitRatioPay,
  businessWithholding,
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
import { nonCompeteRatioApplies, resolveNonCompeteRatio } from "./non-compete";

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
  it("위탁 경업금지 보상금 비율은 비율제 근로계약에 붙지 않는다", () => {
    expect(nonCompeteRatioApplies({ payScheme: "RATIO" })).toBe(true);
    expect(nonCompeteRatioApplies({ payScheme: "RATIO", ratioEmployee: true })).toBe(false);
    expect(
      resolveNonCompeteRatio({ raw: 0.03, fallback: null, payScheme: "RATIO", ratioPercent: 0.4, ratioEmployee: true })
    ).toEqual({ value: null, error: null });
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
    expect(r.pensionD).toBe(Math.floor((DEFAULT_RATES_2025.pensionBaseMax * 0.045) / 10) * 10);
    expect(r.healthD).toBe(Math.floor((8_000_000 * DEFAULT_RATES_2025.health) / 10) * 10);
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

  it("위탁 경업금지 보상금 비율은 비율제 근로자에게 붙지 않는다", () => {
    const r = computePayroll(
      ratioEmp({ nonCompeteRatio: 0.03 }),
      { classRevenue: 10_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(r.nonCompeteP).toBe(0);
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
