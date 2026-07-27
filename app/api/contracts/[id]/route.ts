import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import {
  templateKeyOf,
  refreshEmployeeCard,
  contractIssues,
  closePrecedingContracts,
  addDays,
} from "@/lib/contracts";

export const dynamic = "force-dynamic";

async function issuesFor(employeeId: number) {
  const [emp, list] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId } }),
    prisma.contract.findMany({
      where: { employeeId, status: { not: "DRAFT" } },
      orderBy: { startDate: "asc" },
    }),
  ]);
  if (!emp) return [];
  return contractIssues(emp, list).map((i) => i.message);
}

/** 계약 조건 수정 — 오타 정정·조건 변경. 보수조건을 바꾸는 두 경로 중 하나. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  const body = await req.json();

  const cur = await prisma.contract.findUnique({ where: { id } });
  if (!cur) return NextResponse.json({ error: "계약을 찾을 수 없습니다" }, { status: 404 });

  const data: any = {};
  const num = (v: any) => (v === "" || v == null ? 0 : Number(v));
  const numOrNull = (v: any) => (v === "" || v == null ? null : Number(v));

  for (const f of ["baseWage", "positionAllow", "mealAllow", "carAllow"])
    if (f in body) data[f] = num(body[f]);
  for (const f of ["incThreshold", "incPerStudent", "ratioPercent"])
    if (f in body) data[f] = numOrNull(body[f]);
  if ("payScheme" in body) data.templateKey = templateKeyOf(body.payScheme);
  if ("incomeType" in body) data.incomeType = body.incomeType || null;
  if ("stage" in body) data.stage = body.stage;
  if ("isProbation" in body) data.isProbation = !!body.isProbation;
  if ("note" in body) data.note = body.note || null;
  if ("startDate" in body && body.startDate) data.startDate = new Date(body.startDate);
  if ("endDate" in body) data.endDate = body.endDate ? new Date(body.endDate) : null;

  const start = data.startDate ?? cur.startDate;
  const end = data.endDate !== undefined ? data.endDate : cur.endDate;
  if (end && end < start)
    return NextResponse.json({ error: "계약 종료일이 시작일보다 빠릅니다." }, { status: 400 });

  try {
    await prisma.contract.update({ where: { id }, data });
    // 시작일을 옮겼으면 앞 계약을 다시 닫아 빈틈을 막는다
    if (data.startDate) await closePrecedingContracts(cur.employeeId, start);
    await refreshEmployeeCard(cur.employeeId);
    return NextResponse.json({ ok: true, issues: await issuesFor(cur.employeeId) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

/**
 * 계약 삭제 (잘못 만든 계약 정리).
 * 직전 계약의 종료일을 삭제된 계약의 종료일까지 늘려 빈틈을 메운다.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  const cur = await prisma.contract.findUnique({ where: { id } });
  if (!cur) return NextResponse.json({ error: "계약을 찾을 수 없습니다" }, { status: 404 });

  const count = await prisma.contract.count({
    where: { employeeId: cur.employeeId, status: { not: "DRAFT" } },
  });
  if (count <= 1)
    return NextResponse.json(
      { error: "마지막 계약은 삭제할 수 없습니다. 조건을 수정해 주세요." },
      { status: 400 }
    );

  try {
    const prev = await prisma.contract.findFirst({
      where: {
        employeeId: cur.employeeId,
        status: { not: "DRAFT" },
        startDate: { lt: cur.startDate },
      },
      orderBy: { startDate: "desc" },
    });
    await prisma.contract.delete({ where: { id } });
    if (prev) {
      // 삭제로 생긴 공백을 직전 계약이 이어받는다
      const next = await prisma.contract.findFirst({
        where: {
          employeeId: cur.employeeId,
          status: { not: "DRAFT" },
          startDate: { gt: prev.startDate },
        },
        orderBy: { startDate: "asc" },
      });
      await prisma.contract.update({
        where: { id: prev.id },
        data: {
          endDate: next ? addDays(next.startDate, -1) : cur.endDate,
          status: next ? "EXPIRED" : "ACTIVE",
        },
      });
    }
    await refreshEmployeeCard(cur.employeeId);
    return NextResponse.json({ ok: true, issues: await issuesFor(cur.employeeId) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
