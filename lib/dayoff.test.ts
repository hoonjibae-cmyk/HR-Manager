import { describe, it, expect } from "vitest";
import {
  parseDayOffTitle,
  eventDates,
  parseDayOffEvents,
  planDayOffs,
  diffDayOffs,
  syncWindow,
  dayOffWarning,
  type CalendarEvent,
} from "./dayoff";
import { matchEmployee } from "./timesheet";

const EMPS = [
  { id: 1, name: "김수민", department: "교육운영팀" },
  { id: 2, name: "이영희", department: "교육운영팀" },
  { id: 3, name: "박도윤", department: "교수부" },
];

const ev = (o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "e1",
  summary: "(휴무)김수민",
  start: { date: "2026-08-12" },
  end: { date: "2026-08-13" }, // 구글 종일 일정의 end 는 배타적 — 8/12 하루짜리다
  ...o,
});

describe("제목에서 이름 읽기", () => {
  it("실제 쓰는 모양", () => {
    expect(parseDayOffTitle("(휴무)김수민")).toEqual(["김수민"]);
  });

  it("띄어쓰기·괄호 모양이 흔들려도 읽는다 (사람이 손으로 적는 제목이다)", () => {
    for (const t of ["(휴무) 김수민", "[휴무] 김수민", "【휴무】김수민", "휴무 - 김수민", "휴 무 김수민"])
      expect(parseDayOffTitle(t), t).toEqual(["김수민"]);
  });

  it("이름이 앞에 와도 읽는다", () => {
    expect(parseDayOffTitle("김수민 (휴무)")).toEqual(["김수민"]);
  });

  it("한 일정에 여러 명", () => {
    expect(parseDayOffTitle("(휴무)김수민, 이영희")).toEqual(["김수민", "이영희"]);
    expect(parseDayOffTitle("(휴무) 김수민 · 이영희")).toEqual(["김수민", "이영희"]);
  });

  it("**'휴무' 가 없으면 손대지 않는다** — 같은 캘린더에 앱이 올린 연차 일정이 함께 있다", () => {
    expect(parseDayOffTitle("김서준 연차")).toEqual([]);
    expect(parseDayOffTitle("이지우 반차")).toEqual([]);
    expect(parseDayOffTitle("전사 워크숍")).toEqual([]);
  });

  it("이름이 없으면 빈 목록", () => {
    expect(parseDayOffTitle("(휴무)")).toEqual([]);
    expect(parseDayOffTitle("")).toEqual([]);
  });
});

describe("일정이 걸친 날짜", () => {
  it("종일 일정의 end 는 배타적이다 — 그대로 훑으면 하루 더 쉬는 것으로 잡힌다", () => {
    expect(eventDates(ev())).toEqual(["2026-08-12"]);
  });

  it("여러 날짜리", () => {
    expect(eventDates(ev({ start: { date: "2026-08-12" }, end: { date: "2026-08-15" } }))).toEqual([
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
    ]);
  });

  it("시각이 있는 일정은 끝나는 날도 쉰 날이다 (배타적이지 않다)", () => {
    const out = eventDates(
      ev({ start: { dateTime: "2026-08-12T09:00:00+09:00" }, end: { dateTime: "2026-08-12T18:00:00+09:00" } })
    );
    expect(out).toEqual(["2026-08-12"]);
  });

  it("끝이 없으면 하루로 본다", () => {
    expect(eventDates(ev({ end: null }))).toEqual(["2026-08-12"]);
  });

  it("터무니없이 긴 일정에도 멈추지 않는다", () => {
    expect(eventDates(ev({ end: { date: "2030-01-01" } })).length).toBeLessThanOrEqual(31);
  });
});

describe("캘린더 → 휴무 줄", () => {
  it("휴무 일정만 골라낸다", () => {
    const { rows } = parseDayOffEvents([
      ev({ id: "a", summary: "(휴무)김수민" }),
      ev({ id: "b", summary: "김서준 연차" }), // 앱이 올린 연차 — 건드리면 안 된다
      ev({ id: "c", summary: "(휴무) 이영희", start: { date: "2026-08-13" }, end: { date: "2026-08-14" } }),
    ]);
    expect(rows.map((r) => [r.rawName, r.date])).toEqual([
      ["김수민", "2026-08-12"],
      ["이영희", "2026-08-13"],
    ]);
  });

  it("취소된 일정은 뺀다", () => {
    expect(parseDayOffEvents([ev({ status: "cancelled" })]).rows).toEqual([]);
  });

  it("'휴무' 는 있는데 이름을 못 읽으면 버리지 않고 센다", () => {
    const { rows, unreadable } = parseDayOffEvents([ev({ summary: "(휴무)" })]);
    expect(rows).toEqual([]);
    expect(unreadable).toEqual([{ id: "e1", title: "(휴무)" }]);
  });

  it("여러 날 × 여러 명이면 곱해서 편다", () => {
    const { rows } = parseDayOffEvents([
      ev({ summary: "(휴무)김수민, 이영희", start: { date: "2026-08-12" }, end: { date: "2026-08-14" } }),
    ]);
    expect(rows).toHaveLength(4); // 2명 × 2일
  });
});

describe("직원 붙이기", () => {
  const plan = (events: CalendarEvent[]) => planDayOffs(parseDayOffEvents(events), EMPS, matchEmployee);

  it("이름으로 직원을 찾는다", () => {
    const p = plan([ev()]);
    expect(p.resolved).toHaveLength(1);
    expect(p.resolved[0]).toMatchObject({ employeeId: 1, name: "김수민", department: "교육운영팀" });
  });

  it("못 찾은 이름은 **버리지 않고 돌려준다** — 조용히 사라지면 아무도 모른다", () => {
    const p = plan([ev({ summary: "(휴무)없는사람" })]);
    expect(p.resolved).toEqual([]);
    expect(p.unmatched).toEqual([{ date: "2026-08-12", rawName: "없는사람", title: "(휴무)없는사람" }]);
  });

  it("같은 사람·같은 날이 겹쳐 등록돼도 한 줄만", () => {
    const p = plan([ev({ id: "a" }), ev({ id: "b" })]);
    expect(p.resolved).toHaveLength(1);
  });

  it("날짜·이름 순으로 정렬한다", () => {
    const p = plan([
      ev({ id: "a", summary: "(휴무)이영희", start: { date: "2026-08-13" }, end: { date: "2026-08-14" } }),
      ev({ id: "b", summary: "(휴무)김수민", start: { date: "2026-08-12" }, end: { date: "2026-08-13" } }),
    ]);
    expect(p.resolved.map((r) => r.date)).toEqual(["2026-08-12", "2026-08-13"]);
  });
});

describe("표 맞추기 — 캘린더가 진실이다", () => {
  const W = { from: "2026-08-01", to: "2026-08-31" };
  const stored = (o: any = {}) => ({
    id: 1,
    employeeId: 1,
    date: "2026-08-12",
    gcalEventId: "e1",
    source: "GCAL",
    ...o,
  });
  const resolved = (o: any = {}) => ({
    date: "2026-08-12",
    title: "(휴무)김수민",
    rawName: "김수민",
    gcalEventId: "e1",
    employeeId: 1,
    name: "김수민",
    department: "교육운영팀",
    ...o,
  });

  it("새로 생긴 것은 넣는다", () => {
    expect(diffDayOffs([], [resolved()], W).add).toHaveLength(1);
  });

  it("**캘린더에서 사라진 것은 지운다** — 남겨 두면 달력이 거짓말을 한다", () => {
    const d = diffDayOffs([stored()], [], W);
    expect(d.remove).toHaveLength(1);
  });

  it("창 밖의 지난 기록은 건드리지 않는다", () => {
    const d = diffDayOffs([stored({ date: "2026-06-10" })], [], W);
    expect(d.remove).toEqual([]);
  });

  it("관리자가 직접 넣은 줄은 동기화가 지우지 않는다", () => {
    const d = diffDayOffs([stored({ source: "MANUAL" })], [], W);
    expect(d.remove).toEqual([]);
  });

  it("두 번 돌려도 할 일이 없다 (멱등)", () => {
    const d = diffDayOffs([stored()], [resolved()], W);
    expect(d.add).toEqual([]);
    expect(d.remove).toEqual([]);
  });

  it("날짜가 옮겨지면 옛 줄을 지우고 새 줄을 넣는다", () => {
    const d = diffDayOffs([stored()], [resolved({ date: "2026-08-13" })], W);
    expect(d.add.map((a) => a.date)).toEqual(["2026-08-13"]);
    expect(d.remove.map((r) => r.date)).toEqual(["2026-08-12"]);
  });
});

describe("가져올 기간", () => {
  it("앞뒤로 넉넉히 — 지난 달로 넘겨 봐도 남아 있게", () => {
    const w = syncWindow(new Date("2026-08-06T00:00:00Z"));
    expect(w.from < "2026-08-06").toBe(true);
    expect(w.to > "2026-08-06").toBe(true);
  });
});

describe("안내 문구", () => {
  it("못 찾은 이름을 적어 준다", () => {
    const p = planDayOffs(parseDayOffEvents([ev({ summary: "(휴무)없는사람" })]), EMPS, matchEmployee);
    const w = dayOffWarning(p);
    expect(w).toContain("없는사람");
    expect(w).toContain("(휴무)홍길동");
  });

  it("다 들어왔으면 경고가 없다", () => {
    const p = planDayOffs(parseDayOffEvents([ev()]), EMPS, matchEmployee);
    expect(dayOffWarning(p)).toBeNull();
  });
});
