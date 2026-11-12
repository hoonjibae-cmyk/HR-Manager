import { describe, it, expect } from "vitest";
import { bizIncomeAccountError, bizIncomeDestination } from "./bank-account";
import { ENCRYPTED_EMPLOYEE_FIELDS } from "./crypto";
import { hasSplitIncome } from "./ratio-employee";

// 사업소득용 계좌(v1.62) — 근로소득(이 회사)과 사업소득(별도 사업장)을 함께 받는 직원이 통장을 가른다.
// 가상 직원만 쓴다.

const base = { name: "가상강사", bankName: "신한", bankAccount: "110-503-740850" };

describe("bizIncomeDestination — 별도 사업장 지급분이 가는 통장", () => {
  it("사업소득용 계좌가 있으면 그 계좌 (은행명·계좌번호는 이체 파일 표기로 다듬는다)", () => {
    expect(bizIncomeDestination({ ...base, bizIncomeBank: " 카카오 ", bizIncomeAccount: "3333-01-1234567" })).toEqual({
      source: "BIZ",
      bank: "카카오뱅크",
      account: "3333011234567",
      holder: "가상강사",
    });
  });

  it("없으면 급여 계좌 — 예전 동작 그대로이고, source 로 그 사실을 알 수 있다", () => {
    expect(bizIncomeDestination(base)).toEqual({ source: "PAY", bank: "신한은행", account: "110503740850", holder: "가상강사" });
    // 빈 문자열·공백도 '없음' 이다
    expect(bizIncomeDestination({ ...base, bizIncomeBank: "  ", bizIncomeAccount: "" }).source).toBe("PAY");
  });

  it("반만 있으면 INCOMPLETE — 급여 계좌로 넘겨짚지 않는다", () => {
    expect(bizIncomeDestination({ ...base, bizIncomeBank: "국민은행" })).toMatchObject({ source: "INCOMPLETE", bank: "국민은행", account: "" });
    expect(bizIncomeDestination({ ...base, bizIncomeAccount: "123-456" })).toMatchObject({ source: "INCOMPLETE", bank: "", account: "123456" });
    // 숫자가 없는 계좌번호는 빈 계좌다
    expect(bizIncomeDestination({ ...base, bizIncomeBank: "국민은행", bizIncomeAccount: "미정" }).source).toBe("INCOMPLETE");
  });

  it("어느 계좌도 없으면 NONE", () => {
    expect(bizIncomeDestination({ name: "가상강사" }).source).toBe("NONE");
    expect(bizIncomeDestination({ name: "가상강사", bankName: "신한은행" }).source).toBe("NONE");
  });

  it("예금주는 통장마다 따로다", () => {
    const e = { ...base, bankHolder: "가상보호자" };
    expect(bizIncomeDestination(e).holder).toBe("가상보호자");
    expect(bizIncomeDestination({ ...e, bizIncomeBank: "국민", bizIncomeAccount: "1" }).holder).toBe("가상강사");
    expect(bizIncomeDestination({ ...e, bizIncomeBank: "국민", bizIncomeAccount: "1", bizIncomeHolder: "가상연구소" }).holder).toBe("가상연구소");
  });
});

describe("bizIncomeAccountError — 은행과 계좌번호는 함께", () => {
  it("셋 다 비면 통과 — 사업소득용 계좌를 두지 않는다는 뜻", () => {
    expect(bizIncomeAccountError({})).toBeNull();
    expect(bizIncomeAccountError({ bank: "", account: null, holder: "  " })).toBeNull();
  });

  it("둘 다 있으면 통과 (예금주는 선택)", () => {
    expect(bizIncomeAccountError({ bank: "국민은행", account: "123-45-678901" })).toBeNull();
    expect(bizIncomeAccountError({ bank: "국민은행", account: "123-45-678901", holder: "가상연구소" })).toBeNull();
  });

  it("한쪽만 있으면 무엇이 비었는지 적어 막는다", () => {
    expect(bizIncomeAccountError({ bank: "국민은행" })).toContain("계좌번호가 비어 있습니다");
    expect(bizIncomeAccountError({ account: "123-45" })).toContain("은행이 비어 있습니다");
    // 비우면 어떻게 되는지도 알려 준다
    expect(bizIncomeAccountError({ bank: "국민은행" })).toContain("급여 계좌로 나갑니다");
  });

  it("예금주만 있거나 계좌번호에 숫자가 없으면 막는다", () => {
    expect(bizIncomeAccountError({ holder: "가상연구소" })).toContain("예금주만");
    expect(bizIncomeAccountError({ bank: "국민은행", account: "미정" })).toContain("숫자가 없습니다");
  });

  it("검사를 통과한 계좌는 이체 파일에서 반드시 '사업소득용 계좌' 로 읽힌다 — 두 함수의 '비었다' 가 같다", () => {
    const cases = [
      { bank: "국민은행", account: "123-45-678901" },
      { bank: " kb ", account: " 1 " },
      { bank: "미래저축은행", account: "0001" },
    ];
    for (const c of cases) {
      expect(bizIncomeAccountError(c)).toBeNull();
      expect(bizIncomeDestination({ name: "가상강사", bizIncomeBank: c.bank, bizIncomeAccount: c.account }).source).toBe("BIZ");
    }
    // 반대로 막힌 입력은 사업소득용 계좌로 읽히지 않는다
    for (const c of [{ bank: "국민은행", account: "" }, { bank: "", account: "123" }, { bank: "국민은행", account: "미정" }]) {
      expect(bizIncomeAccountError(c)).not.toBeNull();
      expect(bizIncomeDestination({ name: "가상강사", bizIncomeBank: c.bank, bizIncomeAccount: c.account }).source).not.toBe("BIZ");
    }
  });
});

describe("사업소득용 계좌번호도 암호문으로 저장한다", () => {
  it("DB 경계의 암호화 대상에 들어 있다 — 빠지면 평문이 조용히 저장된다", () => {
    expect(ENCRYPTED_EMPLOYEE_FIELDS).toContain("bizIncomeAccount");
    // 급여·유보금 계좌와 주민번호도 그대로
    expect(ENCRYPTED_EMPLOYEE_FIELDS).toEqual(expect.arrayContaining(["rrn", "bankAccount", "retentionAccount"]));
  });
});

describe("hasSplitIncome — 근로소득과 별도 사업장 사업소득을 함께 받는 구조", () => {
  it("비율제 근로계약 + 근로소득 상한일 때만", () => {
    expect(hasSplitIncome({ payScheme: "RATIO", ratioEmployee: true, ratioWageCap: 5_000_000 })).toBe(true);
  });

  it("상한이 없으면 전액 근로소득이라 사업소득이 없다", () => {
    expect(hasSplitIncome({ payScheme: "RATIO", ratioEmployee: true, ratioWageCap: null })).toBe(false);
    expect(hasSplitIncome({ payScheme: "RATIO", ratioEmployee: true, ratioWageCap: 0 })).toBe(false);
  });

  it("위탁(완전비율제)·월급제는 아니다 — 통장이 하나다", () => {
    expect(hasSplitIncome({ payScheme: "RATIO", ratioEmployee: false, ratioWageCap: 5_000_000 })).toBe(false);
    expect(hasSplitIncome({ payScheme: "MONTHLY", ratioEmployee: true, ratioWageCap: 5_000_000 })).toBe(false);
    expect(hasSplitIncome(null)).toBe(false);
    expect(hasSplitIncome(undefined)).toBe(false);
  });
});
