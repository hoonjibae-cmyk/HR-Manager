import { describe, it, expect } from "vitest";
import {
  computeOvertime,
  overtimeAmount,
  sessionHours,
  isPayEligible,
  needsDecision,
  DEFAULT_OT_POLICY,
  type OtSession,
} from "./overtime";
import type { ScheduleDay } from "./constants";

const at = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00Z`);

/** 학원 표준 근무: 월~금 14:00~22:00 (휴게 0.5h), 토·일 휴무 */
const WEEKDAY: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri"].map((day) => ({
  day: day as ScheduleDay["day"],
  work: true,
  start: "14:00",
  end: "22:00",
  breakH: 0.5,
}));

let seq = 0;
function s(p: Partial<OtSession> & { date: string; from: string; to: string }): OtSession {
  return {
    id: ++seq,
    category: p.category ?? "IMMEDIATE",
    status: p.status ?? "CONFIRMED",
    planStart: at(p.date, p.from),
    planEnd: at(p.date, p.to),
    actualStart: p.actualStart ?? null,
    actualEnd: p.actualEnd ?? null,
    payEligible: p.payEligible ?? null,
  };
}

const run = (sessions: OtSession[], extra: Partial<Parameters<typeof computeOvertime>[0]> = {}) =>
  computeOvertime({ sessions, schedule: WEEKDAY, holidays: [], ...extra });

describe("근무 시간대 분류", () => {
  it("평일 소정근로시간(14~22시) 안의 보강은 수당 대상이 아니다", () => {
    // 2026-08-13 은 목요일
    const r = run([s({ date: "2026-08-13", from: "16:00", to: "18:00" })]);
    expect(r.overtimeHours).toBe(0);
    expect(r.holidayHours).toBe(0);
    expect(r.excluded[0].reason).toContain("소정근로시간 안에서 진행");
  });

  it("평일 근무시간 뒤로 넘어간 부분만 연장근로로 센다 (가산 없음)", () => {
    // 20:00~23:00 → 22시까지는 소정, 22~23시만 연장. 주 40시간 안이라 가산 없음
    const r = run([s({ date: "2026-08-13", from: "20:00", to: "23:00" })]);
    expect(r.extraHours).toBe(1);
    expect(r.overtimeHours).toBe(0);
    expect(r.nightHours).toBe(0); // 야간 가산은 기본 꺼짐
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].timeLabel).toBe("22:00~23:00");
    expect(r.lines[0].multiplier).toBe(1.0);
  });

  it("평일 근무 전(오전) 보강도 연장근로", () => {
    const r = run([s({ date: "2026-08-13", from: "10:00", to: "13:00" })]);
    expect(r.extraHours).toBe(3);
    expect(r.nightHours).toBe(0);
  });

  it("소정근로시간을 앞뒤로 감싸면 두 조각으로 나뉜다", () => {
    const r = run([s({ date: "2026-08-13", from: "12:00", to: "23:30" })]);
    expect(r.lines.map((l) => l.timeLabel)).toEqual(["12:00~14:00", "22:00~23:30"]);
    expect(r.extraHours).toBe(3.5);
    expect(r.nightHours).toBe(0);
  });

  it("토요일은 소정근로일이 아니라 근무분 전부가 연장근로 — 가산은 붙지 않는다", () => {
    // 2026-08-15 은 토요일. 주 소정 37.5h + 7h = 44.5h 지만 기본 정책은 가산하지 않는다
    const r = run([s({ date: "2026-08-15", from: "09:00", to: "16:00" })]);
    expect(r.extraHours).toBe(7);
    expect(r.overtimeHours).toBe(0);
    expect(r.holidayHours).toBe(0);
    expect(r.lines[0].kind).toBe("EXTRA");
    expect(r.lines[0].multiplier).toBe(1.0);
  });

  it("일요일은 휴일근로", () => {
    // 2026-08-16 은 일요일
    const r = run([s({ date: "2026-08-16", from: "09:00", to: "16:00" })]);
    expect(r.holidayHours).toBe(7);
    expect(r.overtimeHours).toBe(0);
    expect(r.lines[0].multiplier).toBe(1.5);
  });

  it("공휴일은 평일이어도 휴일근로 — 소정근로시간 안이라도 전부 센다", () => {
    // 2026-08-14(금)을 임시공휴일로 가정
    const r = run([s({ date: "2026-08-14", from: "15:00", to: "19:00" })], {
      holidays: ["2026-08-14"],
    });
    expect(r.holidayHours).toBe(4);
    expect(r.overtimeHours).toBe(0);
  });

  it("휴일근로 8시간 초과분은 배수가 2.0 으로 갈린다", () => {
    const r = run([s({ date: "2026-08-16", from: "09:00", to: "20:00" })]); // 11시간
    expect(r.holidayHours).toBe(8);
    expect(r.holidayOverHours).toBe(3);
    const over = r.lines.find((l) => l.over);
    expect(over?.multiplier).toBe(2.0);
  });

  it("자정을 넘긴 보강도 시업일 기준으로 묶는다", () => {
    const one = s({ date: "2026-08-15", from: "21:00", to: "01:00" });
    one.planEnd = at("2026-08-16", "01:00");
    expect(sessionHours(one)).toBe(4);
    const r = run([one]);
    expect(r.extraHours).toBe(4); // 토요일 근무로 전부 연장
    expect(r.lines.every((l) => l.date === "2026-08-15")).toBe(true);
  });

  it("근로시간표가 비어 있으면 소정근로를 뺄 수 없어 전부 연장으로 잡는다", () => {
    const r = run([s({ date: "2026-08-13", from: "16:00", to: "18:00" })], { schedule: [] });
    expect(r.extraHours).toBe(2);
  });
});

describe("실근무 확인", () => {
  it("확인 전(PLANNED)에는 수당이 생기지 않는다", () => {
    const r = run([s({ date: "2026-08-15", from: "09:00", to: "16:00", status: "PLANNED" })]);
    expect(r.extraHours).toBe(0);
    expect(r.lines).toHaveLength(0);
  });

  it("미실시·취소는 통째로 빠진다", () => {
    const r = run([
      s({ date: "2026-08-15", from: "09:00", to: "16:00", status: "NOSHOW" }),
      s({ date: "2026-08-16", from: "09:00", to: "16:00", status: "CANCELED" }),
    ]);
    expect(r.extraHours + r.overtimeHours + r.holidayHours).toBe(0);
    expect(r.excluded).toHaveLength(0); // 아예 근무하지 않았으므로 내역에도 없다
  });

  it("관리자가 고친 실근무 시각이 예정 시각을 이긴다", () => {
    const one = s({ date: "2026-08-15", from: "09:00", to: "16:00" });
    one.actualStart = at("2026-08-15", "10:00");
    one.actualEnd = at("2026-08-15", "13:00");
    expect(run([one]).extraHours).toBe(3);
  });
});

describe("보강 종류별 수당 반영", () => {
  it("직전보강은 대상, 결시보강은 관리자가 켜야 반영된다", () => {
    const immediate = run([s({ date: "2026-08-15", from: "09:00", to: "12:00", category: "IMMEDIATE" })]);
    expect(immediate.extraHours).toBe(3);

    const absence = run([s({ date: "2026-08-15", from: "09:00", to: "12:00", category: "ABSENCE" })]);
    expect(absence.extraHours).toBe(0);
    expect(absence.pendingDecision).toBe(1);
    expect(absence.excluded[0].reason).toContain("수당 대상 아닌 보강 종류");

    const approved = run([
      s({ date: "2026-08-15", from: "09:00", to: "12:00", category: "ABSENCE", payEligible: true }),
    ]);
    expect(approved.extraHours).toBe(3);
    expect(approved.pendingDecision).toBe(0);
  });

  it("관리자가 미반영으로 못박으면 대상 종류라도 빠진다", () => {
    const r = run([
      s({ date: "2026-08-15", from: "09:00", to: "12:00", category: "IMMEDIATE", payEligible: false }),
    ]);
    expect(r.extraHours).toBe(0);
    expect(r.excluded[0].reason).toContain("관리자가 수당 미반영");
  });

  it("판단 대기 여부는 카테고리 기본값과 관리자 지정으로 갈린다", () => {
    expect(needsDecision({ category: "ABSENCE", payEligible: null })).toBe(true);
    expect(needsDecision({ category: "ABSENCE", payEligible: false })).toBe(false);
    expect(needsDecision({ category: "IMMEDIATE", payEligible: null })).toBe(false);
    expect(isPayEligible({ category: "MANDATORY", payEligible: null })).toBe(true);
  });
});

describe("내신의무보강 상한 — 수당이 큰 쪽부터 채운다", () => {
  const exam = [
    {
      id: 1,
      name: "2026년 1학기 기말",
      startDate: at("2026-08-01", "00:00"),
      endDate: at("2026-08-31", "00:00"),
      capHours: 10,
    },
  ];

  it("토 7시간 + 일 7시간 → 일요일 7시간 전부 + 토요일 3시간만", () => {
    const r = run(
      [
        s({ date: "2026-08-15", from: "09:00", to: "16:00", category: "MANDATORY" }), // 토 7h
        s({ date: "2026-08-16", from: "09:00", to: "16:00", category: "MANDATORY" }), // 일 7h
      ],
      { examPeriods: exam }
    );
    expect(r.holidayHours).toBe(7); // 일요일(×1.5)이 값어치가 커서 먼저 채워진다
    expect(r.extraHours).toBe(3); // 토요일은 3시간만
    const cut = r.excluded.find((l) => l.date === "2026-08-15");
    expect(cut?.hours).toBe(4);
    expect(cut?.reason).toContain("내신의무보강 상한 초과");
  });

  it("야간 가산을 켜면 값어치가 커져 야간분이 먼저 채워진다", () => {
    const r = run(
      [
        s({ date: "2026-08-15", from: "09:00", to: "19:00", category: "MANDATORY" }), // 토 주간 10h
        s({ date: "2026-08-18", from: "22:00", to: "24:00", category: "MANDATORY" }), // 화 야간 2h (1.0+0.5)
      ],
      { examPeriods: exam, policy: { countNight: true } }
    );
    expect(r.nightHours).toBe(2); // 야간 2시간이 먼저
    expect(r.extraHours).toBe(10); // 야간 2h + 토요일 8h
    expect(r.excluded.find((l) => l.date === "2026-08-15")?.hours).toBe(2);
  });

  it("내신 기간이 다르면 상한도 따로 쓴다", () => {
    const two = [
      { ...exam[0] },
      {
        id: 2,
        name: "2026년 2학기 중간",
        startDate: at("2026-10-01", "00:00"),
        endDate: at("2026-10-31", "00:00"),
        capHours: 10,
      },
    ];
    const r = run(
      [
        s({ date: "2026-08-15", from: "09:00", to: "21:00", category: "MANDATORY" }), // 12h
        s({ date: "2026-10-17", from: "09:00", to: "21:00", category: "MANDATORY" }), // 12h
      ],
      { examPeriods: two }
    );
    expect(r.extraHours).toBe(20); // 각 기간 10시간씩
  });

  it("내신 기간이 등록되지 않았으면 분기(연 4회)로 묶어 상한이 새지 않게 한다", () => {
    const r = run([
      s({ date: "2026-08-15", from: "09:00", to: "16:00", category: "MANDATORY" }), // 3분기 7h
      s({ date: "2026-08-22", from: "09:00", to: "16:00", category: "MANDATORY" }), // 3분기 7h
      s({ date: "2026-11-14", from: "09:00", to: "16:00", category: "MANDATORY" }), // 4분기 7h
    ]);
    expect(r.extraHours).toBe(17); // 3분기 10 + 4분기 7
    expect(r.excluded.some((l) => l.reason?.includes("내신 기간 미등록"))).toBe(true);
  });

  it("상한은 내신의무보강에만 걸리고 직전보강은 자유롭다", () => {
    const r = run(
      [
        s({ date: "2026-08-15", from: "09:00", to: "21:00", category: "MANDATORY" }), // 12h → 10h
        s({ date: "2026-08-22", from: "09:00", to: "21:00", category: "IMMEDIATE" }), // 12h 전부
      ],
      { examPeriods: exam }
    );
    expect(r.extraHours).toBe(22);
  });
});

describe("법정 가산 스위치 (applyStatutoryOvertime)", () => {
  const ON = { policy: { applyStatutoryOvertime: true } };

  it("꺼져 있으면 아무리 길게 일해도 가산이 붙지 않는다", () => {
    const r = run([s({ date: "2026-08-15", from: "09:00", to: "16:00" })]); // 토 7h
    expect(r.extraHours).toBe(7);
    expect(r.overtimeHours).toBe(0);
  });

  it("켜면 주 40시간을 넘는 부분만 ×1.5 로 올라간다", () => {
    // 주 소정 37.5h + 토요일 7h = 44.5h → 2.5h 는 법내(×1.0), 4.5h 는 법정(×1.5)
    const r = run([s({ date: "2026-08-15", from: "09:00", to: "16:00" })], ON);
    expect(r.extraHours).toBe(2.5);
    expect(r.overtimeHours).toBe(4.5);
    expect(overtimeAmount(r, 10000, ON.policy)).toBe(2.5 * 10000 + 4.5 * 10000 * 1.5);
  });

  it("넘긴 시간은 그 주의 늦은 쪽부터 올린다", () => {
    const r = run([s({ date: "2026-08-15", from: "09:00", to: "16:00" })], ON);
    const up = r.lines.find((l) => l.kind === "OVERTIME");
    expect(up?.timeLabel).toBe("11:30~16:00"); // 앞 2.5시간은 법내로 남는다
    expect(up?.reason).toContain("주 40시간 초과");
  });

  it("하루 8시간을 넘기면 그 부분이 먼저 법정 가산으로 잡힌다", () => {
    // 목요일 소정 7.5h + 오전 보강 3h = 10.5h → 2.5h 가 1일 8시간 초과
    const r = run([s({ date: "2026-08-13", from: "10:00", to: "13:00" })], ON);
    expect(r.overtimeHours).toBe(2.5);
    expect(r.extraHours).toBe(0.5);
    expect(r.lines.find((l) => l.kind === "OVERTIME")?.reason).toContain("1일 8시간 초과");
  });

  it("휴일근로는 연장근로시간에 산입하지 않는다", () => {
    // 일요일만 7h → 그 주 합계는 소정 37.5h 뿐이라 연장 승격 대상이 없다
    const r = run([s({ date: "2026-08-16", from: "09:00", to: "16:00" })], ON);
    expect(r.holidayHours).toBe(7);
    expect(r.overtimeHours).toBe(0);
    expect(r.extraHours).toBe(0);
  });

  it("주가 다르면 40시간도 따로 센다", () => {
    const r = run(
      [
        s({ date: "2026-08-15", from: "09:00", to: "16:00" }), // 8/10~16 주
        s({ date: "2026-08-22", from: "09:00", to: "16:00" }), // 8/17~23 주
      ],
      ON
    );
    expect(r.extraHours).toBe(5); // 2.5 + 2.5
    expect(r.overtimeHours).toBe(9); // 4.5 + 4.5
  });
});

describe("금액 환산", () => {
  it("연장은 가산 없이, 휴일만 가산해 합산한다", () => {
    const r = run([
      s({ date: "2026-08-15", from: "09:00", to: "13:00" }), // 토 연장 4h
      s({ date: "2026-08-16", from: "09:00", to: "20:00" }), // 일 휴일 8h + 초과 3h
    ]);
    expect(r.extraHours).toBe(4);
    expect(r.holidayHours).toBe(8);
    expect(r.holidayOverHours).toBe(3);
    // 20,000원 기준: 4×1.0 + 8×1.5 + 3×2.0 = 4 + 12 + 6 = 22시간분
    expect(overtimeAmount(r, 20000)).toBe(22 * 20000);
  });

  it("야간 가산은 기본으로 붙지 않는다", () => {
    const r = run([s({ date: "2026-08-15", from: "22:00", to: "24:00" })]);
    expect(r.extraHours).toBe(2);
    expect(r.nightHours).toBe(0);
    expect(overtimeAmount(r, 10000)).toBe(2 * 10000 * 1.0);
  });

  it("야간 집계를 켜면 같은 시간에 0.5 가 더 붙는다", () => {
    const r = run([s({ date: "2026-08-15", from: "22:00", to: "24:00" })], {
      policy: { countNight: true },
    });
    expect(r.extraHours).toBe(2);
    expect(r.nightHours).toBe(2);
    expect(overtimeAmount(r, 10000)).toBe(2 * 10000 * 1.0 + 2 * 10000 * 0.5);
  });
});

describe("정책 조정", () => {
  it("반올림 단위를 주면 인정시간을 그 단위로 맞춘다", () => {
    // 토 09:00~12:20 = 3.333h → 30분 단위면 3.5h
    const r = run([s({ date: "2026-08-15", from: "09:00", to: "12:20" })], {
      policy: { roundingMinutes: 30 },
    });
    expect(r.extraHours).toBe(3.5);
  });

  it("상한 시간은 정책으로 바꿀 수 있다", () => {
    const r = run([s({ date: "2026-08-15", from: "09:00", to: "21:00", category: "MANDATORY" })], {
      policy: { mandatoryCapHours: 4 },
    });
    expect(r.extraHours).toBe(4);
  });

  it("기본 정책은 연장 가산 없음 · 야간 꺼짐", () => {
    expect(DEFAULT_OT_POLICY.extraMultiplier).toBe(1.0);
    expect(DEFAULT_OT_POLICY.applyStatutoryOvertime).toBe(false);
    expect(DEFAULT_OT_POLICY.countNight).toBe(false);
    expect(DEFAULT_OT_POLICY.holidayMultiplier).toBe(1.5);
    expect(DEFAULT_OT_POLICY.holidayOverMultiplier).toBe(2.0);
  });
});
