import { describe, it, expect } from "vitest";
import {
  normalizeName,
  computeMonthlyFromEntries,
  dominantPeriod,
  matchEmployee,
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
      },
      { rawName: "B", name: "B", entries: [{ date: "2026-02-10", hours: 4 }] },
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
