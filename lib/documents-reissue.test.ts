// 정정 발급 — 발송 잠금을 풀고 고쳐 다시 낸 명세서의 표시
import { describe, it, expect } from "vitest";
import { payslipHtml, type DocPayroll } from "./documents-pay";
import type { DocCompany, DocEmployee } from "./documents";

const company: DocCompany = {
  name: "주식회사 유쌤에듀",
  ceo: "유은정",
  bizNo: "418-86-02289",
  phone: "031-794-3306",
  address: "경기도 하남시 미사강변대로 216",
  payday: 7,
  stamp: null,
};

const employee = {
  name: "이지우",
  empNo: "E001",
  department: "교수부",
  position: "강사",
  hireDate: new Date(Date.UTC(2023, 2, 1)),
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  schedule: [],
} as unknown as DocEmployee;

const base: DocPayroll = {
  year: 2026,
  month: 7,
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseP: 3_000_000,
  extraP: 0,
  overtimeP: 0,
  nightP: 0,
  holidayP: 0,
  weeklyHolidayP: 0,
  positionP: 0,
  mealP: 0,
  carP: 0,
  incentiveP: 0,
  bonusP: 0,
  unusedLeaveP: 0,
  gross: 3_000_000,
  pensionD: 0,
  employmentD: 0,
  healthD: 0,
  longTermD: 0,
  incomeTaxD: 0,
  localTaxD: 0,
  retentionD: 0,
  parkingD: 0,
  expenseD: 0,
  otherD: 0,
  totalDeduct: 0,
  net: 3_000_000,
  hourlyWage: 14_354,
};

describe("payslipHtml — 정정 발급 표시", () => {
  it("정정된 적 없는 원본에는 아무 표시도 붙지 않는다", () => {
    const html = payslipHtml({ employee, payroll: base, company });
    expect(html).not.toContain("정정 발급");
    expect(html).not.toContain("최초 발급일");
  });

  it("reissueCount 가 0 이어도(발송만 한 상태) 원본이다", () => {
    const html = payslipHtml({
      employee,
      payroll: { ...base, reissueCount: 0, firstSentAt: new Date(Date.UTC(2026, 7, 7)) },
      company,
    });
    expect(html).not.toContain("정정 발급");
  });

  it("잠금을 풀고 다시 낸 명세서에는 정정 차수가 찍힌다", () => {
    const html = payslipHtml({
      employee,
      payroll: { ...base, reissueCount: 1, firstSentAt: new Date(Date.UTC(2026, 7, 7)) },
      company,
    });
    expect(html).toContain("정정 발급 (제1차)");
  });

  it("최초 발급일을 함께 적어 앞서 교부된 것과 대조하게 한다", () => {
    const html = payslipHtml({
      employee,
      payroll: { ...base, reissueCount: 1, firstSentAt: new Date(Date.UTC(2026, 7, 7)) },
      company,
    });
    expect(html).toContain("최초 발급일 2026.08.07");
  });

  it("어느 것이 최종본인지 문서에 밝힌다 (근로기준법 §48 교부)", () => {
    const html = payslipHtml({
      employee,
      payroll: { ...base, reissueCount: 1 },
      company,
    });
    expect(html).toContain("이 명세서가 최종본이며 앞서 교부된 명세서는 무효입니다");
  });

  it("두 번 이상 정정하면 차수가 올라간다", () => {
    const html = payslipHtml({ employee, payroll: { ...base, reissueCount: 3 }, company });
    expect(html).toContain("정정 발급 (제3차)");
  });

  it("최초 발급일을 모르면 그 부분만 빠지고 정정 표시는 남는다", () => {
    const html = payslipHtml({
      employee,
      payroll: { ...base, reissueCount: 1, firstSentAt: null },
      company,
    });
    expect(html).toContain("정정 발급 (제1차)");
    expect(html).not.toContain("최초 발급일");
  });

  it("사업소득 지급명세서에도 똑같이 붙는다", () => {
    const html = payslipHtml({
      employee,
      payroll: { ...base, incomeType: "FREELANCE", reissueCount: 1 },
      company,
    });
    expect(html).toContain("사업소득 지급명세서");
    expect(html).toContain("정정 발급 (제1차)");
  });
});
