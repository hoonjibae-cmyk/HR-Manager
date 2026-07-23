import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
  return NextResponse.json(recs);
}
