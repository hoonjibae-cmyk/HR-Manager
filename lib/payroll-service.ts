import { prisma } from "./db";
import {
  computePayroll,
  blendWageTerms,
  type MonthlyInput,
  type WageSegment,
  type EmployeePayInput,
} from "./payroll";
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

/**
 * 해당 월에 각 계약 조건이 적용된 역일수 구간을 산출 (월중 계약 갱신 일할가중용).
 * - 계약 i 의 적용기간은 [시작일, 다음 계약 시작일 전날] — 갱신 계약이 이전 계약을 대체.
 * - 재직기간(입사~퇴사)과 교차한 일수만 집계해 입/퇴사 일할계산과 이중 적용을 방지.
 * - DRAFT 계약은 제외.
 */
export async function wageSegmentsFor(
  emps: Array<{ id: number; hireDate: Date; resignDate: Date | null }>,
  year: number,
  month: number
): Promise<Map<number, WageSegment[]>> {
  const result = new Map<number, WageSegment[]>();
  if (!emps.length) return result;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const contracts = await prisma.contract.findMany({
    where: {
      employeeId: { in: emps.map((e) => e.id) },
      status: { not: "DRAFT" },
      startDate: { lte: monthEnd },
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  const byEmp = new Map<number, typeof contracts>();
  for (const c of contracts) {
    const arr = byEmp.get(c.employeeId) ?? [];
    arr.push(c);
    byEmp.set(c.employeeId, arr);
  }

  for (const emp of emps) {
    const list = byEmp.get(emp.id) ?? [];
    if (!list.length) continue;
    const winFrom = emp.hireDate > monthStart ? emp.hireDate : monthStart;
    const winTo =
      emp.resignDate && emp.resignDate < monthEnd ? emp.resignDate : monthEnd;
    if (winFrom > winTo) continue;

    const segs: WageSegment[] = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const governEnd =
        i + 1 < list.length
          ? new Date(list[i + 1].startDate.getTime() - 86400000)
          : monthEnd;
      const from = c.startDate > winFrom ? c.startDate : winFrom;
      const to = governEnd < winTo ? governEnd : winTo;
      if (from > to) continue;
      const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
      segs.push({
        days,
        baseWage: c.baseWage,
        positionAllow: c.positionAllow,
        mealAllow: c.mealAllow,
        carAllow: c.carAllow,
        ratioPercent: c.ratioPercent,
      });
    }
    if (segs.length) result.set(emp.id, segs);
  }
  return result;
}

/**
 * 월중 계약 갱신(조건이 서로 다른 구간 2개 이상)이면 임금 조건을 역일수
 * 가중평균으로 치환. 그 외(계약 없음/단일 구간/동일 조건)는 직원 카드 값 유지.
 * 반환: 변경 내역 노트(감사용) 또는 null.
 */
function applyMidMonthBlend(
  payInput: EmployeePayInput,
  segs: WageSegment[] | undefined
): string | null {
  if (!segs || segs.length < 2) return null;
  const differs = segs.some(
    (s) =>
      s.baseWage !== segs[0].baseWage ||
      s.positionAllow !== segs[0].positionAllow ||
      s.mealAllow !== segs[0].mealAllow ||
      s.carAllow !== segs[0].carAllow ||
      (s.ratioPercent ?? null) !== (segs[0].ratioPercent ?? null)
  );
  if (!differs) return null;
  const b = blendWageTerms(segs);
  if (!b) return null;
  const before = payInput.baseWage;
  payInput.baseWage = b.baseWage;
  payInput.positionAllow = b.positionAllow;
  payInput.mealAllow = b.mealAllow;
  payInput.carAllow = b.carAllow;
  if (b.ratioPercent != null) payInput.ratioPercent = b.ratioPercent;
  const segDesc = segs
    .map((s) => `${s.days}일×${s.baseWage.toLocaleString()}원`)
    .join(" + ");
  return `월중 계약변경 일할가중 적용: ${segDesc} → 기본급(시급) ${b.baseWage.toLocaleString()}원 (변경 전 기준 ${before.toLocaleString()}원)`;
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
  // 월중 계약 갱신 대비: 이 달에 적용된 계약 조건 구간(역일수) 일괄 조회
  const segMap = await wageSegmentsFor(emps, year, month);

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

    // 월중 계약 갱신 시 기본급(시급)·수당을 역일수 가중평균으로 치환
    const payInput = empToPayInput(emp);
    const blendNote = applyMidMonthBlend(payInput, segMap.get(emp.id));

    const r = computePayroll(payInput, mInput, rates, tax);

    // 공제 기본모드: 4대보험(EMPLOYEE)=MANUAL(세무사 지정값 입력),
    // 사업소득(FREELANCE)=AUTO(3.3% 기계적 계산이므로 자동)
    // 기존 레코드가 '수동인데 아무 값도 입력 안 된 프리랜서'면 AUTO 로 승격(치유)
    const untouchedFreelance =
      !!existing &&
      existing.deductMode === "MANUAL" &&
      emp.incomeType === "FREELANCE" &&
      existing.pensionD === 0 &&
      existing.employmentD === 0 &&
      existing.healthD === 0 &&
      existing.longTermD === 0 &&
      existing.incomeTaxD === 0 &&
      existing.localTaxD === 0;
    const deductMode = untouchedFreelance
      ? "AUTO"
      : existing?.deductMode ??
        (emp.incomeType === "FREELANCE" ? "AUTO" : "MANUAL");
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
      breakdown: JSON.stringify({
        notes: blendNote ? [blendNote, ...r.notes] : r.notes,
        taxableGross: r.taxableGross,
      }),
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
    // 월중 계약 갱신이 있었던 달이면 동일한 가중 조건으로 재산출
    const payInput = empToPayInput(rec.employee);
    const segMap = await wageSegmentsFor([rec.employee], rec.year, rec.month);
    applyMidMonthBlend(payInput, segMap.get(rec.employeeId));
    const r = computePayroll(
      payInput,
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
