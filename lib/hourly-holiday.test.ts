// 시급제 조교의 휴일근로 가산(근로기준법 §56②) — 일요일(주휴일)·공휴일 근로에는 시간 길이와
// 무관하게 가산이 붙는다. 그 시간은 이미 출퇴근 기록으로 ×1.0 지급되므로 **가산분만** 더한다.
import { describe, it, expect } from "vitest";
import { computePayroll, variableOvertimeOf, holidayMultipliers, DEFAULT_RATES_2025, type EmployeePayInput, type TaxBracketRow } from "./payroll";
import { holidayWorkFromEntries } from "./timesheet";
import type { ScheduleDay } from "./constants";

const table: TaxBracketRow[] = [{ lo: 0, hi: null, tax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }];
const sched: ScheduleDay[] = ["mon", "wed", "fri"].map((d) => ({ day: d as ScheduleDay["day"], work: true, start: "17:00", end: "22:00", breakH: 0.5 }));

const assistant = (o: Partial<EmployeePayInput> = {}): EmployeePayInput =>
  ({
    incomeType: "EMPLOYEE",
    payScheme: "HOURLY",
    isContractor: false,
    baseWage: 10_000,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    dependents: 1,
    schedule: sched,
    ...o,
  }) as EmployeePayInput;

describe("출퇴근 기록에서 휴일근로시간 뽑기", () => {
  const holidays = ["2026-09-24", "2026-09-25", "2026-09-26"]; // 추석 연휴(가정)
  it("일요일·공휴일만, 휴게 30분을 뺀 순 근로시간으로, 8시간 초과를 가른다", () => {
    const w = holidayWorkFromEntries(
      [
        { date: "2026-09-06", hours: 5 }, // 일 → 4.5
        { date: "2026-09-05", hours: 5 }, // 토 — 휴일 아님(주휴일은 일요일)
        { date: "2026-09-07", hours: 5 }, // 월 — 평일
        { date: "2026-09-24", hours: 10 }, // 공휴일 → 9.5 = 8 + 1.5
        { date: "2026-08-30", hours: 6 }, // 앞달 일요일 — 이 달에 넣지 않는다
      ],
      { year: 2026, month: 9, holidays }
    );
    expect(w.days.map((d) => d.date)).toEqual(["2026-09-06", "2026-09-24"]);
    expect(w.hours).toBe(12.5); // 4.5 + 8
    expect(w.overHours).toBe(1.5);
    expect(w.days[1].kind).toBe("HOLIDAY");
  });

  it("일요일이면서 공휴일인 날은 한 번만 센다", () => {
    const w = holidayWorkFromEntries([{ date: "2026-09-27", hours: 4 }], { year: 2026, month: 9, holidays: ["2026-09-27"] });
    expect(w.days).toHaveLength(1);
    expect(w.hours).toBe(3.5);
  });

  it("같은 날 여러 줄이면 합쳐서 본다(휴게는 하루 한 번)", () => {
    const w = holidayWorkFromEntries(
      [
        { date: "2026-09-13", hours: 3 },
        { date: "2026-09-13", hours: 2 },
      ],
      { year: 2026, month: 9 }
    );
    expect(w.hours).toBe(4.5);
  });

  it("휴일 근무가 없으면 0", () => {
    const w = holidayWorkFromEntries([{ date: "2026-09-07", hours: 5 }], { year: 2026, month: 9 });
    expect(w).toEqual({ hours: 0, overHours: 0, days: [] });
  });
});

describe("시급제 휴일근로 가산 — 가산분만 더한다", () => {
  it("휴일 8시간까지 ×0.5, 초과분 ×1.0 — 기본 시급분은 근로시간에 이미 들어 있다", () => {
    const r = computePayroll(assistant(), { workedHours: 60, weeklyHolidayHours: 0, holidayHours: 12.5, holidayOverHours: 1.5 }, DEFAULT_RATES_2025, table);
    expect(r.baseP).toBe(600_000); // 60h × 10,000 (휴일 근로 포함)
    expect(r.holidayP).toBe(62_500 + 15_000); // 12.5 × 10,000 × 0.5 + 1.5 × 10,000 × 1.0
    expect(r.notes.join()).toContain("휴일근로 가산");
  });

  it("합치면 법정 배수가 된다 — 휴일 1시간 총액 = 시급 × 1.5", () => {
    const without = computePayroll(assistant(), { workedHours: 1, weeklyHolidayHours: 0 }, DEFAULT_RATES_2025, table);
    const withHol = computePayroll(assistant(), { workedHours: 1, weeklyHolidayHours: 0, holidayHours: 1 }, DEFAULT_RATES_2025, table);
    expect(withHol.gross).toBe(15_000);
    expect(withHol.gross - without.gross).toBe(5_000);
  });

  it("월급제는 예전대로 시간 전체 ×1.5 (가산분만이 아님)", () => {
    expect(holidayMultipliers("MONTHLY")).toMatchObject({ within8: 1.5, over8: 2 });
    expect(holidayMultipliers("HOURLY")).toMatchObject({ within8: 0.5, over8: 1 });
  });

  it("위탁계약(프리랜서)은 가산 대상이 아니다", () => {
    const r = computePayroll(assistant({ isContractor: true, incomeType: "FREELANCE" }), { workedHours: 10, holidayHours: 5 }, DEFAULT_RATES_2025, table);
    expect(r.holidayP).toBe(0);
  });

  it("세무 시트 '오버타임수당' 도 같은 배수로 다시 센다 — 지급액과 어긋나지 않는다", () => {
    const r = computePayroll(assistant(), { workedHours: 60, weeklyHolidayHours: 0, holidayHours: 12.5, holidayOverHours: 1.5 }, DEFAULT_RATES_2025, table);
    expect(variableOvertimeOf({ holidayHours: 12.5, holidayOverHours: 1.5, hourlyWage: r.hourlyWage, payScheme: "HOURLY" })).toBe(r.holidayP);
  });
});
