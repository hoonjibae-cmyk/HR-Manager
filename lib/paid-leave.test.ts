// 유급휴직·휴업 — 원급여 대비 비율 또는 직접 넣은 금액으로 따로 지급하는 휴직·휴업 (v1.64).
// 무급휴직만 있던 때(v1.63)의 계산·기록은 lib/unpaid-leave.test.ts 가 그대로 지킨다.

import { describe, it, expect } from "vitest";
import {
  monthPayDays,
  settleLeavePay,
  unpaidLeaveMetaOf,
  readUnpaidLeaveMeta,
  unpaidLeaveStale,
  unpaidLeaveNote,
  unpaidLeaveCalcNote,
  unpaidLeaveError,
  normalizeLeaveTerms,
  leaveKindOf,
  leavePayTermsOf,
  leavePayRows,
  leavePayDetailLines,
  leaveWordOf,
  leaveTermsLabel,
  leaveDaysBetween,
  shutdownRateWarning,
  ratePercentLabel,
  LEAVE_PAY_LABEL_ANY,
  type UnpaidLeaveSpan,
} from "./unpaid-leave";
import {
  computePayroll,
  leaveWageBasis,
  DEFAULT_RATES_2025,
  type EmployeePayInput,
  type TaxBracketRow,
} from "./payroll";
import { leaveBasisPieces, type MonthContractTerms } from "./payroll-service";
import { estimateContractBase } from "./severance";
import type { ScheduleDay } from "./constants";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const HIRE = d("2024-03-04");
const leave = (a: string, b: string, over: Partial<UnpaidLeaveSpan> = {}): UnpaidLeaveSpan => ({
  startDate: d(a),
  endDate: d(b),
  ...over,
});
const shutdown = (a: string, b: string, payRate: number) => leave(a, b, { kind: "SHUTDOWN", payRate });
const paid = (a: string, b: string, payRate: number) => leave(a, b, { kind: "PAID", payRate });
const byAmount = (a: string, b: string, payAmount: number, kind = "PAID") => leave(a, b, { kind, payAmount });

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

/** 서비스가 하는 일 그대로 — 그 달 일수 → 원급여·지급액 → 엔진 입력 */
function monthInput(
  emp: EmployeePayInput,
  year: number,
  month: number,
  leaves: UnpaidLeaveSpan[],
  hire = HIRE,
  resign: Date | null = null
) {
  const pd = settleLeavePay(monthPayDays(year, month, hire, resign, leaves), [], leaveWageBasis(emp).monthly);
  return { prorationRatio: pd.ratio, unpaidLeave: unpaidLeaveMetaOf(pd), leavePay: pd.leavePay };
}

describe("구분·지급 방식", () => {
  it("★ 모르는 구분은 무급휴직이다 — v1.63 의 행에는 구분이 없다", () => {
    expect(leaveKindOf(undefined)).toBe("UNPAID");
    expect(leaveKindOf(null)).toBe("UNPAID");
    expect(leaveKindOf("")).toBe("UNPAID");
    expect(leaveKindOf("WHATEVER")).toBe("UNPAID");
    expect(leaveKindOf("PAID")).toBe("PAID");
    expect(leaveKindOf("SHUTDOWN")).toBe("SHUTDOWN");
  });

  it("무급휴직은 비율·금액이 있어도 지급하지 않는다", () => {
    expect(leavePayTermsOf({ kind: "UNPAID", payRate: 0.7, payAmount: 500_000 })).toEqual({ mode: "NONE" });
    expect(leavePayTermsOf({ payRate: 1 })).toEqual({ mode: "NONE" });
  });

  it("★ 금액이 있으면 금액이 이긴다", () => {
    expect(leavePayTermsOf({ kind: "PAID", payRate: 0.7, payAmount: 500_000 })).toEqual({ mode: "AMOUNT", amount: 500_000 });
    expect(leavePayTermsOf({ kind: "SHUTDOWN", payRate: 0.7 })).toEqual({ mode: "RATE", rate: 0.7 });
  });

  it("유급 구분인데 조건이 비면 0% 로 읽는다 — 지어내 채우지 않는다", () => {
    expect(leavePayTermsOf({ kind: "PAID" })).toEqual({ mode: "RATE", rate: 0 });
    expect(leavePayTermsOf({ kind: "SHUTDOWN", payAmount: 0 })).toEqual({ mode: "RATE", rate: 0 });
  });

  it("비율은 0~1 로 묶고 소수 넷째 자리(만분율)로 맞춘다", () => {
    expect(leavePayTermsOf({ kind: "PAID", payRate: 1.5 })).toEqual({ mode: "RATE", rate: 1 });
    expect(leavePayTermsOf({ kind: "PAID", payRate: -0.1 })).toEqual({ mode: "RATE", rate: 0 });
    expect(leavePayTermsOf({ kind: "PAID", payRate: 0.66666 })).toEqual({ mode: "RATE", rate: 0.6667 });
    expect(ratePercentLabel(0.7)).toBe("70%");
    expect(ratePercentLabel(0.6667)).toBe("66.67%");
    expect(ratePercentLabel(1)).toBe("100%");
  });

  it("저장할 때 쓰지 않는 조건을 지운다 — 무급이면 둘 다, 금액 지정이면 비율, 비율 지급이면 금액", () => {
    expect(normalizeLeaveTerms({ kind: "UNPAID", payRate: 0.7, payAmount: 1 })).toEqual({ kind: "UNPAID", payRate: null, payAmount: null });
    expect(normalizeLeaveTerms({ payRate: 0.7 })).toEqual({ kind: "UNPAID", payRate: null, payAmount: null });
    expect(normalizeLeaveTerms({ kind: "PAID", payAmount: 800_000 })).toEqual({ kind: "PAID", payRate: null, payAmount: 800_000 });
    expect(normalizeLeaveTerms({ kind: "SHUTDOWN", payRate: 0.7, payAmount: null })).toEqual({ kind: "SHUTDOWN", payRate: 0.7, payAmount: null });
  });

  it("한 줄 요약", () => {
    expect(leaveTermsLabel({})).toBe("무급휴직");
    expect(leaveTermsLabel({ kind: "SHUTDOWN", payRate: 0.7 })).toBe("휴업 · 원급여의 70%");
    expect(leaveTermsLabel({ kind: "SHUTDOWN", payRate: 0 })).toBe("휴업 · 무급(0%)");
    expect(leaveTermsLabel({ kind: "PAID", payAmount: 800_000 })).toBe("유급휴직 · 800,000원(금액 지정)");
  });
});

describe("monthPayDays — 유급휴직·휴업일도 정상 급여에서는 빠진다", () => {
  it("★ 휴업 11/16~11/30 — 정상 급여 지급일은 무급휴직과 같고, 무급일수는 0 이다", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [shutdown("2026-11-16", "2026-11-30", 0.7)]);
    expect(pd.leaveDays).toBe(15);
    expect(pd.unpaidDays).toBe(0);
    expect(pd.paidDays).toBe(15);
    expect(pd.ratio).toBe(0.5);
    expect(pd.spans).toEqual([{ from: "2026-11-16", to: "2026-11-30", days: 15, kind: "SHUTDOWN", rate: 0.7 }]);
  });

  it("★ 무급휴직 구간에는 kind 키가 없다 — v1.63 기록과 같은 모양", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [leave("2026-11-16", "2026-11-30"), leave("2026-11-03", "2026-11-03", { kind: "UNPAID" })]);
    expect(pd.spans).toEqual([
      { from: "2026-11-03", to: "2026-11-03", days: 1 },
      { from: "2026-11-16", to: "2026-11-30", days: 15 },
    ]);
    expect(pd.unpaidDays).toBe(16);
    expect(pd.leaveDays).toBe(16);
  });

  it("구분이 섞인 달 — 날 수는 구분별로, 정상 급여는 전부 뺀 날로", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [
      leave("2026-11-03", "2026-11-04"),
      paid("2026-11-10", "2026-11-14", 1),
      shutdown("2026-11-23", "2026-11-30", 0.7),
    ]);
    expect(pd.unpaidDays).toBe(2);
    expect(pd.leaveDays).toBe(15);
    expect(pd.paidDays).toBe(15);
    expect(pd.spans.map((s) => s.kind ?? "UNPAID")).toEqual(["UNPAID", "PAID", "SHUTDOWN"]);
  });

  it("맞닿은 무급휴직은 한 덩어리로 합치지만, 유급 구간은 합치지 않는다 — 건마다 조건이 다르다", () => {
    const merged = monthPayDays(2026, 11, HIRE, null, [leave("2026-11-01", "2026-11-10"), leave("2026-11-11", "2026-11-15")]);
    expect(merged.spans).toEqual([{ from: "2026-11-01", to: "2026-11-15", days: 15 }]);

    const kept = monthPayDays(2026, 11, HIRE, null, [shutdown("2026-11-01", "2026-11-10", 0.7), shutdown("2026-11-11", "2026-11-15", 0.7)]);
    expect(kept.spans).toHaveLength(2);

    // 무급 → 휴업 → 무급: 가운데가 끼면 앞뒤 무급도 합치지 않는다
    const split = monthPayDays(2026, 11, HIRE, null, [
      leave("2026-11-01", "2026-11-05"),
      shutdown("2026-11-06", "2026-11-10", 0.7),
      leave("2026-11-11", "2026-11-15"),
    ]);
    expect(split.spans.map((s) => [s.from, s.to, s.kind ?? "UNPAID"])).toEqual([
      ["2026-11-01", "2026-11-05", "UNPAID"],
      ["2026-11-06", "2026-11-10", "SHUTDOWN"],
      ["2026-11-11", "2026-11-15", "UNPAID"],
    ]);
  });

  it("★ 겹쳐 등록돼 있어도 하루는 한 건에만 준다 — 먼저 시작한 건이 이긴다", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [shutdown("2026-11-10", "2026-11-20", 0.7), leave("2026-11-16", "2026-11-25")]);
    expect(pd.leaveDays).toBe(16); // 11/10~11/25
    expect(pd.spans).toEqual([
      { from: "2026-11-10", to: "2026-11-20", days: 11, kind: "SHUTDOWN", rate: 0.7 },
      { from: "2026-11-21", to: "2026-11-25", days: 5 },
    ]);
    expect(leaveDaysBetween(d("2026-11-01"), d("2026-11-30"), [shutdown("2026-11-10", "2026-11-20", 0.7), leave("2026-11-16", "2026-11-25")])).toBe(16);
  });

  it("재직 기간 밖의 날은 세지 않는다 — 퇴사일 뒤의 유급휴직은 지급하지 않는다", () => {
    const pd = monthPayDays(2026, 11, HIRE, d("2026-11-20"), [paid("2026-11-16", "2026-11-30", 1)]);
    expect(pd.employedDays).toBe(20);
    expect(pd.leaveDays).toBe(5);
    expect(pd.spans[0]).toMatchObject({ from: "2026-11-16", to: "2026-11-20", days: 5 });
  });
});

describe("금액 지정 — 그 건 기간 전체의 금액을 달마다 역일수로 나눈다", () => {
  it("한 달 안이면 넣은 금액 그대로", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [byAmount("2026-11-16", "2026-11-30", 800_000)]);
    expect(pd.spans).toEqual([
      { from: "2026-11-16", to: "2026-11-30", days: 15, kind: "PAID", amount: 800_000, amountTotal: 800_000 },
    ]);
  });

  it("★ 달을 걸치면 역일수로 나누고, 다 더하면 넣은 금액과 정확히 같다 (누적 반올림)", () => {
    // 11/20 ~ 1/7 — 11일 + 31일 + 7일 = 49일. 1,000,000 ÷ 49 는 나누어떨어지지 않는다
    const l = byAmount("2026-11-20", "2027-01-07", 1_000_000);
    const nov = monthPayDays(2026, 11, HIRE, null, [l]).spans[0];
    const dec = monthPayDays(2026, 12, HIRE, null, [l]).spans[0];
    const jan = monthPayDays(2027, 1, HIRE, null, [l]).spans[0];
    expect([nov.days, dec.days, jan.days]).toEqual([11, 31, 7]);
    expect(nov.amount).toBe(Math.round((1_000_000 * 11) / 49));
    expect(nov.amount! + dec.amount! + jan.amount!).toBe(1_000_000);
    expect([nov.amountTotal, dec.amountTotal, jan.amountTotal]).toEqual([1_000_000, 1_000_000, 1_000_000]);
  });

  it("어떻게 쪼개도 합이 맞는다", () => {
    for (const [a, b, amt] of [
      ["2026-01-31", "2026-03-01", 777_777],
      ["2026-02-27", "2026-04-02", 1],
      ["2026-05-15", "2026-08-14", 3_333_333],
      ["2026-12-31", "2027-01-01", 999_999],
    ] as const) {
      const l = byAmount(a, b, amt);
      let sum = 0;
      for (const [y, m] of [[2026, 1], [2026, 2], [2026, 3], [2026, 4], [2026, 5], [2026, 6], [2026, 7], [2026, 8], [2026, 12], [2027, 1]] as const)
        sum += monthPayDays(y, m, HIRE, null, [l]).spans.reduce((x, s) => x + (s.amount ?? 0), 0);
      expect(sum).toBe(amt);
    }
  });

  it("퇴사일이 당겨져 잘린 날의 몫은 지급하지 않는다", () => {
    const l = byAmount("2026-11-16", "2026-11-30", 900_000);
    const pd = monthPayDays(2026, 11, HIRE, d("2026-11-20"), [l]);
    expect(pd.spans[0].amount).toBe(300_000); // 15일 중 5일
    expect(pd.spans[0].amountTotal).toBe(900_000);
  });
});

describe("settleLeavePay — 원급여 × 지급 비율", () => {
  const base = (leaves: UnpaidLeaveSpan[], y = 2026, m = 11) => monthPayDays(y, m, HIRE, null, leaves);

  it("★ 월 300만 · 11/16~11/30 휴업 70% → 원급여 150만 × 70% = 105만", () => {
    const pd = settleLeavePay(base([shutdown("2026-11-16", "2026-11-30", 0.7)]), [], 3_000_000);
    expect(pd.leavePay).toBe(1_050_000);
    expect(pd.spans[0]).toEqual({
      from: "2026-11-16",
      to: "2026-11-30",
      days: 15,
      kind: "SHUTDOWN",
      rate: 0.7,
      orig: 1_500_000,
      monthly: 3_000_000,
      pay: 1_050_000,
    });
  });

  it("★ 지급액은 반올림한 원급여에서 낸다 — 명세서의 식을 손으로 다시 곱해도 같은 수가 나온다", () => {
    // 31일 달에 10일: 3,000,000 × 10/31 = 967,741.93… → 967,742. × 70% = 677,419.4 → 677,419
    const pd = settleLeavePay(base([shutdown("2026-12-01", "2026-12-10", 0.7)], 2026, 12), [], 3_000_000);
    expect(pd.spans[0].orig).toBe(967_742);
    expect(pd.spans[0].pay).toBe(Math.round(967_742 * 0.7));
    expect(pd.leavePay).toBe(677_419);
  });

  it("비율을 만분율 정수로 곱한다 — 부동소수점 오차로 1원이 갈리지 않는다", () => {
    // 1,000,005 × 0.7 = 700,003.5 (참값) → 700,004. 부동소수점으로는 700,003.4999… 가 될 수 있다
    const pd = settleLeavePay(base([shutdown("2026-11-01", "2026-11-30", 0.7)]), [], 1_000_005);
    expect(pd.spans[0].orig).toBe(1_000_005);
    expect(pd.spans[0].pay).toBe(700_004);
  });

  it("금액 지정 구간은 계약과 무관하게 이 달 몫이 곧 지급액이다", () => {
    const pd = settleLeavePay(base([byAmount("2026-11-16", "2026-11-30", 800_000)]), [], 3_000_000);
    expect(pd.leavePay).toBe(800_000);
    expect(pd.spans[0].pay).toBe(800_000);
    expect(pd.spans[0].orig).toBeUndefined();
  });

  it("무급휴직 구간은 건드리지 않는다", () => {
    const pd = settleLeavePay(base([leave("2026-11-16", "2026-11-30")]), [], 3_000_000);
    expect(pd.leavePay).toBe(0);
    expect(pd.spans).toEqual([{ from: "2026-11-16", to: "2026-11-30", days: 15 }]);
  });

  it("★ 달 안에서 계약이 바뀌면 그 날짜의 조건으로 센다", () => {
    // 11/1~11/15 월 300만, 11/16~ 월 400만. 휴업 11/11~11/20 (300만 5일 + 400만 5일) 70%
    const pieces = [
      { from: "2026-11-01", to: "2026-11-15", monthly: 3_000_000 },
      { from: "2026-11-16", to: "2026-11-30", monthly: 4_000_000 },
    ];
    const pd = settleLeavePay(base([shutdown("2026-11-11", "2026-11-20", 0.7)]), pieces, 9_999_999);
    const orig = Math.round((3_000_000 * 5 + 4_000_000 * 5) / 30);
    expect(pd.spans[0].orig).toBe(orig);
    expect(pd.spans[0].pay).toBe(Math.round(orig * 0.7));
    // 조건이 둘이면 월 기준액을 하나로 적지 않는다
    expect(pd.spans[0].monthly).toBeUndefined();
  });

  it("계약 구간에 덮이지 않은 날은 fallback 으로 센다", () => {
    const pieces = [{ from: "2026-11-16", to: "2026-11-30", monthly: 4_000_000 }];
    const pd = settleLeavePay(base([paid("2026-11-11", "2026-11-20", 1)]), pieces, 3_000_000);
    expect(pd.spans[0].orig).toBe(Math.round((3_000_000 * 5 + 4_000_000 * 5) / 30));
  });

  it("원급여를 낼 수 없으면(0) 비율 지급은 0원이다 — 지어내지 않는다", () => {
    const pd = settleLeavePay(base([shutdown("2026-11-16", "2026-11-30", 0.7)]), [], 0);
    expect(pd.leavePay).toBe(0);
    expect(pd.spans[0]).toMatchObject({ orig: 0, pay: 0 });
  });
});

describe("leaveWageBasis — 원급여(월 기준액)", () => {
  it("월급제 = 월 지급 총액 + 직책수당 (식대는 총액 안에 있다)", () => {
    expect(leaveWageBasis(monthly())).toEqual({ monthly: 3_000_000, nonCompeteExcluded: 0, gap: null });
    expect(leaveWageBasis(monthly({ positionAllow: 100_000 })).monthly).toBe(3_100_000);
  });

  it("★ 경업금지 보상금은 넣지 않는다 — 근로의 대가가 아니다", () => {
    const b = leaveWageBasis(monthly({ baseWage: 3_500_000, nonCompetePay: 300_000 }));
    expect(b.monthly).toBe(3_200_000);
    expect(b.nonCompeteExcluded).toBe(300_000);
  });

  it("시급제 = 시급 × (주 소정 + 주휴) × 4.345 + 월 정액 수당", () => {
    const b = leaveWageBasis(monthly({ payScheme: "HOURLY", baseWage: 12_000, mealAllow: 100_000 }));
    // 주 37.5 + 주휴 7.5 = 45시간
    expect(b.monthly).toBe(Math.round(12_000 * 45 * 4.345) + 100_000);
    expect(b.gap).toBeNull();
  });

  it("시급제인데 근로시간표가 비면 낼 수 없다 — 수당만으로 원급여를 지어내지 않는다", () => {
    const b = leaveWageBasis(monthly({ payScheme: "HOURLY", baseWage: 12_000, schedule: [] }));
    expect(b).toEqual({ monthly: 0, nonCompeteExcluded: 0, gap: "NO_SCHEDULE" });
  });

  it("완전비율제·위탁은 낼 수 없다", () => {
    expect(leaveWageBasis(monthly({ payScheme: "RATIO", ratioEmployee: true })).gap).toBe("RATIO");
    expect(leaveWageBasis(monthly({ payScheme: "RATIO" })).gap).toBe("CONTRACTOR");
    expect(leaveWageBasis(monthly({ isContractor: true })).gap).toBe("CONTRACTOR");
  });

  it("★ 퇴직급여의 계약 추산과 같은 금액이다 — 둘 다 '계약서에 합의된 월 급여총액'", () => {
    for (const emp of [
      monthly(),
      monthly({ baseWage: 3_500_000, nonCompetePay: 300_000, positionAllow: 150_000 }),
      monthly({ payScheme: "INCENTIVE", baseWage: 2_800_000, carAllow: 200_000 }),
      monthly({ payScheme: "HOURLY", baseWage: 12_000, mealAllow: 100_000, positionAllow: 50_000 }),
    ]) {
      const { monthly: basis } = leaveWageBasis(emp);
      const est = estimateContractBase(
        {
          payScheme: emp.payScheme,
          baseWage: emp.baseWage,
          positionAllow: emp.positionAllow,
          mealAllow: emp.mealAllow,
          carAllow: emp.carAllow,
          isContractor: false,
          nonCompetePay: emp.nonCompetePay,
        },
        { weeklyContractual: 37.5, weeklyHoliday: 7.5 }
      );
      expect(basis).toBe(est.base);
    }
  });

  it("계약 구간별 월 기준액 — 구간의 조건을 그 달 조건 위에 얹는다", () => {
    const entry: MonthContractTerms = {
      futureStart: null,
      segs: [
        { days: 15, from: "2026-11-01", to: "2026-11-15", baseWage: 3_000_000, positionAllow: 0, mealAllow: 200_000, carAllow: 0 },
        { days: 15, from: "2026-11-16", to: "2026-11-30", baseWage: 3_500_000, positionAllow: 100_000, mealAllow: 200_000, carAllow: 0, nonCompetePay: 300_000 },
        // 날짜가 없는 구간은 넘어간다
        { days: 0, baseWage: 9_000_000, positionAllow: 0, mealAllow: 0, carAllow: 0 },
      ],
    };
    expect(leaveBasisPieces(monthly(), entry)).toEqual([
      { from: "2026-11-01", to: "2026-11-15", monthly: 3_000_000 },
      { from: "2026-11-16", to: "2026-11-30", monthly: 3_300_000 },
    ]);
    expect(leaveBasisPieces(monthly(), undefined)).toEqual([]);
  });
});

describe("computePayroll — 유급휴직 급여·휴업수당", () => {
  it("★ 월 300만(식대 20만 포함) · 11/16~11/30 휴업 70% → 정상 150만 + 휴업수당 105만", () => {
    const emp = monthly();
    const r = computePayroll(emp, monthInput(emp, 2026, 11, [shutdown("2026-11-16", "2026-11-30", 0.7)]), DEFAULT_RATES_2025, tax);
    expect(r.baseP).toBe(1_400_000);
    expect(r.mealP).toBe(100_000);
    expect(r.leavePayP).toBe(1_050_000);
    expect(r.gross).toBe(2_550_000);
    // 휴업수당은 과세 — 비과세는 정상 급여의 식대뿐이다
    expect(r.taxableGross).toBe(2_450_000);
  });

  it("★ 비율 100% 면 휴직이 없던 달과 지급액이 같다", () => {
    const emp = monthly({ positionAllow: 100_000 });
    const full = computePayroll(emp, {}, DEFAULT_RATES_2025, tax);
    for (const [y, m, a, b] of [
      [2026, 11, "2026-11-16", "2026-11-30"],
      [2026, 12, "2026-12-01", "2026-12-10"],
      [2026, 2, "2026-02-03", "2026-02-19"],
      [2026, 11, "2026-11-01", "2026-11-30"],
    ] as const) {
      const r = computePayroll(emp, monthInput(emp, y, m, [paid(a, b, 1)]), DEFAULT_RATES_2025, tax);
      // 정상 급여와 유급휴직 급여를 따로 반올림하므로 1원까지는 갈릴 수 있다
      expect(Math.abs(r.gross - full.gross)).toBeLessThanOrEqual(1);
      expect(r.leavePayP).toBeGreaterThan(0);
    }
  });

  it("한 달을 통째로 휴업하면 정상 급여는 0 이고 휴업수당만 나간다", () => {
    const emp = monthly();
    const r = computePayroll(emp, monthInput(emp, 2026, 11, [shutdown("2026-11-01", "2026-11-30", 0.7)]), DEFAULT_RATES_2025, tax);
    expect(r.baseP).toBe(0);
    expect(r.mealP).toBe(0);
    expect(r.leavePayP).toBe(2_100_000);
    expect(r.gross).toBe(2_100_000);
  });

  it("★ 경업금지 보상금은 휴업수당의 기준에 들지 않고, 쉰 날만큼 일할로 빠진다", () => {
    const emp = monthly({ baseWage: 3_500_000, nonCompetePay: 300_000 });
    const r = computePayroll(emp, monthInput(emp, 2026, 11, [paid("2026-11-16", "2026-11-30", 1)]), DEFAULT_RATES_2025, tax);
    // 정상 급여(일할 50%) 175만 — 그 안의 보상금 15만. 유급휴직 급여 = (350만 − 30만) × 15/30 = 160만
    expect(r.nonCompeteP).toBe(150_000);
    expect(r.leavePayP).toBe(1_600_000);
    expect(r.gross).toBe(1_750_000 + 1_600_000);
  });

  it("통상시급은 그대로다", () => {
    const emp = monthly();
    const full = computePayroll(emp, {}, DEFAULT_RATES_2025, tax);
    const r = computePayroll(emp, monthInput(emp, 2026, 11, [shutdown("2026-11-16", "2026-11-30", 0.7)]), DEFAULT_RATES_2025, tax);
    expect(r.hourlyWage).toBe(full.hourlyWage);
  });

  it("금액 지정 — 넣은 금액이 그대로 지급 항목이 된다", () => {
    const emp = monthly();
    const r = computePayroll(emp, monthInput(emp, 2026, 11, [byAmount("2026-11-16", "2026-11-30", 800_000)]), DEFAULT_RATES_2025, tax);
    expect(r.leavePayP).toBe(800_000);
    expect(r.gross).toBe(1_500_000 + 800_000);
  });

  it("★ 완전비율제(근로) — 비율급은 일할하지 않고, 금액 지정분만 따로 더한다", () => {
    const emp = monthly({ payScheme: "RATIO", ratioEmployee: true, baseWage: 0, mealAllow: 0, ratioPercent: 0.4 });
    const leaves = [byAmount("2026-11-16", "2026-11-30", 500_000, "SHUTDOWN")];
    const r = computePayroll(emp, { ...monthInput(emp, 2026, 11, leaves), classRevenue: 5_000_000 }, DEFAULT_RATES_2025, tax);
    expect(r.baseP).toBe(2_000_000);
    expect(r.leavePayP).toBe(500_000);
    expect(r.gross).toBe(2_500_000);
    // 통상시급은 비율급만으로 낸다 — 휴업수당은 분자에 없다
    expect(r.ratioHourlyBasis?.wage).toBe(2_000_000);
    const note = r.notes.find((n) => n.includes("휴업"))!;
    expect(note).toContain("비율급은 일할하지 않습니다");
    expect(note).toContain("휴업수당 500,000원을 따로 지급합니다");
  });

  it("완전비율제에 비율 지급이 걸려 있으면 원급여가 없어 0원이다 (등록 검사가 먼저 막는다)", () => {
    const emp = monthly({ payScheme: "RATIO", ratioEmployee: true, baseWage: 0, mealAllow: 0, ratioPercent: 0.4 });
    const r = computePayroll(emp, { ...monthInput(emp, 2026, 11, [shutdown("2026-11-16", "2026-11-30", 0.7)]), classRevenue: 5_000_000 }, DEFAULT_RATES_2025, tax);
    expect(r.leavePayP).toBe(0);
    expect(r.gross).toBe(2_000_000);
  });

  it("위탁계약은 휴직·휴업 자체가 없다 — 금액이 넘어와도 싣지 않는다", () => {
    const emp = monthly({ payScheme: "RATIO", incomeType: "FREELANCE", baseWage: 0, mealAllow: 0, ratioPercent: 0.4 });
    const r = computePayroll(emp, { classRevenue: 5_000_000, leavePay: 500_000 }, DEFAULT_RATES_2025, tax);
    expect(r.leavePayP).toBe(0);
    expect(r.gross).toBe(2_000_000);
  });

  it("시급제 — 기록표로 산정한 달은 실근로 그대로이고 휴업수당만 더해진다", () => {
    const emp = monthly({ payScheme: "HOURLY", baseWage: 12_000, mealAllow: 0 });
    const leaves = [shutdown("2026-11-16", "2026-11-30", 0.7)];
    const input = monthInput(emp, 2026, 11, leaves);
    const r = computePayroll(emp, { ...input, workedHours: 80, weeklyHolidayHours: 15 }, DEFAULT_RATES_2025, tax);
    const basis = Math.round(12_000 * 45 * 4.345);
    const orig = Math.round((basis * 15) / 30);
    expect(r.baseP).toBe(960_000);
    expect(r.leavePayP).toBe(Math.round(orig * 0.7));
    expect(r.gross).toBe(960_000 + 180_000 + r.leavePayP);
  });

  it("산정 근거 — 정상 급여의 일할과 따로 지급한 돈을 갈라 적는다", () => {
    const emp = monthly();
    const r = computePayroll(emp, monthInput(emp, 2026, 11, [shutdown("2026-11-16", "2026-11-30", 0.7)]), DEFAULT_RATES_2025, tax);
    const note = r.notes.find((n) => n.startsWith("휴업"))!;
    expect(note).toBe(
      "휴업 11/16~11/30(15일) 휴업수당 1,050,000원(70%) — 정상 급여는 역일수 일할: 지급 대상 15일 ÷ 30일 = 50.0%. " +
        "휴업수당 1,050,000원을 따로 지급합니다."
    );
    expect(r.notes.some((n) => n.includes("재직비율"))).toBe(false);
  });

  it("휴직·휴업이 없는 달의 결과에는 0 이 실린다", () => {
    const r = computePayroll(monthly(), {}, DEFAULT_RATES_2025, tax);
    expect(r.leavePayP).toBe(0);
    expect(r.gross).toBe(3_000_000);
  });
});

describe("기록 근거 — 저장·되읽기·옛 기록", () => {
  const settled = (leaves: UnpaidLeaveSpan[], monthlyBasis = 3_000_000) =>
    settleLeavePay(monthPayDays(2026, 11, HIRE, null, leaves), [], monthlyBasis);

  it("저장했다 되읽어도 같은 값이다", () => {
    const meta = unpaidLeaveMetaOf(
      settled([leave("2026-11-03", "2026-11-03"), shutdown("2026-11-16", "2026-11-20", 0.7), byAmount("2026-11-24", "2026-11-28", 400_000)])
    )!;
    expect(meta.leavePay).toBe(Math.round(500_000 * 0.7) + 400_000);
    expect(readUnpaidLeaveMeta(JSON.stringify({ unpaidLeave: meta }))).toEqual(meta);
  });

  it("★ 무급휴직만인 달의 근거는 v1.63 과 같은 모양이다 — leavePay 키가 없다", () => {
    const meta = unpaidLeaveMetaOf(settled([leave("2026-11-16", "2026-11-30")]))!;
    expect(meta).toEqual({
      days: 15,
      daysInMonth: 30,
      employedDays: 30,
      paidDays: 15,
      spans: [{ from: "2026-11-16", to: "2026-11-30", days: 15 }],
    });
  });

  it("★ v1.63 이 남긴 기록을 그대로 읽는다 — 무급휴직으로", () => {
    const old = JSON.stringify({
      notes: [],
      unpaidLeave: { days: 15, daysInMonth: 30, employedDays: 30, paidDays: 15, spans: [{ from: "2026-11-16", to: "2026-11-30", days: 15 }] },
    });
    const meta = readUnpaidLeaveMeta(old)!;
    expect(meta.spans).toEqual([{ from: "2026-11-16", to: "2026-11-30", days: 15 }]);
    expect(meta.leavePay).toBeUndefined();
    expect(unpaidLeaveNote(meta)).toBe("무급휴직 11/16~11/30(15일)");
    expect(leaveWordOf(meta)).toBe("무급휴직");
  });

  it("모르는 구분이 적힌 구간은 무급휴직으로 읽고 지급 조건을 버린다", () => {
    const meta = readUnpaidLeaveMeta({
      unpaidLeave: { days: 5, daysInMonth: 30, spans: [{ from: "2026-11-01", to: "2026-11-05", days: 5, kind: "BOGUS", pay: 999 }] },
    })!;
    expect(meta.spans).toEqual([{ from: "2026-11-01", to: "2026-11-05", days: 5 }]);
  });

  it("산정을 거치지 않은 일수에서는 leavePay 를 지어내지 않는다", () => {
    const meta = unpaidLeaveMetaOf(monthPayDays(2026, 11, HIRE, null, [shutdown("2026-11-16", "2026-11-30", 0.7)]))!;
    expect(meta.leavePay).toBeUndefined();
  });
});

describe("unpaidLeaveStale — 산정한 뒤에 바뀌었는가", () => {
  const now = (leaves: UnpaidLeaveSpan[]) => monthPayDays(2026, 11, HIRE, null, leaves);
  const stored = (leaves: UnpaidLeaveSpan[]) => unpaidLeaveMetaOf(settleLeavePay(now(leaves), [], 3_000_000));

  it("같은 등록이면 그대로다 — 산정 결과(원급여·지급액)는 견주지 않는다", () => {
    const l = [shutdown("2026-11-16", "2026-11-30", 0.7)];
    expect(unpaidLeaveStale(stored(l), now(l))).toBe(false);
  });

  it("★ 날짜는 그대로인데 비율만 고쳐도 잡는다", () => {
    expect(unpaidLeaveStale(stored([shutdown("2026-11-16", "2026-11-30", 0.7)]), now([shutdown("2026-11-16", "2026-11-30", 1)]))).toBe(true);
  });

  it("★ 무급휴직을 유급휴직으로 바꿔도 잡는다", () => {
    expect(unpaidLeaveStale(stored([leave("2026-11-16", "2026-11-30")]), now([paid("2026-11-16", "2026-11-30", 1)]))).toBe(true);
  });

  it("비율 지급을 금액 지정으로, 금액을 다른 금액으로 바꿔도 잡는다", () => {
    const rate = stored([paid("2026-11-16", "2026-11-30", 1)]);
    expect(unpaidLeaveStale(rate, now([byAmount("2026-11-16", "2026-11-30", 800_000)]))).toBe(true);
    const amt = stored([byAmount("2026-11-16", "2026-11-30", 800_000)]);
    expect(unpaidLeaveStale(amt, now([byAmount("2026-11-16", "2026-11-30", 900_000)]))).toBe(true);
    expect(unpaidLeaveStale(amt, now([byAmount("2026-11-16", "2026-11-30", 800_000)]))).toBe(false);
  });

  it("기간을 늘리면서 총액을 맞춰 이 달 몫이 그대로면 이 달은 손댈 것이 없다", () => {
    const before = stored([byAmount("2026-11-16", "2026-11-30", 1_000_000)]);
    // 11/16~12/15(30일) 200만 → 11월 몫 15일 = 100만
    expect(unpaidLeaveStale(before, now([byAmount("2026-11-16", "2026-12-15", 2_000_000)]))).toBe(false);
  });

  it("★ v1.63 기록과 지금의 무급휴직 등록은 같은 지문이다", () => {
    const old = readUnpaidLeaveMeta({
      unpaidLeave: { days: 15, daysInMonth: 30, employedDays: 30, paidDays: 15, spans: [{ from: "2026-11-16", to: "2026-11-30", days: 15 }] },
    });
    expect(unpaidLeaveStale(old, now([leave("2026-11-16", "2026-11-30")]))).toBe(false);
    expect(unpaidLeaveStale(old, now([leave("2026-11-16", "2026-11-30", { kind: "UNPAID" })]))).toBe(false);
  });
});

describe("표기", () => {
  const meta = (leaves: UnpaidLeaveSpan[], settle = true) => {
    const pd = monthPayDays(2026, 11, HIRE, null, leaves);
    return unpaidLeaveMetaOf(settle ? settleLeavePay(pd, [], 3_000_000) : pd)!;
  };

  it("한 줄 — 산정을 거쳤으면 금액, 아니면 조건", () => {
    const l = [shutdown("2026-11-16", "2026-11-30", 0.7)];
    expect(unpaidLeaveNote(meta(l))).toBe("휴업 11/16~11/30(15일) 휴업수당 1,050,000원(70%)");
    expect(unpaidLeaveNote(meta(l, false))).toBe("휴업 11/16~11/30(15일) 원급여의 70% 지급");
    const a = [byAmount("2026-11-10", "2026-11-14", 400_000)];
    expect(unpaidLeaveNote(meta(a))).toBe("유급휴직 11/10~11/14(5일) 유급휴직 급여 400,000원(금액 지정)");
    expect(unpaidLeaveNote(meta(a, false))).toBe("유급휴직 11/10~11/14(5일) 400,000원 지급(금액 지정)");
  });

  it("구분이 섞이면 구분마다 갈라 적는다", () => {
    const m = meta([leave("2026-11-03", "2026-11-03"), byAmount("2026-11-10", "2026-11-14", 400_000), shutdown("2026-11-23", "2026-11-30", 0.7)]);
    expect(unpaidLeaveNote(m)).toBe(
      "무급휴직 11/3(1일) · 유급휴직 11/10~11/14(5일) 유급휴직 급여 400,000원(금액 지정) · 휴업 11/23~11/30(8일) 휴업수당 560,000원(70%)"
    );
    expect(leaveWordOf(m)).toBe("휴직·휴업");
  });

  it("0% 휴업은 「무급」으로 적는다", () => {
    expect(unpaidLeaveNote(meta([shutdown("2026-11-16", "2026-11-30", 0)]))).toBe("휴업 11/16~11/30(15일) 무급(0%)");
    expect(leaveWordOf(meta([shutdown("2026-11-16", "2026-11-30", 0)]))).toBe("휴업");
  });

  it("무엇이라 부르는가 — 하나면 그 이름, 섞이면 휴직·휴업, 없으면 무급휴직", () => {
    expect(leaveWordOf(meta([paid("2026-11-16", "2026-11-30", 1)]))).toBe("유급휴직");
    expect(leaveWordOf(null, undefined)).toBe("무급휴직");
    // 산정 때는 무급이었는데 지금은 휴업 — 둘을 함께 보면 섞인 것이다
    expect(leaveWordOf(meta([leave("2026-11-16", "2026-11-30")]), meta([shutdown("2026-11-16", "2026-11-30", 0.7)], false))).toBe("휴직·휴업");
  });

  it("★ 명세서 지급 항목 — 구분별로 가르고, 근거와 금액이 안 맞으면 한 줄로", () => {
    const m = meta([byAmount("2026-11-10", "2026-11-14", 400_000), shutdown("2026-11-23", "2026-11-30", 0.7)]);
    expect(leavePayRows(m, 960_000)).toEqual([
      ["유급휴직 급여", 400_000],
      ["휴업수당", 560_000],
    ]);
    // 근거의 합과 지급액이 다르면 지어내 가르지 않는다
    expect(leavePayRows(m, 1_000_000)).toEqual([[LEAVE_PAY_LABEL_ANY, 1_000_000]]);
    expect(leavePayRows(null, 500_000)).toEqual([[LEAVE_PAY_LABEL_ANY, 500_000]]);
    expect(leavePayRows(m, 0)).toEqual([]);
    expect(leavePayRows(meta([leave("2026-11-16", "2026-11-30")]), 0)).toEqual([]);
  });

  it("★ 명세서 산출 근거 — 구간마다 식을 적는다", () => {
    const m = meta([shutdown("2026-11-16", "2026-11-30", 0.7), byAmount("2026-11-10", "2026-11-14", 400_000)]);
    expect(leavePayDetailLines(m)).toEqual([
      "유급휴직 급여 — 11월 10일 ~ 11월 14일(5일): 400,000원(지정한 금액)",
      "휴업수당 — 11월 16일 ~ 11월 30일(15일): 원급여 1,500,000원(월 3,000,000원 × 15/30일) × 70% = 1,050,000원",
    ]);
    expect(leavePayDetailLines(meta([leave("2026-11-16", "2026-11-30")]))).toEqual([]);
  });

  it("달을 걸친 금액 지정은 기간 전체 금액을 함께 적는다", () => {
    const m = meta([byAmount("2026-11-16", "2026-12-15", 2_000_000, "SHUTDOWN")]);
    expect(leavePayDetailLines(m)).toEqual([
      "휴업수당 — 11월 16일 ~ 11월 30일(15일): 1,000,000원(지정한 금액 — 기간 전체 2,000,000원 중 이 달 몫)",
    ]);
  });

  it("계약이 바뀐 구간은 월 기준액을 하나로 적지 않는다 · 0% 는 지급 없음으로", () => {
    const pd = settleLeavePay(
      monthPayDays(2026, 11, HIRE, null, [shutdown("2026-11-11", "2026-11-20", 0.7), shutdown("2026-11-25", "2026-11-26", 0)]),
      [
        { from: "2026-11-01", to: "2026-11-15", monthly: 3_000_000 },
        { from: "2026-11-16", to: "2026-11-30", monthly: 4_000_000 },
      ],
      0
    );
    const lines = leavePayDetailLines(unpaidLeaveMetaOf(pd)!);
    expect(lines[0]).toContain("기간 중 계약이 바뀌어 날짜별 월 급여를 역일수로 계산");
    expect(lines[1]).toBe("휴업 — 11월 25일 ~ 11월 26일(2일): 휴업수당 없음(지급 비율 0%)");
  });

  it("엔진 근거 — 시급제 실근로 달", () => {
    const m = meta([shutdown("2026-11-16", "2026-11-30", 0.7)]);
    expect(unpaidLeaveCalcNote(m, "HOURLY_ACTUAL")).toContain("월 정액 수당만 15/30 로 일할했습니다. 휴업수당 1,050,000원을 따로 지급합니다.");
  });
});

describe("unpaidLeaveError — 유급휴직·휴업의 지급 조건", () => {
  const ctx = { hireDate: HIRE, resignDate: null, contractor: false, others: [] as UnpaidLeaveSpan[] };
  const input = (over: Record<string, unknown> = {}) => ({ startDate: "2026-11-16", endDate: "2026-11-30", ...over });

  it("구분이 없으면 무급휴직이고, 비율·금액을 묻지 않는다", () => {
    expect(unpaidLeaveError(input(), ctx)).toBeNull();
    expect(unpaidLeaveError(input({ kind: "UNPAID" }), ctx)).toBeNull();
  });

  it("모르는 구분은 받지 않는다", () => {
    expect(unpaidLeaveError(input({ kind: "HOLIDAY" }), ctx)).toContain("구분은 무급휴직·유급휴직·휴업 중에서");
  });

  it("★ 유급휴직·휴업은 비율과 금액 중 하나를 정해야 한다", () => {
    expect(unpaidLeaveError(input({ kind: "PAID" }), ctx)).toContain("유급휴직 급여를 어떻게 줄지 정해 주세요");
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN" }), ctx)).toContain("휴업수당을 어떻게 줄지 정해 주세요");
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN" }), ctx)).toContain("비율을 0% 로 넣습니다");
    expect(unpaidLeaveError(input({ kind: "PAID", payRate: 1 }), ctx)).toBeNull();
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN", payRate: 0.7 }), ctx)).toBeNull();
    expect(unpaidLeaveError(input({ kind: "PAID", payAmount: 800_000 }), ctx)).toBeNull();
  });

  it("둘 다 넣으면 막는다 — 어느 쪽으로 줄지 알 수 없다", () => {
    expect(unpaidLeaveError(input({ kind: "PAID", payRate: 0.7, payAmount: 800_000 }), ctx)).toContain(
      "유급휴직 급여는 지급 비율과 금액 중 하나만 정해 주세요"
    );
  });

  it("비율은 0~100%, 소수 둘째 자리(%)까지", () => {
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN", payRate: 1.2 }), ctx)).toContain("0% ~ 100%");
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN", payRate: -0.1 }), ctx)).toContain("0% ~ 100%");
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN", payRate: "0.7" }), ctx)).toContain("0% ~ 100%");
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN", payRate: 0.66666 }), ctx)).toContain("소수 둘째 자리");
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN", payRate: 0.6667 }), ctx)).toBeNull();
  });

  it("★ 휴업의 0% 는 받고(휴업수당 없는 휴업), 유급휴직의 0% 는 막는다", () => {
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN", payRate: 0 }), ctx)).toBeNull();
    expect(unpaidLeaveError(input({ kind: "PAID", payRate: 0 }), ctx)).toContain("구분을 무급휴직으로");
  });

  it("금액은 1원 이상의 정수", () => {
    for (const bad of [0, -1, 1.5, "800000", NaN])
      expect(unpaidLeaveError(input({ kind: "PAID", payAmount: bad }), ctx)).toContain("1원 이상의 정수");
    expect(unpaidLeaveError(input({ kind: "PAID", payAmount: 100_000_001 }), ctx)).toContain("자릿수를 확인");
  });

  it("★ 완전비율제는 비율 지급을 쓸 수 없다 — 금액만", () => {
    const ratio = { ...ctx, ratio: true };
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN", payRate: 0.7 }), ratio)).toContain("금액을 직접 넣어 주세요");
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN", payAmount: 500_000 }), ratio)).toBeNull();
    // 무급휴직은 그대로 된다
    expect(unpaidLeaveError(input(), ratio)).toBeNull();
  });

  it("구분이 달라도 겹치면 막고, 겹친 건의 구분을 적는다", () => {
    const others = [shutdown("2026-11-20", "2026-11-25", 0.7)];
    expect(unpaidLeaveError(input(), { ...ctx, others })).toContain("이미 등록된 휴업(2026-11-20 ~ 2026-11-25)과 겹칩니다");
    expect(unpaidLeaveError(input({ kind: "PAID", payRate: 1 }), { ...ctx, others: [leave("2026-11-01", "2026-11-16")] })).toContain(
      "이미 등록된 무급휴직("
    );
  });

  it("위탁계약은 어느 구분도 대상이 아니다", () => {
    expect(unpaidLeaveError(input({ kind: "SHUTDOWN", payRate: 0.7 }), { ...ctx, contractor: true })).toContain("위탁계약");
  });
});

describe("shutdownRateWarning — 70% 미만 휴업수당 (막지 않는다)", () => {
  it("휴업이고 비율이 70% 에 못 미칠 때만", () => {
    expect(shutdownRateWarning({ kind: "SHUTDOWN", payRate: 0.5 })).toContain("70% 에 못 미칩니다(50%)");
    expect(shutdownRateWarning({ kind: "SHUTDOWN", payRate: 0 })).toContain("노동위원회");
    expect(shutdownRateWarning({ kind: "SHUTDOWN", payRate: 0.7 })).toBeNull();
    expect(shutdownRateWarning({ kind: "SHUTDOWN", payRate: 1 })).toBeNull();
  });
  it("유급휴직·무급휴직·금액 지정은 판단하지 않는다 — 견줄 기준(평균임금)을 모른다", () => {
    expect(shutdownRateWarning({ kind: "PAID", payRate: 0.5 })).toBeNull();
    expect(shutdownRateWarning({ kind: "UNPAID" })).toBeNull();
    expect(shutdownRateWarning({ kind: "SHUTDOWN", payAmount: 1 })).toBeNull();
  });
});
