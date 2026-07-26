import { describe, it, expect } from "vitest";
import { buildLeaveEvent, exclusiveEnd } from "./gcal";

describe("구글 캘린더 일정 생성", () => {
  it("종일 일정의 종료일은 배타적(다음 날)", () => {
    expect(exclusiveEnd(new Date("2026-08-16T00:00:00Z"))).toBe("2026-08-17");
  });

  it("하루짜리 휴가", () => {
    const e = buildLeaveEvent({
      name: "홍길동",
      typeLabel: "연차",
      start: new Date("2026-08-14T00:00:00Z"),
      end: new Date("2026-08-14T00:00:00Z"),
      reason: "개인사유",
      department: "교수부",
      days: 1,
    });
    expect(e.summary).toBe("홍길동 연차");
    expect(e.start.date).toBe("2026-08-14");
    expect(e.end.date).toBe("2026-08-15"); // 배타적
    expect(e.description).toContain("교수부");
    expect(e.description).toContain("개인사유");
  });

  it("기간 휴가", () => {
    const e = buildLeaveEvent({
      name: "김직원",
      typeLabel: "연차",
      start: new Date("2026-08-14T00:00:00Z"),
      end: new Date("2026-08-16T00:00:00Z"),
      days: 3,
    });
    expect(e.start.date).toBe("2026-08-14");
    expect(e.end.date).toBe("2026-08-17");
    expect(e.description).toContain("3일");
  });

  it("반차·병가도 제목에 종류가 표기된다", () => {
    expect(
      buildLeaveEvent({
        name: "이직원",
        typeLabel: "오후반차",
        start: new Date("2026-09-01T00:00:00Z"),
        end: new Date("2026-09-01T00:00:00Z"),
      }).summary
    ).toBe("이직원 오후반차");
    expect(
      buildLeaveEvent({
        name: "박직원",
        typeLabel: "병가",
        start: new Date("2026-09-01T00:00:00Z"),
        end: new Date("2026-09-01T00:00:00Z"),
      }).summary
    ).toBe("박직원 병가");
  });

  it("월말 경계 처리", () => {
    const e = buildLeaveEvent({
      name: "최직원",
      typeLabel: "연차",
      start: new Date("2026-08-31T00:00:00Z"),
      end: new Date("2026-08-31T00:00:00Z"),
    });
    expect(e.end.date).toBe("2026-09-01");
  });

  it("일정은 '한가함(transparent)'으로 등록되어 일정 충돌로 잡히지 않는다", () => {
    const e = buildLeaveEvent({
      name: "홍길동",
      typeLabel: "연차",
      start: new Date("2026-08-14T00:00:00Z"),
      end: new Date("2026-08-14T00:00:00Z"),
    });
    expect(e.transparency).toBe("transparent");
  });
});
