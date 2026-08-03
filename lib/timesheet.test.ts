import { describe, it, expect } from "vitest";
import {
  normalizeName,
  computeMonthlyFromEntries,
  dominantPeriod,
  matchEmployee,
  parseHourCell,
  parseDateCell,
  type TimesheetEntry,
  type TimesheetPerson,
  type MonthlyTimesheetResult,
} from "./timesheet";
import type { ScheduleDay } from "./constants";

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

describe("matchEmployee — 이름 옆에 다른 정보가 붙어도 매칭", () => {
  const emps = [{ name: "오은우" }, { name: "권도현" }, { name: "김민" }, { name: "김민수" }];

  it("정규화 일치: 직책어·퇴직 표기 무시", () => {
    expect(matchEmployee("오은우조교_퇴직", emps).emp?.name).toBe("오은우");
    expect(matchEmployee("권도현 조교", emps).emp?.name).toBe("권도현");
  });

  it("포함 검색: 임의의 접미사/접두사가 붙어도 이름이 들어있으면 매칭", () => {
    expect(matchEmployee("오은우T(오전)", emps).emp?.name).toBe("오은우");
    expect(matchEmployee("★권도현 선생님★", emps).emp?.name).toBe("권도현");
    expect(matchEmployee("2월-오은우-근무표", emps).emp?.name).toBe("오은우");
  });

  it("더 긴 이름 우선 (김민 vs 김민수)", () => {
    expect(matchEmployee("김민수 조교", emps).emp?.name).toBe("김민수");
  });

  it("아무 이름도 없으면 미매칭", () => {
    const r = matchEmployee("장윤지조교", emps);
    expect(r.emp).toBeUndefined();
    expect(r.ambiguous).toBeUndefined();
  });
});

describe("dominantPeriod — 파일에서 연·월 자동 감지", () => {
  it("가장 많은 기록이 있는 달을 반환", () => {
    const people: TimesheetPerson[] = [
      {
        rawName: "A",
        name: "A",
        entries: [
          { date: "2026-02-02", hours: 5 },
          { date: "2026-02-03", hours: 5 },
          { date: "2026-01-31", hours: 5 }, // 소수의 전월 기록
        ],
        skipped: 0,
      },
      { rawName: "B", name: "B", entries: [{ date: "2026-02-10", hours: 4 }], skipped: 0 },
    ];
    expect(dominantPeriod(people)).toEqual({ year: 2026, month: 2 });
  });

  it("기록이 없으면 null", () => {
    expect(dominantPeriod([])).toBeNull();
  });
});

/* ─────────── 주휴수당 (근로기준법 §55①, 시행령 §30①, §18③) ─────────── */

/** 주5일 하루 5시간 = 주 25시간 소정근로 (요일은 판정에 쓰지 않는다) */
const WEEK5: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri"].map((day) => ({
  day: day as ScheduleDay["day"],
  work: true,
  start: "17:00",
  end: "22:00",
  breakH: 0,
}));

/** 주3일 하루 6시간 = 주 18시간 */
const WEEK3: ScheduleDay[] = ["mon", "wed", "fri"].map((day) => ({
  day: day as ScheduleDay["day"],
  work: true,
  start: "16:00",
  end: "22:00",
  breakH: 0,
}));

/** 2026-02-02(월)부터 n일 연속, 하루 h시간 */
const days = (n: number, h = 5, from = 2): TimesheetEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-02-${String(from + i).padStart(2, "0")}`,
    hours: h,
  }));

const base = { year: 2026, month: 2, breakPaid: true, schedule: WEEK5 };
const wk1 = (r: MonthlyTimesheetResult) => r.weeks.find((w) => w.weekStart === "2026-02-02")!;

describe("시간 구분 — 체류 · 휴게 · 순 근로", () => {
  it("휴게 유급: 체류시간 그대로 급여 산정", () => {
    const r = computeMonthlyFromEntries(days(4, 4.5), { ...base, breakPaid: true });
    expect(r.stayHours).toBeCloseTo(18, 5);
    expect(r.breakHours).toBeCloseTo(2, 5); // 4일 × 0.5
    expect(r.netHours).toBeCloseTo(16, 5);
    expect(r.paidHours).toBeCloseTo(18, 5); // 유급이므로 체류 기준
    expect(r.workedDays).toBe(4);
  });

  it("휴게 무급: 순 근로시간으로 급여 산정", () => {
    const r = computeMonthlyFromEntries(days(4, 4.5), { ...base, breakPaid: false });
    expect(r.stayHours).toBeCloseTo(18, 5);
    expect(r.netHours).toBeCloseTo(16, 5);
    expect(r.paidHours).toBeCloseTo(16, 5);
  });

  it("30분보다 짧게 일한 날은 그만큼만 휴게로 뺀다", () => {
    const r = computeMonthlyFromEntries([{ date: "2026-02-02", hours: 0.3 }], {
      ...base,
      breakPaid: false,
    });
    expect(r.netHours).toBe(0);
    expect(r.breakHours).toBeCloseTo(0.3, 5);
  });

  it("대상 월 밖의 기록은 시간 집계에서 제외", () => {
    const r = computeMonthlyFromEntries(
      [
        { date: "2026-01-30", hours: 8 },
        { date: "2026-02-02", hours: 8 },
      ],
      base
    );
    expect(r.workedDays).toBe(1);
    expect(r.stayHours).toBeCloseTo(8, 5);
  });
});

describe("주휴 fixed — 주5일 계약은 계약 근무요일 개근으로 판정", () => {
  // WEEK5 = 월~금 17:00~22:00 (휴게 0) → 주 25시간 · 주5일 → fixed 모드
  it("계약 근무요일을 다 채우면 발생 — 주휴시간은 계약 소정 ÷ 5", () => {
    const w = wk1(computeMonthlyFromEntries(days(5), base));
    expect(w.mode).toBe("fixed");
    expect(w.requiredDays).toBe(5);
    expect(w.missingDates).toEqual([]);
    expect(w.qualified).toBe(true);
    expect(w.holidayHours).toBe(5); // 25 ÷ 5
  });

  it("계약 근무요일 중 하루라도 빠지면 미발생 — 빠진 날짜를 사유에 적는다", () => {
    const w = wk1(computeMonthlyFromEntries(days(4), base)); // 금요일 결근
    expect(w.missingDates).toEqual(["2026-02-06"]);
    expect(w.qualified).toBe(false);
    expect(w.reason).toContain("계약 근무요일 결근 1일 (2/6)");
    expect(w.reason).toContain("개근 4/5일");
  });

  it("다른 날 아무리 길게 일해도 결근한 요일이 있으면 미발생", () => {
    const w = wk1(computeMonthlyFromEntries(days(4, 10), base)); // 4일 × 10h = 38h
    expect(w.actualHours).toBe(38);
    expect(w.eligible).toBe(true);
    expect(w.qualified).toBe(false);
  });

  it("그 주 공휴일은 채워야 할 날에서 빠진다", () => {
    const w = wk1(computeMonthlyFromEntries(days(4), { ...base, holidays: ["2026-02-06"] }));
    expect(w.requiredDays).toBe(4); // 금요일이 공휴일
    expect(w.missingDates).toEqual([]);
    expect(w.qualified).toBe(true);
    expect(w.holidayHours).toBe(5); // 주휴시간은 계약 기준이라 줄지 않는다
  });

  it("일요일 공휴일은 계약 근무요일이 아니라 아무 영향이 없다", () => {
    const w = wk1(computeMonthlyFromEntries(days(4), { ...base, holidays: ["2026-02-08"] }));
    expect(w.requiredDays).toBe(5);
    expect(w.qualified).toBe(false);
  });

  it("연차 사용일은 출근으로 세어 개근이 유지된다", () => {
    const w = wk1(
      computeMonthlyFromEntries(days(4), {
        ...base,
        leaveUses: [{ date: "2026-02-06", days: 1 }],
      })
    );
    expect(w.missingDates).toEqual([]);
    expect(w.qualified).toBe(true);
    expect(w.holidayHours).toBe(5);
  });

  it("지각·조퇴는 결근이 아니다 — 기록이 있으면 그날은 채운 것", () => {
    const late = days(5).map((e, i) => (i === 2 ? { ...e, hours: 1 } : e));
    expect(wk1(computeMonthlyFromEntries(late, base)).qualified).toBe(true);
  });

  it("실근로가 계약보다 많아도 주휴시간은 계약 소정 기준", () => {
    expect(wk1(computeMonthlyFromEntries(days(5, 9), base)).holidayHours).toBe(5);
  });

  it("주휴시간 상한은 8시간", () => {
    const W48: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri", "sat"].map((day) => ({
      day: day as ScheduleDay["day"],
      work: true,
      start: "09:00",
      end: "17:00",
      breakH: 0,
    })); // 6일 × 8h = 48h → 48/5 = 9.6 → 8
    const w = wk1(computeMonthlyFromEntries(days(6, 8), { ...base, schedule: W48 }));
    expect(w.mode).toBe("fixed");
    expect(w.holidayHours).toBe(8);
  });

  it("주5일이어도 계약 소정이 15시간 미만이면 초단시간이라 실근로 판정으로 넘어간다", () => {
    const W10: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri"].map((day) => ({
      day: day as ScheduleDay["day"],
      work: true,
      start: "20:00",
      end: "22:00",
      breakH: 0,
    })); // 5일 × 2h = 10h
    const w = wk1(computeMonthlyFromEntries(days(5, 4), { ...base, schedule: W10 }));
    expect(w.mode).toBe("actual");
    expect(w.actualHours).toBe(17.5); // 5일 × 3.5h
    expect(w.qualified).toBe(true);
  });
});

describe("주휴 actual — 주2~4일 계약은 그 주 실근로 15시간으로 판정", () => {
  // WEEK3 = 월·수·금 16:00~22:00 (휴게 0) → 주 18시간 · 주3일 → actual 모드
  const base3 = { ...base, schedule: WEEK3 };

  it("계약 요일과 다른 요일에 나와도 시간만 채우면 발생", () => {
    const shifted: TimesheetEntry[] = [
      { date: "2026-02-03", hours: 6 }, // 화
      { date: "2026-02-05", hours: 6 }, // 목
      { date: "2026-02-07", hours: 6 }, // 토
    ];
    const w = wk1(computeMonthlyFromEntries(shifted, base3));
    expect(w.mode).toBe("actual");
    expect(w.requiredDays).toBe(0); // 요일 개근을 보지 않는다
    expect(w.actualHours).toBe(16.5); // 3일 × 5.5h
    expect(w.holidayHours).toBeCloseTo(3.3, 5);
  });

  it("15시간 정각은 대상이다 (§18③ 은 '미만' 을 제외한다)", () => {
    const w = wk1(computeMonthlyFromEntries(days(3, 5.5), base3)); // 3일 × 5h = 15h
    expect(w.actualHours).toBe(15);
    expect(w.eligible).toBe(true);
    expect(w.holidayHours).toBe(3);
  });

  it("15시간에 못 미치면 미발생 — 사유에 그 주 실근로를 적는다", () => {
    const w = wk1(computeMonthlyFromEntries(days(3, 5), base3)); // 3일 × 4.5h = 13.5h
    expect(w.actualHours).toBe(13.5);
    expect(w.qualified).toBe(false);
    expect(w.reason).toBe("주 근로 13.5시간 (15시간 미만 — §18③)");
  });

  it("계약(18h)보다 많이 일한 주는 그 주 실근로 기준으로 준다", () => {
    const w = wk1(computeMonthlyFromEntries(days(5, 6), base3)); // 5일 × 5.5h = 27.5h
    expect(w.actualHours).toBe(27.5);
    expect(w.holidayHours).toBe(5.5);
  });

  it("한 주만 15시간을 넘겨도 그 주는 대상 — 다른 주가 미달이어도 무관", () => {
    const entries: TimesheetEntry[] = [
      // 2/02~2/08 주: 3일 × 4h → 순 10.5h (미달)
      { date: "2026-02-02", hours: 4 },
      { date: "2026-02-03", hours: 4 },
      { date: "2026-02-04", hours: 4 },
      // 2/09~2/15 주: 4일 × 5h → 순 18h (충족)
      { date: "2026-02-09", hours: 5 },
      { date: "2026-02-10", hours: 5 },
      { date: "2026-02-11", hours: 5 },
      { date: "2026-02-12", hours: 5 },
    ];
    const r = computeMonthlyFromEntries(entries, base3);
    expect(wk1(r).qualified).toBe(false);
    const w2 = r.weeks.find((w) => w.weekStart === "2026-02-09")!;
    expect(w2.qualified).toBe(true);
    expect(w2.holidayHours).toBe(3.6); // 18 ÷ 5
    expect(r.weeklyHolidayHours).toBe(3.6);
  });

  it("연차 사용일은 1일 소정근로시간을 채운 것으로 세어 15시간 판정에 넣는다", () => {
    // 출근 2일 × 5.5h → 순 10h + 연차 1일(6h) = 16h → 충족
    const w = wk1(
      computeMonthlyFromEntries(days(2, 5.5), {
        ...base3,
        leaveUses: [{ date: "2026-02-06", days: 1 }],
      })
    );
    expect(w.leaveDays).toBe(1);
    expect(w.actualHours).toBe(16);
    expect(w.qualified).toBe(true);
  });

  it("근로시간표가 없어도 그 주 실근로만으로 판정한다", () => {
    const w = wk1(computeMonthlyFromEntries(days(4), { ...base, schedule: [] }));
    expect(w.mode).toBe("actual");
    expect(w.actualHours).toBe(18); // 4일 × 4.5h
    expect(w.qualified).toBe(true);
    expect(w.holidayHours).toBe(3.6);
  });

  it("주휴일이 다음 달인 주는 이 달 합계에 넣지 않는다", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-02-${23 + i}`,
      hours: 5,
    }));
    const r = computeMonthlyFromEntries(entries, base3);
    const w = r.weeks.find((x) => x.weekStart === "2026-02-23")!;
    expect(w.qualified).toBe(true);
    expect(r.weeklyHolidayHours).toBe(0);
  });
});

describe("15시간 판정 — 휴게 30분은 유급·무급과 무관하게 항상 뺀다", () => {
  const base3 = { ...base, schedule: WEEK3 };

  it("휴게가 유급이어도 판정에서는 뺀다 — 체류 15시간은 대상이 아니다", () => {
    const r = computeMonthlyFromEntries(days(3, 5), { ...base3, breakPaid: true });
    expect(r.stayHours).toBe(15);
    expect(r.paidHours).toBe(15); // 급여는 체류 기준(유급)
    expect(wk1(r).actualHours).toBe(13.5); // 판정은 순 근로 기준
    expect(wk1(r).qualified).toBe(false);
  });

  it("휴게 유급·무급이 판정 결과를 바꾸지 않는다", () => {
    const paid = wk1(computeMonthlyFromEntries(days(3, 5.5), { ...base3, breakPaid: true }));
    const unpaid = wk1(computeMonthlyFromEntries(days(3, 5.5), { ...base3, breakPaid: false }));
    expect(paid.actualHours).toBe(unpaid.actualHours);
    expect(paid.holidayHours).toBe(unpaid.holidayHours);
  });
});

describe("주휴 ㉢ 1주 근로관계 존속 — 입·퇴사 주", () => {
  it("주휴일(일요일) 전에 퇴사하면 개근해도 미발생", () => {
    const w = wk1(computeMonthlyFromEntries(days(5), { ...base, resignDate: "2026-02-06" }));
    expect(w.eligible).toBe(true);
    expect(w.employedWholeWeek).toBe(false);
    expect(w.reason).toContain("주휴일(2026-02-08) 이전");
  });

  it("주휴일까지 재직하면 발생한다 (2021.8.4. 행정해석 변경)", () => {
    const w = wk1(computeMonthlyFromEntries(days(5), { ...base, resignDate: "2026-02-08" }));
    expect(w.employedWholeWeek).toBe(true);
    expect(w.qualified).toBe(true);
    expect(w.holidayHours).toBe(5);
  });

  it("주 중간에 입사하면 그 주는 미발생", () => {
    const w = wk1(
      computeMonthlyFromEntries(days(3, 5, 4), { ...base, hireDate: "2026-02-04" })
    );
    expect(w.employedWholeWeek).toBe(false);
    expect(w.reason).toContain("입사일");
  });

  it("월요일 입사면 그 주부터 발생한다", () => {
    expect(wk1(computeMonthlyFromEntries(days(5), { ...base, hireDate: "2026-02-02" })).qualified).toBe(true);
  });
});

describe("연차 — 소정근로시간을 채운 것으로 보고 유급 산정", () => {
  it("연차 1일은 1일 소정근로시간(5h)을 유급으로 더한다", () => {
    const r = computeMonthlyFromEntries(days(4), {
      ...base,
      leaveUses: [{ date: "2026-02-06", days: 1 }],
    });
    expect(r.dailyContractual).toBe(5); // 25h ÷ 5일
    expect(r.leaveDays).toBe(1);
    expect(r.leaveHours).toBe(5);
    expect(r.stayHours).toBe(20); // 실제 출근분
    expect(r.paidHours).toBe(25); // 20 + 연차 5
  });

  it("반차는 0.5일로 비례한다", () => {
    const r = computeMonthlyFromEntries(days(4), {
      ...base,
      leaveUses: [{ date: "2026-02-06", days: 0.5 }],
    });
    expect(r.leaveHours).toBe(2.5);
    expect(r.paidHours).toBe(22.5);
  });

  it("휴게 무급이면 순 근로시간에 연차분을 더한다", () => {
    const r = computeMonthlyFromEntries(days(4), {
      ...base,
      breakPaid: false,
      leaveUses: [{ date: "2026-02-06", days: 1 }],
    });
    expect(r.netHours).toBe(18); // 20 − 2
    expect(r.paidHours).toBe(23); // 18 + 5
  });

  it("연차 미적용 직원(leavePaid=false)은 유급으로 더하지 않는다", () => {
    const r = computeMonthlyFromEntries(days(4), {
      ...base,
      leavePaid: false,
      leaveUses: [{ date: "2026-02-06", days: 1 }],
    });
    expect(r.leaveHours).toBe(0);
    expect(r.paidHours).toBe(20);
    // 다만 그 주 15시간 판정에는 연차분이 그대로 들어간다 (휴게는 항상 차감 → 18 + 5)
    expect(wk1(r).actualHours).toBe(23);
  });

  it("같은 날 중복 기록이 있어도 1일을 넘기지 않는다", () => {
    const r = computeMonthlyFromEntries(days(4), {
      ...base,
      leaveUses: [
        { date: "2026-02-06", days: 0.5 },
        { date: "2026-02-06", days: 1 },
      ],
    });
    expect(r.leaveDays).toBe(1);
    expect(r.leaveHours).toBe(5);
  });
});

describe("주 단위 집계 · 달 경계", () => {
  it("근무 기록이 없는 주도 사유와 함께 남는다", () => {
    const r = computeMonthlyFromEntries(days(5), base);
    expect(r.weeks.filter((w) => w.weekEnd.startsWith("2026-02")).length).toBe(4);
    expect(wk1(r).qualified).toBe(true);
    const empty = r.weeks.find((w) => w.weekStart === "2026-02-09")!;
    expect(empty.reason).toContain("계약 근무요일 결근 5일");
  });

  it("주휴일이 다음 달인 주는 이번 달에서 세지 않는다 (이중 지급 방지)", () => {
    const r = computeMonthlyFromEntries(days(5, 5, 23), base); // 2/23(월)~2/27(금)
    const w = r.weeks.find((x) => x.weekStart === "2026-02-23")!;
    expect(w.weekEnd).toBe("2026-03-01");
    expect(w.qualified).toBe(true);
    expect(r.weeklyHolidayHours).toBe(0); // 3월에서 센다
    expect(r.stayHours).toBe(25); // 실근로는 그대로
  });
});

describe("달을 걸친 주 — 앞달 기록을 함께 봐야 이월분이 살아난다", () => {
  const W3: ScheduleDay[] = ["mon", "tue", "wed"].map((day) => ({
    day: day as ScheduleDay["day"],
    work: true,
    start: "16:00",
    end: "22:00",
    breakH: 0,
  })); // 주3일 18시간
  const b3 = { breakPaid: true, schedule: W3, knownFrom: "2026-07-27" };
  const july = [
    { date: "2026-07-27", hours: 6 },
    { date: "2026-07-28", hours: 6 },
    { date: "2026-07-29", hours: 6 },
  ];
  const aug = [
    { date: "2026-08-03", hours: 6 },
    { date: "2026-08-04", hours: 6 },
    { date: "2026-08-05", hours: 6 },
  ];

  it("7월에는 주휴일이 8월이라 이 달 합계에서 뺀다", () => {
    const r = computeMonthlyFromEntries(july, { ...b3, year: 2026, month: 7 });
    const w = r.weeks.find((x) => x.weekStart === "2026-07-27")!;
    expect(w.weekEnd).toBe("2026-08-02");
    expect(w.qualified).toBe(true);
    expect(r.weeklyHolidayHours).toBe(0);
  });

  it("8월 계산에 7월 기록을 함께 넘기면 그 주 주휴가 8월에 지급된다", () => {
    const r = computeMonthlyFromEntries([...july, ...aug], { ...b3, year: 2026, month: 8 });
    const w = r.weeks.find((x) => x.weekStart === "2026-07-27")!;
    expect(w.attendedDays).toBe(3);
    expect(w.qualified).toBe(true);
    // 휴게 30분은 판정에서 항상 빠지므로 주 16.5h → 3.3h. 이월분 + 8/3 주
    expect(r.weeklyHolidayHours).toBeCloseTo(16.5 / 5 + 16.5 / 5, 5);
    expect(r.stayHours).toBe(18); // 실근로는 8월분만
  });

  it("8월 파일만 있으면 그 주가 결근으로 잡혀 이월분이 사라진다 (고치기 전 동작)", () => {
    const r = computeMonthlyFromEntries(aug, { breakPaid: true, schedule: W3, year: 2026, month: 8 });
    expect(r.weeks.find((x) => x.weekStart === "2026-07-27")!.qualified).toBe(false);
  });
});

describe("기록이 없는 구간 — 결근으로 몰지 않고 판정을 보류한다", () => {
  const W3: ScheduleDay[] = ["mon", "tue", "wed"].map((day) => ({
    day: day as ScheduleDay["day"],
    work: true,
    start: "16:00",
    end: "22:00",
    breakH: 0,
  }));

  it("첫 업로드 달의 첫 주는 앞달 기록이 없어 보류된다", () => {
    const r = computeMonthlyFromEntries(
      [
        { date: "2026-07-01", hours: 6 },
        { date: "2026-07-02", hours: 6 },
      ],
      { year: 2026, month: 7, breakPaid: true, schedule: W3, knownFrom: "2026-07-01" }
    );
    const w = r.weeks.find((x) => x.weekStart === "2026-06-29")!;
    expect(w.partial).toBe(true);
    expect(w.qualified).toBe(false);
    expect(w.reason).toContain("판정 보류");
  });

  it("기록이 아예 없는 주에 주휴가 붙지 않는다", () => {
    const r = computeMonthlyFromEntries(
      [{ date: "2026-07-27", hours: 6 }],
      { year: 2026, month: 7, breakPaid: true, schedule: W3, knownFrom: "2026-07-27" }
    );
    // 7월 앞쪽 주들은 전부 knownFrom 이전 → 보류이지 지급이 아니다
    expect(r.weeklyHolidayHours).toBe(0);
    expect(r.weeks.filter((w) => w.qualified).length).toBe(0);
  });

  it("knownFrom 이후에 안 나온 날은 보류가 아니라 0시간으로 센다", () => {
    const r = computeMonthlyFromEntries(
      [
        { date: "2026-07-06", hours: 6 },
        { date: "2026-07-07", hours: 6 },
      ],
      { year: 2026, month: 7, breakPaid: true, schedule: W3, knownFrom: "2026-07-01" }
    );
    const w = r.weeks.find((x) => x.weekStart === "2026-07-06")!;
    expect(w.partial).toBe(false);
    expect(w.actualHours).toBe(11); // 2일 × 5.5h (휴게 30분 차감)
    expect(w.reason).toBe("주 근로 11시간 (15시간 미만 — §18③)");
  });

  it("출근한 날짜를 그대로 돌려줘 왜 결근인지 볼 수 있다", () => {
    const r = computeMonthlyFromEntries(
      [
        { date: "2026-07-06", hours: 6 },
        { date: "2026-07-08", hours: 6 },
      ],
      { year: 2026, month: 7, breakPaid: true, schedule: W3, knownFrom: "2026-07-01" }
    );
    expect(r.weeks.find((x) => x.weekStart === "2026-07-06")!.attendedDates).toEqual([
      "2026-07-06",
      "2026-07-08",
    ]);
  });
});

describe("근로시간표가 없을 때 — 옛 방식으로 갈음하고 경고", () => {
  it("실근로 15시간 초과면 주휴를 주되 noSchedule 로 알린다", () => {
    const r = computeMonthlyFromEntries(days(5), { year: 2026, month: 2, breakPaid: true });
    expect(r.noSchedule).toBe(true);
    expect(wk1(r).mode).toBe("actual");
    expect(wk1(r).holidayHours).toBe(4.5); // 22.5h ÷ 5 (휴게 30분 항상 차감)
  });

  it("시간표가 없으면 연차 유급 인정도 하지 않는다 (1일 소정을 모르므로)", () => {
    const r = computeMonthlyFromEntries(days(4), {
      year: 2026,
      month: 2,
      breakPaid: true,
      leaveUses: [{ date: "2026-02-06", days: 1 }],
    });
    expect(r.leaveHours).toBe(0);
    expect(r.paidHours).toBe(20);
  });

  it("시간표가 없어도 퇴사 주는 걸러 낸다", () => {
    const r = computeMonthlyFromEntries(days(5), {
      year: 2026,
      month: 2,
      breakPaid: true,
      resignDate: "2026-02-06",
    });
    expect(wk1(r).qualified).toBe(false);
  });
});

describe("parseHourCell — 근무시간 칸을 못 읽어 그날이 사라지는 일 방지", () => {
  it("엑셀 시간값(하루=1)을 시간으로 환산", () => {
    expect(parseHourCell(0.2083333333333333)).toBeCloseTo(5, 3); // 5:00
    expect(parseHourCell(4 / 24 + 47 / 1440 + 55 / 86400)).toBeCloseTo(4.7986, 3); // 4:47:55
  });
  it("사람이 손으로 적은 숫자·문자도 읽는다", () => {
    expect(parseHourCell(5)).toBe(5); // "5" (시간)
    expect(parseHourCell(4.5)).toBe(4.5);
    expect(parseHourCell("5:00")).toBe(5);
    expect(parseHourCell("4:47:55")).toBeCloseTo(4.7986, 3);
    expect(parseHourCell("5.5")).toBe(5.5);
    expect(parseHourCell("5시간 30분")).toBe(5.5);
    expect(parseHourCell(new Date(Date.UTC(1899, 11, 30, 5, 30)))).toBe(5.5);
  });
  it("빈칸·0·합계(24시간 초과)는 버린다", () => {
    expect(parseHourCell(undefined)).toBeNull();
    expect(parseHourCell("")).toBeNull();
    expect(parseHourCell(0)).toBeNull();
    expect(parseHourCell(-1)).toBeNull();
    expect(parseHourCell(62.5)).toBeNull(); // 월 합계 62:32
    expect(parseHourCell("62:32:00")).toBeNull();
    expect(parseHourCell("결근")).toBeNull();
  });
});

describe("parseDateCell — 날짜 칸", () => {
  it("엑셀 일련번호 / Date / 문자 날짜", () => {
    expect(parseDateCell(46223)).toEqual({ date: "2026-07-20" });
    expect(parseDateCell(new Date(Date.UTC(2026, 6, 20)))).toEqual({ date: "2026-07-20" });
    expect(parseDateCell("2026-07-20")).toEqual({ date: "2026-07-20" });
    expect(parseDateCell("2026.7.2")).toEqual({ date: "2026-07-02" });
  });
  it("연도 없는 표기는 월·일만 돌려준다 (나중에 연도를 채운다)", () => {
    expect(parseDateCell("7/20")).toEqual({ month: 7, day: 20 });
    expect(parseDateCell("7월 20일")).toEqual({ month: 7, day: 20 });
  });
  it("날짜가 아닌 값은 null — 1900년대로 튀는 작은 숫자 포함", () => {
    expect(parseDateCell(20)).toBeNull(); // 일자만 적힌 칸 → 1900-01-19 로 튀지 않게
    expect(parseDateCell("합계")).toBeNull();
    expect(parseDateCell(undefined)).toBeNull();
  });
});
