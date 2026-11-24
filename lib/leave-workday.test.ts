// 유급휴직·휴업 — 비율 지급의 **소정근로일 기준** (v1.65).
//
//   원급여 = 통상시급 × 1일 환산시간(주 소정근로시간 ÷ 5) × 그 기간의 평일(월~금) 수
//   지급액 = 원급여 × 지급 비율
//
// 2026-11 실제 협의 건(월 3,200,000원 · 주 18시간 → 월 유급 93.852시간 · 1일 3.6시간 · 휴업수당 70%)의
// 세 금액을 원 단위로 못박는다. 역일수 기준(v1.64)의 계산·기록은 lib/paid-leave.test.ts 가 그대로 지킨다.

import { describe, it, expect } from "vitest";
import {
  monthPayDays,
  settleLeavePay,
  unpaidLeaveMetaOf,
  readUnpaidLeaveMeta,
  unpaidLeaveStale,
  unpaidLeaveNote,
  unpaidLeaveError,
  normalizeLeaveTerms,
  leavePayTermsOf,
  leavePayBasisOf,
  leavePayTermsLabel,
  leaveTermsLabel,
  leavePayDetailLines,
  leavePayRows,
  leaveZeroBasis,
  workdayWageText,
  type UnpaidLeaveSpan,
  type LeaveWageTerms,
} from "./unpaid-leave";
import {
  computePayroll,
  leaveWageBasis,
  DEFAULT_RATES_2025,
  type EmployeePayInput,
  type TaxBracketRow,
} from "./payroll";
import { leaveBasisPieces, leaveWageTermsOf, type MonthContractTerms } from "./payroll-service";
import type { ScheduleDay } from "./constants";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const HIRE = d("2024-03-04");

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
/** 근무 요일과 시각으로 근로시간표를 만든다 — 나머지 요일은 쉰다 */
const scheduleOf = (work: string[], start: string, end: string, breakH = 0): ScheduleDay[] =>
  DAYS.map((day) =>
    work.includes(day)
      ? ({ day, work: true, start, end, breakH } as ScheduleDay)
      : ({ day, work: false, start: "00:00", end: "00:00", breakH: 0 } as ScheduleDay)
  );

// 주 18시간 — 월·수·금 6시간. 주휴 3.6시간 → 월 유급시간 (18 + 3.6) × 4.345 = 93.852
const WEEK18 = scheduleOf(["mon", "wed", "fri"], "15:00", "21:00");
// 14~22시 · 휴게 30분 — 주 37.5시간, 월 195.525시간, 1일 7.5시간
const WEEK375 = scheduleOf(["mon", "tue", "wed", "thu", "fri"], "14:00", "22:00", 0.5);

const tax: TaxBracketRow[] = [
  { lo: 0, hi: 2000, tax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { lo: 2000, hi: null, tax: [50000, 40000, 30000, 20000, 10000, 0, 0, 0, 0, 0, 0] },
];

const monthly = (over: Partial<EmployeePayInput> = {}): EmployeePayInput => ({
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseWage: 3_200_000,
  positionAllow: 0,
  mealAllow: 0,
  carAllow: 0,
  dependents: 1,
  schedule: WEEK18,
  ...over,
});

const leave = (a: string, b: string, over: Partial<UnpaidLeaveSpan> = {}): UnpaidLeaveSpan => ({
  startDate: d(a),
  endDate: d(b),
  ...over,
});
/** 휴업 — 소정근로일 기준 */
const workday = (a: string, b: string, payRate: number, kind = "SHUTDOWN") =>
  leave(a, b, { kind, payRate, payBasis: "WORKDAY" });
/** 휴업 — 역일수 기준(v1.64 의 행 — 기준이 없다) */
const calendar = (a: string, b: string, payRate: number) => leave(a, b, { kind: "SHUTDOWN", payRate });

/** 서비스가 하는 일 그대로 — 그 달 일수 → 원급여·지급액 */
const settle = (
  emp: EmployeePayInput,
  year: number,
  month: number,
  leaves: UnpaidLeaveSpan[],
  resign: Date | null = null
) => settleLeavePay(monthPayDays(year, month, HIRE, resign, leaves), [], leaveWageTermsOf(emp));

/* ───────────── 협의 건 ───────────── */

describe("★ 2026-11 협의 건 — 월 3,200,000원 · 월 유급 93.852시간 · 1일 3.6시간 · 휴업수당 70%", () => {
  // 휴업 11/7 ~ 2027-01-22, 휴업 종료와 함께 퇴직
  const RESIGN = d("2027-01-22");
  const leaves = [workday("2026-11-07", "2027-01-22", 0.7)];
  const emp = monthly();

  it("산출 기준 — 통상시급의 분자·분모와 1일 환산시간", () => {
    const b = leaveWageBasis(emp);
    expect(b.hourlyBase).toBe(3_200_000);
    expect(b.hourlyHours).toBeCloseTo(93.852, 9);
    expect(b.dailyHours).toBeCloseTo(3.6, 9);
    expect(b.dailyGap).toBeNull();
    expect(workdayWageText(b.hourlyBase, b.hourlyHours)).toBe("월 3,200,000원 ÷ 93.852시간");
  });

  it("★ 11/7 ~ 11/30 — 평일 16일 → 세전 1,374,760원", () => {
    const s = settle(emp, 2026, 11, leaves, RESIGN);
    expect(s.spans).toHaveLength(1);
    expect(s.spans[0]).toMatchObject({
      from: "2026-11-07",
      to: "2026-11-30",
      days: 24,
      kind: "SHUTDOWN",
      rate: 0.7,
      basis: "WORKDAY",
      workdays: 16,
      orig: 1_963_943,
      wage: 3_200_000,
      pay: 1_374_760,
    });
    expect(s.spans[0].hours).toBeCloseTo(93.852, 9);
    expect(s.spans[0].dailyHours).toBeCloseTo(3.6, 9);
    expect(s.leavePay).toBe(1_374_760);
    // 정상 급여는 구분·기준과 무관하게 역일수로 일할한다 — 11/1 ~ 11/6 의 6일
    expect(s.paidDays).toBe(6);
    expect(s.ratio).toBeCloseTo(6 / 30, 12);
  });

  it("★ 12/1 ~ 12/31 — 평일 23일(12/25 성탄절 포함) → 세전 1,976,218원", () => {
    const s = settle(emp, 2026, 12, leaves, RESIGN);
    expect(s.spans[0]).toMatchObject({ days: 31, workdays: 23, orig: 2_823_168, pay: 1_976_218 });
    expect(s.leavePay).toBe(1_976_218);
    expect(s.paidDays).toBe(0);
  });

  it("★ 1/1 ~ 1/22 — 평일 16일(1/1 신정 포함), 퇴직일까지 → 세전 1,374,760원", () => {
    const s = settle(emp, 2027, 1, leaves, RESIGN);
    expect(s.spans[0]).toMatchObject({ from: "2027-01-01", to: "2027-01-22", days: 22, workdays: 16, pay: 1_374_760 });
    expect(s.employedDays).toBe(22);
    expect(s.paidDays).toBe(0);
    expect(s.leavePay).toBe(1_374_760);
  });

  it("세 달을 더하면 4,725,738원", () => {
    const total = [
      [2026, 11],
      [2026, 12],
      [2027, 1],
    ].reduce((a, [y, m]) => a + settle(emp, y, m, leaves, RESIGN).leavePay, 0);
    expect(total).toBe(1_374_760 + 1_976_218 + 1_374_760);
  });

  it("★ 통상시급을 먼저 반올림하지 않는다 — 34,096원으로 자르면 16일치에 9원이 빠진다", () => {
    expect(Math.round(34_096 * 3.6 * 0.7 * 16)).toBe(1_374_751);
    expect(settle(emp, 2026, 11, leaves, RESIGN).leavePay).toBe(1_374_760);
  });

  it("근무 요일이 어떻게 짜여 있든 같다 — 주 5일 3.6시간이어도, 화·목·토 6시간이어도", () => {
    for (const schedule of [
      scheduleOf(["mon", "tue", "wed", "thu", "fri"], "15:00", "18:36"),
      scheduleOf(["tue", "thu", "sat"], "13:00", "19:00"),
    ]) {
      const e = monthly({ schedule });
      expect(settle(e, 2026, 11, leaves, RESIGN).leavePay).toBe(1_374_760);
      expect(settle(e, 2026, 12, leaves, RESIGN).leavePay).toBe(1_976_218);
    }
  });

  it("★ 급여 — 11월은 정상 급여 640,000원(6/30일) + 휴업수당 1,374,760원", () => {
    const s = settle(emp, 2026, 11, leaves, RESIGN);
    const r = computePayroll(
      emp,
      { prorationRatio: s.ratio, unpaidLeave: unpaidLeaveMetaOf(s), leavePay: s.leavePay },
      DEFAULT_RATES_2025,
      tax
    );
    expect(r.baseP).toBe(640_000);
    expect(r.leavePayP).toBe(1_374_760);
    expect(r.gross).toBe(2_014_760);
    // 통상시급은 그대로다 — 휴업수당의 통상시급과 같은 값
    expect(r.hourlyWage).toBe(34_096);
  });

  it("12월·1월은 정상 급여 없이 휴업수당만 나간다", () => {
    for (const [y, m, pay] of [
      [2026, 12, 1_976_218],
      [2027, 1, 1_374_760],
    ]) {
      const s = settle(emp, y, m, leaves, RESIGN);
      const r = computePayroll(
        emp,
        { prorationRatio: s.ratio, unpaidLeave: unpaidLeaveMetaOf(s), leavePay: s.leavePay },
        DEFAULT_RATES_2025,
        tax
      );
      expect(r.baseP).toBe(0);
      expect(r.gross).toBe(pay);
    }
  });

  it("★ 같은 건을 역일수 기준으로 두면 금액이 다르다 — 주휴일·토요일 몫이 들어간다", () => {
    const cal = [calendar("2026-11-07", "2027-01-22", 0.7)];
    expect(settle(emp, 2026, 11, cal, RESIGN).leavePay).toBe(1_792_000); // 320만 × 24/30 × 70%
    expect(settle(emp, 2026, 12, cal, RESIGN).leavePay).toBe(2_240_000); // 320만 × 70%
    // 320만 × 22/31 = 2,270,968원(반올림한 원급여) × 70%
    expect(settle(emp, 2027, 1, cal, RESIGN).leavePay).toBe(1_589_678);
  });

  it("★ 명세서 산출 근거 — 손으로 다시 계산되는 식을 적는다", () => {
    const meta = unpaidLeaveMetaOf(settle(emp, 2026, 11, leaves, RESIGN))!;
    expect(leavePayDetailLines(meta)).toEqual([
      "휴업수당 — 11월 7일 ~ 11월 30일(24일): 통상임금 1,963,943원" +
        "(월 3,200,000원 ÷ 93.852시간 × 1일 3.6시간 × 평일 16일) × 70% = 1,374,760원",
    ]);
    // 적힌 수로 다시 계산해도 같은 금액이다
    expect(Math.round((3_200_000 / 93.852) * 3.6 * 16)).toBe(1_963_943);
    expect(Math.round(1_963_943 * 0.7)).toBe(1_374_760);
    expect(leavePayRows(meta, 1_374_760)).toEqual([["휴업수당", 1_374_760]]);
  });

  it("세무 자료 비고 — 기준과 평일 수를 함께 적는다", () => {
    const meta = unpaidLeaveMetaOf(settle(emp, 2026, 11, leaves, RESIGN))!;
    expect(unpaidLeaveNote(meta)).toBe("휴업 11/7~11/30(24일) 휴업수당 1,374,760원(통상임금의 70% · 평일 16일)");
    // 산정 전(지금 등록을 그대로 보일 때)은 조건만
    const now = unpaidLeaveMetaOf(monthPayDays(2026, 11, HIRE, RESIGN, leaves))!;
    expect(unpaidLeaveNote(now)).toBe("휴업 11/7~11/30(24일) 통상임금의 70% 지급(소정근로일 기준 · 평일 16일)");
  });
});

/* ───────────── 통상시급 ───────────── */

describe("통상시급은 급여 엔진과 같은 값이다", () => {
  const hourlyOf = (e: EmployeePayInput) => {
    const b = leaveWageBasis(e);
    return Math.round(b.hourlyBase / b.hourlyHours);
  };
  const engine = (e: EmployeePayInput) => computePayroll(e, {}, DEFAULT_RATES_2025, tax).hourlyWage;

  it("★ 월급제 — 근로시간표 환산시간", () => {
    for (const e of [
      monthly(),
      monthly({ baseWage: 3_000_000, mealAllow: 200_000, schedule: WEEK375 }),
      monthly({ baseWage: 2_500_000, schedule: scheduleOf(["mon", "tue", "wed", "thu", "fri"], "09:00", "18:00", 1) }),
    ])
      expect(hourlyOf(e)).toBe(engine(e));
  });

  it("★ 포괄임금 — 기본급 산정시간 + 1.5×약정 시간외 + 0.5×약정 야간", () => {
    const e = monthly({
      baseWage: 3_400_000,
      schedule: WEEK375,
      fixedBaseHours: 209,
      fixedOtHours: 20,
      fixedNightHours: 10,
    });
    expect(leaveWageBasis(e).hourlyHours).toBe(209 + 30 + 5);
    expect(hourlyOf(e)).toBe(engine(e));
  });

  it("★ 경업금지 보상금은 통상시급에 넣지 않는다 — 근로의 대가가 아니다", () => {
    const e = monthly({ baseWage: 3_300_000, nonCompetePay: 100_000 });
    const b = leaveWageBasis(e);
    expect(b.hourlyBase).toBe(3_200_000);
    expect(hourlyOf(e)).toBe(engine(e));
    // 그래서 보상금 10만원을 얹은 330만원 계약도 휴업수당은 320만원 계약과 같다
    const s = settle(e, 2026, 11, [workday("2026-11-07", "2026-11-30", 0.7)]);
    expect(s.leavePay).toBe(1_374_760);
  });

  it("직책수당은 엔진의 통상시급에 들지 않으므로 여기도 넣지 않는다 (역일수 기준의 월 기준액에는 든다)", () => {
    const e = monthly({ positionAllow: 300_000 });
    const b = leaveWageBasis(e);
    expect(b.hourlyBase).toBe(3_200_000);
    expect(b.monthly).toBe(3_500_000);
    expect(hourlyOf(e)).toBe(engine(e));
  });

  it("시급제 — 시급이 곧 통상시급이다(나눌 것이 없다)", () => {
    const e = monthly({
      payScheme: "HOURLY",
      baseWage: 12_000,
      mealAllow: 100_000,
      schedule: scheduleOf(["mon", "tue", "wed", "thu", "fri"], "14:00", "18:00"),
    });
    const b = leaveWageBasis(e);
    expect(b).toMatchObject({ hourlyBase: 12_000, hourlyHours: 1, dailyHours: 4, dailyGap: null });
    expect(workdayWageText(b.hourlyBase, b.hourlyHours)).toBe("시급 12,000원");
    // 11/16 ~ 11/30 의 평일 11일 × 4시간 × 12,000원 = 528,000원 × 70%
    const s = settle(e, 2026, 11, [workday("2026-11-16", "2026-11-30", 0.7)]);
    expect(s.spans[0]).toMatchObject({ workdays: 11, orig: 528_000, pay: 369_600 });
    expect(leavePayDetailLines(unpaidLeaveMetaOf(s)!)).toEqual([
      "휴업수당 — 11월 16일 ~ 11월 30일(15일): 통상임금 528,000원(시급 12,000원 × 1일 4시간 × 평일 11일) × 70% = 369,600원",
    ]);
  });

  it("1일 환산시간 = 주 소정근로시간 ÷ 5, 상한 8시간", () => {
    expect(leaveWageBasis(monthly({ schedule: WEEK375 })).dailyHours).toBe(7.5);
    // 주 6일 48시간이어도 주 소정은 40시간 → 1일 8시간
    const six = scheduleOf(["mon", "tue", "wed", "thu", "fri", "sat"], "09:00", "18:00", 1);
    expect(leaveWageBasis(monthly({ schedule: six })).dailyHours).toBe(8);
  });

  it("★ 완전비율제·위탁은 낼 수 없다", () => {
    expect(leaveWageBasis(monthly({ payScheme: "RATIO", ratioEmployee: true })).dailyGap).toBe("RATIO");
    expect(leaveWageBasis(monthly({ payScheme: "RATIO" })).dailyGap).toBe("CONTRACTOR");
    expect(leaveWageBasis(monthly({ payScheme: "HOURLY", isContractor: true })).dailyGap).toBe("CONTRACTOR");
  });

  it("★ 근로시간표가 비면 월급제도 낼 수 없다 — 1일 8시간을 지어내지 않는다 (역일수 기준은 된다)", () => {
    const e = monthly({ schedule: [] });
    const b = leaveWageBasis(e);
    expect(b.dailyGap).toBe("NO_SCHEDULE");
    expect(b).toMatchObject({ hourlyBase: 0, hourlyHours: 0, dailyHours: 0 });
    expect(b.gap).toBeNull();
    expect(b.monthly).toBe(3_200_000);
    const s = settle(e, 2026, 11, [workday("2026-11-16", "2026-11-30", 0.7)]);
    expect(s.spans[0]).toMatchObject({ workdays: 11, orig: 0, pay: 0 });
    expect(s.spans[0].wage).toBeUndefined();
    // 조용히 0원이 나가지 않게 급여 화면이 그 행에 띄운다
    expect(leaveZeroBasis(unpaidLeaveMetaOf(s))).toBe(true);
    // 같은 사람의 역일수 기준은 근로시간표 없이도 계산된다
    expect(settle(e, 2026, 11, [calendar("2026-11-16", "2026-11-30", 0.7)]).leavePay).toBe(1_120_000);
  });
});

/* ───────────── 평일 수 ───────────── */

describe("평일(월~금)만 센다", () => {
  const emp = monthly();

  it("토·일은 세지 않고, 평일에 든 공휴일은 센다", () => {
    // 2026-11-07(토) ~ 11-15(일): 평일은 9~13 의 5일
    expect(monthPayDays(2026, 11, HIRE, null, [workday("2026-11-07", "2026-11-15", 0.7)]).spans[0]).toMatchObject({
      days: 9,
      workdays: 5,
    });
    // 2026-12-25(금) 성탄절 하루 — 공휴일 표를 보지 않는다(유급휴일이라 센다)
    expect(monthPayDays(2026, 12, HIRE, null, [workday("2026-12-25", "2026-12-25", 0.7)]).spans[0].workdays).toBe(1);
  });

  it("★ 주말뿐인 구간은 0원이고, '원급여를 못 낸 것' 이 아니다", () => {
    const s = settle(emp, 2026, 11, [workday("2026-11-07", "2026-11-08", 0.7)]);
    expect(s.spans[0]).toMatchObject({ days: 2, workdays: 0, orig: 0, pay: 0 });
    expect(leaveZeroBasis(unpaidLeaveMetaOf(s))).toBe(false);
    // 그래도 정상 급여에서는 2일이 빠진다 — 일할은 기준과 무관하게 역일수다
    expect(s.paidDays).toBe(28);
  });

  it("달을 걸치면 달마다 그 달의 평일로 센다", () => {
    const l = [workday("2026-11-23", "2026-12-04", 1)];
    expect(monthPayDays(2026, 11, HIRE, null, l).spans[0]).toMatchObject({ from: "2026-11-23", to: "2026-11-30", workdays: 6 });
    expect(monthPayDays(2026, 12, HIRE, null, l).spans[0]).toMatchObject({ from: "2026-12-01", to: "2026-12-04", workdays: 4 });
  });

  it("퇴사일 뒤의 평일은 세지 않는다", () => {
    const s = monthPayDays(2026, 11, HIRE, d("2026-11-18"), [workday("2026-11-16", "2026-11-30", 0.7)]);
    expect(s.spans[0]).toMatchObject({ from: "2026-11-16", to: "2026-11-18", days: 3, workdays: 3 });
  });

  it("★ 100% 여도 평소 한 달 급여보다 적다 — 주휴일 몫이 없다", () => {
    const e = monthly({ baseWage: 3_000_000, schedule: WEEK375 });
    const s = settle(e, 2026, 12, [workday("2026-12-01", "2026-12-31", 1, "PAID")]);
    // 3,000,000 ÷ 195.525 × 7.5 × 23일
    expect(s.leavePay).toBe(Math.round((3_000_000 / 195.525) * 7.5 * 23));
    expect(s.leavePay).toBeLessThan(3_000_000);
    // 역일수 기준이면 평소 급여 그대로다
    expect(settle(e, 2026, 12, [leave("2026-12-01", "2026-12-31", { kind: "PAID", payRate: 1 })]).leavePay).toBe(3_000_000);
  });
});

/* ───────────── 월중 계약 변경 ───────────── */

describe("달 안에서 계약이 바뀌면 그 날짜의 통상시급으로 센다", () => {
  const terms = (baseWage: number): LeaveWageTerms => leaveWageTermsOf(monthly({ baseWage, schedule: WEEK375 }));

  it("★ 11/9 ~ 11/20 휴업 · 16일부터 400만 — 앞 주 5일은 300만, 뒤 주 5일은 400만", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [workday("2026-11-09", "2026-11-20", 0.7)]);
    const s = settleLeavePay(
      pd,
      [
        { from: "2026-11-01", to: "2026-11-15", ...terms(3_000_000) },
        { from: "2026-11-16", to: "2026-11-30", ...terms(4_000_000) },
      ],
      terms(4_000_000)
    );
    const orig = Math.round((3_000_000 * 7.5 * 5) / 195.525 + (4_000_000 * 7.5 * 5) / 195.525);
    expect(s.spans[0]).toMatchObject({ workdays: 10, orig, pay: Math.round(orig * 0.7) });
    // 조건이 둘이라 통상시급을 하나로 적지 않는다
    expect(s.spans[0].wage).toBeUndefined();
    expect(leavePayDetailLines(unpaidLeaveMetaOf(s)!)[0]).toContain(
      "기간 중 계약이 바뀌어 날짜별 통상시급 × 1일 환산시간 × 평일 10일로 계산"
    );
  });

  it("계약 구간에 덮이지 않은 날은 fallback 으로 센다", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [workday("2026-11-09", "2026-11-20", 1)]);
    const s = settleLeavePay(pd, [{ from: "2026-11-01", to: "2026-11-15", ...terms(3_000_000) }], terms(4_000_000));
    expect(s.spans[0].orig).toBe(Math.round((3_000_000 * 7.5 * 5) / 195.525 + (4_000_000 * 7.5 * 5) / 195.525));
  });

  it("조건이 같은 계약 구간 둘은 한 조건으로 본다 — 통상시급을 적는다", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [workday("2026-11-09", "2026-11-20", 0.7)]);
    const s = settleLeavePay(
      pd,
      [
        { from: "2026-11-01", to: "2026-11-15", ...terms(3_000_000) },
        { from: "2026-11-16", to: "2026-11-30", ...terms(3_000_000) },
      ],
      terms(3_000_000)
    );
    expect(s.spans[0]).toMatchObject({ wage: 3_000_000, dailyHours: 7.5 });
  });

  it("월 기준액만 넘기면(숫자 fallback) 소정근로일 기준은 0원이다 — 지어내지 않는다", () => {
    const pd = monthPayDays(2026, 11, HIRE, null, [workday("2026-11-09", "2026-11-20", 0.7)]);
    const s = settleLeavePay(pd, [], 3_000_000);
    expect(s.spans[0]).toMatchObject({ orig: 0, pay: 0 });
    expect(leaveZeroBasis(s)).toBe(true);
  });

  it("★ 서비스가 싣는 계약 구간 — 구간의 조건으로 통상시급을 다시 낸다", () => {
    const payInput = monthly({ baseWage: 4_000_000, schedule: WEEK375 });
    const entry: MonthContractTerms = {
      futureStart: null,
      segs: [
        { days: 15, from: "2026-11-01", to: "2026-11-15", baseWage: 3_000_000, positionAllow: 0, mealAllow: 0, carAllow: 0 },
        {
          days: 15,
          from: "2026-11-16",
          to: "2026-11-30",
          baseWage: 4_100_000,
          positionAllow: 0,
          mealAllow: 0,
          carAllow: 0,
          nonCompetePay: 100_000,
        },
      ],
    };
    const pieces = leaveBasisPieces(payInput, entry);
    expect(pieces.map((p) => [p.from, p.to, p.monthly, p.hourlyBase, p.dailyHours])).toEqual([
      ["2026-11-01", "2026-11-15", 3_000_000, 3_000_000, 7.5],
      // 보상금은 월 기준액에서도 통상시급에서도 빠진다
      ["2026-11-16", "2026-11-30", 4_000_000, 4_000_000, 7.5],
    ]);
    expect(pieces[0].hourlyHours).toBeCloseTo(195.525, 9);
  });
});

/* ───────────── 기록 · 지문 ───────────── */

describe("기록 근거와 지문", () => {
  const emp = monthly();
  const meta = (leaves: UnpaidLeaveSpan[]) => unpaidLeaveMetaOf(settle(emp, 2026, 11, leaves))!;

  it("★ 역일수 기준 구간에는 basis 키가 없다 — v1.64 가 남긴 기록과 같은 모양", () => {
    const s = meta([calendar("2026-11-16", "2026-11-30", 0.7)]).spans[0];
    expect("basis" in s).toBe(false);
    expect("workdays" in s).toBe(false);
    expect("wage" in s).toBe(false);
    expect(s).toMatchObject({ rate: 0.7, orig: 1_600_000, monthly: 3_200_000, pay: 1_120_000 });
  });

  it("저장했다 되읽어도 같은 값이다", () => {
    const m = meta([workday("2026-11-07", "2026-11-30", 0.7)]);
    expect(readUnpaidLeaveMeta(JSON.stringify({ unpaidLeave: m }))).toEqual(m);
  });

  it("모르는 기준이 적힌 구간은 역일수 기준으로 읽고 소정근로일 재료를 버린다", () => {
    const m = meta([workday("2026-11-07", "2026-11-30", 0.7)]);
    const broken = { unpaidLeave: { ...m, spans: m.spans.map((s) => ({ ...s, basis: "WEEKLY" })) } };
    const s = readUnpaidLeaveMeta(broken)!.spans[0];
    expect("basis" in s).toBe(false);
    expect("workdays" in s).toBe(false);
    expect("wage" in s).toBe(false);
    expect(s.pay).toBe(1_374_760);
  });

  it("★ 같은 날짜·같은 비율이어도 산정 기준을 바꾸면 다시 산정해야 한다", () => {
    const stored = meta([calendar("2026-11-07", "2026-11-30", 0.7)]);
    const now = (l: UnpaidLeaveSpan[]) => monthPayDays(2026, 11, HIRE, null, l);
    expect(unpaidLeaveStale(stored, now([calendar("2026-11-07", "2026-11-30", 0.7)]))).toBe(false);
    expect(unpaidLeaveStale(stored, now([workday("2026-11-07", "2026-11-30", 0.7)]))).toBe(true);
    const storedW = meta([workday("2026-11-07", "2026-11-30", 0.7)]);
    expect(unpaidLeaveStale(storedW, now([workday("2026-11-07", "2026-11-30", 0.7)]))).toBe(false);
    expect(unpaidLeaveStale(storedW, now([workday("2026-11-07", "2026-11-30", 0.8)]))).toBe(true);
    expect(unpaidLeaveStale(storedW, now([calendar("2026-11-07", "2026-11-30", 0.7)]))).toBe(true);
  });

  it("★ v1.64 가 산정한 기록(기준 키 없음)은 지금의 역일수 기준 등록과 같은 지문이다", () => {
    const v164 = {
      unpaidLeave: {
        days: 15,
        daysInMonth: 30,
        employedDays: 30,
        paidDays: 15,
        leavePay: 1_120_000,
        spans: [
          { from: "2026-11-16", to: "2026-11-30", days: 15, kind: "SHUTDOWN", rate: 0.7, orig: 1_600_000, monthly: 3_200_000, pay: 1_120_000 },
        ],
      },
    };
    const stored = readUnpaidLeaveMeta(v164);
    expect(unpaidLeaveStale(stored, monthPayDays(2026, 11, HIRE, null, [calendar("2026-11-16", "2026-11-30", 0.7)]))).toBe(false);
    // 표기도 그대로다
    expect(unpaidLeaveNote(stored!)).toBe("휴업 11/16~11/30(15일) 휴업수당 1,120,000원(70%)");
    expect(leavePayDetailLines(stored!)).toEqual([
      "휴업수당 — 11월 16일 ~ 11월 30일(15일): 원급여 1,600,000원(월 3,200,000원 × 15/30일) × 70% = 1,120,000원",
    ]);
  });

  it("0% 휴업은 기준과 무관하게 「무급」이다", () => {
    const m = meta([workday("2026-11-16", "2026-11-30", 0)]);
    expect(unpaidLeaveNote(m)).toBe("휴업 11/16~11/30(15일) 무급(0%)");
    expect(leaveZeroBasis(m)).toBe(false);
    expect(leavePayDetailLines(m)).toEqual(["휴업 — 11월 16일 ~ 11월 30일(15일): 휴업수당 없음(지급 비율 0%)"]);
  });
});

/* ───────────── 조건 읽기 · 저장 · 검사 ───────────── */

describe("산정 기준 — 읽기·저장·검사", () => {
  it("★ 없거나 모르는 값은 역일수 기준이다 — v1.64 의 행에는 기준이 없다", () => {
    expect(leavePayBasisOf(undefined)).toBe("CALENDAR");
    expect(leavePayBasisOf(null)).toBe("CALENDAR");
    expect(leavePayBasisOf("")).toBe("CALENDAR");
    expect(leavePayBasisOf("workday")).toBe("CALENDAR");
    expect(leavePayBasisOf("WORKDAY")).toBe("WORKDAY");
    expect(leavePayTermsOf({ kind: "SHUTDOWN", payRate: 0.7 })).toEqual({ mode: "RATE", rate: 0.7, basis: "CALENDAR" });
    expect(leavePayTermsOf({ kind: "SHUTDOWN", payRate: 0.7, payBasis: "WORKDAY" })).toEqual({
      mode: "RATE",
      rate: 0.7,
      basis: "WORKDAY",
    });
  });

  it("★ 저장 — 소정근로일 기준은 비율 지급에만 남기고, 역일수 기준은 null 로 둔다", () => {
    expect(normalizeLeaveTerms({ kind: "SHUTDOWN", payRate: 0.7, payBasis: "WORKDAY" })).toEqual({
      kind: "SHUTDOWN",
      payRate: 0.7,
      payAmount: null,
      payBasis: "WORKDAY",
    });
    expect(normalizeLeaveTerms({ kind: "SHUTDOWN", payRate: 0.7, payBasis: "CALENDAR" }).payBasis).toBeNull();
    expect(normalizeLeaveTerms({ kind: "SHUTDOWN", payRate: 0.7 }).payBasis).toBeNull();
    // 금액 지정·무급휴직이면 지운다 — 남으면 다시 비율로 돌릴 때 보이지 않던 값이 되살아난다
    expect(normalizeLeaveTerms({ kind: "PAID", payAmount: 800_000, payBasis: "WORKDAY" }).payBasis).toBeNull();
    expect(normalizeLeaveTerms({ kind: "UNPAID", payRate: 0.7, payBasis: "WORKDAY" })).toEqual({
      kind: "UNPAID",
      payRate: null,
      payAmount: null,
      payBasis: null,
    });
  });

  it("한 줄 요약", () => {
    expect(leavePayTermsLabel({ kind: "SHUTDOWN", payRate: 0.7, payBasis: "WORKDAY" })).toBe("통상임금의 70%(소정근로일 기준)");
    expect(leaveTermsLabel({ kind: "SHUTDOWN", payRate: 0.7, payBasis: "WORKDAY" })).toBe("휴업 · 통상임금의 70%(소정근로일 기준)");
    expect(leaveTermsLabel({ kind: "SHUTDOWN", payRate: 0.7 })).toBe("휴업 · 원급여의 70%");
    expect(leaveTermsLabel({ kind: "SHUTDOWN", payRate: 0, payBasis: "WORKDAY" })).toBe("휴업 · 무급(0%)");
  });

  const ctx = { hireDate: HIRE, contractor: false, others: [] as UnpaidLeaveSpan[] };
  const input = (over: Record<string, unknown> = {}) => ({
    startDate: "2026-11-07",
    endDate: "2026-11-30",
    kind: "SHUTDOWN",
    payRate: 0.7,
    ...over,
  });

  it("두 기준 모두 받는다", () => {
    expect(unpaidLeaveError(input(), ctx)).toBeNull();
    expect(unpaidLeaveError(input({ payBasis: "CALENDAR" }), ctx)).toBeNull();
    expect(unpaidLeaveError(input({ payBasis: "WORKDAY" }), ctx)).toBeNull();
    expect(unpaidLeaveError(input({ payBasis: "" }), ctx)).toBeNull();
  });

  it("모르는 기준은 받지 않는다", () => {
    expect(unpaidLeaveError(input({ payBasis: "WEEKLY" }), ctx)).toContain("산정 기준");
  });

  it("★ 근로시간표가 없으면 소정근로일 기준을 막는다 — 지나가면 0원이 산정된다", () => {
    const noSchedule = { ...ctx, noSchedule: true };
    expect(unpaidLeaveError(input({ payBasis: "WORKDAY" }), noSchedule)).toContain("근로시간표");
    // 역일수 기준·금액 지정은 근로시간표가 없어도 된다
    expect(unpaidLeaveError(input(), noSchedule)).toBeNull();
    expect(unpaidLeaveError(input({ payRate: undefined, payAmount: 800_000, payBasis: "WORKDAY" }), noSchedule)).toBeNull();
    // 0% 휴업은 어느 기준이든 0원이라 묻지 않는다
    expect(unpaidLeaveError(input({ payRate: 0, payBasis: "WORKDAY" }), noSchedule)).toBeNull();
  });

  it("완전비율제는 기준과 무관하게 비율 지급을 쓸 수 없다", () => {
    expect(unpaidLeaveError(input({ payBasis: "WORKDAY" }), { ...ctx, ratio: true })).toContain("완전비율제");
  });
});
