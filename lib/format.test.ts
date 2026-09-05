import { describe, it, expect } from "vitest";
import { tenureOf, ageOf, birthIsoOf, ymd } from "./format";

const d = (s: string) => new Date(s + "T00:00:00Z");

describe("tenureOf — 근속 (달력 월, 입사기념일 기준)", () => {
  it("1년 6개월", () => {
    expect(tenureOf(d("2025-03-01"), d("2026-09-03"))).toEqual({ label: "1년 6개월", months: 18 });
  });
  it("기념일이 안 지난 달은 세지 않는다", () => {
    expect(tenureOf(d("2025-03-15"), d("2026-03-14")).months).toBe(11);
    expect(tenureOf(d("2025-03-15"), d("2026-03-15")).months).toBe(12);
  });
  it("정확히 n년이면 개월을 붙이지 않는다", () => {
    expect(tenureOf(d("2024-09-03"), d("2026-09-03")).label).toBe("2년");
  });
  it("입사 첫 달은 0개월", () => {
    expect(tenureOf(d("2026-09-01"), d("2026-09-03"))).toEqual({ label: "0개월", months: 0 });
  });
});

describe("birthIsoOf — 생년월일 정규화", () => {
  it("점·붙임 표기 모두 ISO 로", () => {
    expect(birthIsoOf("1990-03-15")).toBe("1990-03-15");
    expect(birthIsoOf("1990.03.15")).toBe("1990-03-15");
    expect(birthIsoOf("19900315")).toBe("1990-03-15");
  });
  it("두 자리 연도(YYMMDD)는 세기를 알 수 없어 null — 생일 알림과 같은 규칙", () => {
    expect(birthIsoOf("900315")).toBeNull();
    expect(birthIsoOf(null)).toBeNull();
    expect(birthIsoOf("")).toBeNull();
  });
});

describe("ageOf — 만 나이", () => {
  it("생일이 지났으면 그대로, 안 지났으면 한 살 뺀다", () => {
    expect(ageOf("1990-03-15", "2026-09-03")).toBe(36);
    expect(ageOf("1990-12-25", "2026-09-03")).toBe(35);
    expect(ageOf("1990-09-03", "2026-09-03")).toBe(36); // 당일은 지난 것으로
  });
  it("생년월일이 없으면 null", () => {
    expect(ageOf(null, "2026-09-03")).toBeNull();
  });
});

describe("ymd — 표시 형식이 사전순 = 시간순", () => {
  it("점 표기도 자릿수를 채워 사전순 비교가 된다", () => {
    expect(ymd(d("2026-09-03"))).toBe("2026.09.03");
    expect(ymd(d("2026-09-03")) < ymd(d("2026-10-01"))).toBe(true);
  });
});
