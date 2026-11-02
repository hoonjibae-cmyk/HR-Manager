// 연차 이월 — 수당 대신 다음 기간으로 넘긴 달의 급여명세서에 그 사실이 적히는가
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
  name: "박영은",
  empNo: "E010",
  department: "교육운영팀",
  position: "팀장",
  hireDate: new Date(Date.UTC(2021, 10, 2)),
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  schedule: [],
} as unknown as DocEmployee;

const base: DocPayroll = {
  year: 2026,
  month: 11,
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

const carry = {
  days: 5,
  periodStart: "2025-11-02",
  periodEnd: "2026-11-01",
  nextStart: "2026-11-02",
  nextEnd: "2027-11-01",
  processedOn: "2026-11-03",
};

describe("payslipHtml — 연차 이월 안내", () => {
  it("이월 처리한 달의 명세서에 기간·일수·다음 기간·처리일이 적힌다", () => {
    const html = payslipHtml({ employee, payroll: { ...base, leaveCarryover: carry }, company });
    expect(html).toContain("연차 이월:");
    expect(html).toContain("2025-11-02 ~ 2026-11-01");
    expect(html).toContain("미사용 연차 5일");
    expect(html).toContain("2026-11-02 ~ 2027-11-01");
    expect(html).toContain("근로자 동의");
    expect(html).toContain("처리일 2026-11-03");
  });

  it("이월이 없으면 아무 말도 없다", () => {
    expect(payslipHtml({ employee, payroll: base, company })).not.toContain("연차 이월");
    expect(payslipHtml({ employee, payroll: { ...base, leaveCarryover: null }, company })).not.toContain("연차 이월");
  });

  it("일부는 수당·일부는 이월이면 둘 다 적힌다", () => {
    const html = payslipHtml({
      employee,
      payroll: { ...base, unusedLeaveP: 229_664, unusedLeaveDays: 2, leaveCarryover: { ...carry, days: 3 } },
      company,
    });
    expect(html).toContain("연차미사용수당 = 미사용 연차일수");
    expect(html).toContain("미사용 연차 3일");
  });
});
