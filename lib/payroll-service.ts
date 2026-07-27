import { prisma } from "./db";
import {
  computePayroll,
  blendWageTerms,
  type MonthlyInput,
  type WageSegment,
  type EmployeePayInput,
} from "./payroll";
import { getActiveRates, getTaxTable, empToPayInput } from "./repo";
import { summarizeIncentive, type RosterStudent } from "./incentive";
import { overtimeInputsFor } from "./makeup-service";

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
export interface MonthContractTerms {
  segs: WageSegment[];
  /** 이 달 이후에 시작하는(아직 발효 전) 계약의 최초 시작일 — 있으면 직원 카드가
   *  미래 조건으로 선반영된 상태이므로, 이 달은 계약 스냅샷 조건을 써야 한다. */
  futureStart: Date | null;
}

export async function wageSegmentsFor(
  emps: Array<{ id: number; hireDate: Date; resignDate: Date | null }>,
  year: number,
  month: number
): Promise<Map<number, MonthContractTerms>> {
  const result = new Map<number, MonthContractTerms>();
  if (!emps.length) return result;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const contracts = await prisma.contract.findMany({
    where: {
      employeeId: { in: emps.map((e) => e.id) },
      status: { not: "DRAFT" },
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
    const all = byEmp.get(emp.id) ?? [];
    if (!all.length) continue;
    // 이 달을 지배하는 계약(시작일 <= 말일)과 아직 발효 전(미래 시작) 계약 분리
    const list = all.filter((c) => c.startDate <= monthEnd);
    const future = all.find((c) => c.startDate > monthEnd) ?? null;

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
        ratioMinGuarantee: c.ratioMinGuarantee,
      });
    }
    if (segs.length || future)
      result.set(emp.id, { segs, futureStart: future?.startDate ?? null });
  }
  return result;
}

/** 저장된 인센티브 학생 명단 → 엔진 입력용 */
export function rosterToStudents(rows: any[]): RosterStudent[] {
  return rows.map((r) => ({
    seq: r.seq,
    status: r.status as RosterStudent["status"],
    name: r.name,
    className: r.className,
    school: r.school,
    enrollDate: r.enrollDate,
    withdrawDate: r.withdrawDate,
    sessions: r.sessions,
    fullSessions: r.fullSessions,
  }));
}

/** 강사·월 인센티브 명단 조회 (없으면 null) */
export async function incentiveRosterFor(employeeId: number, year: number, month: number) {
  const rows = await prisma.incentiveStudent.findMany({
    where: { employeeId, year, month },
    orderBy: [{ seq: "asc" }, { id: "asc" }],
  });
  return rows.length ? rows : null;
}

/** 월중 계약변경 가중 결과 — 명세서 산출 근거 표시용 구조화 데이터 */
export interface BlendInfo {
  totalDays: number;
  segments: Array<{ days: number; baseWage: number }>;
  baseWage: number; // 가중평균 기본급(시급)
}

/**
 * 이 달에 적용할 임금 조건을 계약 이력 기준으로 결정해 payInput 에 반영.
 * - 조건이 다른 구간 2개 이상: 역일수 가중평균(월중 계약 변경).
 * - 단일 구간 + 미래 시작 계약 존재: 직원 카드는 미래 조건으로 선반영된 상태이므로
 *   이 달을 지배하는 계약의 스냅샷 조건으로 되돌려 계산 (발효 전 선지급 방지).
 * - 그 외(계약 없음/미래 계약 없음): 직원 카드 값 유지.
 */
export function applyMidMonthBlend(
  payInput: EmployeePayInput,
  entry: MonthContractTerms | undefined
): { note: string; info: BlendInfo | null } | null {
  if (!entry || !entry.segs.length) return null;
  const { segs, futureStart } = entry;

  const applySeg = (s: WageSegment) => {
    payInput.baseWage = s.baseWage;
    payInput.positionAllow = s.positionAllow;
    payInput.mealAllow = s.mealAllow;
    payInput.carAllow = s.carAllow;
    if (s.ratioPercent != null) payInput.ratioPercent = s.ratioPercent;
    if (s.ratioMinGuarantee != null) payInput.ratioMinGuarantee = s.ratioMinGuarantee;
  };

  if (segs.length >= 2) {
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
    return {
      note: `월중 계약변경 일할가중 적용: ${segDesc} → 기본급(시급) ${b.baseWage.toLocaleString()}원 (변경 전 기준 ${before.toLocaleString()}원)`,
      info: {
        totalDays: segs.reduce((a, s) => a + s.days, 0),
        segments: segs.map((s) => ({ days: s.days, baseWage: s.baseWage })),
        baseWage: b.baseWage,
      },
    };
  }

  // 단일 구간 — 미래 시작 계약이 있으면 이 달은 기존(지배) 계약 조건으로 계산
  if (futureStart) {
    const s = segs[0];
    const changed =
      s.baseWage !== payInput.baseWage ||
      s.positionAllow !== payInput.positionAllow ||
      s.mealAllow !== payInput.mealAllow ||
      s.carAllow !== payInput.carAllow ||
      (s.ratioPercent != null && s.ratioPercent !== (payInput.ratioPercent ?? null));
    if (!changed) return null;
    const cardBase = payInput.baseWage;
    applySeg(s);
    const d = futureStart;
    const ymdStr = `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
    return {
      note: `변경 계약 발효 전 — 이 달은 기존 계약 조건(기본급 ${s.baseWage.toLocaleString()}원) 적용. 변경 계약(기본급 ${cardBase.toLocaleString()}원)은 ${ymdStr}부터 적용됩니다.`,
      info: null,
    };
  }
  return null;
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
  // 보강 사전신청 중 '실근무 확정' 된 건 → 연장/휴일/야간 시간 자동 산출
  // (완전비율제는 overtimeInputsFor 가 알아서 뺀다)
  const otMap = await overtimeInputsFor(
    year,
    month,
    emps.map((e) => e.id)
  );
  // 인센티브 강사: 학생 명단(회차 비례 가중 인원) 일괄 조회
  const incEmpIds = emps.filter((e) => e.payScheme === "INCENTIVE").map((e) => e.id);
  const rosterMap = new Map<number, any[]>();
  if (incEmpIds.length) {
    const rosterRows = await prisma.incentiveStudent.findMany({
      where: { employeeId: { in: incEmpIds }, year, month },
      orderBy: [{ seq: "asc" }, { id: "asc" }],
    });
    for (const r of rosterRows) {
      const arr = rosterMap.get(r.employeeId) ?? [];
      arr.push(r);
      rosterMap.set(r.employeeId, arr);
    }
  }

  const results = [];
  for (const emp of emps) {
    const existing = await prisma.payrollRecord.findUnique({
      where: { employeeId_year_month: { employeeId: emp.id, year, month } },
    });
    // 발송(SENT)된 기록만 잠금 — 명세서 발송 전까지는 자유롭게 재계산 가능
    if (existing && existing.status === "SENT") {
      results.push(existing);
      continue;
    }

    const mInput = { ...(inputs[emp.id] ?? {}) };
    // 시간기록표로 입력된 실근로/주휴시간은 일반 재계산 시 보존 (새 값이 오면 교체)
    if (mInput.workedHours === undefined)
      mInput.workedHours = existing?.workedHours ?? null;
    if (mInput.weeklyHolidayHours === undefined)
      mInput.weeklyHolidayHours = existing?.weeklyHolidayHours ?? null;
    // 오버타임(보강 실근무 확정분) — 명시적으로 넘긴 값이 있으면 그쪽을 존중한다
    const ot = otMap.get(emp.id);
    if (ot) {
      if (mInput.overtimeHours === undefined) mInput.overtimeHours = ot.overtimeHours;
      if (mInput.holidayHours === undefined) mInput.holidayHours = ot.holidayHours;
      if (mInput.holidayOverHours === undefined) mInput.holidayOverHours = ot.holidayOverHours;
      if (mInput.nightHours === undefined) mInput.nightHours = ot.nightHours;
    }
    mInput.prorationRatio = prorationRatioFor(
      year,
      month,
      emp.hireDate,
      emp.resignDate
    );
    if (mInput.prorationRatio === 0) continue; // 해당 월 재직 없음

    // 월중 계약 갱신 시 기본급(시급)·수당을 역일수 가중평균으로 치환
    const payInput = empToPayInput(emp);
    const blend = applyMidMonthBlend(payInput, segMap.get(emp.id));

    // 인센티브: 학생 명단이 있으면 회차 비례 가중 인원으로 산정
    let incSummary: ReturnType<typeof summarizeIncentive> | null = null;
    if (emp.payScheme === "INCENTIVE") {
      const roster = rosterMap.get(emp.id);
      if (roster?.length) {
        incSummary = summarizeIncentive(rosterToStudents(roster), {
          threshold: payInput.incThreshold ?? 0,
          perStudent: payInput.incPerStudent ?? 0,
        });
        mInput.studentUnits = incSummary.units;
      } else if (mInput.studentUnits === undefined) {
        mInput.studentUnits = existing?.studentUnits ?? null;
      }
    }

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
      holidayOverHours: mInput.holidayOverHours ?? 0,
      studentCount: mInput.studentCount ?? null,
      studentUnits: mInput.studentUnits ?? null,
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
      // 배치 재실행 시 기타공제 세부 항목 보존 (합계 otherD 는 fin 에서 보존됨)
      otherItems: existing?.otherItems ?? null,
      breakdown: JSON.stringify({
        notes: blend ? [blend.note, ...r.notes] : r.notes,
        taxableGross: r.taxableGross,
        // 명세서 '기본급 산출 근거' 표기용: 이 달 계산에 실제 사용된 기본급(시급)과
        // 월중 계약변경 가중 내역
        baseApplied: payInput.baseWage,
        blend: blend?.info ?? null,
        // 포괄임금 약정시간 — 명세서에 '계약서 어느 항목이 얼마인지' 를 그대로 비추기 위함
        fixed:
          payInput.fixedOtHours || payInput.fixedNightHours
            ? {
                baseHours: payInput.fixedBaseHours ?? null,
                otHours: payInput.fixedOtHours ?? null,
                nightHours: payInput.fixedNightHours ?? null,
              }
            : null,
        // 보강 오버타임 산정 내역 — 명세서 첨부 '오버타임 산정 내역서' 가 이걸 그대로 쓴다
        overtime: ot?.detail?.length
          ? {
              overtimeHours: ot.overtimeHours,
              holidayHours: ot.holidayHours,
              holidayOverHours: ot.holidayOverHours,
              nightHours: ot.nightHours,
              lines: ot.detail,
              excluded: ot.excluded,
            }
          : null,
        // 인센티브 명단 산정 요약 (상세는 IncentiveStudent 테이블)
        incentive: incSummary
          ? {
              threshold: incSummary.threshold,
              perStudent: incSummary.perStudent,
              perSession: incSummary.perSession,
              standardSessions: incSummary.standardSessions,
              units: incSummary.units,
              over: incSummary.over,
              amount: incSummary.amount,
              fullCount: incSummary.fullCount,
              partialCount: incSummary.partialCount,
              totalCount: incSummary.totalCount,
            }
          : null,
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

export interface OtherDeductItem {
  name: string;
  amount: number;
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
  /** 기타공제 세부 항목 — 전달 시 otherD 는 항목 합계로 자동 산출 */
  otherItems?: OtherDeductItem[];
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

  // 기타공제 세부 항목: 전달되면 정제 후 합계를 otherD 로 사용
  let otherItemsJson: string | null | undefined = undefined; // undefined = 변경 없음
  let otherDVal = num(patch.otherD, rec.otherD);
  if (patch.otherItems !== undefined) {
    const items = (patch.otherItems ?? [])
      .map((it) => ({
        name: String(it?.name ?? "").trim(),
        amount: Math.round(Number(it?.amount) || 0),
      }))
      .filter((it) => it.name !== "" || it.amount !== 0);
    otherItemsJson = items.length ? JSON.stringify(items) : null;
    otherDVal = items.reduce((a, it) => a + it.amount, 0);
  }

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
    otherD: otherDVal,
    gross: rec.gross,
  });

  return prisma.payrollRecord.update({
    where: { id: payrollId },
    data: {
      deductMode,
      ...fin,
      ...(otherItemsJson !== undefined ? { otherItems: otherItemsJson } : {}),
    },
  });
}
