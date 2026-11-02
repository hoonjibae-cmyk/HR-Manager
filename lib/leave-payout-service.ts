// 연차수당 정산·이월의 DB 어댑터 — 판정은 lib/leave-payout.ts(순수 함수, 테스트 있음)에 있고
// 여기서는 읽어 넘기기만 한다. 연차수당 상세(GET /api/payroll/leave-expiry)·이월 처리
// (POST /api/leave/carryover)·명세서의 이월 안내(genPayslip)가 같은 입력을 쓴다.

import { addYears } from "date-fns";
import { prisma } from "./db";
import { isLeaveEligible, type LeaveTxn } from "./leave";
import { computeWeeklyHours, dailyLeaveHours } from "./payroll";
import { parseSchedule } from "./constants";
import { kstTodayYmd } from "./format";
import {
  leavePeriodEndingIn,
  payoutRemaining,
  periodLastDay,
  ymd,
  type CarryoverInfo,
  type PayoutInput,
} from "./leave-payout";

const DAY = 86400000;

export type LeavePeriodEnding = NonNullable<ReturnType<typeof leavePeriodEndingIn>>;

export interface PayoutRowMeta {
  employeeId: number;
  name: string;
  hireDate: Date;
  /** 그 달에 끝나는 연차기간 — 없으면 이월 대상이 아니다 */
  ending: LeavePeriodEnding | null;
  payrollId: number;
  payrollStatus: string;
}

/**
 * 그 달 급여 시트에 오른 직원의 정산 입력값. **시트에 없는 사람은 보지 않는다** — 제안해 봐야
 * 넣을 자리가 없다. 연차 원장을 전부 훑으므로 급여 목록 조회에 얹지 않고 따로 부른다.
 */
export async function payoutRowsFor(
  year: number,
  month: number,
  employeeIds?: number[]
): Promise<{ rows: PayoutInput[]; meta: Map<number, PayoutRowMeta> }> {
  const records = await prisma.payrollRecord.findMany({
    where: { year, month, ...(employeeIds?.length ? { employeeId: { in: employeeIds } } : {}) },
    include: { employee: true },
  });
  const meta = new Map<number, PayoutRowMeta>();
  if (!records.length) return { rows: [], meta };

  const empIds = records.map((r) => r.employeeId);
  const txns = await prisma.leaveTransaction.findMany({
    where: { employeeId: { in: empIds } },
    orderBy: { date: "asc" },
  });
  const byEmp = new Map<number, LeaveTxn[]>();
  for (const t of txns) {
    const arr = byEmp.get(t.employeeId) ?? [];
    arr.push({
      date: t.date,
      days: t.days,
      type: t.type as any,
      category: (t as any).category ?? "STATUTORY",
      note: t.note ?? undefined,
    });
    byEmp.set(t.employeeId, arr);
  }

  // 퇴사 정산의 초과사용 공제 근거 — 살아 있는(승인·취소 요청 중) 신청의 동의 기록만 센다.
  // 반려·취소된 신청은 그 초과가 실제로 일어나지 않았으므로 근거가 아니다.
  const consentRows = await prisma.leaveRequest.findMany({
    where: {
      employeeId: { in: empIds },
      overdraftConsentAt: { not: null },
      status: { in: ["APPROVED", "CANCEL_PENDING"] },
    },
    select: { id: true, employeeId: true },
    orderBy: { startDate: "asc" },
  });
  const consentsOf = new Map<number, number[]>();
  for (const c of consentRows) consentsOf.set(c.employeeId, [...(consentsOf.get(c.employeeId) ?? []), c.id]);

  const rows: PayoutInput[] = records.map((r) => {
    const e = r.employee;
    const { weeklyContractual } = computeWeeklyHours(parseSchedule(e.schedule));
    const eligible = isLeaveEligible(weeklyContractual, (e as any).leaveEligible);
    const list = byEmp.get(e.id) ?? [];
    // 기준 시점(퇴사일 / 그 달에 끝나는 기간의 마지막 날 / 말일)과 잔여는 `payoutRemaining` 하나가
    // 정한다 — 말일 시점의 '지금 기간' 으로 가리면 입사일이 1일인 사람만 잡힌다(lib/leave-payout.ts).
    const { periodEnd, remaining, carriedDays } = payoutRemaining(e.hireDate, year, month, list, {
      eligible,
      resignDate: e.resignDate,
    });
    meta.set(e.id, {
      employeeId: e.id,
      name: e.name,
      hireDate: e.hireDate,
      ending: leavePeriodEndingIn(e.hireDate, year, month),
      payrollId: r.id,
      payrollStatus: r.status,
    });
    return {
      employeeId: e.id,
      name: e.name,
      eligible,
      periodEnd,
      resignDate: e.resignDate,
      remaining,
      carriedDays,
      alreadyDays: r.unusedLeaveDays ?? 0,
      hourlyWage: r.hourlyWage ?? 0,
      // 엔진과 같은 함수로 구한다 — 미리보기 금액과 실제 명세서가 원 단위까지 같아야 한다
      dailyHours: dailyLeaveHours(parseSchedule(e.schedule)),
      consentRequestIds: consentsOf.get(e.id) ?? [],
    };
  });
  return { rows, meta };
}

/** 그 달에 끝난 연차기간과 이월분이 사는 다음 기간의 앞뒤 날짜 — 이월 메모·명세서 안내에 쓴다 */
export function carryoverPeriods(ending: LeavePeriodEnding): Omit<CarryoverInfo, "days" | "processedOn"> {
  return {
    periodStart: ymd(addYears(ending.endExclusive, -1)),
    periodEnd: ymd(ending.lastDay),
    nextStart: ymd(ending.endExclusive),
    nextEnd: ymd(periodLastDay(addYears(ending.endExclusive, 1))),
  };
}

/** 그 기념일 날짜(00:00 ~ 다음날 00:00 전)로 적힌 이월 줄 — 날짜 비교는 하루 범위로 해 시각 잡음을 탄다 */
export function carryoverWhere(employeeId: number, endExclusive: Date) {
  return {
    employeeId,
    type: "CARRYOVER",
    days: { gt: 0 },
    date: { gte: endExclusive, lt: new Date(endExclusive.getTime() + DAY) },
  } as const;
}

/**
 * 그 달 명세서에 적을 이월 내용 — 그 달에 끝난 연차기간의 기념일 날짜로 적힌 이월 줄을 모은다. 없으면 null.
 * **원장이 진실**이라 이월을 되돌리면(줄 삭제) 다시 뽑는 명세서에서도 사라진다. 이미 발송된 PDF 는 안 바뀐다.
 */
export async function carryoverFor(
  employeeId: number,
  hireDate: Date,
  year: number,
  month: number
): Promise<CarryoverInfo | null> {
  const ending = leavePeriodEndingIn(hireDate, year, month);
  if (!ending) return null;
  const rows = await prisma.leaveTransaction.findMany({
    where: carryoverWhere(employeeId, ending.endExclusive),
    orderBy: { createdAt: "asc" },
  });
  if (!rows.length) return null;
  const days = Math.round(rows.reduce((a, r) => a + r.days, 0) * 10) / 10;
  return { days, ...carryoverPeriods(ending), processedOn: kstTodayYmd(rows[0].createdAt) };
}
