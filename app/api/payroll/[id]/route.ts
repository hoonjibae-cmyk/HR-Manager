import { NextResponse } from "next/server";
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
      return NextResponse.json(rec);
    }

    if (body.status) {
      const rec = await prisma.payrollRecord.update({
        where: { id: Number(params.id) },
        data: { status: body.status },
      });
      return NextResponse.json(rec);
    }

    return NextResponse.json({ error: "변경할 내용 없음" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
