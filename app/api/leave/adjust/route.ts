import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { adjustLeave } from "@/lib/leave-service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  try {
    const { summary } = await adjustLeave(
      Number(b.employeeId),
      Number(b.days),
      b.type || "ADJUST",
      b.date ? new Date(b.date) : new Date(),
      b.note
    );
    return NextResponse.json({ ok: true, remaining: summary.remaining });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
