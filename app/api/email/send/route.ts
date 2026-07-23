import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { sendPayslipsForMonth } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { year, month } = await req.json();
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });
  try {
    const res = await sendPayslipsForMonth(Number(year), Number(month));
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
