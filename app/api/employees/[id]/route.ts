import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { syncActiveContract } from "@/lib/contract-sync";

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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const data: any = {};
  const fields = [
    "name", "rrn", "birth", "department", "position", "duty", "address",
    "phone", "email", "slackUserId", "bankName", "bankAccount", "incomeType", "payScheme",
  ];
  for (const f of fields) if (f in body) data[f] = body[f] || null;
  const numFields = [
    "baseWage", "positionAllow", "mealAllow", "carAllow", "dependents", "nonTaxTotal",
  ];
  for (const f of numFields) if (f in body) data[f] = Number(body[f]) || 0;
  for (const f of ["incThreshold", "incPerStudent", "ratioPercent"]) {
    if (f in body) data[f] = body[f] != null && body[f] !== "" ? Number(body[f]) : null;
  }
  if ("hireDate" in body && body.hireDate) data.hireDate = new Date(body.hireDate);
  if ("resignDate" in body) data.resignDate = body.resignDate ? new Date(body.resignDate) : null;
  if ("active" in body) data.active = !!body.active;
  if ("breakPaid" in body) data.breakPaid = !!body.breakPaid;
  if ("schedule" in body)
    data.schedule = typeof body.schedule === "string" ? body.schedule : JSON.stringify(body.schedule);

  try {
    const id = Number(params.id);
    // 계약서·급여는 Contract 스냅샷을 읽으므로, 카드에서 바뀐 보수조건은 계약에도 반영한다
    const before = await prisma.employee.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
    const emp = await prisma.employee.update({ where: { id }, data });
    const contractSync = await syncActiveContract(id, data, before);
    return NextResponse.json({ ...emp, contractSync });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    await prisma.employee.delete({ where: { id: Number(params.id) } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
