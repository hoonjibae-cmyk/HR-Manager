// 월 적용 임금 조건 결정 로직 (계약 이력 기반) — DB 무관 순수 부분 테스트
import { describe, it, expect } from "vitest";
import { applyMidMonthBlend, type MonthContractTerms } from "./payroll-service";
import type { EmployeePayInput } from "./payroll";

function cardInput(baseWage: number): EmployeePayInput {
  return {
    incomeType: "EMPLOYEE",
    payScheme: "MONTHLY",
    baseWage,
    positionAllow: 0,
    mealAllow: 200_000,
    carAllow: 0,
    dependents: 1,
    schedule: [],
  };
}

function seg(days: number, baseWage: number) {
  return { days, baseWage, positionAllow: 0, mealAllow: 200_000, carAllow: 0, ratioPercent: null };
}

describe("applyMidMonthBlend — 월 적용 임금 조건 결정", () => {
  it("미래 시작 계약 존재 시, 발효 전 달은 기존 계약 조건으로 계산 (카드 500만 → 계약 400만)", () => {
    // 정시우 케이스: 8/16 시작 500만 계약을 7월에 미리 생성 → 카드는 500만으로 선반영
    const payInput = cardInput(5_000_000);
    const entry: MonthContractTerms = {
      segs: [seg(31, 4_000_000)], // 7월 전체는 기존 계약(400만)이 지배
      futureStart: new Date(Date.UTC(2026, 7, 16)),
    };
    const r = applyMidMonthBlend(payInput, entry);
    expect(payInput.baseWage).toBe(4_000_000);
    expect(r?.note).toContain("발효 전");
    expect(r?.note).toContain("2026년 8월 16일");
    expect(r?.info).toBeNull(); // 가중평균 아님
  });

  it("변경 발효 월: 구간 2개 → 역일수 가중평균 (8월 = 15일×400만 + 16일×500만)", () => {
    const payInput = cardInput(5_000_000);
    const entry: MonthContractTerms = {
      segs: [seg(15, 4_000_000), seg(16, 5_000_000)],
      futureStart: null,
    };
    const r = applyMidMonthBlend(payInput, entry);
    expect(payInput.baseWage).toBe(Math.round((4_000_000 * 15 + 5_000_000 * 16) / 31)); // 4,516,129
    expect(r?.info?.segments).toHaveLength(2);
  });

  it("미래 계약 없음 + 단일 구간이면 직원 카드 값 유지 (직접 수정 케이스 보호)", () => {
    const payInput = cardInput(3_300_000); // 카드에서 직접 인상
    const entry: MonthContractTerms = {
      segs: [seg(31, 3_000_000)], // 입사 시점 계약 스냅샷
      futureStart: null,
    };
    const r = applyMidMonthBlend(payInput, entry);
    expect(r).toBeNull();
    expect(payInput.baseWage).toBe(3_300_000); // 덮어쓰지 않음
  });

  it("발효 후 달(단일 구간 = 새 계약, 카드와 동일)이면 개입하지 않음", () => {
    const payInput = cardInput(5_000_000);
    const entry: MonthContractTerms = {
      segs: [seg(30, 5_000_000)],
      futureStart: null,
    };
    expect(applyMidMonthBlend(payInput, entry)).toBeNull();
    expect(payInput.baseWage).toBe(5_000_000);
  });
});
