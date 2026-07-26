// 예약 발송 스케줄 판단 (KST 기준) — DB 무관 순수 로직
import { describe, it, expect } from "vitest";
import {
  kstParts,
  kstToUtc,
  sameKstDay,
  effectiveDayOfMonth,
  targetYearMonth,
  scheduleDue,
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
    const r = scheduleDue(base, new Date("2026-08-07T00:00:00Z")); // KST 8/7 09:00
    expect(r.due).toBe(true);
  });

  it("지정일이 아니면 미발송", () => {
    const r = scheduleDue(base, new Date("2026-08-08T00:00:00Z"));
    expect(r.due).toBe(false);
    expect(r.reason).toContain("날짜 불일치");
  });

  it("예정 시각 이전이면 미발송 (strict 모드)", () => {
    const r = scheduleDue(base, new Date("2026-08-06T23:00:00Z")); // KST 8/7 08:00
    expect(r.due).toBe(false);
    expect(r.reason).toContain("예정 시각 이전");
  });

  it("ignoreClock(서버리스 크론)이면 시각 무관하게 발송", () => {
    const r = scheduleDue(base, new Date("2026-08-06T23:00:00Z"), { ignoreClock: true });
    expect(r.due).toBe(true);
  });

  it("같은 한국 날짜에 이미 실행했으면 중복 발송 안 함", () => {
    const sched = { ...base, lastRunAt: new Date("2026-08-06T15:10:00Z") }; // KST 8/7 00:10
    const r = scheduleDue(sched, new Date("2026-08-07T00:00:00Z")); // KST 8/7 09:00
    expect(r.due).toBe(false);
    expect(r.reason).toBe("오늘 이미 실행됨");
  });

  it("전날 실행분은 중복으로 보지 않음", () => {
    const sched = { ...base, lastRunAt: new Date("2026-08-05T23:00:00Z") }; // KST 8/6 08:00
    expect(scheduleDue(sched, new Date("2026-08-07T00:00:00Z")).due).toBe(true);
  });

  it("비활성이면 미발송, force 면 무조건 발송", () => {
    const off = { ...base, enabled: false };
    expect(scheduleDue(off, new Date("2026-08-07T00:00:00Z")).due).toBe(false);
    expect(scheduleDue(off, new Date("2026-08-08T00:00:00Z"), { force: true }).due).toBe(true);
  });

  it("31일 지정 + 2월 → 말일(28일)에 발송", () => {
    const sched = { ...base, dayOfMonth: 31 };
    expect(effectiveDayOfMonth(2026, 2, 31)).toBe(28);
    expect(scheduleDue(sched, new Date("2026-02-28T00:00:00Z")).due).toBe(true);
  });
});

describe("scheduleDue — 매주", () => {
  const weekly: ScheduleLike = { ...base, frequency: "WEEKLY", dayOfWeek: 5 }; // 금요일
  it("지정 요일이면 발송", () => {
    // 2026-08-07 은 금요일
    expect(scheduleDue(weekly, new Date("2026-08-07T00:00:00Z")).due).toBe(true);
  });
  it("다른 요일이면 미발송", () => {
    expect(scheduleDue(weekly, new Date("2026-08-06T00:00:00Z")).reason).toBe("요일 불일치");
  });
  it("UTC 로는 목요일이지만 KST 로 금요일이면 발송", () => {
    // UTC 2026-08-06 20:00 = KST 2026-08-07(금) 05:00
    expect(scheduleDue(weekly, new Date("2026-08-06T20:00:00Z"), { ignoreClock: true }).due).toBe(true);
  });
});

describe("computeNextRun — 다음 발송 예정", () => {
  it("이번 달 지정일 이전이면 이번 달", () => {
    const next = computeNextRun(base, new Date("2026-08-01T00:00:00Z"))!;
    expect(formatKst(next)).toBe("2026-08-07 09:00");
  });
  it("지정일 시각이 지났으면 다음 달", () => {
    const next = computeNextRun(base, new Date("2026-08-07T01:00:00Z"))!; // KST 8/7 10:00
    expect(formatKst(next)).toBe("2026-09-07 09:00");
  });
  it("12월 지나면 다음 해 1월", () => {
    const next = computeNextRun(base, new Date("2026-12-20T00:00:00Z"))!;
    expect(formatKst(next)).toBe("2027-01-07 09:00");
  });
  it("31일 지정 + 2월은 말일로 보정", () => {
    const next = computeNextRun({ ...base, dayOfMonth: 31 }, new Date("2026-02-01T00:00:00Z"))!;
    expect(formatKst(next)).toBe("2026-02-28 09:00");
  });
  it("매주: 다음 지정 요일", () => {
    const weekly: ScheduleLike = { ...base, frequency: "WEEKLY", dayOfWeek: 1 }; // 월요일
    const next = computeNextRun(weekly, new Date("2026-08-07T00:00:00Z"))!; // KST 금 09:00
    expect(formatKst(next)).toBe("2026-08-10 09:00");
  });
  it("비활성이면 null", () => {
    expect(computeNextRun({ ...base, enabled: false })).toBeNull();
  });
});
