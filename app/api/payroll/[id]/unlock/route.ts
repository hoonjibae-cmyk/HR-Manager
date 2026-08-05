import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { unlockPayroll } from "@/lib/payroll-service";

export const dynamic = "force-dynamic";

/**
 * 발송 잠금 해제 — 이미 보낸 명세서를 고쳐야 할 때.
 *
 * 상태를 바꾸는 일반 경로(`PATCH /api/payroll/[id]`)로는 SENT 를 풀 수 없게 막아 두었다.
 * 되돌리기 어려운 작업이므로 **반드시 이 경로로만**, 사유를 남기고 풀린다.
 * body: { reason }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason ?? "");

  try {
    const before = await prisma.payrollRecord.findUnique({
      where: { id: Number(params.id) },
      include: { employee: true },
    });
    const rec = await unlockPayroll(Number(params.id), reason);

    await logActivity({
      action: "PAYROLL_UNLOCK",
      employeeId: rec.employeeId,
      target: `${before?.employee.name ?? ""} ${rec.year}-${String(rec.month).padStart(2, "0")}`,
      summary:
        `${before?.employee.name ?? "직원"}의 ${rec.year}년 ${rec.month}월 명세서 발송 잠금을 해제했습니다 ` +
        `(정정 ${rec.reissueCount}차). 사유: ${reason.trim()}`,
      // 푼 시점의 금액을 함께 남긴다 — 무엇이 어떻게 바뀌었는지 나중에 대조하려면 필요하다
      meta: {
        reason: reason.trim(),
        reissueCount: rec.reissueCount,
        firstSentAt: rec.firstSentAt,
        before: {
          gross: before?.gross,
          totalDeduct: before?.totalDeduct,
          net: before?.net,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      id: rec.id,
      status: rec.status,
      reissueCount: rec.reissueCount,
      firstSentAt: rec.firstSentAt,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
