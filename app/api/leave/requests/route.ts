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

// 관리자용 '연차 신청 등록' 은 없앴다. 운영자가 직접 반영할 때는 신청서를 만들지 않고
// /api/leave/adjust 로 바로 기록한다. 직원 신청은 슬랙 흐름으로만 들어온다.
