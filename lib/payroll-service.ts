import { prisma } from "./db";
import { computePayroll, type MonthlyInput } from "./payroll";
import { getActiveRates, getTaxTable, empToPayInput } from "./repo";

export interface PayrollInputMap {
  [employeeId: number]: MonthlyInput;
}

/** 한 달치 급여를 (활성 직원 전원 또는 지정 직원) 계산하여 upsert */
export async function runPayrollMonth(
  year: number,
  month: number,
  inputs: PayrollInputMap = {},
  onlyEmployeeIds?: number[]
) {
  const [rates, tax] = await Promise.all([getActiveRates(), getTaxTable()]);
  const where: any = { active: true };
  if (onlyEmployeeIds && onlyEmployeeIds.length)
    where.id = { in: onlyEmployeeIds };
  const emps = await prisma.employee.findMany({ where });

  const results = [];
  for (const emp of emps) {
    const mInput = inputs[emp.id] ?? {};
    const r = computePayroll(empToPayInput(emp), mInput, rates, tax);

    const existing = await prisma.payrollRecord.findUnique({
      where: { employeeId_year_month: { employeeId: emp.id, year, month } },
    });
    // 이미 확정/발송된 기록은 덮어쓰지 않음
    if (existing && existing.status !== "DRAFT") {
      results.push(existing);
      continue;
    }

    const data = {
      employeeId: emp.id,
      year,
      month,
      incomeType: emp.incomeType,
      payScheme: emp.payScheme,
      workedHours: mInput.workedHours ?? null,
      overtimeHours: mInput.overtimeHours ?? 0,
      nightHours: mInput.nightHours ?? 0,
      holidayHours: mInput.holidayHours ?? 0,
      studentCount: mInput.studentCount ?? null,
      classRevenue: mInput.classRevenue ?? null,
      bonus: mInput.bonus ?? 0,
      incentiveManual: mInput.incentiveManual ?? 0,
      unusedLeaveDays: mInput.unusedLeaveDays ?? 0,
      baseP: r.baseP,
      overtimeP: r.overtimeP,
      nightP: r.nightP,
      holidayP: r.holidayP,
      weeklyHolidayP: r.weeklyHolidayP,
      positionP: r.positionP,
      mealP: r.mealP,
      carP: r.carP,
      incentiveP: r.incentiveP,
      bonusP: r.bonusP,
      unusedLeaveP: r.unusedLeaveP,
      gross: r.gross,
      pensionD: r.pensionD,
      employmentD: r.employmentD,
      healthD: r.healthD,
      longTermD: r.longTermD,
      incomeTaxD: r.incomeTaxD,
      localTaxD: r.localTaxD,
      otherD: r.otherD,
      totalDeduct: r.totalDeduct,
      net: r.net,
      hourlyWage: r.hourlyWage,
      breakdown: JSON.stringify({ notes: r.notes, taxableGross: r.taxableGross }),
      status: "DRAFT",
    };

    const rec = await prisma.payrollRecord.upsert({
      where: { employeeId_year_month: { employeeId: emp.id, year, month } },
      update: data,
      create: data,
    });
    results.push(rec);
  }
  return results;
}
