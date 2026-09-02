import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { approveLeaveRequest, rejectLeaveRequest } from "@/lib/leave-service";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { action, note } = await req.json();
  try {
    if (action === "approve") {
      await approveLeaveRequest(Number(params.id));
    } else if (action === "reject") {
      await rejectLeaveRequest(Number(params.id), "admin", note || "");
    } else {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

/**
 * 신청 자체를 지운다 (잘못 만든 신청 정리).
 * 승인 전 신청만 지울 수 있다 — 승인된 신청은 연차가 이미 차감돼 있어
 * '반려'(승인 취소)로 되돌려야 기록이 맞는다.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  const row = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { employee: { select: { name: true } } },
  });
  if (!row) return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
  if (row.status !== "PENDING" && row.status !== "PRE_PENDING")
    return NextResponse.json(
      { error: "이미 처리된 신청은 지울 수 없습니다. 반려로 되돌려 주세요." },
      { status: 400 }
    );

  await prisma.leaveRequest.delete({ where: { id } });
  await logActivity({
    action: "LEAVE_REJECT",
    employeeId: row.employeeId,
    target: row.employee.name,
    summary: `${row.employee.name}의 연차 신청(${row.startDate
      .toISOString()
      .slice(0, 10)}, ${row.days}일)을 삭제했습니다.`,
    meta: { requestId: id, source: row.source },
  });
  return NextResponse.json({ ok: true });
}
