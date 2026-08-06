import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { sendConfirmRequest } from "@/lib/makeup-service";
import { makeupDateLabel } from "@/lib/makeup-slack";
import { makeupKindLabel } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * '실근무 시간을 확정해 주세요' 알림을 관리자가 **골라서** 보낸다.
 *
 * 수당이 기본 반영되는 건(주말근무, 그리고 **토·일·공휴일에 한** 직전보강·내신의무보강)은
 * 근무 다음날 크론이 자동으로 보낸다. 결시보강처럼 **기본 미반영**인 건과 **평일에 한
 * 직전·내신보강**은 관리자가 수당 반영 여부를 먼저 정해야 하므로 여기로 온다 —
 * 반영하지 않기로 한 건에 확정을 재촉하면 지급되는 줄 알게 된다.
 *
 * `force=true` 면 이미 보낸 건에도 다시 보낸다(신청자가 못 봤을 때).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  const b = await req.json().catch(() => ({}) as any);

  const res = await sendConfirmRequest(id, { force: !!b.force });
  if (!res.ok) return NextResponse.json({ error: res.reason ?? "보내지 못했습니다." }, { status: 400 });

  const row = await prisma.makeupSession.findUnique({ where: { id }, include: { employee: true } });
  if (row)
    await logActivity({
      action: "MAKEUP_REMIND",
      employeeId: row.employeeId,
      target: row.employee.name,
      summary:
        `${row.employee.name}님에게 ${makeupKindLabel(row.category)} 실근무 확정 요청을 보냈습니다 — ` +
        `${makeupDateLabel(row.planStart, row.planEnd)}.`,
      meta: { makeupId: id, force: !!b.force },
    }).catch(() => {});

  return NextResponse.json({ ok: true });
}
