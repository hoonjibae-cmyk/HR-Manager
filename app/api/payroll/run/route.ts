import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { isAuthed } from "@/lib/auth";
import { runPayrollMonth } from "@/lib/payroll-service";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { year, month, inputs, employeeIds } = await req.json();
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });
  const recs = await runPayrollMonth(Number(year), Number(month), inputs || {}, employeeIds);
  await logActivity({
    action: "PAYROLL_RUN",
    target: `${year}-${String(month).padStart(2, "0")}`,
    summary: `${year}년 ${month}월 급여를 ${recs.length}명 산정했습니다.`,
    meta: { count: recs.length, employeeIds: employeeIds ?? null },
  });
  return NextResponse.json({ ok: true, count: recs.length });
}
