import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { countLeaveDays } from "@/lib/leave";
import { isHalfDayLeave } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const where: any = {};
  if (status) where.status = status;
  const rows = await prisma.leaveRequest.findMany({
    where,
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  const target = await prisma.employee.findUnique({ where: { id: Number(b.employeeId) } });
  if (target?.payScheme === "RATIO") {
    return NextResponse.json(
      { error: "완전비율제(위탁) 계약은 연차휴가 대상이 아닙니다." },
      { status: 400 }
    );
  }
  const start = new Date(b.startDate);
  const end = new Date(b.endDate || b.startDate);
  const half = isHalfDayLeave(b.leaveType);
  const holidays = (await prisma.holiday.findMany()).map((h) => h.date);
  const days = b.days ? Number(b.days) : countLeaveDays(start, end, { half, holidays });
  const row = await prisma.leaveRequest.create({
    data: {
      employeeId: Number(b.employeeId),
      startDate: start,
      endDate: end,
      days,
      leaveType: b.leaveType || "ANNUAL",
      reason: b.reason || null,
      workPlan: b.workPlan?.trim() || null,
      status: "PENDING",
      source: b.source || "WEB",
    },
  });
  return NextResponse.json(row, { status: 201 });
}
