// 예약 발송 스케줄 판단 (KST 기준) — DB 무관 순수 로직
import { describe, it, expect } from "vitest";
import {
  kstParts,
  kstToUtc,
  sameKstDay,
  effectiveDayOfMonth,
  targetYearMonth,
  scheduleDue,
  payoutDayOfMonth,
  computeNextRun,
  formatKst,
  type ScheduleLike,
} from "./scheduler";

const base: ScheduleLike = {
  enabled: true,
  frequency: "MONTHLY",
  dayOfMonth: 7,
  dayOfWeek: 1,
  hour: 9,
  minute: 0,
  targetMonthOffset: -1,
  lastRunAt: null,
};

describe("KST 변환", () => {
  it("UTC 00:00 = KST 09:00 (같은 날)", () => {
    const p = kstParts(new Date("2026-08-07T00:00:00Z"));
    expect(p).toMatchObject({ year: 2026, month: 8, day: 7, hour: 9, minute: 0 });
  });

  it("UTC 15:00 = 다음날 KST 00:00 (날짜 경계)", () => {
    const p = kstParts(new Date("2026-08-06T15:00:00Z"));
    expect(p).toMatchObject({ year: 2026, month: 8, day: 7, hour: 0 });
  });

  it("kstToUtc 는 왕복 변환된다", () => {
    const utc = kstToUtc(2026, 8, 7, 9, 30);
    expect(utc.toISOString()).toBe("2026-08-07T00:30:00.000Z");
    expect(kstParts(utc)).toMatchObject({ year: 2026, month: 8, day: 7, hour: 9, minute: 30 });
  });

  it("sameKstDay 는 UTC 날짜가 달라도 한국 날짜로 판단", () => {
    // 둘 다 KST 2026-08-07
    expect(
      sameKstDay(new Date("2026-08-06T15:30:00Z"), new Date("2026-08-07T05:00:00Z"))
    ).toBe(true);
  });

  it("formatKst 표기", () => {
    expect(formatKst(new Date("2026-08-07T00:00:00Z"))).toBe("2026-08-07 09:00");
  });
});

describe("targetYearMonth — 발송 대상 월", () => {
  it("전월분(-1): KST 8월 7일 실행 → 7월분", () => {
    expect(targetYearMonth(new Date("2026-08-07T00:00:00Z"), -1)).toEqual({ year: 2026, month: 7 });
  });
  it("당월분(0)", () => {
    expect(targetYearMonth(new Date("2026-08-07T00:00:00Z"), 0)).toEqual({ year: 2026, month: 8 });
  });
  it("연 경계: KST 1월 7일 전월분 → 전년 12월", () => {
    expect(targetYearMonth(new Date("2026-01-07T00:00:00Z"), -1)).toEqual({ year: 2025, month: 12 });
  });
  it("UTC 기준이면 틀리는 경계: UTC 7/31 20:00 = KST 8/1 → 전월분은 7월", () => {
    expect(targetYearMonth(new Date("2026-07-31T20:00:00Z"), -1)).toEqual({ year: 2026, month: 7 });
  });
});

describe("scheduleDue — 매월", () => {
  it("지정일 + 예정 시각 이후면 발송", () => {
    const r = scheduleDue(base, new Date("2026-08-07T00:00:00Z"), { holidays: [] }); // KST 8/7 09:00
    expect(r.due).toBe(true);
  });

  it("지정일이 아니면 미발송", () => {
    const r = scheduleDue(base, new Date("2026-08-08T00:00:00Z"), { holidays: [] });
    expect(r.due).toBe(false);
    expect(r.reason).toContain("날짜 불일치");
  });

  it("예정 시각 이전이면 미발송 (strict 모드)", () => {
    const r = scheduleDue(base, new Date("2026-08-06T23:00:00Z"), { holidays: [] }); // KST 8/7 08:00
    expect(r.due).toBe(false);
    expect(r.reason).toContain("예정 시각 이전");
  });

  it("ignoreClock(서버리스 크론)이면 시각 무관하게 발송", () => {
    const r = scheduleDue(base, new Date("2026-08-06T23:00:00Z"), { ignoreClock: true, holidays: [] });
    expect(r.due).toBe(true);
  });

  it("같은 한국 날짜에 이미 실행했으면 중복 발송 안 함", () => {
    const sched = { ...base, lastRunAt: new Date("2026-08-06T15:10:00Z") }; // KST 8/7 00:10
    const r = scheduleDue(sched, new Date("2026-08-07T00:00:00Z"), { holidays: [] }); // KST 8/7 09:00
    expect(r.due).toBe(false);
    expect(r.reason).toBe("오늘 이미 실행됨");
  });

  it("전날 실행분은 중복으로 보지 않음", () => {
    const sched = { ...base, lastRunAt: new Date("2026-08-05T23:00:00Z") }; // KST 8/6 08:00
    expect(scheduleDue(sched, new Date("2026-08-07T00:00:00Z"), { holidays: [] }).due).toBe(true);
  });

  it("비활성이면 미발송, force 면 무조건 발송", () => {
    const off = { ...base, enabled: false };
    expect(scheduleDue(off, new Date("2026-08-07T00:00:00Z"), { holidays: [] }).due).toBe(false);
    expect(scheduleDue(off, new Date("2026-08-08T00:00:00Z"), { force: true, holidays: [] }).due).toBe(true);
  });

  it("31일 지정 + 2월 → 말일 보정, 그 말일이 토요일이면 다시 금요일로", () => {
    const sched = { ...base, dayOfMonth: 31 };
    expect(effectiveDayOfMonth(2026, 2, 31)).toBe(28); // 말일 보정은 그대로
    // 2026-02-28 은 토요일 → 2/27(금)
    expect(scheduleDue(sched, new Date("2026-02-28T00:00:00Z"), { holidays: [] }).due).toBe(false);
    expect(scheduleDue(sched, new Date("2026-02-27T00:00:00Z"), { holidays: [] }).due).toBe(true);
  });
});

/*
 * 급여명세서는 임금 지급일과 함께 움직인다. 쉬는 날 보내면 문의할 곳이 없고 은행 이체와도
 * 어긋나므로 **그 전 마지막 평일로 당긴다**(늦추면 지연 지급이 된다).
 */
describe("발송일이 토·일·공휴일이면 그 전 마지막 평일로", () => {
  const due = (now: string, hol: string[] = [], sched: ScheduleLike = base) =>
    scheduleDue(sched, new Date(now), { holidays: hol, ignoreClock: true }).due;

  it("평일이면 그대로", () => {
    // 2026-08-07 은 금요일
    expect(payoutDayOfMonth(2026, 8, 7, [])).toBe(7);
  });

  it("토요일이면 금요일로", () => {
    // 2026-11-07 은 토요일
    expect(payoutDayOfMonth(2026, 11, 7, [])).toBe(6);
    expect(due("2026-11-07T00:00:00Z")).toBe(false);
    expect(due("2026-11-06T00:00:00Z")).toBe(true);
  });

  it("일요일이면 금요일로 (이틀 당긴다)", () => {
    // 2026-03-08 은 일요일
    expect(payoutDayOfMonth(2026, 3, 8, [])).toBe(6);
  });

  it("공휴일이면 그 전 평일로", () => {
    // 2026-08-07(금)이 임시공휴일이라면 8/6(목)
    expect(payoutDayOfMonth(2026, 8, 7, ["2026-08-07"])).toBe(6);
    // 목요일까지 연달아 쉬면 수요일
    expect(payoutDayOfMonth(2026, 8, 7, ["2026-08-07", "2026-08-06"])).toBe(5);
  });

  it("연휴가 주말에 이어지면 그 앞 금요일까지 간다", () => {
    // 2026-11-07 토 · 11-08 일 · 11-09 월(가정) → 9일 지정분은 11/6(금)
    expect(payoutDayOfMonth(2026, 11, 9, ["2026-11-09"])).toBe(6);
  });

  // 대상 월을 '지금이 몇 월인가' 로 정하므로 지난달로 넘어가면 한 달 전 명세서를 보낸다
  it("**달을 넘어가야 할 만큼이면 옮기지 않는다** — 엉뚱한 달을 보내느니 그날 보낸다", () => {
    // 2026-08-01 은 토요일. 당기면 7/31 이라 8월이 아니게 된다
    expect(payoutDayOfMonth(2026, 8, 1, [])).toBe(1);
    // 1일이 공휴일이어도 마찬가지
    expect(payoutDayOfMonth(2026, 9, 1, ["2026-09-01"])).toBe(1);
  });

  it("사유를 적는다 — 로그만 보고 설정이 틀렸다고 오해하지 않게", () => {
    const r = scheduleDue(base, new Date("2026-11-07T00:00:00Z"), {
      holidays: [],
      ignoreClock: true,
    });
    expect(r.reason).toContain("매월 7일");
    expect(r.reason).toContain("쉬는 날이라 이달은 6일");
  });

  // 요일은 사람이 골라 둔 값이다 — 토요일 발송을 금요일로 당기면 고른 값을 뒤집는 셈이다
  it("매주(WEEKLY)에는 적용하지 않는다", () => {
    const weekly: ScheduleLike = { ...base, frequency: "WEEKLY", dayOfWeek: 6 }; // 토요일
    expect(due("2026-11-07T00:00:00Z", [], weekly)).toBe(true);
  });

  it("'다음 예정' 도 당겨진 날짜로 답한다 — 안 그러면 하루 전에 급여를 고치고 있게 된다", () => {
    const next = computeNextRun(base, [], new Date("2026-11-01T00:00:00Z"))!;
    expect(formatKst(next)).toBe("2026-11-06 09:00");
  });
});

describe("scheduleDue — 매주", () => {
  const weekly: ScheduleLike = { ...base, frequency: "WEEKLY", dayOfWeek: 5 }; // 금요일
  it("지정 요일이면 발송", () => {
    // 2026-08-07 은 금요일
    expect(scheduleDue(weekly, new Date("2026-08-07T00:00:00Z"), { holidays: [] }).due).toBe(true);
  });
  it("다른 요일이면 미발송", () => {
    expect(scheduleDue(weekly, new Date("2026-08-06T00:00:00Z"), { holidays: [] }).reason).toBe("요일 불일치");
  });
  it("UTC 로는 목요일이지만 KST 로 금요일이면 발송", () => {
    // UTC 2026-08-06 20:00 = KST 2026-08-07(금) 05:00
    expect(scheduleDue(weekly, new Date("2026-08-06T20:00:00Z"), { ignoreClock: true, holidays: [] }).due).toBe(true);
  });
});

describe("computeNextRun — 다음 발송 예정", () => {
  it("이번 달 지정일 이전이면 이번 달", () => {
    const next = computeNextRun(base, [], new Date("2026-08-01T00:00:00Z"))!;
    expect(formatKst(next)).toBe("2026-08-07 09:00");
  });
  it("지정일 시각이 지났으면 다음 달", () => {
    const next = computeNextRun(base, [], new Date("2026-08-07T01:00:00Z"))!; // KST 8/7 10:00
    expect(formatKst(next)).toBe("2026-09-07 09:00");
  });
  it("12월 지나면 다음 해 1월", () => {
    const next = computeNextRun(base, [], new Date("2026-12-20T00:00:00Z"))!;
    expect(formatKst(next)).toBe("2027-01-07 09:00");
  });
  it("31일 지정 + 2월은 말일로 보정 (그 말일이 토요일이면 다시 금요일로)", () => {
    const next = computeNextRun({ ...base, dayOfMonth: 31 }, [], new Date("2026-02-01T00:00:00Z"))!;
    // 말일 2/28 은 토요일이라 2/27(금)
    expect(formatKst(next)).toBe("2026-02-27 09:00");
  });
  it("매주: 다음 지정 요일", () => {
    const weekly: ScheduleLike = { ...base, frequency: "WEEKLY", dayOfWeek: 1 }; // 월요일
    const next = computeNextRun(weekly, [], new Date("2026-08-07T00:00:00Z"))!; // KST 금 09:00
    expect(formatKst(next)).toBe("2026-08-10 09:00");
  });
  it("비활성이면 null", () => {
    expect(computeNextRun({ ...base, enabled: false }, [])).toBeNull();
  });
});
