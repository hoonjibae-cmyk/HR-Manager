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

describe("주휴 ㉡ 개근 — 요일이 아니라 '근무일수' 로 판정", () => {
  it("주5일 25시간 계약, 5일 근무 → 주휴 5시간", () => {
    const w = wk1(computeMonthlyFromEntries(days(5), base));
    expect(w.requiredDays).toBe(5);
    expect(w.attendedDays).toBe(5);
    expect(w.perfect).toBe(true);
    expect(w.holidayHours).toBe(5); // 25 / 5
  });

  it("주5일 계약인데 4일(20시간)만 근무 → 미발생", () => {
    const w = wk1(computeMonthlyFromEntries(days(4), base));
    expect(w.attendedDays).toBe(4);
    expect(w.perfect).toBe(false);
    expect(w.holidayHours).toBe(0);
    expect(w.reason).toBe("근무 4일 / 필요 5일");
  });

  it("계약 요일(월수금)과 다른 요일(화목토)에 나와도 일수만 채우면 개근", () => {
    // 계약은 월·수·금인데 실제로는 화·목·토 근무 — 학원 사정으로 요일이 바뀌는 경우
    const shifted: TimesheetEntry[] = [
      { date: "2026-02-03", hours: 6 }, // 화
      { date: "2026-02-05", hours: 6 }, // 목
      { date: "2026-02-07", hours: 6 }, // 토
    ];
    const w = wk1(computeMonthlyFromEntries(shifted, { ...base, schedule: WEEK3 }));
    expect(w.requiredDays).toBe(3);
    expect(w.attendedDays).toBe(3);
    expect(w.perfect).toBe(true);
    expect(w.holidayHours).toBeCloseTo(18 / 5, 5);
  });

  it("계약보다 많이 나온 주도 개근 (일수가 넘치면 그만)", () => {
    const w = wk1(computeMonthlyFromEntries(days(5, 6), { ...base, schedule: WEEK3 }));
    expect(w.attendedDays).toBe(5);
    expect(w.requiredDays).toBe(3);
    expect(w.perfect).toBe(true);
  });

  it("연차 사용일은 출근으로 세어 개근이 유지된다", () => {
    const w = wk1(
      computeMonthlyFromEntries(days(4), {
        ...base,
        leaveUses: [{ date: "2026-02-06", days: 1 }],
      })
    );
    expect(w.attendedDays).toBe(5);
    expect(w.leaveDays).toBe(1);
    expect(w.perfect).toBe(true);
    expect(w.holidayHours).toBe(5);
  });

  it("그 주 공휴일수만큼 채워야 할 일수가 줄어든다", () => {
    const w = wk1(computeMonthlyFromEntries(days(4), { ...base, holidays: ["2026-02-06"] }));
    expect(w.requiredDays).toBe(4); // 5 − 공휴일 1
    expect(w.perfect).toBe(true);
    expect(w.holidayHours).toBe(5); // 주휴시간은 계약 소정근로 기준이라 줄지 않는다
  });

  it("일요일 공휴일은 원래 휴무라 근무일수를 줄이지 않는다", () => {
    const w = wk1(computeMonthlyFromEntries(days(4), { ...base, holidays: ["2026-02-08"] }));
    expect(w.requiredDays).toBe(5);
    expect(w.perfect).toBe(false);
  });

  it("지각·조퇴는 결근이 아니다 — 기록이 있으면 하루로 센다", () => {
    const late = days(5).map((e, i) => (i === 2 ? { ...e, hours: 1 } : e));
    expect(wk1(computeMonthlyFromEntries(late, base)).perfect).toBe(true);
  });
});

describe("주휴 ㉠ 15시간 — 소정근로시간 기준", () => {
  const W12: ScheduleDay[] = ["mon", "tue", "wed"].map((day) => ({
    day: day as ScheduleDay["day"],
    work: true,
    start: "18:00",
    end: "22:00",
    breakH: 0,
  })); // 3일 × 4h = 12h

  it("주 소정 12시간이면 개근해도 미발생 (§18③ 초단시간)", () => {
    const w = wk1(computeMonthlyFromEntries(days(3, 4), { ...base, schedule: W12 }));
    expect(w.eligible).toBe(false);
    expect(w.perfect).toBe(true);
    expect(w.qualified).toBe(false);
    expect(w.reason).toContain("15시간 미만");
  });

  it("소정 12시간인데 실근로가 20시간이어도 대상이 아니다", () => {
    const r = computeMonthlyFromEntries(days(3, 7), { ...base, schedule: W12 });
    expect(wk1(r).qualified).toBe(false);
    expect(r.weeklyHolidayHours).toBe(0);
  });

  it("소정 15시간 정각은 대상이다 ('미만' 이 제외이므로)", () => {
    const W15: ScheduleDay[] = ["mon", "tue", "wed"].map((day) => ({
      day: day as ScheduleDay["day"],
      work: true,
      start: "17:00",
      end: "22:00",
      breakH: 0,
    }));
    const w = wk1(computeMonthlyFromEntries(days(3, 5), { ...base, schedule: W15 }));
    expect(w.eligible).toBe(true);
    expect(w.holidayHours).toBe(3); // 15 / 5
  });

  it("주휴시간 상한은 8시간", () => {
    const W48: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri", "sat"].map((day) => ({
      day: day as ScheduleDay["day"],
      work: true,
      start: "09:00",
      end: "17:00",
      breakH: 0,
    })); // 48h → 48/5 = 9.6 → cap 8
    expect(wk1(computeMonthlyFromEntries(days(6, 8), { ...base, schedule: W48 })).holidayHours).toBe(8);
  });

  it("실근로가 소정을 넘어도 주휴시간은 늘지 않는다", () => {
    expect(wk1(computeMonthlyFromEntries(days(5, 9), base)).holidayHours).toBe(5);
  });
});

describe("주휴 ㉢ 1주 근로관계 존속 — 입·퇴사 주", () => {
  it("주휴일(일요일) 전에 퇴사하면 개근해도 미발생", () => {
    const w = wk1(computeMonthlyFromEntries(days(5), { ...base, resignDate: "2026-02-06" }));
    expect(w.perfect).toBe(true);
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
    // 다만 개근 판정에는 여전히 출근으로 센다
    expect(wk1(r).perfect).toBe(true);
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
    expect(empty.reason).toBe("근무 0일 / 필요 5일");
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
    expect(r.weeklyHolidayHours).toBeCloseTo(18 / 5 + 18 / 5, 5); // 이월분 + 8/3 주
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
    expect(w.reason).toContain("개근 판정 보류");
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

  it("knownFrom 이후의 무단결근은 그대로 결근이다", () => {
    const r = computeMonthlyFromEntries(
      [
        { date: "2026-07-06", hours: 6 },
        { date: "2026-07-07", hours: 6 },
      ],
      { year: 2026, month: 7, breakPaid: true, schedule: W3, knownFrom: "2026-07-01" }
    );
    const w = r.weeks.find((x) => x.weekStart === "2026-07-06")!;
    expect(w.partial).toBe(false);
    expect(w.reason).toBe("근무 2일 / 필요 3일");
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
    expect(wk1(r).holidayHours).toBe(5);
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

describe("§18③ 15시간 판정 — 계약이 실제보다 적게 적혀 있을 때", () => {
  // 계약은 주2일(9h)인데 실제로는 주4일씩 나온다 — 이다현 케이스
  const CONTRACT_2D: ScheduleDay[] = ["mon", "thu"].map((day) => ({
    day: day as ScheduleDay["day"],
    work: true,
    start: "17:00",
    end: "22:00",
    breakH: 0.5,
  }));

  /** 2026-02-02(월)부터 4주간, 매주 지정 요일에 6시간씩 나온 기록 */
  const runWeeks = (perWeekDays: number[][], hoursPerDay = 6) => {
    const entries: TimesheetEntry[] = [];
    for (let w = 0; w < perWeekDays.length; w++)
      for (const off of perWeekDays[w]) {
        const d = new Date(Date.UTC(2026, 1, 2 + w * 7 + off));
        entries.push({ date: d.toISOString().slice(0, 10), hours: hoursPerDay });
      }
    return entries;
  };

  it("계약은 9시간이지만 4주 평균 실근로가 15시간 이상이면 주휴가 발생한다", () => {
    // 매주 월·화·목·금 6시간 = 체류 24h, 휴게 2h 차감 → 순 22h
    const entries = runWeeks([[0, 1, 3, 4], [0, 1, 3, 4], [0, 1, 3, 4], [0, 1, 3, 4]]);
    const r = computeMonthlyFromEntries(entries, {
      year: 2026,
      month: 2,
      breakPaid: false,
      schedule: CONTRACT_2D,
      hireDate: "2025-01-01",
      knownFrom: "2026-02-02",
    });
    const w = r.weeks.find((x) => x.weekStart === "2026-02-23")!;
    expect(w.avgWeeklyActual).toBeGreaterThanOrEqual(15);
    expect(w.eligibleBy).toBe("actual");
    expect(w.qualified).toBe(true);
    // 주휴시간은 4주 평균 실근로 ÷ 5 (계약 9h ÷ 5 = 1.8h 가 아니라)
    expect(w.holidayHours).toBeCloseTo(22 / 5, 1);
  });

  it("실근로도 4주 평균 15시간 미만이면 초단시간 그대로 — 사유에 둘 다 적는다", () => {
    // 매주 월·목 6시간 = 체류 12h, 순 11h
    const entries = runWeeks([[0, 3], [0, 3], [0, 3], [0, 3]]);
    const r = computeMonthlyFromEntries(entries, {
      year: 2026,
      month: 2,
      breakPaid: false,
      schedule: CONTRACT_2D,
      hireDate: "2025-01-01",
      knownFrom: "2026-02-02",
    });
    const w = r.weeks.find((x) => x.weekStart === "2026-02-23")!;
    expect(w.eligibleBy).toBeNull();
    expect(w.qualified).toBe(false);
    expect(w.reason).toContain("계약 주 소정근로 9시간");
    expect(w.reason).toContain("4주 평균 실근로 11시간");
  });

  it("계약이 15시간 이상이면 실근로가 적어도 계약 기준으로 판정한다", () => {
    // WEEK5 = 주5일 25시간 계약. 실제로는 주5일 3시간씩(15h 미만) 나와도 계약이 기준
    const entries = runWeeks([[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4]], 3);
    const r = computeMonthlyFromEntries(entries, {
      year: 2026,
      month: 2,
      breakPaid: false,
      schedule: WEEK5,
      hireDate: "2025-01-01",
      knownFrom: "2026-02-02",
    });
    const w = r.weeks.find((x) => x.weekStart === "2026-02-23")!;
    expect(w.eligibleBy).toBe("contract");
    expect(w.holidayHours).toBeCloseTo(5, 5); // 25h ÷ 5 — 실근로(12.5h)가 아니라 계약 기준
  });

  it("계약 ↔ 실제가 다르면 scheduleMismatch 로 알린다", () => {
    const entries = runWeeks([[0, 1, 3, 4], [0, 1, 3, 4], [0, 1, 3, 4], [0, 1, 3, 4]]);
    const r = computeMonthlyFromEntries(entries, {
      year: 2026,
      month: 2,
      breakPaid: false,
      schedule: CONTRACT_2D,
      hireDate: "2025-01-01",
      knownFrom: "2026-02-02",
    });
    expect(r.scheduleMismatch).toEqual({
      contractDays: 2,
      contractHours: 9,
      actualDays: 4,
      actualHours: 22,
    });
  });

  it("계약대로 일하면 scheduleMismatch 는 없다", () => {
    // WEEK5(주5일 17~22시 = 25h) 대로 매주 5일 5시간씩
    const entries = runWeeks([[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4]], 5);
    const r = computeMonthlyFromEntries(entries, {
      year: 2026,
      month: 2,
      breakPaid: true, // 휴게 유급 → 체류 25h 그대로
      schedule: WEEK5,
      hireDate: "2025-01-01",
      knownFrom: "2026-02-02",
    });
    expect(r.scheduleMismatch).toBeNull();
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
