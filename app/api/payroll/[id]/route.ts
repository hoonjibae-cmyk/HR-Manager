import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// 상태 변경 (확정 등) 및 월별 입력값 개별 저장
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const data: any = {};
  if (body.status) data.status = body.status;
  if ("otherD" in body) data.otherD = Number(body.otherD) || 0;
  try {
    const rec = await prisma.payrollRecord.update({ where: { id: Number(params.id) }, data });
    return NextResponse.json(rec);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
