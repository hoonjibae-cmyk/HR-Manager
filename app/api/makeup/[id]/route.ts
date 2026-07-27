import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { updateMakeupSession, deleteMakeupSession } from "@/lib/makeup-service";
import { makeupDateLabel } from "@/lib/makeup-slack";
import { MAKEUP_STATUS_LABEL } from "@/lib/constants";
import { postMessage, slackConfigured } from "@/lib/slack";

export const dynamic = "force-dynamic";

/**
 * 관리자 확인 — 실근무 시각 기입, 수당 반영 여부(결시보강), 미실시 처리.
 * 확정하면 그 달 급여를 다시 돌릴 때 연장/휴일/야간 시간이 자동으로 반영된다.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  const b = await req.json().catch(() => ({} as any));

  const patch: any = {};
  if (b.status) patch.status = String(b.status);
  if (b.actualStart !== undefined)
    patch.actualStart = b.actualStart ? new Date(b.actualStart) : null;
  if (b.actualEnd !== undefined) patch.actualEnd = b.actualEnd ? new Date(b.actualEnd) : null;
  if (b.payEligible !== undefined)
    patch.payEligible = b.payEligible === null ? null : !!b.payEligible;
  if (b.reviewNote !== undefined) patch.reviewNote = b.reviewNote || null;
  if (b.category) patch.category = String(b.category);
  if (b.targetClass !== undefined) patch.targetClass = String(b.targetClass);
  if (b.headcount !== undefined)
    patch.headcount = b.headcount === "" || b.headcount == null ? null : Number(b.headcount);
  if (b.detail !== undefined) patch.detail = String(b.detail);
  if (b.note !== undefined) patch.note = b.note || null;

  if (patch.actualStart && patch.actualEnd && patch.actualEnd <= patch.actualStart)
    return NextResponse.json({ error: "실근무 종료가 시작보다 빠릅니다." }, { status: 400 });

  try {
    const row = await updateMakeupSession(id, patch);
    const label = makeupDateLabel(row.actualStart ?? row.planStart, row.actualEnd ?? row.planEnd);

    await logActivity({
      action: "MAKEUP_UPDATE",
      employeeId: row.employeeId,
      target: row.employee.name,
      summary:
        `${row.employee.name}님의 보강을 ${MAKEUP_STATUS_LABEL[row.status] ?? row.status}(으)로 ` +
        `처리했습니다 — ${label}.` +
        (patch.payEligible !== undefined
          ? ` 수당 ${patch.payEligible === true ? "반영" : patch.payEligible === false ? "미반영" : "기본값"}.`
          : ""),
      meta: { makeupId: id, patch: { ...patch } },
    });

    // 수당에 영향을 주는 결정은 당사자에게 알린다 (실패해도 처리는 되돌리지 않는다)
    if (b.notify && slackConfigured() && row.slackUserId) {
      const lines = [
        `📚 *${row.employee.name}님의 보강이 확인되었습니다.*`,
        "",
        `• 일시: ${label}`,
        `• 처리: ${MAKEUP_STATUS_LABEL[row.status] ?? row.status}`,
        ...(row.reviewNote ? [`• 메모: ${row.reviewNote}`] : []),
        "",
        "수당 반영 내역은 급여명세서의 「보강 오버타임 산정 내역서」에서 확인할 수 있습니다.",
      ];
      await postMessage(row.slackUserId, lines.join("\n")).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const row = await deleteMakeupSession(Number(params.id));
    await logActivity({
      action: "MAKEUP_DELETE",
      employeeId: row.employeeId,
      target: row.employee.name,
      summary: `${row.employee.name}님의 보강 신청을 삭제했습니다 — ${makeupDateLabel(
        row.planStart,
        row.planEnd
      )}.`,
      meta: { makeupId: row.id },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
