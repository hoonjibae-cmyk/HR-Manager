import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { isAuthed } from "@/lib/auth";
import { sendPayslipsForMonth } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { year, month } = await req.json();
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });
  try {
    const res: any = await sendPayslipsForMonth(Number(year), Number(month));
    await logActivity({
      action: "PAYSLIP_SEND",
      target: `${year}-${String(month).padStart(2, "0")}`,
      summary: `${year}년 ${month}월 급여명세서를 발송했습니다. (성공 ${res.sent ?? 0} · 실패 ${res.failed ?? 0})`,
      meta: res,
    });
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
