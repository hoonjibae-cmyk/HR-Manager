import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * 관리자 직접 반영 기록 한 줄 삭제 — 중복 입력·오타 정정용.
 *
 * **신청서에 매인 줄(`requestId != null`)은 여기서 못 지운다** — 그 줄은 승인된 신청서의
 * 그림자라, 원장만 지우면 신청서는 승인인데 차감은 없는 어긋난 상태가 된다. 그쪽은
 * 신청 반려(승인 취소)·휴가 취소 승인 경로로 되돌려야 두 기록이 함께 맞는다.
 *
 * 지운 내용은 작업 이력에 그대로 남긴다 — 원장을 지우는 일이라 무엇이 사라졌는지
 * 되짚을 수 있어야 한다.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "id 가 필요합니다" }, { status: 400 });

  const row = await prisma.leaveTransaction.findUnique({
    where: { id },
    include: { employee: { select: { id: true, name: true } } },
  });
  if (!row) return NextResponse.json({ error: "기록을 찾을 수 없습니다." }, { status: 404 });
  if (row.requestId != null)
    return NextResponse.json(
      {
        error:
          "신청서에서 온 기록은 여기서 지울 수 없습니다. 연차 신청 이력에서 해당 신청을 반려(승인 취소)로 되돌리세요 — 그래야 신청서와 원장이 함께 맞습니다.",
      },
      { status: 400 }
    );

  await prisma.leaveTransaction.delete({ where: { id } });
  await logActivity({
    action: "LEAVE_ADJUST",
    employeeId: row.employeeId,
    target: row.employee?.name ?? `txn:${id}`,
    summary:
      `${row.employee?.name ?? "직원"}의 직접 반영 기록을 삭제했습니다 — ` +
      `${row.date.toISOString().slice(0, 10)} · ${row.days > 0 ? "+" : ""}${row.days}일 (${row.type}/${row.category ?? "STATUTORY"})` +
      (row.note ? ` · ${row.note}` : ""),
    meta: {
      txnId: id,
      date: row.date.toISOString().slice(0, 10),
      days: row.days,
      type: row.type,
      category: row.category,
      note: row.note,
    },
  });
  return NextResponse.json({ ok: true });
}
