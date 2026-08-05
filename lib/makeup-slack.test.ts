import { describe, it, expect } from "vitest";
import {
  parseMakeupInput,
  makeupDateLabel,
  slackDateTime,
  parseConfirmInput,
  confirmInitials,
} from "./makeup-slack";
import { buildMakeupEvent } from "./gcal";
import type { MakeupModalValues } from "./slack";

const base: MakeupModalValues = {
  startDate: "2026-08-15",
  startTime: "09:00",
  endDate: null,
  endTime: "16:00",
  category: "MANDATORY",
  targetClass: "은가람중3",
  headcount: 12,
  detail: "실전모의고사 응시 및 풀이.",
  note: "",
};

describe("슬랙 보강 신청 입력 해석", () => {
  it("날짜·시간을 KST 벽시계 그대로 담는다 (앱 전체 규칙)", () => {
    // 09:00 KST 를 09:00Z 로 담아 달력·공휴일 판정이 getUTC* 로 맞아떨어지게 한다
    expect(slackDateTime("2026-08-15", "09:00").toISOString()).toBe("2026-08-15T09:00:00.000Z");
  });

  it("종료일을 비우면 같은 날로 본다", () => {
    const r = parseMakeupInput(base);
    expect(r.ok).toBe(true);
    expect(r.start!.toISOString()).toBe("2026-08-15T09:00:00.000Z");
    expect(r.end!.toISOString()).toBe("2026-08-15T16:00:00.000Z");
  });

  it("종료일 없이 시각이 거꾸로면 자정을 넘긴 것으로 본다", () => {
    const r = parseMakeupInput({ ...base, startTime: "22:00", endTime: "01:00" });
    expect(r.ok).toBe(true);
    expect(r.end!.toISOString()).toBe("2026-08-16T01:00:00.000Z");
  });

  it("종료일을 적었는데 시각이 거꾸로면 막는다", () => {
    const r = parseMakeupInput({ ...base, endDate: "2026-08-15", startTime: "16:00", endTime: "09:00" });
    expect(r.ok).toBe(false);
    expect(r.field).toBe("etime");
  });

  it("24시간을 넘는 신청은 날짜 실수로 보고 막는다", () => {
    const r = parseMakeupInput({ ...base, endDate: "2026-08-20" });
    expect(r.ok).toBe(false);
    expect(r.field).toBe("edate");
  });

  it("필수 입력을 빠뜨리면 해당 칸에 오류를 돌려준다", () => {
    expect(parseMakeupInput({ ...base, startTime: null }).field).toBe("sdate");
    expect(parseMakeupInput({ ...base, endTime: null }).field).toBe("etime");
    expect(parseMakeupInput({ ...base, targetClass: "" }).field).toBe("target");
  });

  it("사람이 읽을 일시 라벨을 만든다", () => {
    const r = parseMakeupInput(base);
    expect(makeupDateLabel(r.start!, r.end!)).toBe("2026.08.15(토) 09:00~16:00 · 7시간");
  });

  it("자정을 넘기면 '익일' 을 붙인다", () => {
    const r = parseMakeupInput({ ...base, startTime: "22:00", endTime: "01:00" });
    expect(makeupDateLabel(r.start!, r.end!)).toBe("2026.08.15(토) 22:00~익일 01:00 · 3시간");
  });
});

describe("보강캘린더 일정 본문", () => {
  const ev = buildMakeupEvent({
    name: "김지연",
    department: "교수부",
    categoryLabel: "내신의무보강",
    start: new Date("2026-08-15T09:00:00Z"),
    end: new Date("2026-08-15T16:00:00Z"),
    targetClass: "은가람중3",
    headcount: 12,
    detail: "실전모의고사 응시 및 풀이.",
    note: "교재 준비 필요",
  });

  it("제목에 보강종류·강사·대상반이 함께 들어간다", () => {
    expect(ev.summary).toBe("[내신의무보강] 김지연 · 은가람중3");
  });

  it("시각은 서울 시간대로 보낸다 (종일 일정이 아니다)", () => {
    expect(ev.start).toEqual({ dateTime: "2026-08-15T09:00:00", timeZone: "Asia/Seoul" });
    expect(ev.end).toEqual({ dateTime: "2026-08-15T16:00:00", timeZone: "Asia/Seoul" });
  });

  it("본문에 신청 내용을 그대로 옮긴다", () => {
    expect(ev.description).toContain("강사: 김지연 (교수부)");
    expect(ev.description).toContain("수강 예상인원: 12명");
    expect(ev.description).toContain("예정 시간: 7시간");
    expect(ev.description).toContain("실전모의고사 응시 및 풀이.");
    expect(ev.description).toContain("교재 준비 필요");
  });
});

/* ───────────── 실근무 확정 (신청자 본인) ───────────── */

describe("confirmInitials — 확정 모달 초기값", () => {
  it("실근무 시각이 없으면 예정값을 채운다", () => {
    const r = {
      planStart: new Date("2026-08-15T09:00:00Z"),
      planEnd: new Date("2026-08-15T16:00:00Z"),
    };
    expect(confirmInitials(r)).toEqual({
      startDate: "2026-08-15",
      startTime: "09:00",
      endDate: "2026-08-15",
      endTime: "16:00",
    });
  });

  it("이미 확정한 시각이 있으면 그쪽을 보여준다 (수정하러 다시 열었을 때)", () => {
    const r = {
      planStart: new Date("2026-08-15T09:00:00Z"),
      planEnd: new Date("2026-08-15T16:00:00Z"),
      actualStart: new Date("2026-08-15T09:30:00Z"),
      actualEnd: new Date("2026-08-15T14:00:00Z"),
    };
    expect(confirmInitials(r).startTime).toBe("09:30");
    expect(confirmInitials(r).endTime).toBe("14:00");
  });
});

describe("parseConfirmInput — 확정 입력 검증", () => {
  it("정상 입력", () => {
    const r = parseConfirmInput({
      startDate: "2026-08-15",
      startTime: "09:00",
      endDate: null,
      endTime: "14:30",
    });
    expect(r.ok).toBe(true);
    expect(r.start!.toISOString()).toBe("2026-08-15T09:00:00.000Z");
    expect(r.end!.toISOString()).toBe("2026-08-15T14:30:00.000Z");
  });

  it("종료일을 안 적었는데 시각이 더 이르면 자정을 넘긴 것으로 본다", () => {
    const r = parseConfirmInput({
      startDate: "2026-08-15",
      startTime: "21:00",
      endDate: null,
      endTime: "01:00",
    });
    expect(r.ok).toBe(true);
    expect(r.end!.toISOString()).toBe("2026-08-16T01:00:00.000Z");
  });

  it("종료가 시작보다 빠르면 막는다", () => {
    const r = parseConfirmInput({
      startDate: "2026-08-15",
      startTime: "14:00",
      endDate: "2026-08-15",
      endTime: "09:00",
    });
    expect(r.ok).toBe(false);
    expect(r.field).toBe("etime");
  });

  it("24시간을 넘기면 날짜를 잘못 고른 것으로 본다", () => {
    const r = parseConfirmInput({
      startDate: "2026-08-15",
      startTime: "09:00",
      endDate: "2026-08-17",
      endTime: "09:00",
    });
    expect(r.ok).toBe(false);
    expect(r.field).toBe("edate");
  });

  it("시작 시각이 비면 첫 칸을 가리킨다", () => {
    const r = parseConfirmInput({ startDate: null, startTime: null, endDate: null, endTime: "14:00" });
    expect(r.ok).toBe(false);
    expect(r.field).toBe("sdate");
  });
});
