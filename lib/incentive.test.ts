import { describe, it, expect } from "vitest";
import {
  studentWeight,
  summarizeIncentive,
  parseDateSessionCell,
  STANDARD_SESSIONS,
  type RosterStudent,
} from "./incentive";

function full(n: number, from = 1): RosterStudent[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: from + i,
    status: "ENROLLED" as const,
    name: `학생${from + i}`,
    sessions: null,
  }));
}
function partial(
  status: RosterStudent["status"],
  sessions: number[],
  prefix: string
): RosterStudent[] {
  return sessions.map((s, i) => ({
    status,
    name: `${prefix}${i + 1}`,
    sessions: s,
  }));
}

describe("studentWeight — 재원계수", () => {
  it("회차 미기재(만근)는 1.0", () => {
    expect(studentWeight({ status: "ENROLLED", name: "A", sessions: null })).toBe(1);
  });
  it("8회 만근 = 1.0, 4회 = 0.5, 0회 = 0", () => {
    expect(studentWeight({ status: "WITHDRAWN", name: "A", sessions: 8 })).toBe(1);
    expect(studentWeight({ status: "WITHDRAWN", name: "A", sessions: 4 })).toBe(0.5);
    expect(studentWeight({ status: "WITHDRAWN", name: "A", sessions: 0 })).toBe(0);
  });
  it("표준 회차를 넘어도 1.0 으로 상한", () => {
    expect(studentWeight({ status: "ENROLLED", name: "A", sessions: 9 })).toBe(1);
  });
});

describe("summarizeIncentive — 실제 엑셀 양식 재현", () => {
  // 23년 7월 김지연 선생님: 기준 40명 / 기준금액 100,000원 (회당 12,500원)
  it("23년 7월 김지연 — 인센티브 2,162,500원", () => {
    const students: RosterStudent[] = [
      ...full(49), // 1~49 만근 재원
      // 50~63 월중 입학
      ...partial("ENROLLED", [4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 2], "신규"),
      ...partial("TRANSFERRED", [3, 4, 4, 4], "전출"),
      ...partial("WITHDRAWN", [0, 0, 0, 0, 2, 2, 5, 7, 8], "퇴원"),
    ];
    const r = summarizeIncentive(students, { threshold: 40, perStudent: 100_000 });
    expect(r.units).toBeCloseTo(61.625, 6);
    expect(r.over).toBeCloseTo(21.625, 6);
    expect(r.amount).toBe(2_162_500);
    expect(r.perSession).toBe(12_500);
    // 학생별 배분 합계 = 총액
    expect(r.rows.reduce((a, x) => a + x.amount, 0)).toBe(2_162_500);
    // 기준 인원(40명) 이내 만근 학생은 인센티브 0
    expect(r.rows[0].amount).toBe(0);
    expect(r.rows[39].amount).toBe(0);
    // 41번째 만근 학생부터 기준금액 전액
    expect(r.rows[40].amount).toBe(100_000);
    // 4회 학생 = 50,000원, 5회 = 62,500원, 2회 = 25,000원
    expect(r.rows.find((x) => x.name === "신규1")!.amount).toBe(50_000);
    expect(r.rows.find((x) => x.name === "신규3")!.amount).toBe(62_500);
    expect(r.rows.find((x) => x.name === "신규14")!.amount).toBe(25_000);
    // 전출 3회 = 37,500원
    expect(r.rows.find((x) => x.name === "전출1")!.amount).toBe(37_500);
    // 퇴원 0회 = 0원, 7회 = 87,500원, 8회 = 100,000원
    expect(r.rows.find((x) => x.name === "퇴원1")!.amount).toBe(0);
    expect(r.rows.find((x) => x.name === "퇴원8")!.amount).toBe(87_500);
    expect(r.rows.find((x) => x.name === "퇴원9")!.amount).toBe(100_000);
  });

  // 26년 6월 서연승 선생님: 기준 50명 / 기준금액 70,000원
  it("26년 6월 서연승 — 인센티브 420,000원", () => {
    const students: RosterStudent[] = [
      ...full(55),
      ...partial("WITHDRAWN", [0, 0, 8], "퇴원"),
    ];
    const r = summarizeIncentive(students, { threshold: 50, perStudent: 70_000 });
    expect(r.units).toBe(56);
    expect(r.amount).toBe(420_000);
    expect(r.rows.filter((x) => x.amount > 0)).toHaveLength(6); // 51~55 + 퇴원(8회)
    expect(r.rows.reduce((a, x) => a + x.amount, 0)).toBe(420_000);
  });

  it("기준 인원 이하이면 인센티브 0", () => {
    const r = summarizeIncentive(full(30), { threshold: 40, perStudent: 100_000 });
    expect(r.amount).toBe(0);
    expect(r.rows.every((x) => x.amount === 0)).toBe(true);
  });

  it("만근 학생이 기준 인원을 먼저 채운다 (중도학생이 앞에 있어도 동일 총액)", () => {
    const a = summarizeIncentive(
      [...partial("WITHDRAWN", [4], "퇴원"), ...full(41)],
      { threshold: 40, perStudent: 100_000 }
    );
    expect(a.units).toBeCloseTo(41.5, 6);
    expect(a.amount).toBe(150_000);
    expect(a.rows[0].amount).toBe(50_000); // 중도 학생 4회분
  });
});

describe("parseDateSessionCell — '7/17(4회)' 형식", () => {
  it("날짜 + 회차 동시 파싱", () => {
    const r = parseDateSessionCell("7/17(4회)", 2023);
    expect(r.date!.toISOString().slice(0, 10)).toBe("2023-07-17");
    expect(r.sessions).toBe(4);
  });
  it("0회 퇴원", () => {
    const r = parseDateSessionCell("7/3(0회)", 2023);
    expect(r.sessions).toBe(0);
  });
  it("날짜만 있으면 회차 null(만근)", () => {
    expect(parseDateSessionCell("6/30", 2026).sessions).toBeNull();
  });
  it("빈 셀", () => {
    expect(parseDateSessionCell(null, 2026)).toEqual({ date: null, sessions: null });
  });
  it("표준 회차 상수는 8", () => {
    expect(STANDARD_SESSIONS).toBe(8);
  });
});
