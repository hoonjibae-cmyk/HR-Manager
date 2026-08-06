import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * 월별 **산정기준 임금**을 관리자가 직접 지정한다.
 *
 * 지정값(MANUAL)은 그 달 급여 레코드보다 세다 — 추산이 틀렸거나 계약에 안 잡히는 사정이
 * 있을 때 쓰라고 둔 자리다. 대신 **되돌릴 수 있게** 한다(DELETE) — 지정해 두고 잊으면
 * 나중에 급여를 정정해도 퇴직급여가 옛 값에 묶인다.
 */
export async function PUT(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  const employeeId = Number(b.employeeId);
  const year = Number(b.year);
  const month = Number(b.month);
  const base = Number(b.base);

  if (!employeeId || !year || !month || month < 1 || month > 12)
    return NextResponse.json({ error: "직원·연월을 확인해 주세요." }, { status: 400 });
  if (!Number.isFinite(base) || base < 0)
    return NextResponse.json({ error: "기준급여는 0 이상의 금액이어야 합니다." }, { status: 400 });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });

  const note = String(b.note ?? "").trim() || null;
  const row = await prisma.severanceMonthlyBase.upsert({
    where: { employeeId_year_month: { employeeId, year, month } },
    update: { base: Math.round(base), source: "MANUAL", note },
    create: { employeeId, year, month, base: Math.round(base), source: "MANUAL", note },
  });

  await logActivity({
    action: "SEVERANCE_BASE_SET",
    employeeId,
    target: emp.name,
    summary:
      `${emp.name}님의 ${year}년 ${month}월 퇴직급여 기준급여를 ` +
      `${Math.round(base).toLocaleString("ko-KR")}원으로 지정했습니다.` +
      (note ? ` (${note})` : ""),
    meta: { year, month, base: Math.round(base), note },
  }).catch(() => {});

  return NextResponse.json({ ok: true, row });
}

/** 지정을 지운다 — 그 달 급여 레코드(또는 추산값) 기준으로 되돌아간다 */
export async function DELETE(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const employeeId = Number(u.searchParams.get("employeeId"));
  const year = Number(u.searchParams.get("year"));
  const month = Number(u.searchParams.get("month"));
  if (!employeeId || !year || !month)
    return NextResponse.json({ error: "직원·연월을 확인해 주세요." }, { status: 400 });

  const existing = await prisma.severanceMonthlyBase.findUnique({
    where: { employeeId_year_month: { employeeId, year, month } },
    include: { employee: true },
  });
  if (!existing) return NextResponse.json({ error: "지정된 값이 없습니다." }, { status: 404 });

  await prisma.severanceMonthlyBase.delete({ where: { id: existing.id } });
  await logActivity({
    action: "SEVERANCE_BASE_CLEAR",
    employeeId,
    target: existing.employee.name,
    summary:
      `${existing.employee.name}님의 ${year}년 ${month}월 퇴직급여 기준급여 지정을 해제했습니다 ` +
      `(${existing.base.toLocaleString("ko-KR")}원 → 급여 기준으로 되돌림).`,
    meta: { year, month, was: existing.base, source: existing.source },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
