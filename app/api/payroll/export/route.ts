// 세무사무소 제출용 급여자료 (엑셀 다운로드)
//
// 급여 일괄 산정·수동 조정이 끝난 뒤 그 달 기록을 그대로 시트로 내린다.
// 표 구성과 열 관계는 lib/payroll-export.ts 참고 (세무사가 이 표로 원천세를 신고한다).

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCompany } from "@/lib/repo";
import { buildPayrollExportWorkbook } from "@/lib/payroll-export";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!year || !month)
    return NextResponse.json({ error: "year/month 가 필요합니다" }, { status: 400 });

  const records = await prisma.payrollRecord.findMany({
    where: { year, month },
    include: { employee: true },
    orderBy: { employee: { empNo: "asc" } },
  });
  if (records.length === 0)
    return NextResponse.json(
      { error: `${year}년 ${month}월 급여 기록이 없습니다. 급여 일괄 산정을 먼저 실행하세요.` },
      { status: 400 }
    );

  const company = await getCompany();
  const { buffer, rows, mismatches, missingId } = buildPayrollExportWorkbook({
    year,
    month,
    payday: company.payday ?? 7,
    companyName: company.name,
    records: records as any,
  });

  // 되돌리기 어려운 작업은 아니지만, 세무사에게 무엇을 언제 넘겼는지는 남겨 둔다
  await logActivity({
    action: "PAYROLL_EXPORT",
    summary: `${year}.${month} 세무사무소 제출자료 내려받기 — ${rows.length}명`,
    meta: mismatches.length ? { mismatches } : undefined,
  }).catch(() => {});

  const filename = `급여자료_${company.name}_${year}-${String(month).padStart(2, "0")}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      // 화면이 경고를 띄울 수 있게 (헤더는 ASCII 만 가능해 base64 로 싣는다)
      "X-Export-Warnings": Buffer.from(
        JSON.stringify({ mismatches, missingId }),
        "utf8"
      ).toString("base64"),
    },
  });
}
