import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { severanceMonth } from "@/lib/severance-service";

export const dynamic = "force-dynamic";

/** 한 달 퇴직급여 산정 (DC 부담금 · 충당금) */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const now = new Date();
  const year = Number(u.searchParams.get("year")) || now.getFullYear();
  const month = Number(u.searchParams.get("month")) || now.getMonth() + 1;
  return NextResponse.json(await severanceMonth(year, month));
}
