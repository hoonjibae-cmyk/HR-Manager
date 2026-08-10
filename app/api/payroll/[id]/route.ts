import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateDeductions } from "@/lib/payroll-service";

export const dynamic = "force-dynamic";

// 상태 변경(확정 등) 및 공제 편집(수동/자동 모드, 세무사 지정값, 자체공제)
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  try {
    // 공제 관련 필드가 하나라도 있으면 공제 편집으로 처리
    const dedKeys = [
      "deductMode", "pensionD", "employmentD", "healthD", "longTermD",
      "incomeTaxD", "localTaxD", "retentionD", "parkingD", "expenseD", "otherD",
      "otherItems",
    ];
    if (dedKeys.some((k) => k in body)) {
      const patch: any = {};
      if (body.deductMode) patch.deductMode = body.deductMode;
      for (const k of dedKeys.slice(1)) {
        if (k === "otherItems") continue; // 숫자 필드 아님 — 아래에서 별도 처리
        if (k in body && body[k] !== "" && body[k] != null) patch[k] = Number(body[k]);
      }
      if ("otherItems" in body && Array.isArray(body.otherItems)) {
        patch.otherItems = body.otherItems;
      }
      const rec = await updateDeductions(Number(params.id), patch);
      const emp = await prisma.employee.findUnique({ where: { id: rec.employeeId } });
      await logActivity({
        action: "PAYROLL_EDIT",
        employeeId: rec.employeeId,
        target: `${emp?.name ?? ""} ${rec.year}-${String(rec.month).padStart(2, "0")}`,
        summary: `${emp?.name ?? "직원"}의 ${rec.year}년 ${rec.month}월 공제 내역을 수정했습니다. (실수령 ${rec.net.toLocaleString()}원)`,
        meta: patch,
      });
      return NextResponse.json(rec);
    }

    if (body.status) {
      // 발송(SENT)은 이 경로로 풀 수 없다 — 사유를 남기고 정정 차수를 새기는
      // POST /api/payroll/[id]/unlock 만이 잠금을 푼다. 여기서 조용히 DRAFT 로
      // 되돌릴 수 있으면 정정 이력이 남지 않아 잠금이 있으나 마나가 된다.
      const cur = await prisma.payrollRecord.findUnique({ where: { id: Number(params.id) } });
      if (cur?.status === "SENT" && body.status !== "SENT") {
        return NextResponse.json(
          { error: "발송 완료된 기록은 '발송 잠금 해제'로만 되돌릴 수 있습니다 (사유 입력 필요)" },
          { status: 400 }
        );
      }
      const rec = await prisma.payrollRecord.update({
        where: { id: Number(params.id) },
        data: { status: body.status },
      });
      await logActivity({
        action: "PAYROLL_EDIT",
        employeeId: rec.employeeId,
        target: `${rec.year}-${String(rec.month).padStart(2, "0")}`,
        summary: `급여 상태를 ${body.status} 로 변경했습니다.`,
      });
      return NextResponse.json(rec);
    }

    return NextResponse.json({ error: "변경할 내용 없음" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

/**
 * 시트에서 한 행을 내린다 — **직접 추가한 행(manualAdd)만**.
 * 재직 중인 직원의 행까지 여기서 지울 수 있으면 다음 산정에서 도로 생기므로
 * 지운 셈도 안 되면서 그 사이에 세무·이체 파일만 어긋난다.
 * 전월 퇴직자가 남은 행은 산정이 알아서 내린다(pruneResignedFromSheet).
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rec = await prisma.payrollRecord.findUnique({
    where: { id: Number(params.id) },
    include: { employee: { select: { name: true } } },
  });
  if (!rec) return NextResponse.json({ error: "기록을 찾을 수 없습니다" }, { status: 404 });
  if (!rec.manualAdd)
    return NextResponse.json(
      { error: "직접 추가한 행만 내릴 수 있습니다. 재직 중인 직원은 급여 산정 대상입니다." },
      { status: 400 }
    );
  if (rec.status === "SENT")
    return NextResponse.json(
      { error: "이미 명세서가 발송된 기록입니다. '발송 잠금 해제' 로 사유를 남긴 뒤 내리세요." },
      { status: 400 }
    );

  await prisma.payrollRecord.delete({ where: { id: rec.id } });
  await logActivity({
    action: "PAYROLL_DELETE",
    employeeId: rec.employeeId,
    target: `${rec.employee.name} ${rec.year}-${String(rec.month).padStart(2, "0")}`,
    summary: `직접 추가했던 ${rec.employee.name}의 ${rec.year}년 ${rec.month}월 급여 기록을 시트에서 내렸습니다. (지급액 ${rec.gross.toLocaleString()}원)`,
    meta: { gross: rec.gross, net: rec.net },
  });
  return NextResponse.json({ ok: true });
}
