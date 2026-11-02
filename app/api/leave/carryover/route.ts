// 미사용 연차를 **수당 대신 다음 연차기간으로 이월**한다 (연차수당 상세의 *이월 처리*).
//
// 원장(`LeaveTransaction`)에 `CARRYOVER` 줄을 **다음 기간 첫날(입사기념일) 날짜**로 적는다 —
// 엔진(lib/leave.ts)이 그 날부터 1년짜리 이월 lot 으로 살리고, 같은 날 만료된 lot 의 '소멸' 을
// 그만큼 '이월' 로 바꾼다. 급여는 건드리지 않는다. 되돌리는 길은 직원별 연차 내역의 ✕(줄 삭제)다.
//
// - **근로자 동의 확인**(`consent: true`)이 있어야 한다 — 미사용 연차는 수당 지급이 원칙이라
//   동의 없이 이월하면 수당 미지급(체불)이 된다. 확인한 사람(관리자)을 메모와 이력에 남긴다.
// - **기간이 끝난 다음 날부터**만 된다(`carryoverPlan`) — 그 전엔 잔여가 아직 움직인다.
// - 이미 수당으로 넣은(`alreadyDays`)·이월한(`carriedDays`) 만큼은 뺀 나머지만 이월한다.
//   같은 직원을 두 번 눌러도 잠금 안에서 다시 세어 넘치지 않는다.
// - 그 달 명세서(genPayslip)가 이월 안내를 싣는다 — **이미 발송된 명세서에는 실리지 않으므로**
//   그런 사람은 응답에 따로 적어 화면이 알린다(잠금 해제 → 정정 재발송).

import { NextResponse } from "next/server";
import { currentHrUser, isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { kstTodayYmd } from "@/lib/format";
import { withEmployeeLeaveLock } from "@/lib/leave-lock";
import {
  CARRYOVER_BLOCK_LABEL,
  carriedOverDays,
  carryoverPlan,
  carryoverTxnNote,
  payoutSuggestions,
} from "@/lib/leave-payout";
import { carryoverPeriods, carryoverWhere, payoutRowsFor } from "@/lib/leave-payout-service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 동의를 확인한 사람의 이름을 메모·이력에 남기려고 신원까지 받는다 (isAuthed 와 같은 원장 대조)
  const user = await currentHrUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}) as any);
  const year = Number(body.year);
  const month = Number(body.month);
  const ids: number[] = Array.isArray(body.employeeIds)
    ? [...new Set<number>(body.employeeIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
    : [];
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });
  if (!ids.length) return NextResponse.json({ error: "이월할 직원을 고르세요" }, { status: 400 });
  if (body.consent !== true)
    return NextResponse.json(
      { error: "근로자 동의(또는 노사 합의) 확인이 필요합니다 — 동의 없이 이월하면 수당 미지급이 됩니다." },
      { status: 400 }
    );

  const today = kstTodayYmd();
  const { rows, meta } = await payoutRowsFor(year, month, ids);
  const suggestions = payoutSuggestions(rows, year, month);

  const applied: Array<{ employeeId: number; name: string; days: number }> = [];
  const skipped: Array<{ employeeId: number; name: string; reason: string }> = [];
  const sentNotice: string[] = [];

  for (const id of ids) {
    const m = meta.get(id);
    const s = suggestions.find((x) => x.employeeId === id);
    if (!m || !s || !m.ending) {
      skipped.push({ employeeId: id, name: m?.name ?? String(id), reason: "그 달 정산 대상이 아닙니다" });
      continue;
    }
    const plan = carryoverPlan(s, today);
    if (!plan.ok) {
      skipped.push({ employeeId: id, name: m.name, reason: CARRYOVER_BLOCK_LABEL[plan.reason] });
      continue;
    }
    const ending = m.ending;
    const periods = carryoverPeriods(ending);

    // 직원 단위 잠금 안에서 **이미 적힌 이월분을 다시 세어** 남은 만큼만 적는다 — 두 번 눌러도 넘치지 않는다
    const days = await withEmployeeLeaveLock(id, async (tx) => {
      const existing = await tx.leaveTransaction.findMany({ where: carryoverWhere(id, ending.endExclusive) });
      const already = carriedOverDays(
        existing.map((t: any) => ({ date: t.date, days: t.days, type: t.type, category: t.category })),
        ending.endExclusive
      );
      const room = Math.round((s.remaining - s.alreadyDays - already) * 10) / 10;
      const n = Math.min(plan.days, room);
      if (n <= 0) return 0;
      await tx.leaveTransaction.create({
        data: {
          employeeId: id,
          date: ending.endExclusive,
          days: n,
          type: "CARRYOVER",
          category: "STATUTORY",
          note: carryoverTxnNote({ days: n, periodStart: periods.periodStart, periodEnd: periods.periodEnd }, user.name),
        },
      });
      return n;
    });
    if (days <= 0) {
      skipped.push({ employeeId: id, name: m.name, reason: CARRYOVER_BLOCK_LABEL.NOTHING });
      continue;
    }
    applied.push({ employeeId: id, name: m.name, days });
    if (m.payrollStatus === "SENT") sentNotice.push(m.name);

    await logActivity({
      action: "LEAVE_CARRYOVER",
      actorName: user.name,
      employeeId: id,
      target: m.name,
      summary:
        `${m.name}의 연차기간 ${periods.periodStart}~${periods.periodEnd} 미사용 ${days}일을 수당 대신 ` +
        `다음 기간(${periods.nextStart}~${periods.nextEnd})으로 이월했습니다 — 근로자 동의 확인(${user.name})` +
        (m.payrollStatus === "SENT" ? " · 명세서는 이미 발송됨(이월 안내 미반영)" : ""),
      meta: {
        year,
        month,
        days,
        ...periods,
        consent: true,
        confirmedBy: user.empNo,
        payrollId: m.payrollId,
        payrollStatus: m.payrollStatus,
        remaining: s.remaining,
        alreadyDays: s.alreadyDays,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, applied, skipped, sentNotice });
}
