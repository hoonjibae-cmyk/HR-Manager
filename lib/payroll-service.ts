import { prisma } from "./db";
import { computePayroll, type MonthlyInput } from "./payroll";
import { getActiveRates, getTaxTable, empToPayInput } from "./repo";

export interface PayrollInputMap {
  [employeeId: number]: MonthlyInput;
}

/** 월중 입/퇴사 일할계산 비율 = 해당 월 재직 역일수 / 해당 월 총 역일수 */
export function prorationRatioFor(
  year: number,
  month: number,
  hireDate: Date,
  resignDate: Date | null
): number {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0)); // 말일
  const daysInMonth = monthEnd.getUTCDate();

  const from = hireDate > monthStart ? hireDate : monthStart;
  const to = resignDate && resignDate < monthEnd ? resignDate : monthEnd;
  if (from > to) return 0; // 해당 월 재직일 없음

  const activeDays =
    Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  const ratio = activeDays / daysInMonth;
  return Math.min(Math.max(ratio, 0), 1);
}

/** 저장된 레코드의 공제 최종본 조립 + 합계 재계산 */
/** 엔진 결과에서 법정공제 6개 필드만 추출 */
function statutoryOf(r: {
  pensionD: number;
  employmentD: number;
  healthD: number;
  longTermD: number;
  incomeTaxD: number;
  localTaxD: number;
}) {
  return {
    pensionD: r.pensionD,
    employmentD: r.employmentD,
    healthD: r.healthD,
    longTermD: r.longTermD,
    incomeTaxD: r.incomeTaxD,
    localTaxD: r.localTaxD,
  };
}

function assembleDeductions(args: {
  deductMode: string;
  auto: {
    pensionD: number;
    employmentD: number;
    healthD: number;
    longTermD: number;
    incomeTaxD: number;
    localTaxD: number;
  };
  manual: {
    pensionD: number;
    employmentD: number;
    healthD: number;
    longTermD: number;
    incomeTaxD: number;
    localTaxD: number;
  };
  retentionD: number;
  parkingD: number;
  expenseD: number;
  otherD: number;
  gross: number;
}) {
  const statutory = args.deductMode === "AUTO" ? args.auto : args.manual;
  const totalDeduct =
    statutory.pensionD +
    statutory.employmentD +
    statutory.healthD +
    statutory.longTermD +
    statutory.incomeTaxD +
    statutory.localTaxD +
    args.retentionD +
    args.parkingD +
    args.expenseD +
    args.otherD;
  return {
    ...statutory,
    retentionD: args.retentionD,
    parkingD: args.parkingD,
    expenseD: args.expenseD,
    otherD: args.otherD,
    totalDeduct,
    net: args.gross - totalDeduct,
  };
}

/**
 * 한 달치 급여를 (활성 직원 전원 또는 지정 직원) 계산하여 upsert.
 * - 공제모드 기본 MANUAL: 법정공제(4대보험·소득세)는 세무사 지정값을 직접 입력(공제 편집).
 *   재계산 시 기존 수동 공제값·주차비·실비·기타공제는 보존된다.
 * - AUTO 모드 레코드는 법정공제를 엔진으로 재산출.
 * - 퇴직유보금(인센티브×8.3%)은 모드와 무관하게 자동 산출.
 * - 월중 입/퇴사자는 일할계산 자동 적용.
 */
export async function runPayrollMonth(
  year: number,
  month: number,
  inputs: PayrollInputMap = {},
  onlyEmployeeIds?: number[]
) {
  const [rates, tax] = await Promise.all([getActiveRates(), getTaxTable()]);
  const where: any = {
    OR: [
      { active: true },
      // 해당 월에 퇴사한 직원도 그 달 급여는 계산
      {
        resignDate: {
          gte: new Date(Date.UTC(year, month - 1, 1)),
          lte: new Date(Date.UTC(year, month, 0)),
        },
      },
    ],
  };
  if (onlyEmployeeIds && onlyEmployeeIds.length)
    where.id = { in: onlyEmployeeIds };
  const emps = await prisma.employee.findMany({ where });

  const results = [];
  for (const emp of emps) {
    const existing = await prisma.payrollRecord.findUnique({
      where: { employeeId_year_month: { employeeId: emp.id, year, month } },
    });
    // 이미 확정/발송된 기록은 덮어쓰지 않음
    if (existing && existing.status !== "DRAFT") {
      results.push(existing);
      continue;
    }

    const mInput = { ...(inputs[emp.id] ?? {}) };
    // 시간기록표로 입력된 실근로/주휴시간은 일반 재계산 시 보존 (새 값이 오면 교체)
    if (mInput.workedHours === undefined)
      mInput.workedHours = existing?.workedHours ?? null;
    if (mInput.weeklyHolidayHours === undefined)
      mInput.weeklyHolidayHours = existing?.weeklyHolidayHours ?? null;
    mInput.prorationRatio = prorationRatioFor(
      year,
      month,
      emp.hireDate,
      emp.resignDate
    );
    if (mInput.prorationRatio === 0) continue; // 해당 월 재직 없음

    const r = computePayroll(empToPayInput(emp), mInput, rates, tax);

    const deductMode = existing?.deductMode ?? "MANUAL";
    const fin = assembleDeductions({
      deductMode,
      auto: statutoryOf(r),
      manual: {
        pensionD: existing?.pensionD ?? 0,
        employmentD: existing?.employmentD ?? 0,
        healthD: existing?.healthD ?? 0,
        longTermD: existing?.longTermD ?? 0,
        incomeTaxD: existing?.incomeTaxD ?? 0,
        localTaxD: existing?.localTaxD ?? 0,
      },
      retentionD: r.retentionD,
      parkingD: existing?.parkingD ?? 0,
      expenseD: existing?.expenseD ?? 0,
      otherD: existing?.otherD ?? 0,
      gross: r.gross,
    });

    const data = {
      employeeId: emp.id,
      year,
      month,
      incomeType: emp.incomeType,
      payScheme: emp.payScheme,
      workedHours: mInput.workedHours ?? null,
      weeklyHolidayHours: mInput.weeklyHolidayHours ?? null,
      extraHours: mInput.extraHours ?? 0,
      overtimeHours: mInput.overtimeHours ?? 0,
      nightHours: mInput.nightHours ?? 0,
      holidayHours: mInput.holidayHours ?? 0,
      studentCount: mInput.studentCount ?? null,
      classRevenue: mInput.classRevenue ?? null,
      bonus: mInput.bonus ?? 0,
      incentiveManual: mInput.incentiveManual ?? 0,
      unusedLeaveDays: mInput.unusedLeaveDays ?? 0,
      prorationRatio: mInput.prorationRatio,
      baseP: r.baseP,
      extraP: r.extraP,
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
      deductMode,
      ...fin,
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

export interface DeductionPatch {
  deductMode?: "MANUAL" | "AUTO";
  pensionD?: number;
  employmentD?: number;
  healthD?: number;
  longTermD?: number;
  incomeTaxD?: number;
  localTaxD?: number;
  retentionD?: number;
  parkingD?: number;
  expenseD?: number;
  otherD?: number;
}

/** 공제 편집 저장: 모드 전환/수동값/자체공제 반영 후 합계·실수령 재계산 */
export async function updateDeductions(payrollId: number, patch: DeductionPatch) {
  const rec = await prisma.payrollRecord.findUnique({
    where: { id: payrollId },
    include: { employee: true },
  });
  if (!rec) throw new Error("급여기록 없음");
  if (rec.status === "SENT") throw new Error("발송 완료된 기록은 수정할 수 없습니다");

  const deductMode = patch.deductMode ?? (rec.deductMode as "MANUAL" | "AUTO");

  // AUTO 모드면 법정공제를 엔진으로 재산출 (저장된 월 입력값 사용)
  let auto = statutoryOf(rec);
  let retentionAuto = rec.retentionD;
  if (deductMode === "AUTO") {
    const [rates, tax] = await Promise.all([getActiveRates(), getTaxTable()]);
    const r = computePayroll(
      empToPayInput(rec.employee),
      {
        workedHours: rec.workedHours,
        weeklyHolidayHours: rec.weeklyHolidayHours,
        extraHours: rec.extraHours,
        overtimeHours: rec.overtimeHours,
        nightHours: rec.nightHours,
        holidayHours: rec.holidayHours,
        studentCount: rec.studentCount,
        classRevenue: rec.classRevenue,
        bonus: rec.bonus,
        incentiveManual: rec.incentiveManual,
        unusedLeaveDays: rec.unusedLeaveDays,
        prorationRatio: rec.prorationRatio,
      },
      rates,
      tax
    );
    auto = statutoryOf(r);
    retentionAuto = r.retentionD;
  }

  const num = (v: number | undefined, fallback: number) =>
    v == null || isNaN(v) ? fallback : Math.round(v);

  const fin = assembleDeductions({
    deductMode,
    auto,
    manual: {
      pensionD: num(patch.pensionD, rec.pensionD),
      employmentD: num(patch.employmentD, rec.employmentD),
      healthD: num(patch.healthD, rec.healthD),
      longTermD: num(patch.longTermD, rec.longTermD),
      incomeTaxD: num(patch.incomeTaxD, rec.incomeTaxD),
      localTaxD: num(patch.localTaxD, rec.localTaxD),
    },
    retentionD: num(patch.retentionD, retentionAuto),
    parkingD: num(patch.parkingD, rec.parkingD),
    expenseD: num(patch.expenseD, rec.expenseD),
    otherD: num(patch.otherD, rec.otherD),
    gross: rec.gross,
  });

  return prisma.payrollRecord.update({
    where: { id: payrollId },
    data: { deductMode, ...fin },
  });
}
