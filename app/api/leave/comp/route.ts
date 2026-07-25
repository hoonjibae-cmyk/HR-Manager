import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { adjustLeave } from "@/lib/leave-service";

export const dynamic = "force-dynamic";

/**
 * 대체휴일 보상연차(대휴) 수동 부여/차감 — 운영자 직접 입력.
 * body: { employeeId, days(+부여/-차감), date?, note? }
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  const days = Number(b.days);
  if (!b.employeeId || !days || isNaN(days)) {
    return NextResponse.json({ error: "employeeId 와 days(0이 아닌 숫자)가 필요합니다" }, { status: 400 });
  }
  const emp = await prisma.employee.findUnique({ where: { id: Number(b.employeeId) } });
  if (!emp) return NextResponse.json({ error: "직원 없음" }, { status: 404 });
  if (emp.payScheme === "RATIO") {
    return NextResponse.json({ error: "완전비율제(위탁) 계약은 연차 대상이 아닙니다" }, { status: 400 });
  }
  try {
    const { comp } = await adjustLeave(
      emp.id,
      days,
      days > 0 ? "GRANT" : "ADJUST",
      b.date ? new Date(b.date) : new Date(),
      b.note || (days > 0 ? "대휴 부여" : "대휴 차감"),
      "COMP"
    );
    await prisma.auditLog.create({
      data: { action: "COMP_LEAVE_ADJUST", target: `emp:${emp.id}`, detail: JSON.stringify({ days, note: b.note }) },
    });
    return NextResponse.json({ ok: true, comp });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
