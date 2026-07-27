import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const day = (s: string) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await prisma.examPeriod.findMany({ orderBy: { startDate: "asc" } }));
}

/** 내신 기간 등록 — 내신의무보강 상한(기간당 10시간)이 걸리는 단위 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  if (!b.name?.trim()) return NextResponse.json({ error: "기간 이름을 적어 주세요." }, { status: 400 });
  if (!b.startDate || !b.endDate)
    return NextResponse.json({ error: "시작일과 종료일을 선택해 주세요." }, { status: 400 });
  const startDate = day(b.startDate);
  const endDate = day(b.endDate);
  if (endDate < startDate)
    return NextResponse.json({ error: "종료일이 시작일보다 빠릅니다." }, { status: 400 });

  // 기간이 겹치면 상한이 어느 쪽에 걸리는지 모호해진다
  const overlap = await prisma.examPeriod.findFirst({
    where: { startDate: { lte: endDate }, endDate: { gte: startDate } },
  });
  if (overlap)
    return NextResponse.json(
      { error: `기존 내신 기간과 겹칩니다 — ${overlap.name}` },
      { status: 400 }
    );

  const row = await prisma.examPeriod.create({
    data: {
      name: b.name.trim(),
      startDate,
      endDate,
      capHours: Number.isFinite(Number(b.capHours)) ? Number(b.capHours) : 10,
    },
  });
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: "내신 기간",
    summary: `내신 기간을 등록했습니다 — ${row.name} (${b.startDate} ~ ${b.endDate}, 상한 ${row.capHours}시간).`,
    meta: { examPeriodId: row.id },
  });
  return NextResponse.json({ ok: true, row });
}
