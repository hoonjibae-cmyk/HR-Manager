import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await prisma.examPeriod.findUnique({ where: { id: Number(params.id) } });
  if (!row) return NextResponse.json({ error: "없는 기간입니다." }, { status: 404 });
  await prisma.examPeriod.delete({ where: { id: row.id } });
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: "내신 기간",
    summary: `내신 기간을 삭제했습니다 — ${row.name}. 이 기간의 내신의무보강은 분기 기준 상한으로 되돌아갑니다.`,
    meta: { examPeriodId: row.id },
  });
  return NextResponse.json({ ok: true });
}
