import { describe, it, expect } from "vitest";
import {
  normalizeName,
  computeMonthlyFromEntries,
  type TimesheetEntry,
} from "./timesheet";

describe("normalizeName — 기록표 이름 → 직원 이름", () => {
  it("직책어·퇴직 표기·공백 제거", () => {
    expect(normalizeName("김하연 조교_퇴직")).toBe("김하연");
    expect(normalizeName("양한나 조교")).toBe("양한나");
    expect(normalizeName("조현정조교_퇴직")).toBe("조현정");
    expect(normalizeName("임세영조교")).toBe("임세영");
    expect(normalizeName("박지호 조교장")).toBe("박지호");
    expect(normalizeName("  강민서   조교 ")).toBe("강민서");
  });
});

describe("computeMonthlyFromEntries — 휴게 차감·주휴 산정", () => {
  // 2026-02: 2/2(월)~2/8(일) 이 한 주
  const week1: TimesheetEntry[] = [
    { date: "2026-02-02", hours: 4.5 },
    { date: "2026-02-03", hours: 4.5 },
    { date: "2026-02-04", hours: 4.0 },
    { date: "2026-02-05", hours: 4.0 },
  ]; // 합 17h

  it("휴게 유급(breakPaid=true): 기록 그대로", () => {
    const r = computeMonthlyFromEntries(week1, { year: 2026, month: 2, breakPaid: true });
    expect(r.workHours).toBeCloseTo(17, 5);
    expect(r.workedDays).toBe(4);
  });

  it("휴게 무급(breakPaid=false): 근무일마다 0.5h 차감", () => {
    const r = computeMonthlyFromEntries(week1, { year: 2026, month: 2, breakPaid: false });
    expect(r.workHours).toBeCloseTo(15, 5); // 17 - 4×0.5
  });

  it("주휴: 주 15시간 '초과' 시에만 부여 (딱 15시간은 미지급)", () => {
    const paid = computeMonthlyFromEntries(week1, { year: 2026, month: 2, breakPaid: true });
    // 17h > 15h → 주휴 = 17/5 = 3.4h
    expect(paid.weeks[0].qualified).toBe(true);
    expect(paid.weeklyHolidayHours).toBeCloseTo(17 / 5, 5);

    const unpaid = computeMonthlyFromEntries(week1, { year: 2026, month: 2, breakPaid: false });
    // 15h (초과 아님) → 미지급
    expect(unpaid.weeks[0].qualified).toBe(false);
    expect(unpaid.weeklyHolidayHours).toBe(0);
  });

  it("주휴시간 상한 8시간", () => {
    const heavy: TimesheetEntry[] = [
      { date: "2026-02-02", hours: 9 },
      { date: "2026-02-03", hours: 9 },
      { date: "2026-02-04", hours: 9 },
      { date: "2026-02-05", hours: 9 },
      { date: "2026-02-06", hours: 9 },
    ]; // 45h (유급 기준)
    const r = computeMonthlyFromEntries(heavy, { year: 2026, month: 2, breakPaid: true });
    expect(r.weeks[0].holidayHours).toBe(8); // 45/5=9 → cap 8
  });

  it("주 단위(월~일)로 분리 집계", () => {
    const twoWeeks: TimesheetEntry[] = [
      { date: "2026-02-06", hours: 10 }, // 금 (2/2 주)
      { date: "2026-02-07", hours: 10 }, // 토 (2/2 주) → 20h ✓
      { date: "2026-02-09", hours: 5 }, // 월 (2/9 주) → 5h ✗
    ];
    const r = computeMonthlyFromEntries(twoWeeks, { year: 2026, month: 2, breakPaid: true });
    expect(r.weeks.length).toBe(2);
    expect(r.weeks[0].weekStart).toBe("2026-02-02");
    expect(r.weeks[0].qualified).toBe(true);
    expect(r.weeks[1].qualified).toBe(false);
    expect(r.weeklyHolidayHours).toBeCloseTo(20 / 5, 5);
  });

  it("대상 월 밖의 기록은 제외", () => {
    const mixed: TimesheetEntry[] = [
      { date: "2026-01-30", hours: 8 },
      { date: "2026-02-02", hours: 8 },
    ];
    const r = computeMonthlyFromEntries(mixed, { year: 2026, month: 2, breakPaid: true });
    expect(r.workedDays).toBe(1);
    expect(r.workHours).toBeCloseTo(8, 5);
  });

  it("일요일은 그 주 월요일 버킷으로", () => {
    const sun: TimesheetEntry[] = [{ date: "2026-02-08", hours: 16 }]; // 일요일
    const r = computeMonthlyFromEntries(sun, { year: 2026, month: 2, breakPaid: true });
    expect(r.weeks[0].weekStart).toBe("2026-02-02");
  });
});
