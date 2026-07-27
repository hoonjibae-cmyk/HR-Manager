import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { CONTRACT_OWNED_FIELDS } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const emp = await prisma.employee.findUnique({
    where: { id: Number(params.id) },
    include: { contracts: { orderBy: { startDate: "desc" } } },
  });
  if (!emp) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(emp);
}

/**
 * 직원 카드 수정 — 인적사항·소속·근태 설정만.
 * 보수조건(기본급·수당·비율·인센티브·급여형태·세무구분)은 계약이 정하므로 여기서 받지 않는다.
 * 조건을 바꾸려면 계약을 새로 쓰거나(POST /api/contracts) 고친다(PATCH /api/contracts/[id]).
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const data: any = {};
  const fields = [
    "name", "rrn", "birth", "department", "position", "duty", "address",
    "phone", "email", "slackUserId", "bankName", "bankAccount",
  ];
  for (const f of fields) if (f in body) data[f] = body[f] || null;
  for (const f of ["dependents", "nonTaxTotal"]) if (f in body) data[f] = Number(body[f]) || 0;
  if ("hireDate" in body && body.hireDate) data.hireDate = new Date(body.hireDate);
  if ("resignDate" in body) data.resignDate = body.resignDate ? new Date(body.resignDate) : null;
  if ("active" in body) data.active = !!body.active;
  if ("breakPaid" in body) data.breakPaid = !!body.breakPaid;
  if ("schedule" in body)
    data.schedule = typeof body.schedule === "string" ? body.schedule : JSON.stringify(body.schedule);

  // 계약이 소유한 항목이 섞여 들어오면 조용히 무시하고 사실만 알려준다
  const ignored = CONTRACT_OWNED_FIELDS.filter((f) => f in body);

  try {
    const emp = await prisma.employee.update({ where: { id: Number(params.id) }, data });
    await logActivity({
      action: "EMPLOYEE_UPDATE",
      employeeId: emp.id,
      target: emp.name,
      summary: `${emp.name}의 인적사항을 수정했습니다 (${Object.keys(data).join(", ")}).`,
      meta: { changed: Object.keys(data) },
    });
    return NextResponse.json({ ...emp, ignoredContractFields: ignored });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const gone = await prisma.employee.findUnique({ where: { id: Number(params.id) } });
    await prisma.employee.delete({ where: { id: Number(params.id) } });
    await logActivity({
      action: "EMPLOYEE_DELETE",
      target: gone?.name,
      summary: `직원 ${gone?.name ?? params.id}을(를) 삭제했습니다. (급여·계약·연차 기록 포함)`,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
