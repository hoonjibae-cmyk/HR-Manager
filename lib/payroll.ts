// 유쌤에듀 급여 산정 엔진
// 엑셀 '임금산정식' / '갑근세' / '임금(4대보험)' / '임금(3.3%)' 로직을 재현한 순수 함수.
// DB에 의존하지 않으므로 단위 테스트가 용이합니다.

import { ScheduleDay } from "./constants";

/** 근속연수 계산 등에서 쓰는 4.345주/월 */
export const WEEKS_PER_MONTH = 4.345;

export interface InsuranceRates {
  nationalPension: number; // 0.045
  employment: number; // 0.009
  health: number; // 0.03545
  longTermCare: number; // 0.1295 (건강보험료 대비)
  localIncomeTaxRate: number; // 0.1
  businessIncomeTax: number; // 0.03
  pensionBaseMin: number;
  pensionBaseMax: number;
}

export const DEFAULT_RATES_2025: InsuranceRates = {
  nationalPension: 0.045,
  employment: 0.009,
  health: 0.03545,
  longTermCare: 0.1295,
  localIncomeTaxRate: 0.1,
  businessIncomeTax: 0.03,
  pensionBaseMin: 390000,
  pensionBaseMax: 6170000,
};

/** 간이세액표 한 구간 */
export interface TaxBracketRow {
  lo: number; // 이상 (천원)
  hi: number | null; // 미만 (천원)
  tax: number[]; // 부양가족수 1~11 세액(원)
}

export interface EmployeePayInput {
  incomeType: "EMPLOYEE" | "FREELANCE";
  payScheme: "MONTHLY" | "HOURLY" | "INCENTIVE" | "RATIO";
  baseWage: number; // 월급제=월기본급, 시급제=시급
  positionAllow: number;
  mealAllow: number; // 비과세
  carAllow: number; // 비과세
  nonTaxTotal?: number; // 기타 비과세
  dependents: number; // 부양가족수(본인포함)
  schedule: ScheduleDay[];
  // 인센티브
  incThreshold?: number | null;
  incPerStudent?: number | null;
  // 비율제
  ratioPercent?: number | null;
}

export interface MonthlyInput {
  workedHours?: number | null; // 시급제 실근로시간(월). 없으면 스케줄로 추정
  overtimeHours?: number; // 추가 연장근로(월, 계약 외)
  nightHours?: number; // 야간근로(월)
  holidayHours?: number; // 휴일근로(월)
  studentCount?: number | null; // 인센티브용
  classRevenue?: number | null; // 비율제용
  bonus?: number; // 특별상여
  incentiveManual?: number; // 수동 인센티브 조정
  unusedLeaveDays?: number; // 연차미사용 일수
}

export interface PayrollResult {
  hourlyWage: number; // 통상시급
  weeklyContractual: number; // 주 소정근로시간
  weeklyHoliday: number; // 주휴시간
  monthlyStdHours: number; // 월 기본급 환산시간 (소정+주휴)*4.345

  // 지급
  baseP: number;
  overtimeP: number;
  nightP: number;
  holidayP: number;
  weeklyHolidayP: number;
  positionP: number;
  mealP: number;
  carP: number;
  incentiveP: number;
  bonusP: number;
  unusedLeaveP: number;
  gross: number;

  // 공제
  pensionD: number;
  employmentD: number;
  healthD: number;
  longTermD: number;
  incomeTaxD: number;
  localTaxD: number;
  otherD: number;
  totalDeduct: number;

  net: number;
  taxableGross: number; // 과세 대상 급여 (비과세 제외)
  notes: string[];
}

/** 10원 미만 절사 (Excel ROUNDDOWN(x,-1)) */
export function floor10(x: number): number {
  return Math.floor(x / 10) * 10;
}
function round0(x: number): number {
  return Math.round(x);
}

/** "HH:MM" → 시(소수) */
function toHours(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) + (m || 0) / 60;
}

/** 스케줄에서 주 소정근로시간 / 주 연장 / 주휴시간 계산 */
export function computeWeeklyHours(schedule: ScheduleDay[]) {
  let contractual = 0; // Σ min(일근로,8)
  let overtime = 0; // Σ max(일근로-8,0)
  for (const d of schedule) {
    if (!d.work) continue;
    let dur = toHours(d.end) - toHours(d.start) - (d.breakH || 0);
    if (dur <= 0) continue;
    contractual += Math.min(dur, 8);
    overtime += Math.max(dur - 8, 0);
  }
  const weeklyRaw = contractual;
  const weeklyContractual = Math.min(weeklyRaw, 40);
  // 40시간 초과분도 연장으로
  overtime += Math.max(weeklyRaw - 40, 0);
  // 주휴시간: 주 15시간 미만이면 0, 아니면 주소정/5 (=주소정/40*8) 상한 8
  const weeklyHoliday =
    weeklyContractual < 15 ? 0 : Math.min(weeklyContractual / 5, 8);
  return { weeklyContractual, weeklyOvertime: overtime, weeklyHoliday };
}

/** 간이세액표 조회 */
export function lookupIncomeTax(
  taxableMonthly: number,
  dependents: number,
  table: TaxBracketRow[]
): number {
  if (taxableMonthly <= 0 || table.length === 0) return 0;
  const thousands = Math.floor(taxableMonthly / 1000);
  const depIdx = Math.min(Math.max(dependents, 1), 11) - 1;
  // 정렬되어 있다고 가정하고 선형/이진 탐색
  let found: TaxBracketRow | undefined;
  for (const b of table) {
    const hi = b.hi ?? Infinity;
    if (thousands >= b.lo && thousands < hi) {
      found = b;
      break;
    }
  }
  if (!found) {
    // 최고 구간(초과) — 표의 마지막 수치 구간 사용
    found = table[table.length - 1];
  }
  const v = found.tax[depIdx];
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/**
 * 월 급여/사업소득 산정.
 * 반환값의 모든 금액은 '원' 단위 정수.
 */
export function computePayroll(
  emp: EmployeePayInput,
  month: MonthlyInput,
  rates: InsuranceRates,
  taxTable: TaxBracketRow[]
): PayrollResult {
  const notes: string[] = [];
  const { weeklyContractual, weeklyOvertime, weeklyHoliday } =
    computeWeeklyHours(emp.schedule);

  const monthlyStdHours =
    Math.max(weeklyContractual + weeklyHoliday, 0) * WEEKS_PER_MONTH;

  // --- 통상시급 ---
  let hourlyWage = 0;
  if (emp.payScheme === "HOURLY") {
    hourlyWage = emp.baseWage; // 시급 자체
  } else if (emp.payScheme === "RATIO") {
    hourlyWage = 0; // 비율제 프리랜서 — 통상시급 개념 미적용
  } else {
    // 월급제/인센티브: 통상임금(기본급) / 월소정환산시간
    hourlyWage = monthlyStdHours > 0 ? emp.baseWage / monthlyStdHours : 0;
  }
  hourlyWage = round0(hourlyWage);

  // --- 기본급 ---
  let baseP = 0;
  let weeklyHolidayP = 0;
  if (emp.payScheme === "HOURLY") {
    const monthHours =
      month.workedHours != null && month.workedHours > 0
        ? month.workedHours
        : weeklyContractual * WEEKS_PER_MONTH; // 스케줄 기반 추정
    baseP = round0(emp.baseWage * monthHours);
    // 시급제 주휴수당
    weeklyHolidayP = round0(emp.baseWage * weeklyHoliday * WEEKS_PER_MONTH);
    if (weeklyHoliday === 0)
      notes.push("주 15시간 미만으로 주휴수당 미발생");
  } else if (emp.payScheme === "RATIO") {
    const rev = month.classRevenue ?? 0;
    const pct = emp.ratioPercent ?? 0;
    baseP = round0(rev * pct);
    notes.push(
      `비율제: 매출 ${rev.toLocaleString()}원 × ${(pct * 100).toFixed(1)}%`
    );
  } else {
    // MONTHLY / INCENTIVE — 포괄임금(월 기본급 고정)
    baseP = round0(emp.baseWage);
  }

  // --- 인센티브 ---
  let incentiveP = 0;
  if (emp.payScheme === "INCENTIVE") {
    const th = emp.incThreshold ?? 0;
    const per = emp.incPerStudent ?? 0;
    const cnt = month.studentCount ?? 0;
    const over = Math.max(cnt - th, 0);
    incentiveP = round0(over * per);
    if (over > 0)
      notes.push(
        `인센티브: (학생 ${cnt} - 기준 ${th}) × ${per.toLocaleString()}원`
      );
  }
  incentiveP += month.incentiveManual ?? 0;

  // --- 연장/야간/휴일 (추가 근로, 월 입력) ---
  const otH = month.overtimeHours ?? 0;
  const nightH = month.nightHours ?? 0;
  const holH = month.holidayHours ?? 0;
  const overtimeP = round0(otH * hourlyWage * 1.5);
  const nightP = round0(nightH * hourlyWage * 0.5);
  const holidayP = round0(holH * hourlyWage * 1.5);

  // --- 수당 ---
  const positionP = emp.positionAllow || 0;
  const mealP = emp.mealAllow || 0;
  const carP = emp.carAllow || 0;
  const bonusP = month.bonus ?? 0;

  // --- 연차미사용수당 = 1일 통상임금(통상시급×8) × 미사용일수 ---
  const unusedLeaveP = round0((month.unusedLeaveDays ?? 0) * hourlyWage * 8);

  const gross =
    baseP +
    overtimeP +
    nightP +
    holidayP +
    weeklyHolidayP +
    positionP +
    mealP +
    carP +
    incentiveP +
    bonusP +
    unusedLeaveP;

  // 비과세 총액 (식대 + 차량유지비 + 기타)
  const nonTax = mealP + carP + (emp.nonTaxTotal ?? 0);
  const taxableGross = Math.max(gross - nonTax, 0);

  // --- 공제 ---
  let pensionD = 0,
    employmentD = 0,
    healthD = 0,
    longTermD = 0,
    incomeTaxD = 0,
    localTaxD = 0;

  if (emp.incomeType === "FREELANCE") {
    // 사업소득 3.3% (지급총액 기준)
    incomeTaxD = floor10(gross * rates.businessIncomeTax);
    localTaxD = floor10(incomeTaxD * rates.localIncomeTaxRate);
  } else {
    // 4대보험 (보수월액 = 과세급여 기준)
    const pensionBase = Math.min(
      Math.max(taxableGross, rates.pensionBaseMin),
      rates.pensionBaseMax
    );
    pensionD = floor10(pensionBase * rates.nationalPension);
    employmentD = floor10(taxableGross * rates.employment);
    healthD = floor10(taxableGross * rates.health);
    longTermD = floor10(healthD * rates.longTermCare);
    incomeTaxD = lookupIncomeTax(taxableGross, emp.dependents, taxTable);
    localTaxD = floor10(incomeTaxD * rates.localIncomeTaxRate);
  }

  const otherD = 0;
  const totalDeduct =
    pensionD +
    employmentD +
    healthD +
    longTermD +
    incomeTaxD +
    localTaxD +
    otherD;
  const net = gross - totalDeduct;

  return {
    hourlyWage,
    weeklyContractual,
    weeklyHoliday,
    monthlyStdHours: round0(monthlyStdHours),
    baseP,
    overtimeP,
    nightP,
    holidayP,
    weeklyHolidayP,
    positionP,
    mealP,
    carP,
    incentiveP,
    bonusP,
    unusedLeaveP,
    gross,
    pensionD,
    employmentD,
    healthD,
    longTermD,
    incomeTaxD,
    localTaxD,
    otherD,
    totalDeduct,
    net,
    taxableGross,
    notes,
  };
}
