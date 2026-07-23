import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { runPayrollMonth } from "@/lib/payroll-service";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { year, month, inputs, employeeIds } = await req.json();
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });
  const recs = await runPayrollMonth(Number(year), Number(month), inputs || {}, employeeIds);
  await prisma.auditLog.create({
    data: { action: "PAYROLL_RUN", target: `${year}-${month}`, detail: JSON.stringify({ count: recs.length }) },
  });
  return NextResponse.json({ ok: true, count: recs.length });
}
