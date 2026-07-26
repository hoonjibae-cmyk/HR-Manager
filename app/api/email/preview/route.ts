import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { targetYearMonth, computeNextRun, formatKst } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/**
 * 예약 발송 대상 미리보기.
 * ?year=&month= 없으면 예약 설정의 대상 월(당월/전월분)을 사용한다.
 */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const sched = await prisma.emailSchedule.findFirst();

  const next = sched ? computeNextRun(sched) : null;
  let year = Number(searchParams.get("year"));
  let month = Number(searchParams.get("month"));
  if (!year || !month) {
    // 다음 발송 예정일 기준의 대상 월을 보여준다 (예: 8/7 발송 → 7월분)
    const t = targetYearMonth(next ?? new Date(), sched?.targetMonthOffset ?? -1);
    year = t.year;
    month = t.month;
  }

  const recs = await prisma.payrollRecord.findMany({
    where: { year, month },
    include: { employee: { select: { name: true, email: true } } },
    orderBy: { id: "asc" },
  });

  const alreadySent = recs.filter((r) => r.status === "SENT");
  const targets = recs.filter((r) => r.status !== "SENT" && !!r.employee.email);
  const noEmail = recs.filter((r) => r.status !== "SENT" && !r.employee.email);

  return NextResponse.json({
    year,
    month,
    total: recs.length,
    targetCount: targets.length,
    alreadySentCount: alreadySent.length,
    noEmailNames: noEmail.map((r) => r.employee.name),
    totalNet: targets.reduce((a, r) => a + r.net, 0),
    nextRunAt: next,
    nextRunLabel: next ? formatKst(next) : null,
    lastRunLabel: sched?.lastRunAt ? formatKst(sched.lastRunAt) : null,
    smtpReady: !!process.env.SMTP_HOST,
  });
}
