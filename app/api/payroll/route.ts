import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { unpaidFlagsFor } from "@/lib/unpaid-leave-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });
  const recs = await prisma.payrollRecord.findMany({
    where: { year, month },
    include: { employee: true },
    orderBy: { employee: { empNo: "asc" } },
  });
  // 무급휴직 표시 — 산정에 쓴 휴직과, **산정한 뒤에 휴직 등록이 바뀌었는지**(다시 산정 필요).
  // 휴직을 등록·수정·삭제해도 이미 만든 급여 기록은 저절로 바뀌지 않으므로 화면이 짚어 줘야 한다.
  // 못 읽어도 급여 목록은 그대로 내준다(표시만 빠진다).
  const flags = await unpaidFlagsFor(year, month, recs).catch((e: any) => {
    console.error("[payroll] 무급휴직 표시 조회 실패:", e?.message ?? e);
    return new Map();
  });
  return NextResponse.json(recs.map((r) => ({ ...r, unpaid: flags.get(r.id) ?? null })));
}
