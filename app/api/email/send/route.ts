import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { isAuthed } from "@/lib/auth";
import { sendPayslipsForMonth } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const { year, month } = body;
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });

  // 선택 발송 — 없으면(undefined) 예전처럼 그 달 전체.
  // ⚠ **빈 배열을 '전체' 로 읽지 않는다** — 아무도 안 고르고 누른 실수가 전 직원 발송이 된다.
  const raw = body.payrollIds;
  let payrollIds: number[] | null = null;
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw)) return NextResponse.json({ error: "payrollIds 형식 오류" }, { status: 400 });
    payrollIds = raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (payrollIds.length !== raw.length)
      return NextResponse.json({ error: "payrollIds 에 잘못된 값이 있습니다" }, { status: 400 });
    if (!payrollIds.length)
      return NextResponse.json({ error: "발송할 직원을 고르세요" }, { status: 400 });
  }

  try {
    const res: any = await sendPayslipsForMonth(Number(year), Number(month), { payrollIds });
    await logActivity({
      action: "PAYSLIP_SEND",
      target: `${year}-${String(month).padStart(2, "0")}`,
      // 전체 발송과 선택 발송을 이력에서 갈라 적는다 — 나중에 "왜 이 사람만 두 번 받았나" 를
      // 되짚을 때 무엇을 눌렀는지가 남아 있어야 한다.
      summary: payrollIds
        ? `${year}년 ${month}월 급여명세서를 선택한 ${payrollIds.length}명에게 발송했습니다. (성공 ${res.sent ?? 0} · 실패 ${res.failed ?? 0})`
        : `${year}년 ${month}월 급여명세서를 발송했습니다. (성공 ${res.sent ?? 0} · 실패 ${res.failed ?? 0})`,
      meta: { selective: !!payrollIds, payrollIds, ...res },
    });
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
