// 보강 오버타임 산정 내역서의 시간대 표기 — 이미 저장된 옛 줄도 분 단위로 그린다.
import { describe, it, expect } from "vitest";
import { cleanTimeLabel, overtimeDetailHtml } from "./documents-pay";

describe("시간대 표기 다듬기", () => {
  it("소수 분을 반올림한다", () => {
    expect(cleanTimeLabel("08:30~12:49.98000000000002")).toBe("08:30~12:50");
    expect(cleanTimeLabel("19:00~21:59.6")).toBe("19:00~22:00");
    expect(cleanTimeLabel("23:59.7~01:00")).toBe("00:00~01:00");
  });

  it("멀쩡한 표기·빈 값은 그대로", () => {
    expect(cleanTimeLabel("08:30~14:00")).toBe("08:30~14:00");
    expect(cleanTimeLabel("")).toBe("");
  });

  it("저장된 옛 줄로 그려도 내역서에 소수 분이 나오지 않는다", () => {
    const line = {
      sessionId: 1,
      category: "MANDATORY",
      date: "2026-09-13",
      timeLabel: "08:30~12:49.98000000000002",
      kind: "HOLIDAY",
      night: false,
      hours: 4.333,
      countedHours: 4.333,
      multiplier: 1.5,
    } as any;
    const h = overtimeDetailHtml({
      employee: { name: "가상직원", position: "전임강사" },
      company: { name: "가상학원", ceo: "대표", bizNo: "000-00-00000", address: "주소", phone: "000" },
      year: 2026,
      month: 9,
      hourlyWage: 16_293,
      lines: [line],
      excluded: [{ ...line, countedHours: 0 }],
      categoryLabel: { MANDATORY: "내신의무보강" },
    } as any);
    expect(h).toContain("08:30~12:50");
    expect(h).not.toContain("49.98");
  });
});
