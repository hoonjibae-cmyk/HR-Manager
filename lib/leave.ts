// 유쌤에듀 연차(annual leave) 엔진 — 근로기준법 제60조 기준
//
// 규칙:
//  - 입사 1년 미만: 1개월 개근 시 1일씩 발생 (최대 11일). 발생일로부터 사용, 입사일 기준 1년 내 소멸.
//  - 1년(80% 이상 출근): 15일.
//  - 3년 이상: 매 2년마다 1일 가산, 최대 25일.  → 15 + floor((근속연수-1)/2), 상한 25.
//  - 회사 정책상 '입사일 기준(anniversary)'으로 산정 (근로계약서 제6조①).
//  - 발생 연차는 발생일로부터 1년간 사용, 미사용분은 소멸(수당 정산 대상).

import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  isAfter,
  isBefore,
  isEqual,
} from "date-fns";

export interface LeaveTxn {
  date: Date;
  days: number; // +발생 / -사용 (여기서는 사용/조정만 입력)
  type: "USE" | "ADJUST" | "PAYOUT" | "GRANT" | "EXPIRE";
  /** STATUTORY(본래 연차, 기본) | COMP(대체휴일 보상연차) */
  category?: string;
  note?: string;
}

function isComp(t: LeaveTxn): boolean {
  return (t.category ?? "STATUTORY") === "COMP";
}

export interface Lot {
  grantDate: Date;
  expiryDate: Date;
  days: number; // 발생일수
  source: "MONTHLY" | "ANNUAL" | "ADJUST";
  serviceYear: number; // 0 = 1년 미만
  remaining: number; // FIFO 차감 후 잔여
  used: number;
  expiredLost: number; // 소멸된 미사용분
}

/**
 * '이번 연차기간' — 입사일 기준 1년 단위. 직원이 실제로 체감하는 단위는
 * 입사 후 누계가 아니라 지금 쓸 수 있는 이 기간의 발생/사용/잔여다.
 */
export interface LeavePeriod {
  start: Date; // 기간 시작 (입사기념일)
  end: Date; // 기간 마지막 날 = 사용기한 (다음 발생일 −1일)
  serviceYear: number; // 1 = 입사 1년차(1년 미만), 2 = 2년차 …
  label: string; // "6년차"
  granted: number; // 이 기간에 발생한 일수
  carriedOver: number; // 이전 기간에서 넘어와 아직 유효한 잔여 (보통 0)
  used: number; // 이 기간에 사용한 일수 (승인된 미래 휴가 포함)
  remaining: number; // 지금 쓸 수 있는 잔여
  scheduled: number; // 이 기간에 앞으로 더 발생할 예정 일수 (1년 미만 월 개근분)
}

export interface LeaveSummary {
  asOf: Date;
  hireDate: Date;
  /** 법정 연차 발생 대상인가 (주 15시간 미만·계약상 미적용이면 false) */
  eligible: boolean;
  serviceYears: number; // 완성 근속연수
  serviceLabel: string;
  granted: number; // 발생 누계 (asOf까지)
  used: number; // 사용 누계
  expired: number; // 소멸 누계
  remaining: number; // 현재 사용가능 잔여
  /** 이번 연차기간 기준 현황 — 화면·슬랙은 이쪽을 우선 표시한다 */
  period: LeavePeriod;
  lots: Lot[];
  nextGrantDate: Date | null;
  nextGrantDays: number | null;
}

/** asOf 가 속한 연차기간 [시작, 끝(exclusive)) — 입사일 기준 */
export function currentLeavePeriod(
  hireDate: Date,
  asOf: Date
): { start: Date; endExclusive: Date; serviceYear: number } {
  const firstYearEnd = addYears(hireDate, 1);
  if (isBefore(asOf, firstYearEnd)) {
    return { start: hireDate, endExclusive: firstYearEnd, serviceYear: 1 };
  }
  const years = completedServiceYears(hireDate, asOf);
  return {
    start: addYears(hireDate, years),
    endExclusive: addYears(hireDate, years + 1),
    serviceYear: years + 1,
  };
}

/** 근속연수(>=1)에 대한 연차 발생일수 */
export function annualLeaveDays(serviceYears: number): number {
  if (serviceYears < 1) return 0;
  return Math.min(15 + Math.floor((serviceYears - 1) / 2), 25);
}

/** 완성 근속연수 (몇 번째 입사기념일을 지났는지) */
export function completedServiceYears(hireDate: Date, asOf: Date): number {
  let y = 0;
  while (!isBefore(asOf, addYears(hireDate, y + 1))) y++;
  return y;
}

function serviceLabel(hireDate: Date, asOf: Date): string {
  const total = differenceInCalendarDays(asOf, hireDate);
  if (total < 0) return "입사 전";
  const years = Math.floor(total / 365);
  const months = Math.floor((total % 365) / 30);
  if (years <= 0 && months <= 0) return "입사 " + total + "일";
  if (years <= 0) return `${months}개월`;
  return `${years}년 ${months}개월`;
}

/**
 * 연차·주휴 적용 최소 소정근로시간 (근로기준법 제18조 제3항).
 * 4주 평균 1주 소정근로시간이 15시간 미만인 초단시간근로자에게는
 * 제55조(주휴)와 제60조(연차)가 적용되지 않는다.
 */
export const MIN_WEEKLY_HOURS_FOR_LEAVE = 15;

/**
 * 이 직원에게 법정 연차가 발생하는가.
 * override 가 true/false 면 그대로 따르고(계약상 별도 정함), null/undefined 면
 * 주 소정근로시간으로 판단한다.
 */
export function isLeaveEligible(
  weeklyContractual: number,
  override?: boolean | null
): boolean {
  if (override === true || override === false) return override;
  return weeklyContractual >= MIN_WEEKLY_HOURS_FOR_LEAVE;
}

/**
 * 입사일과 기준일로부터 법정 연차 발생 lot 목록 생성.
 * (실제 출근율 80%/개근은 true 가정 — 미출근 반영은 별도 조정으로 처리)
 */
export function generateGrants(hireDate: Date, asOf: Date): Lot[] {
  const lots: Lot[] = [];
  if (isBefore(asOf, hireDate)) return lots;

  // 1) 입사 1년 미만: 매월 개근 1일 (최대 11일)
  const firstYearEnd = addYears(hireDate, 1);
  for (let m = 1; m <= 11; m++) {
    const g = addMonths(hireDate, m);
    if (isAfter(g, asOf)) break;
    if (!isBefore(g, firstYearEnd)) break; // 1년 시점부터는 연차로 전환
    lots.push({
      grantDate: g,
      expiryDate: firstYearEnd, // 입사일 기준 1년 내 사용
      days: 1,
      source: "MONTHLY",
      serviceYear: 0,
      remaining: 1,
      used: 0,
      expiredLost: 0,
    });
  }

  // 2) 각 입사기념일마다 연차 발생 (1년차=15일, 이후 가산)
  const years = completedServiceYears(hireDate, asOf);
  for (let y = 1; y <= years; y++) {
    const g = addYears(hireDate, y);
    const days = annualLeaveDays(y);
    lots.push({
      grantDate: g,
      expiryDate: addYears(g, 1),
      days,
      source: "ANNUAL",
      serviceYear: y,
      remaining: days,
      used: 0,
      expiredLost: 0,
    });
  }

  lots.sort((a, b) => a.grantDate.getTime() - b.grantDate.getTime());
  return lots;
}

/** 수동 조정(ADJUST +) 을 lot 으로 추가 */
function adjustLots(txns: LeaveTxn[]): Lot[] {
  return txns
    .filter((t) => t.type === "ADJUST" && t.days > 0)
    .map((t) => ({
      grantDate: t.date,
      expiryDate: addYears(t.date, 1),
      days: t.days,
      source: "ADJUST" as const,
      serviceYear: -1,
      remaining: t.days,
      used: 0,
      expiredLost: 0,
    }));
}

/**
 * FIFO 로 사용/소멸 반영하여 연차 현황 요약.
 * txns: 사용(USE, days<0 또는 양수 일수) 및 조정(ADJUST).
 *       USE 의 days 는 '사용일수(양수)'로 입력받는다.
 */
export function summarizeLeave(
  hireDate: Date,
  asOf: Date,
  txns: LeaveTxn[],
  opts: {
    /**
     * 법정 연차 발생 대상 여부. false 면 자동 발생분을 만들지 않는다
     * (주 15시간 미만 초단시간근로자·계약상 연차 미적용).
     * 관리자가 수동으로 부여한 분(ADJUST +)은 그대로 살린다.
     */
    eligible?: boolean;
  } = {}
): LeaveSummary {
  const eligible = opts.eligible !== false;
  // 대휴(COMP)는 별도 풀(summarizeComp)로 집계 — 본래 연차 계산에서 제외
  const statTxns = txns.filter((t) => !isComp(t));
  const lots = [
    ...(eligible ? generateGrants(hireDate, asOf) : []),
    ...adjustLots(statTxns),
  ].sort((a, b) => a.grantDate.getTime() - b.grantDate.getTime());

  // 사용 이벤트(날짜순)
  const uses = statTxns
    .filter((t) => t.type === "USE" || t.type === "PAYOUT")
    .map((t) => ({ date: t.date, days: Math.abs(t.days) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // 이번 연차기간 — lot/사용을 기간별로 나눠 집계하기 위해 먼저 구한다
  const period = currentLeavePeriod(hireDate, asOf);
  const inPeriod = (d: Date) =>
    !isBefore(d, period.start) && isBefore(d, period.endExclusive);
  const usedInThisPeriod: number[] = lots.map(() => 0); // lots 와 같은 인덱스

  // 부여분이 하나도 없을 때의 사용분 (lot 에 실을 수 없어 따로 센다)
  let overdraft = 0;
  let overdraftInPeriod = 0;

  // FIFO: 각 사용을 '사용시점에 유효한 가장 오래된 lot'에서 차감
  for (const use of uses) {
    let need = use.days;
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (need <= 0) break;
      // lot 발생 이전이거나 이미 소멸된 lot 은 사용 불가
      if (isAfter(lot.grantDate, use.date)) continue;
      if (!isAfter(lot.expiryDate, use.date)) continue; // 소멸됨
      const take = Math.min(lot.remaining, need);
      lot.remaining -= take;
      lot.used += take;
      if (inPeriod(use.date)) usedInThisPeriod[i] += take;
      need -= take;
    }
    // need>0 이면 초과사용(마이너스 잔여) — 마지막 lot 에서 차감 처리
    if (need > 0 && lots.length > 0) {
      const last = lots.length - 1;
      lots[last].remaining -= need;
      lots[last].used += need;
      if (inPeriod(use.date)) usedInThisPeriod[last] += need;
    } else if (need > 0) {
      // 발생분(lot)이 하나도 없는데 사용한 경우 — 입사 직후 선사용 등.
      // 여기서 버리면 사용 내역이 통째로 사라지므로 따로 모아 둔다.
      overdraft += need;
      if (inPeriod(use.date)) overdraftInPeriod += need;
    }
  }

  // 소멸 처리 (asOf 기준 만료된 lot 의 잔여)
  for (const lot of lots) {
    if (!isAfter(lot.expiryDate, asOf) && lot.remaining > 0) {
      lot.expiredLost = lot.remaining;
      lot.remaining = 0;
    }
  }

  const granted = lots.reduce((s, l) => s + l.days, 0);
  const used = lots.reduce((s, l) => s + l.used, 0) + overdraft;
  const expired = lots.reduce((s, l) => s + l.expiredLost, 0);
  const remaining =
    lots
      .filter((l) => isAfter(l.expiryDate, asOf))
      .reduce((s, l) => s + l.remaining, 0) - overdraft;

  // 이번 연차기간 집계
  let periodGranted = 0;
  let periodCarried = 0;
  let periodUsed = overdraftInPeriod;
  lots.forEach((l, i) => {
    periodUsed += usedInThisPeriod[i];
    if (inPeriod(l.grantDate)) periodGranted += l.days;
    else if (isAfter(l.expiryDate, period.start)) {
      // 이전 기간 발생분이 아직 살아서 넘어온 경우 (기간 시작 시점의 잔여)
      periodCarried += l.remaining + usedInThisPeriod[i] + l.expiredLost;
    }
  });
  // 1년 미만은 매월 개근분이 앞으로 더 발생한다 (최대 11일)
  const monthlyGranted = lots
    .filter((l) => l.source === "MONTHLY")
    .reduce((s, l) => s + l.days, 0);
  const scheduled =
    eligible && period.serviceYear === 1 ? Math.max(0, 11 - monthlyGranted) : 0;

  // 다음 발생 예정
  const years = completedServiceYears(hireDate, asOf);
  let nextGrantDate: Date | null = null;
  let nextGrantDays: number | null = null;
  const firstYearEnd = addYears(hireDate, 1);
  if (!eligible) {
    // 발생 대상이 아니면 예정도 없다
  } else if (isBefore(asOf, firstYearEnd)) {
    // 1년 미만: 다음 달 개근 1일
    for (let m = 1; m <= 11; m++) {
      const g = addMonths(hireDate, m);
      if (isAfter(g, asOf) && isBefore(g, firstYearEnd)) {
        nextGrantDate = g;
        nextGrantDays = 1;
        break;
      }
    }
    if (!nextGrantDate) {
      nextGrantDate = firstYearEnd;
      nextGrantDays = annualLeaveDays(1);
    }
  } else {
    nextGrantDate = addYears(hireDate, years + 1);
    nextGrantDays = annualLeaveDays(years + 1);
  }

  return {
    asOf,
    hireDate,
    eligible,
    serviceYears: years,
    serviceLabel: serviceLabel(hireDate, asOf),
    granted,
    used,
    expired,
    remaining,
    period: {
      start: period.start,
      end: addDays(period.endExclusive, -1),
      serviceYear: period.serviceYear,
      label: `${period.serviceYear}년차`,
      granted: periodGranted,
      carriedOver: periodCarried,
      used: periodUsed,
      remaining,
      scheduled,
    },
    lots,
    nextGrantDate,
    nextGrantDays,
  };
}

/** 대체휴일 보상연차(대휴) 요약 — 운영자 수동 부여(GRANT/ADJUST±), 사용(USE) */
export interface CompSummary {
  granted: number;
  used: number;
  remaining: number;
}

export function summarizeComp(txns: LeaveTxn[], asOf?: Date): CompSummary {
  let granted = 0;
  let used = 0;
  for (const t of txns) {
    if (!isComp(t)) continue;
    if (asOf && isAfter(t.date, asOf)) continue;
    if (t.type === "USE" || t.type === "PAYOUT") used += Math.abs(t.days);
    else granted += t.days; // GRANT/ADJUST — 음수 조정 허용
  }
  return { granted, used, remaining: granted - used };
}

/** 기간 내 사용일수 (본래 연차 / 대휴 구분) */
export function usedInPeriod(
  txns: LeaveTxn[],
  from: Date,
  to: Date
): { statutory: number; comp: number } {
  let statutory = 0;
  let comp = 0;
  for (const t of txns) {
    if (t.type !== "USE" && t.type !== "PAYOUT") continue;
    if (isBefore(t.date, from) || isAfter(t.date, to)) continue;
    if (isComp(t)) comp += Math.abs(t.days);
    else statutory += Math.abs(t.days);
  }
  return { statutory, comp };
}

/** 두 날짜 사이 연차 사용일수 계산 (주말/공휴일 제외, 반차 0.5 지원) */
export function countLeaveDays(
  start: Date,
  end: Date,
  opts: { half?: boolean; holidays?: Date[] } = {}
): number {
  if (opts.half) return 0.5;
  const holidaySet = new Set(
    (opts.holidays ?? []).map((d) => d.toISOString().slice(0, 10))
  );
  let days = 0;
  let cur = new Date(start);
  while (!isAfter(cur, end)) {
    const dow = cur.getDay();
    const key = cur.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(key)) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export { isEqual };
