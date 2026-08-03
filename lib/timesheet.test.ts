import { describe, it, expect } from "vitest";
import {
  normalizeName,
  computeMonthlyFromEntries,
  dominantPeriod,
  matchEmployee,
  type TimesheetEntry,
  type TimesheetPerson,
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

/** 주5일(월~금) 하루 5시간 = 주 25시간 소정근로 */
const WEEK5: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri"].map((day) => ({
  day: day as ScheduleDay["day"],
  work: true,
  start: "17:00",
  end: "22:00",
  breakH: 0,
}));

/** 2026-02-02(월) ~ 02-06(금) 을 하루 h시간씩 채운다 */
const fullWeek = (h = 5, days = 5): TimesheetEntry[] =>
  Array.from({ length: days }, (_, i) => ({
    date: `2026-02-0${i + 2}`,
    hours: h,
  }));

const base = { year: 2026, month: 2, breakPaid: true, schedule: WEEK5 };

describe("computeMonthlyFromEntries — 휴게 차감", () => {
  const week1 = fullWeek(4.5, 4); // 2/2~2/5 각 4.5h

  it("휴게 유급(breakPaid=true): 기록 그대로", () => {
    const r = computeMonthlyFromEntries(week1, { ...base, breakPaid: true });
    expect(r.workHours).toBeCloseTo(18, 5);
    expect(r.workedDays).toBe(4);
  });

  it("휴게 무급(breakPaid=false): 근무일마다 0.5h 차감", () => {
    const r = computeMonthlyFromEntries(week1, { ...base, breakPaid: false });
    expect(r.workHours).toBeCloseTo(16, 5); // 18 - 4×0.5
  });

  it("대상 월 밖의 기록은 실근로에서 제외", () => {
    const r = computeMonthlyFromEntries(
      [
        { date: "2026-01-30", hours: 8 },
        { date: "2026-02-02", hours: 8 },
      ],
      base
    );
    expect(r.workedDays).toBe(1);
    expect(r.workHours).toBeCloseTo(8, 5);
  });
});

describe("주휴 ㉡ 개근 — 소정근로일을 하루라도 빠지면 미발생", () => {
  it("주5일 25시간 계약, 5일 개근 → 주휴 5시간", () => {
    const r = computeMonthlyFromEntries(fullWeek(), base);
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.perfect).toBe(true);
    expect(w.qualified).toBe(true);
    expect(w.holidayHours).toBe(5); // 25 / 5
  });

  it("주5일 계약인데 4일(20시간)만 근무 → 결근 1일이므로 미발생", () => {
    const r = computeMonthlyFromEntries(fullWeek(5, 4), base); // 2/2~2/5, 2/6(금) 결근
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.perfect).toBe(false);
    expect(w.absentDays).toEqual(["2026-02-06"]);
    expect(w.qualified).toBe(false);
    expect(w.holidayHours).toBe(0);
    expect(w.reason).toContain("결근 1일");
  });

  it("연차 사용일은 출근으로 봐서 개근이 유지된다", () => {
    const r = computeMonthlyFromEntries(fullWeek(5, 4), {
      ...base,
      leaveDates: ["2026-02-06"],
    });
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.perfect).toBe(true);
    expect(w.holidayHours).toBe(5);
  });

  it("공휴일은 소정근로일이 아니므로 쉬어도 개근이다", () => {
    const r = computeMonthlyFromEntries(fullWeek(5, 4), {
      ...base,
      holidays: ["2026-02-06"],
    });
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.scheduledDays).not.toContain("2026-02-06");
    expect(w.perfect).toBe(true);
    // 주휴시간은 계약 소정근로(25h) 기준 — 공휴일로 하루 쉬었다고 줄지 않는다
    expect(w.holidayHours).toBe(5);
  });

  it("지각·조퇴는 결근이 아니다 — 기록이 있으면 시간이 짧아도 출근", () => {
    const late = fullWeek().map((e, i) => (i === 2 ? { ...e, hours: 1 } : e));
    const w = computeMonthlyFromEntries(late, base).weeks.find(
      (x) => x.weekStart === "2026-02-02"
    )!;
    expect(w.perfect).toBe(true);
    expect(w.qualified).toBe(true);
  });
});

describe("주휴 ㉠ 15시간 — 소정근로시간 기준", () => {
  /** 주3일 × 4시간 = 12시간 */
  const WEEK3: ScheduleDay[] = ["mon", "tue", "wed"].map((day) => ({
    day: day as ScheduleDay["day"],
    work: true,
    start: "18:00",
    end: "22:00",
    breakH: 0,
  }));

  it("주 소정 12시간이면 개근해도 미발생 (§18③ 초단시간)", () => {
    const r = computeMonthlyFromEntries(
      [
        { date: "2026-02-02", hours: 4 },
        { date: "2026-02-03", hours: 4 },
        { date: "2026-02-04", hours: 4 },
      ],
      { ...base, schedule: WEEK3 }
    );
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.eligible).toBe(false);
    expect(w.qualified).toBe(false);
    expect(w.reason).toContain("15시간 미만");
  });

  it("소정 12시간인데 실근로가 20시간이어도 대상이 아니다", () => {
    const r = computeMonthlyFromEntries(
      [
        { date: "2026-02-02", hours: 7 },
        { date: "2026-02-03", hours: 7 },
        { date: "2026-02-04", hours: 6 },
      ],
      { ...base, schedule: WEEK3 }
    );
    expect(r.weeks.find((x) => x.weekStart === "2026-02-02")!.qualified).toBe(false);
    expect(r.weeklyHolidayHours).toBe(0);
  });

  it("소정 15시간 정각은 대상이다 ('미만' 이 제외이므로)", () => {
    const W15: ScheduleDay[] = ["mon", "tue", "wed"].map((day) => ({
      day: day as ScheduleDay["day"],
      work: true,
      start: "17:00",
      end: "22:00",
      breakH: 0,
    })); // 3일 × 5h = 15h
    const r = computeMonthlyFromEntries(
      [
        { date: "2026-02-02", hours: 5 },
        { date: "2026-02-03", hours: 5 },
        { date: "2026-02-04", hours: 5 },
      ],
      { ...base, schedule: W15 }
    );
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.eligible).toBe(true);
    expect(w.qualified).toBe(true);
    expect(w.holidayHours).toBe(3); // 15 / 5
  });

  it("주휴시간 상한은 8시간", () => {
    const W48: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri", "sat"].map((day) => ({
      day: day as ScheduleDay["day"],
      work: true,
      start: "09:00",
      end: "17:00",
      breakH: 0,
    })); // 6일 × 8h = 48h → 48/5 = 9.6 → cap 8
    const r = computeMonthlyFromEntries(
      Array.from({ length: 6 }, (_, i) => ({ date: `2026-02-0${i + 2}`, hours: 8 })),
      { ...base, schedule: W48 }
    );
    expect(r.weeks.find((x) => x.weekStart === "2026-02-02")!.holidayHours).toBe(8);
  });

  it("실근로가 소정을 넘어도 주휴시간은 늘지 않는다", () => {
    const r = computeMonthlyFromEntries(fullWeek(9), base); // 소정 5h인데 9h씩
    expect(r.weeks.find((x) => x.weekStart === "2026-02-02")!.holidayHours).toBe(5);
  });
});

describe("주휴 ㉢ 1주 근로관계 존속 — 입·퇴사 주", () => {
  it("주휴일(일요일) 전에 퇴사하면 개근해도 미발생", () => {
    // 2/2(월)~2/6(금) 개근 후 2/6 자로 퇴사 → 주휴일 2/8(일)에 근로관계 없음
    const r = computeMonthlyFromEntries(fullWeek(), { ...base, resignDate: "2026-02-06" });
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.perfect).toBe(true);
    expect(w.employedWholeWeek).toBe(false);
    expect(w.qualified).toBe(false);
    expect(w.reason).toContain("주휴일(2026-02-08) 이전");
  });

  it("주휴일까지 재직하면 그 주 주휴는 발생한다 (2021.8.4. 행정해석 변경)", () => {
    const r = computeMonthlyFromEntries(fullWeek(), { ...base, resignDate: "2026-02-08" });
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.employedWholeWeek).toBe(true);
    expect(w.qualified).toBe(true);
    expect(w.holidayHours).toBe(5);
  });

  it("퇴사 이후 날은 소정근로일이 아니라 결근으로 잡히지 않는다", () => {
    // 2/4(수) 퇴사 — 2/5·2/6 은 애초에 소정근로일이 아니다
    const r = computeMonthlyFromEntries(fullWeek(5, 3), { ...base, resignDate: "2026-02-04" });
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.absentDays).toEqual([]);
    expect(w.perfect).toBe(true);
    expect(w.qualified).toBe(false); // 다만 1주 존속이 아니라 미발생
  });

  it("주 중간에 입사하면 그 주는 미발생", () => {
    const r = computeMonthlyFromEntries(fullWeek(5, 5).slice(2), {
      ...base,
      hireDate: "2026-02-04",
    });
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.employedWholeWeek).toBe(false);
    expect(w.qualified).toBe(false);
    expect(w.reason).toContain("입사일");
  });

  it("월요일 입사면 그 주부터 발생한다", () => {
    const r = computeMonthlyFromEntries(fullWeek(), { ...base, hireDate: "2026-02-02" });
    expect(r.weeks.find((x) => x.weekStart === "2026-02-02")!.qualified).toBe(true);
  });
});

describe("주 단위 집계 · 달 경계", () => {
  it("결근한 주는 사유와 함께 남는다 (근무 기록이 없어도 훑는다)", () => {
    const r = computeMonthlyFromEntries(fullWeek(), base);
    // 2월에는 일요일이 1·8·15·22일 → 주휴일이 2월인 주가 4개
    expect(r.weeks.filter((w) => w.weekEnd.startsWith("2026-02")).length).toBe(4);
    const empty = r.weeks.find((x) => x.weekStart === "2026-02-09")!;
    expect(empty.qualified).toBe(false);
    expect(empty.reason).toContain("결근 5일");
  });

  it("주휴일이 다음 달인 주는 이번 달에서 세지 않는다 (이중 지급 방지)", () => {
    // 2026-02-23(월)~03-01(일) — 주휴일이 3월이라 2월 합계에서 빠진다
    const lastWeek: TimesheetEntry[] = ["23", "24", "25", "26", "27"].map((d) => ({
      date: `2026-02-${d}`,
      hours: 5,
    }));
    const r = computeMonthlyFromEntries(lastWeek, base);
    const w = r.weeks.find((x) => x.weekStart === "2026-02-23")!;
    expect(w.weekEnd).toBe("2026-03-01");
    expect(w.qualified).toBe(true); // 주 자체는 요건 충족
    expect(r.weeklyHolidayHours).toBe(0); // 다만 이 달 합계에는 넣지 않는다
    expect(r.workHours).toBeCloseTo(25, 5); // 실근로는 그대로 집계
  });

  it("일요일 근무도 그 주 월요일 버킷으로 들어간다", () => {
    const r = computeMonthlyFromEntries([{ date: "2026-02-08", hours: 6 }], base);
    expect(r.weeks.find((x) => x.weekStart === "2026-02-02")!.hours).toBe(6);
  });
});

describe("근로시간표가 없을 때 — 옛 방식으로 갈음하고 경고", () => {
  it("실근로 15시간 초과면 주휴를 주되 noSchedule 로 알린다", () => {
    const r = computeMonthlyFromEntries(fullWeek(), { year: 2026, month: 2, breakPaid: true });
    expect(r.noSchedule).toBe(true);
    const w = r.weeks.find((x) => x.weekStart === "2026-02-02")!;
    expect(w.qualified).toBe(true);
    expect(w.holidayHours).toBe(5); // 25/5
  });

  it("시간표가 없어도 퇴사 주는 걸러 낸다", () => {
    const r = computeMonthlyFromEntries(fullWeek(), {
      year: 2026,
      month: 2,
      breakPaid: true,
      resignDate: "2026-02-06",
    });
    expect(r.weeks.find((x) => x.weekStart === "2026-02-02")!.qualified).toBe(false);
  });
});
