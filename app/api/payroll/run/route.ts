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
  const { records, plan } = await runPayrollMonth(
    Number(year),
    Number(month),
    inputs || {},
    employeeIds
  );
  await logActivity({
    action: "PAYROLL_RUN",
    target: `${year}-${String(month).padStart(2, "0")}`,
    summary:
      `${year}년 ${month}월 급여를 ${records.length}명 산정했습니다.` +
      (plan.remove.length ? ` (퇴직으로 ${plan.remove.length}명 제외)` : ""),
    meta: { count: records.length, employeeIds: employeeIds ?? null, removed: plan.remove.length },
  });
  // 시트에서 빠진 사람은 화면이 알려 준다 — 조용히 사라지면 왜 없어졌는지 알 수 없다
  return NextResponse.json({
    ok: true,
    count: records.length,
    removed: plan.remove,
    locked: plan.locked,
    kept: plan.kept,
  });
}
