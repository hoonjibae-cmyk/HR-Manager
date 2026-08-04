// 유쌤에듀 급여 산정 엔진
// 엑셀 '임금산정식' / '갑근세' / '임금(4대보험)' / '임금(3.3%)' 로직을 재현한 순수 함수.
// DB에 의존하지 않으므로 단위 테스트가 용이합니다.

import { ScheduleDay, isContractorContract } from "./constants";

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
  /**
   * 위탁계약(프리랜서) — 근로기준법 항목(주휴·연차·퇴직유보금·4대보험·법정가산)을 일절 적용하지 않고
   * 계약서의 시급 또는 비율로만 지급한다. 완전비율제(RATIO)는 플래그와 무관하게 항상 위탁으로 본다.
   */
  isContractor?: boolean | null;
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
  /** 포괄임금 기본급 산정시간(월) — 계약서 '기본급 (209시간)'. 없으면 스케줄 환산시간 */
  fixedBaseHours?: number | null;
  /** 포괄임금 약정 시간외근로시간(월) — 월 급여에 미리 포함된 시간 */
  fixedOtHours?: number | null;
  /** 포괄임금 약정 야간근로시간(월) */
  fixedNightHours?: number | null;
  // 비율제
  ratioPercent?: number | null;
  /** 위탁 최저보장액(월) — 만근 시 수수료가 이에 못 미쳐도 보장 (계약서 제5조) */
  ratioMinGuarantee?: number | null;
}

/** 인센티브 퇴직유보금 요율 — 확인서 기준 '인센티브 원천액의 8.3%'(= 1/12) */
export const RETENTION_RATE = 1 / 12;

/* ───────────── 월중 계약 변경(갱신) 일할 가중 ───────────── */

/** 한 달 안에서 특정 계약 조건이 적용된 구간 (역일수 기준) */
export interface WageSegment {
  days: number; // 해당 월 중 이 조건이 적용된 역일수 (재직기간과 교차한 일수)
  baseWage: number; // 월급제=월기본급, 시급제=시급
  positionAllow: number;
  mealAllow: number;
  carAllow: number;
  ratioPercent?: number | null;
  ratioMinGuarantee?: number | null;
}

export interface BlendedWage {
  baseWage: number;
  positionAllow: number;
  mealAllow: number;
  carAllow: number;
  ratioPercent: number | null;
}

/**
 * 월중 계약 갱신 시 임금 조건을 역일수 가중평균으로 환산.
 * 예) 30일 월: 기본급 300만(1~15일) + 400만(16~30일) → 350만.
 * 시급제는 시급에 동일 규칙 적용. 입/퇴사 일할계산(prorationRatio)과는
 * 독립 — 분모는 구간 일수의 합이므로 이중 일할이 되지 않는다.
 */
export function blendWageTerms(segments: WageSegment[]): BlendedWage | null {
  const segs = segments.filter((s) => s.days > 0);
  const total = segs.reduce((a, s) => a + s.days, 0);
  if (!total) return null;
  const avg = (pick: (s: WageSegment) => number) =>
    Math.round(segs.reduce((a, s) => a + pick(s) * s.days, 0) / total);
  const hasRatio = segs.some((s) => s.ratioPercent != null);
  return {
    baseWage: avg((s) => s.baseWage),
    positionAllow: avg((s) => s.positionAllow),
    mealAllow: avg((s) => s.mealAllow),
    carAllow: avg((s) => s.carAllow),
    ratioPercent: hasRatio
      ? segs.reduce((a, s) => a + (s.ratioPercent ?? 0) * s.days, 0) / total
      : null,
  };
}

/** 시간기록표 근거 — 계산에는 쓰이지 않고 명세서 표기용으로 breakdown 에 실려 간다 */
export interface TimesheetMeta {
  stayHours: number; // 학원 체류시간 (출근~퇴근)
  breakHours: number; // 차감 휴게시간
  netHours: number; // 순 근로시간 = 체류 − 휴게
  leaveHours: number; // 연차 유급 인정시간
  leaveDays: number;
  paidHours: number; // 급여 산정 기준 시간
  workedDays: number;
  breakPaid: boolean;
  dailyContractual: number;
}

export interface MonthlyInput {
  workedHours?: number | null; // 시급제 실근로시간(월). 없으면 스케줄로 추정
  weeklyHolidayHours?: number | null; // 시급제 주휴시간(월 합계) — 시간기록표 기반. 지정 시 스케줄 추정 대신 사용
  /** 시간기록표 근거 (명세서 표기용 — 금액 계산에는 쓰지 않는다) */
  timesheet?: TimesheetMeta | null;
  prorationRatio?: number; // 일할계산 비율(월중 입/퇴사). 1=만근월. 월급·수당·추정근로시간에 적용
  extraHours?: number; // 법내연장(월): 소정 외이나 1일8h·주40h 이내 — 가산 없음(×1.0)
  overtimeHours?: number; // 법정 연장근로(월): 1일8h·주40h 초과분 — ×1.5
  nightHours?: number; // 야간근로(월, 22~06시) — +0.5 가산
  holidayHours?: number; // 휴일근로(월, 주휴일·공휴일) 8시간 이내 — ×1.5
  holidayOverHours?: number; // 휴일근로 중 1일 8시간 초과분 — ×2.0 (근로기준법 §56②)
  studentCount?: number | null; // 인센티브용 (명단 없을 때 수동 입력 정수)
  /** 인센티브 가중 인원 — 학생 명단 기반. 월중 입학·전출·퇴원은 회차 비례(0~1)로
   *  환산되므로 소수. 지정 시 studentCount 대신 사용한다. */
  studentUnits?: number | null;
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
  extraP: number; // 추가근로수당(법내연장, ×1.0)
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
  retentionD: number; // 퇴직유보금 (인센티브×8.3%)
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

/* ───────────── 포괄임금(고정OT) 분해 ───────────── */

/** 포괄임금 분해에 필요한 계약 조건 */
export interface InclusiveWageTerms {
  /** 월 지급 총액(기준급여) — 식대·차량유지비(비과세)가 이 안에 포함된다 */
  baseWage: number;
  mealAllow?: number | null;
  carAllow?: number | null;
  /** 기본급 산정시간(월). 계약서 '기본급 (209시간)'. 없으면 스케줄 환산시간 */
  baseHours: number;
  /** 약정(고정) 시간외근로시간(월) */
  otHours?: number | null;
  /** 약정(고정) 야간근로시간(월) */
  nightHours?: number | null;
  /** 일할계산 비율 (월중 입·퇴사). 기본 1 */
  prorate?: number;
}

/** 계약서 제4조 ① 의 임금 항목 분해 결과 */
export interface InclusiveWageBreakdown {
  hourlyWage: number; // 통상시급(표시용 반올림)
  exactHourly: number; // 반올림 전 — 분해에 사용
  baseHours: number;
  otHours: number;
  nightHours: number;
  /** 약정(고정) 시간외근로수당 */
  overtimePay: number;
  /** 약정(고정) 야간근로수당 */
  nightPay: number;
  /** 기본급(과세) — 총액에서 비과세·약정수당을 뺀 잔액 */
  basePay: number;
  nonTax: number; // 식대+차량유지비
  hasFixed: boolean;
  /**
   * 이 분해가 맞춰야 할 월 지급 총액 = round0(기준급여 × 일할비율).
   * `basePay + nonTax(반올림분) + overtimePay + nightPay` 가 항상 이 값과 정확히 같다.
   */
  target: number;
}

/**
 * 포괄임금 분해 — 계약서에 적힌 '기준급여' 를 기본급·시간외·야간으로 되돌린다.
 *
 *   통상시급 = 기준급여 ÷ (기본급 산정시간 + 1.5×약정 시간외 + 0.5×약정 야간)
 *   시간외(고정) = 통상시급 × 1.5 × 약정 시간외시간
 *   야간(고정)   = 통상시급 × 0.5 × 약정 야간시간
 *   기본급       = 기준급여 − 식대·차량유지비 − 시간외(고정) − 야간(고정)
 *
 * 기본급을 잔액으로 두므로 항목 합계는 언제나 기준급여와 정확히 일치한다.
 * 약정시간이 없으면 통상시급 = 기준급여 ÷ 기본급 산정시간 (기존 동작).
 * 계약서·급여명세서가 같은 결과를 쓰도록 두 곳에서 이 함수를 호출한다.
 */
export function inclusiveWageBreakdown(t: InclusiveWageTerms): InclusiveWageBreakdown {
  const otHours = Math.max(t.otHours ?? 0, 0);
  const nightHours = Math.max(t.nightHours ?? 0, 0);
  const hasFixed = otHours > 0 || nightHours > 0;
  const prorate = t.prorate ?? 1;
  const nonTax = (t.mealAllow || 0) + (t.carAllow || 0);

  const divisor = t.baseHours + 1.5 * otHours + 0.5 * nightHours;
  const exactHourly = divisor > 0 ? t.baseWage / divisor : 0;

  const overtimePay = round0(exactHourly * 1.5 * otHours * prorate);
  const nightPay = round0(exactHourly * 0.5 * nightHours * prorate);

  // 기본급은 '잔액' — **이미 반올림한** 항목들을 뺀 나머지로 둔다.
  // 반올림 전 값으로 빼면 각 항목이 흘린 소수점 잔차가 기본급에 남지 않고 합계에 새어
  // 계약 총액과 1원씩 어긋난다(3,400,000 → 3,399,999). 잔차는 전부 기본급이 흡수한다.
  //
  // 비과세(식대·차량유지비)도 급여 산정과 **같은 식**으로 반올림해야 맞물린다 —
  // computePayroll 의 mealP/carP 가 각각 round0(수당 × prorate) 이므로 여기서도 따로 반올림한다.
  const target = round0(t.baseWage * prorate); // 이 계약이 그 달에 지급해야 할 총액
  const nonTaxPaid =
    round0((t.mealAllow || 0) * prorate) + round0((t.carAllow || 0) * prorate);
  const basePay = Math.max(target - nonTaxPaid - overtimePay - nightPay, 0);

  return {
    hourlyWage: round0(exactHourly),
    exactHourly,
    baseHours: t.baseHours,
    otHours,
    nightHours,
    overtimePay,
    nightPay,
    basePay,
    nonTax,
    hasFixed,
    /** 이 분해가 맞춰야 할 월 지급 총액 (기본급 + 비과세 + 약정 시간외 + 약정 야간) */
    target,
  };
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

  // --- 위탁계약(프리랜서) — 근로기준법 항목을 일절 싣지 않는다 ---
  // 주휴(§55)·연차·퇴직유보금·4대보험·법정가산(§56)이 모두 빠지고 계약서의 시급/비율로만 지급한다.
  // 주 15시간을 넘겨도 마찬가지 — 15시간은 '근로자' 일 때 따지는 기준이다.
  const contractor = isContractorContract(emp);

  const monthlyStdHours =
    Math.max(weeklyContractual + weeklyHoliday, 0) * WEEKS_PER_MONTH;

  // --- 포괄임금 약정시간 (월급제/인센티브만) ---
  // 위탁계약은 법정가산 자체가 없어 포괄임금(고정OT) 개념도 성립하지 않는다.
  const isMonthlyScheme =
    !contractor && (emp.payScheme === "MONTHLY" || emp.payScheme === "INCENTIVE");
  const fixedOt = isMonthlyScheme ? emp.fixedOtHours ?? 0 : 0;
  const fixedNight = isMonthlyScheme ? emp.fixedNightHours ?? 0 : 0;
  const hasFixed = fixedOt > 0 || fixedNight > 0;
  // 기본급 산정시간 — 계약서에 적힌 값(예 209시간)이 있으면 그대로, 없으면 스케줄 환산
  const baseHours =
    isMonthlyScheme && emp.fixedBaseHours ? emp.fixedBaseHours : monthlyStdHours;

  // --- 일할계산 비율 (월중 입/퇴사). 비율제는 매출 기반이라 미적용 ---
  const rawRatio = month.prorationRatio ?? 1;
  const prorate =
    emp.payScheme === "RATIO" ? 1 : Math.min(Math.max(rawRatio, 0), 1);
  if (prorate < 1) notes.push(`일할계산 적용 (재직비율 ${(prorate * 100).toFixed(1)}%)`);

  // --- 포괄임금 분해 (월급제/인센티브) — 계약서 제4조와 같은 계산을 쓴다 ---
  const inclusive = inclusiveWageBreakdown({
    baseWage: emp.baseWage,
    mealAllow: emp.mealAllow,
    carAllow: emp.carAllow,
    baseHours,
    otHours: fixedOt,
    nightHours: fixedNight,
    prorate,
  });

  // --- 통상시급 ---
  let hourlyWage = 0;
  if (emp.payScheme === "HOURLY") {
    hourlyWage = emp.baseWage; // 시급 자체
  } else if (emp.payScheme === "RATIO") {
    hourlyWage = 0; // 비율제 프리랜서 — 통상시급 개념 미적용
  } else {
    // 월급제/인센티브: 기준급여 ÷ (소정 + 1.5×약정연장 + 0.5×약정야간).
    // 포괄임금 약정이 없으면 분모가 소정시간뿐이라 기존 계산과 같다.
    hourlyWage = inclusive.hourlyWage;
  }

  // --- 기본급 ---
  let baseP = 0;
  let weeklyHolidayP = 0;
  if (emp.payScheme === "HOURLY") {
    // 시간기록표를 올렸으면 그 실근로시간, 아니면 계약 근로시간표로 **추정**한다.
    // 추정치는 결근·지각·추가근무가 하나도 반영되지 않은 '만근 가정' 값이므로 명세서에 반드시 남긴다.
    const estimated = !(month.workedHours != null && month.workedHours > 0);
    const monthHours = estimated
      ? weeklyContractual * WEEKS_PER_MONTH * prorate // 스케줄 기반 추정
      : month.workedHours!; // 실제 근로시간 입력 시 그대로 사용(일할 이미 반영됨)
    baseP = round0(emp.baseWage * monthHours);
    if (estimated)
      notes.push(
        `⚠️ 시간기록표 미반영 — 계약 근로시간표로 추정했습니다 ` +
          `(주 ${weeklyContractual}시간 × ${WEEKS_PER_MONTH}주 = ${monthHours.toFixed(2)}시간, 만근 가정). ` +
          `실제 출퇴근 기록을 올리면 실근로 기준으로 다시 계산됩니다.`
      );
    // 시급제 주휴수당 — 요건은 lib/timesheet.ts 에서 **1주 단위**로 판정한다
    // (주5일 계약=계약 근무요일 개근 / 주2~4일=그 주 실근로 15시간, 둘 다 1주 근로관계 존속 필요)
    if (contractor) {
      // 위탁계약: 근로자가 아니므로 주휴 자체가 없다. 주 15시간을 넘겨도 마찬가지.
      weeklyHolidayP = 0;
      notes.push("위탁계약(프리랜서) — 주휴수당 미적용 (계약 시급으로만 지급)");
    } else if (month.weeklyHolidayHours != null) {
      weeklyHolidayP = round0(emp.baseWage * month.weeklyHolidayHours);
      notes.push(
        month.weeklyHolidayHours > 0
          ? `주휴수당: 주휴시간 ${month.weeklyHolidayHours.toFixed(2)}시간 (요건을 갖춘 주만 부여)`
          : "주휴수당: 요건을 갖춘 주가 없어 미발생 (계약 근무요일 개근 또는 주 15시간 이상)"
      );
    } else {
      weeklyHolidayP = round0(emp.baseWage * weeklyHoliday * WEEKS_PER_MONTH * prorate);
      if (weeklyHoliday === 0)
        notes.push("주휴수당: 계약 주 소정근로가 15시간 미만이라 미발생 (§18③ 초단시간)");
      else
        notes.push(
          `주휴수당: 계약 근로시간표 기준 추정 — 매주 요건을 갖춘 것으로 보고 ` +
            `주 ${weeklyHoliday}시간 × ${WEEKS_PER_MONTH}주로 계산했습니다. ` +
            `시간기록표를 올리면 주별로 다시 판정합니다.`
        );
    }
  } else if (emp.payScheme === "RATIO") {
    const rev = month.classRevenue ?? 0;
    const pct = emp.ratioPercent ?? 0;
    const fee = round0(rev * pct);
    const floor = emp.ratioMinGuarantee ?? 0;
    baseP = Math.max(fee, floor);
    notes.push(`비율제: 매출 ${rev.toLocaleString()}원 × ${(pct * 100).toFixed(1)}%`);
    if (floor > 0) {
      notes.push(
        baseP > fee
          ? `최저보장 적용: 산출 수수료 ${fee.toLocaleString()}원 → 보장액 ${floor.toLocaleString()}원 (만근 조건 충족 시)`
          : `최저보장 ${floor.toLocaleString()}원 — 산출 수수료가 이를 넘어 그대로 지급`
      );
    }
  } else {
    // MONTHLY / INCENTIVE — 포괄임금.
    // baseWage 는 '월 지급 총액'이며 식대·차량유지비(비과세)가 그 안에 포함돼 있다.
    // 명세서에는 과세 대상분만 기본급으로 싣고 비과세분은 아래에서 따로 표시한다.
    // (합계는 그대로 baseWage — 비과세 항목을 떼어내 세금만 줄이는 구조)
    const inclusiveNonTax = inclusive.nonTax;
    if (hasFixed) {
      // 포괄임금: 약정 시간외·야간분을 먼저 떼고 남는 것이 기본급.
      // (합계가 계약 총액과 정확히 맞도록 기본급을 잔액으로 둔다)
      baseP = inclusive.basePay;
      notes.push(
        `포괄임금 분해: 통상시급 ${hourlyWage.toLocaleString()}원 (기본급 산정 ${baseHours.toFixed(
          1
        )}시간` +
          (fixedOt ? ` · 약정 시간외 ${fixedOt}시간` : "") +
          (fixedNight ? ` · 약정 야간 ${fixedNight}시간` : "") +
          ")"
      );
      if (inclusiveNonTax > 0)
        notes.push(
          `기본급 ${emp.baseWage.toLocaleString()}원에 비과세 ${inclusiveNonTax.toLocaleString()}원(식대·차량유지비)이 포함되어 있습니다.`
        );
    } else if (inclusiveNonTax > emp.baseWage) {
      notes.push(
        `식대·차량유지비 합계(${inclusiveNonTax.toLocaleString()}원)가 기본급(${emp.baseWage.toLocaleString()}원)보다 큽니다 — 계약 조건을 확인하세요.`
      );
    } else if (inclusiveNonTax > 0) {
      notes.push(
        `기본급 ${emp.baseWage.toLocaleString()}원에 비과세 ${inclusiveNonTax.toLocaleString()}원(식대·차량유지비)이 포함되어 있어, 과세 대상 기본급은 ${(
          emp.baseWage - inclusiveNonTax
        ).toLocaleString()}원입니다.`
      );
    }
    if (!hasFixed) baseP = inclusive.basePay;
  }

  // --- 인센티브 ---
  let incentiveP = 0;
  if (emp.payScheme === "INCENTIVE") {
    const th = emp.incThreshold ?? 0;
    const per = emp.incPerStudent ?? 0;
    // 명단 기반 가중 인원(월중 입학·전출·퇴원 회차 비례)이 있으면 우선 사용
    const cnt = month.studentUnits ?? month.studentCount ?? 0;
    const over = Math.max(cnt - th, 0);
    incentiveP = round0(over * per);
    if (over > 0) {
      const cntTxt = Number.isInteger(cnt) ? String(cnt) : cnt.toFixed(3);
      notes.push(
        `인센티브: (학생 ${cntTxt}${month.studentUnits != null ? "명(가중)" : ""} - 기준 ${th}) × ${per.toLocaleString()}원`
      );
    }
  }
  incentiveP += month.incentiveManual ?? 0;

  // --- 추가(법내연장)/연장/야간/휴일 (월 입력) ---
  // 위탁계약은 §56 가산 대상이 아니라 시간이 입력돼 있어도 수당으로 잡지 않는다.
  const exH = contractor ? 0 : month.extraHours ?? 0;
  const otH = contractor ? 0 : month.overtimeHours ?? 0;
  const nightH = contractor ? 0 : month.nightHours ?? 0;
  const holH = contractor ? 0 : month.holidayHours ?? 0;
  const holOverH = contractor ? 0 : month.holidayOverHours ?? 0;
  const extraP = round0(exH * hourlyWage); // 법내연장 — 가산 없음
  // 포괄임금 약정분은 매월 고정 지급(일할 적용), 실적분은 그 위에 추가 가산
  const overtimeP = inclusive.overtimePay + round0(otH * hourlyWage * 1.5);
  const nightP = inclusive.nightPay + round0(nightH * hourlyWage * 0.5);
  // 휴일근로는 8시간까지 ×1.5, 그 초과분은 ×2.0 (근로기준법 §56②)
  const holidayP = round0(holH * hourlyWage * 1.5) + round0(holOverH * hourlyWage * 2);

  // --- 수당 (월 정액 수당은 일할 적용) ---
  // 식대·차량유지비는 월급제/인센티브에서는 기본급에서 이미 빼 두었으므로 여기서 더해도
  // 합계는 계약 총액 그대로다. 시급제·비율제는 기본급 개념이 달라 별도 가산으로 둔다.
  const positionP = round0((emp.positionAllow || 0) * prorate);
  const mealP = round0((emp.mealAllow || 0) * prorate);
  const carP = round0((emp.carAllow || 0) * prorate);
  const bonusP = month.bonus ?? 0;

  // --- 연차미사용수당 = 1일 통상임금(통상시급×8) × 미사용일수 ---
  // 위탁계약은 연차(§60) 자체가 없어 미사용수당도 없다.
  const unusedLeaveP = contractor
    ? 0
    : round0((month.unusedLeaveDays ?? 0) * hourlyWage * 8);

  const gross =
    baseP +
    extraP +
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

  // 위탁계약은 근로자가 아니라 4대보험 가입 대상이 아니므로, 세무구분이 실수로
  // EMPLOYEE 로 남아 있어도 보험료를 떼지 않는다 (사업소득 3.3% 로 처리).
  if (emp.incomeType === "FREELANCE" || contractor) {
    // 사업소득 3.3% (지급총액 기준)
    incomeTaxD = floor10(gross * rates.businessIncomeTax);
    localTaxD = floor10(incomeTaxD * rates.localIncomeTaxRate);
    if (contractor && emp.incomeType !== "FREELANCE")
      notes.push(
        "위탁계약(프리랜서)이라 4대보험을 공제하지 않고 사업소득 3.3%로 처리했습니다 — " +
          "계약의 세무구분을 '사업소득(3.3%)'으로 맞춰 주세요."
      );
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

  // --- 퇴직유보금: 인센티브 계약은 **인센티브와 상여금**의 1/12(8.3%)를 별도통장 송금(공제) ---
  // 상여금도 퇴직금 산정의 평균임금에 들어가므로 함께 적립한다(확인서 제6조).
  // 위탁계약은 퇴직급여 대상이 아니므로 유보하지 않는다.
  //
  // 다른 공제와 달리 **10원 절사를 하지 않고 원 단위로 반올림**한다 — 세무사무소에 넘기던
  // 기존 시트가 그렇게 적립해 왔다(상여 200,000원 → 16,667원. 절사하면 16,660원이 되어 어긋난다).
  // 유보금은 법정공제가 아니라 직원 몫으로 떼어 두는 돈이라 깎지 않는 쪽이 맞기도 하다.
  let retentionD = 0;
  if (!contractor && emp.payScheme === "INCENTIVE") {
    const incPart = Math.max(incentiveP, 0);
    const bonusPart = Math.max(bonusP, 0);
    const retentionBase = incPart + bonusPart;
    if (retentionBase > 0) {
      retentionD = round0(retentionBase * RETENTION_RATE);
      const parts = [
        incPart > 0 ? `인센티브 ${incPart.toLocaleString()}원` : "",
        bonusPart > 0 ? `상여금 ${bonusPart.toLocaleString()}원` : "",
      ].filter(Boolean);
      // 항목이 둘이면 괄호를 씌운다 — "인센티브 + 상여금 × 1/12" 로 읽히면 안 된다
      const basis = parts.length > 1 ? `(${parts.join(" + ")})` : parts[0];
      notes.push(
        `퇴직유보금: ${basis} × 1/12(8.3%) = ${retentionD.toLocaleString()}원 (별도통장 송금)`
      );
    }
  }

  const otherD = 0;
  const totalDeduct =
    pensionD +
    employmentD +
    healthD +
    longTermD +
    incomeTaxD +
    localTaxD +
    retentionD +
    otherD;
  const net = gross - totalDeduct;

  return {
    hourlyWage,
    weeklyContractual,
    weeklyHoliday,
    monthlyStdHours: round0(monthlyStdHours),
    baseP,
    extraP,
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
    retentionD,
    otherD,
    totalDeduct,
    net,
    taxableGross,
    notes,
  };
}
