import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { runDueSchedules } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 관리자 화면에서 예약 발송을 수동 실행.
 *  - { dryRun: true }     : 조건만 판단 (모의 실행)
 *  - { force: true }      : 조건 무시하고 즉시 발송
 *  - { year, month }      : 발송 대상 월 직접 지정 (미리보기와 동일한 대상 보장)
 *  - 기본                   : 실제 조건(날짜·요일)으로 판단하여 실행
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const override =
    Number(body.year) && Number(body.month)
      ? { year: Number(body.year), month: Number(body.month) }
      : undefined;
  try {
    const result = await runDueSchedules(new Date(), {
      force: !!body.force,
      dryRun: !!body.dryRun,
      ignoreClock: body.strict !== true,
      override,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
