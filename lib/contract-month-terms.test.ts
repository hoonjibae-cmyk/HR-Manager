import { describe, it, expect } from "vitest";
import { withContractTerms, monthTermsDate } from "./contracts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const base = {
  endDate: null,
  templateKey: "INCENTIVE",
  incomeType: "EMPLOYEE",
  baseWage: 3_400_000,
  positionAllow: 0,
  mealAllow: 200_000,
  carAllow: 0,
  incPerStudent: 20_000,
  incRevenuePercent: null,
  ratioPercent: null,
  ratioMinGuarantee: null,
  isContractor: false,
  status: "ACTIVE",
};

// 8월에 미리 만든 9/1 계약 — 만들 때 카드는 옛 계약(40명)을 비춘 채 남았다
const contracts = [
  { ...base, id: 1, startDate: d("2025-09-01"), incThreshold: 40 },
  { ...base, id: 2, startDate: d("2026-09-01"), incThreshold: 37 },
];
const staleCard = {
  id: 7,
  name: "가상강사",
  payScheme: "INCENTIVE",
  incThreshold: 40,
  incPerStudent: 20_000,
  baseWage: 3_400_000,
  resignDate: null as Date | null,
};

describe("그 달 계약 조건 (카드가 아니라 계약에서)", () => {
  it("9월 급여는 9/1 발효 계약의 기준인원을 쓴다 — 카드가 옛 값이어도", () => {
    const e = withContractTerms(staleCard, contracts as any, monthTermsDate(staleCard, 2026, 9));
    expect(e.incThreshold).toBe(37);
  });

  it("8월을 다시 산정하면 그때 계약(40명) — 카드가 이미 새 값이어도", () => {
    const fresh = { ...staleCard, incThreshold: 37 };
    const e = withContractTerms(fresh, contracts as any, monthTermsDate(fresh, 2026, 8));
    expect(e.incThreshold).toBe(40);
  });

  it("월중 변경이면 그 달 마지막 재직일의 계약을 쓴다", () => {
    const mid = [...contracts, { ...base, id: 3, startDate: d("2026-10-15"), incThreshold: 35 }];
    const e = withContractTerms(staleCard, mid as any, monthTermsDate(staleCard, 2026, 10));
    expect(e.incThreshold).toBe(35);
  });

  it("월중 퇴사면 퇴사일 기준 — 퇴사 뒤에 시작하는 계약은 쓰지 않는다", () => {
    const resigned = { ...staleCard, resignDate: d("2026-10-10") };
    const mid = [...contracts, { ...base, id: 3, startDate: d("2026-10-15"), incThreshold: 35 }];
    expect(monthTermsDate(resigned, 2026, 10)).toEqual(d("2026-10-10"));
    expect(withContractTerms(resigned, mid as any, monthTermsDate(resigned, 2026, 10)).incThreshold).toBe(37);
  });

  it("DRAFT 계약은 보지 않는다", () => {
    const draft = [...contracts, { ...base, id: 4, startDate: d("2026-09-15"), incThreshold: 10, status: "DRAFT" }];
    expect(withContractTerms(staleCard, draft as any, monthTermsDate(staleCard, 2026, 9)).incThreshold).toBe(37);
  });

  it("계약이 없거나 그 달에 아직 시작 전이면 카드 그대로", () => {
    expect(withContractTerms(staleCard, [], monthTermsDate(staleCard, 2026, 9))).toBe(staleCard);
    const e = withContractTerms(staleCard, contracts as any, monthTermsDate(staleCard, 2025, 8));
    expect(e).toBe(staleCard);
  });

  it("모르는 templateKey 는 월급제로 떨어뜨리지 않고 카드 급여형태를 쓴다", () => {
    const odd = [{ ...contracts[0], templateKey: "LEGACY_X" }];
    expect(withContractTerms(staleCard, odd as any, d("2026-01-31")).payScheme).toBe("INCENTIVE");
  });

  it("인적사항(이름 등)은 카드 값을 그대로 둔다", () => {
    const e = withContractTerms(staleCard, contracts as any, monthTermsDate(staleCard, 2026, 9));
    expect(e.name).toBe("가상강사");
    expect(e.id).toBe(7);
  });
});
