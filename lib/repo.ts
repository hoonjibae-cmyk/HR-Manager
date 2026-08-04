// DB ↔ 엔진/문서 어댑터
import { prisma } from "./db";
import {
  computePayroll,
  computeWeeklyHours,
  type EmployeePayInput,
  type InsuranceRates,
  type TaxBracketRow,
  type MonthlyInput,
} from "./payroll";
import { summarizeLeave, summarizeComp, isLeaveEligible, type LeaveTxn } from "./leave";
import { parseSchedule } from "./constants";
import type { DocCompany, DocEmployee, DocContract } from "./documents";

let _taxCache: TaxBracketRow[] | null = null;

export async function getCompany(): Promise<DocCompany & { payday: number }> {
  const c = await prisma.company.findFirst({ where: { id: 1 } });
  if (!c) {
    return {
      name: "주식회사 유쌤에듀",
      ceo: "유은정",
      bizNo: "418-86-02289",
      phone: "031-794-3306",
      address: "경기도 하남시 미사강변대로 216 한강트윈프라자2 3층",
      payday: 7,
      logo: null,
    };
  }
  return {
    // ㈜ 글리프는 PDF 임베드 폰트(한글 서브셋)에 없어 빈칸으로 출력됨 →
    // DB 값에 ㈜ 가 남아 있어도 문서에는 '주식회사 '로 자동 변환
    name: c.name.replace(/㈜\s*/g, "주식회사 "),
    ceo: c.ceo,
    bizNo: c.bizNo,
    phone: c.phone,
    address: c.address,
    payday: c.payday,
    logo: (c as any).logo ?? null,
  };
}

export async function getActiveRates(): Promise<InsuranceRates> {
  const r =
    (await prisma.insuranceRate.findFirst({ where: { isActive: true }, orderBy: { year: "desc" } })) ??
    (await prisma.insuranceRate.findFirst({ orderBy: { year: "desc" } }));
  if (!r) {
    return {
      nationalPension: 0.045,
      employment: 0.009,
      health: 0.03545,
      longTermCare: 0.1295,
      localIncomeTaxRate: 0.1,
      businessIncomeTax: 0.03,
      pensionBaseMin: 390000,
      pensionBaseMax: 6170000,
    };
  }
  return {
    nationalPension: r.nationalPension,
    employment: r.employment,
    health: r.health,
    longTermCare: r.longTermCare,
    localIncomeTaxRate: r.localIncomeTaxRate,
    businessIncomeTax: r.businessIncomeTax,
    pensionBaseMin: r.pensionBaseMin,
    pensionBaseMax: r.pensionBaseMax,
  };
}

export async function getTaxTable(): Promise<TaxBracketRow[]> {
  if (_taxCache) return _taxCache;
  const rows = await prisma.taxBracket.findMany({ orderBy: { loThousand: "asc" } });
  _taxCache = rows.map((r) => ({
    lo: r.loThousand,
    hi: r.hiThousand,
    tax: JSON.parse(r.taxByDependents) as number[],
  }));
  return _taxCache;
}

export function empToPayInput(e: any): EmployeePayInput {
  return {
    incomeType: e.incomeType,
    payScheme: e.payScheme,
    isContractor: e.isContractor ?? false,
    baseWage: e.baseWage,
    positionAllow: e.positionAllow,
    mealAllow: e.mealAllow,
    carAllow: e.carAllow,
    nonTaxTotal: e.nonTaxTotal ?? 0,
    dependents: e.dependents ?? 1,
    schedule: parseSchedule(e.schedule),
    incThreshold: e.incThreshold,
    incPerStudent: e.incPerStudent,
    ratioPercent: e.ratioPercent,
    ratioMinGuarantee: e.ratioMinGuarantee,
    fixedBaseHours: e.fixedBaseHours,
    fixedOtHours: e.fixedOtHours,
    fixedNightHours: e.fixedNightHours,
  };
}

export function empToDoc(e: any): DocEmployee {
  return {
    name: e.name,
    rrn: e.rrn,
    birth: e.birth,
    department: e.department,
    position: e.position,
    duty: e.duty,
    address: e.address,
    phone: e.phone,
    email: e.email,
    hireDate: e.hireDate,
    resignDate: e.resignDate,
    incomeType: e.incomeType,
    payScheme: e.payScheme,
    baseWage: e.baseWage,
    positionAllow: e.positionAllow,
    mealAllow: e.mealAllow,
    carAllow: e.carAllow,
    schedule: e.schedule,
    breakPaid: e.breakPaid ?? false,
  };
}

export function contractToDoc(ct: any): DocContract {
  return {
    stage: ct.stage,
    templateKey: ct.templateKey,
    startDate: ct.startDate,
    endDate: ct.endDate,
    isProbation: ct.isProbation,
    probationMonths: ct.probationMonths,
    baseWage: ct.baseWage,
    positionAllow: ct.positionAllow,
    mealAllow: ct.mealAllow,
    carAllow: ct.carAllow,
    ratioPercent: ct.ratioPercent,
    incThreshold: ct.incThreshold,
    incPerStudent: ct.incPerStudent,
    fixedBaseHours: ct.fixedBaseHours,
    fixedOtHours: ct.fixedOtHours,
    fixedNightHours: ct.fixedNightHours,
  };
}

/** 단일 직원의 월 급여 계산 (저장 X) */
export async function previewPayroll(employeeId: number, month: MonthlyInput) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new Error("직원을 찾을 수 없습니다");
  const [rates, tax] = await Promise.all([getActiveRates(), getTaxTable()]);
  const result = computePayroll(empToPayInput(emp), month, rates, tax);
  return { emp, result };
}

/** 연차 현황 요약 (본래 연차 + 대휴보상연차, DB 트랜잭션 기반) */
export async function leaveSummaryFor(employeeId: number, asOf: Date = new Date()) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new Error("직원을 찾을 수 없습니다");
  const txns = await prisma.leaveTransaction.findMany({ where: { employeeId } });
  const leaveTxns: LeaveTxn[] = txns.map((t) => ({
    date: t.date,
    days: t.days,
    type: t.type as any,
    category: (t as any).category ?? "STATUTORY",
    note: t.note ?? undefined,
  }));
  // 주 소정근로시간이 15시간 미만이면 법정 연차가 발생하지 않는다(근로기준법 §18③).
  // 계약상 별도로 정한 경우 Employee.leaveEligible 로 덮어쓴다.
  const { weeklyContractual } = computeWeeklyHours(parseSchedule(emp.schedule));
  const eligible = isLeaveEligible(weeklyContractual, (emp as any).leaveEligible);
  return {
    emp,
    summary: summarizeLeave(emp.hireDate, asOf, leaveTxns, { eligible }),
    comp: summarizeComp(leaveTxns, asOf),
    weeklyContractual,
  };
}

export function invalidateTaxCache() {
  _taxCache = null;
}
