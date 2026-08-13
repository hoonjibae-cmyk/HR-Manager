// 그 달에 **연차기간이 끝나는 직원**과 미사용 연차수당 제안.
//
// 급여 화면이 행마다 배지를 띄우고 '연차 수당 반영' 버튼을 여는 데 쓴다.
// 판정·계산은 lib/leave-payout.ts(순수 함수, 테스트 있음)에 있고 여기서는 읽어 넘기기만 한다.
//
// **급여 목록과 따로 부른다** — 연차 잔여를 내려면 전 직원의 연차 원장을 훑어야 해서
// 급여 목록(자주 다시 부른다)에 얹으면 화면이 매번 느려진다.

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  summarizeLeave,
  currentLeavePeriod,
  isLeaveEligible,
  type LeaveTxn,
} from "@/lib/leave";
import { computeWeeklyHours } from "@/lib/payroll";
import { parseSchedule } from "@/lib/constants";
import { payoutSuggestions, periodLastDay, type PayoutInput } from "@/lib/leave-payout";
import { runPayrollMonth, type PayrollInputMap } from "@/lib/payroll-service";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });

  // 그 달 급여 시트에 오른 사람만 본다 — 시트에 없는 사람에게 제안해 봐야 넣을 자리가 없다
  const records = await prisma.payrollRecord.findMany({
    where: { year, month },
    include: { employee: true },
  });
  if (!records.length) return NextResponse.json({ year, month, suggestions: [] });

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

  /*
   * 기준 시점은 **그 달의 마지막 날**이다.
   * 연차기간이 그 달 안에서 끝나므로, 월초를 기준으로 잡으면 아직 발생하지 않은 월 개근분이
   * 빠지고 기간이 하나 앞으로 밀려 잡힌다.
   */
  const asOf = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  const rows: PayoutInput[] = records.map((r) => {
    const e = r.employee;
    const { weeklyContractual } = computeWeeklyHours(parseSchedule(e.schedule));
    const eligible = isLeaveEligible(weeklyContractual, (e as any).leaveEligible);
    const list = byEmp.get(e.id) ?? [];
    const s = summarizeLeave(e.hireDate, asOf, list, { eligible });
    const { endExclusive } = currentLeavePeriod(e.hireDate, asOf);
    return {
      employeeId: e.id,
      name: e.name,
      eligible,
      periodEnd: periodLastDay(endExclusive),
      remaining: s.period.remaining,
      alreadyDays: r.unusedLeaveDays ?? 0,
      hourlyWage: r.hourlyWage ?? 0,
    };
  });

  return NextResponse.json({ year, month, suggestions: payoutSuggestions(rows, year, month) });
}

/**
 * 고른 직원의 **미사용 연차 일수를 급여에 넣고 다시 산정**한다.
 *
 * ⚠ **그 행에 이미 들어 있는 입력값을 함께 실어 보낸다.** `runPayrollMonth` 는 넘기지 않은
 * 항목을 보존하려 애쓰지만 오버타임 시간처럼 원장에서 다시 채우는 값이 있어, 손으로 넣어 둔
 * 시간이 이 경로에서 조용히 0 이 될 수 있다. 기존 값을 그대로 다시 넣어 그 여지를 없앤다.
 *
 * 발송(SENT)된 달은 `runPayrollMonth` 가 알아서 건드리지 않는다 — 명세서가 이미 나갔으므로
 * 잠금 해제를 거쳐야 한다. 여기서는 그런 행을 골라내 몇 건인지 알려 준다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}) as any);
  const year = Number(body.year);
  const month = Number(body.month);
  const items: Array<{ employeeId: number; days: number }> = Array.isArray(body.items) ? body.items : [];
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });
  if (!items.length) return NextResponse.json({ error: "반영할 직원을 고르세요" }, { status: 400 });

  const wanted = new Map(items.map((i) => [Number(i.employeeId), Number(i.days)]));
  const records = await prisma.payrollRecord.findMany({
    where: { year, month, employeeId: { in: [...wanted.keys()] } },
    include: { employee: { select: { name: true } } },
  });

  const locked = records.filter((r) => r.status === "SENT");
  const open = records.filter((r) => r.status !== "SENT");
  if (!open.length)
    return NextResponse.json(
      { error: "고른 행이 모두 발송 완료 상태입니다. '발송 잠금 해제' 후 다시 시도하세요." },
      { status: 400 }
    );

  const inputs: PayrollInputMap = {};
  for (const r of open) {
    const days = wanted.get(r.employeeId);
    if (days == null || !Number.isFinite(days)) continue;
    // 그 행의 현재 입력값 그대로 + 미사용 일수만 교체
    inputs[r.employeeId] = {
      extraHours: r.extraHours,
      overtimeHours: r.overtimeHours,
      holidayHours: r.holidayHours,
      holidayOverHours: r.holidayOverHours,
      nightHours: r.nightHours,
      studentCount: r.studentCount,
      classRevenue: r.classRevenue,
      bonus: r.bonus,
      incentiveManual: r.incentiveManual,
      unusedLeaveDays: Math.max(0, Math.round(days * 10) / 10),
    } as any;
  }

  const ids = Object.keys(inputs).map(Number);
  await runPayrollMonth(year, month, inputs, ids);

  const names = open.map((r) => r.employee?.name).filter(Boolean).join(", ");
  const totalDays = ids.reduce((a, id) => a + ((inputs[id] as any).unusedLeaveDays ?? 0), 0);
  await logActivity({
    action: "PAYROLL_EDIT",
    target: `${year}-${String(month).padStart(2, "0")}`,
    summary: `미사용 연차수당을 ${ids.length}명(${Math.round(totalDays * 10) / 10}일)에게 반영했습니다. ${names}`,
    meta: { ids, totalDays },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    applied: ids.length,
    skippedSent: locked.map((r) => r.employee?.name ?? String(r.employeeId)),
  });
}
