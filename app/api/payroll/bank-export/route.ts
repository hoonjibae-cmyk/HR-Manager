// 은행 대량이체 파일 (엑셀 다운로드)
//
// 세후 금액이 확정된 뒤 그 달 실지급액을 은행 '파일이체' 로 한 번에 올리기 위한 파일.
// 양식과 열 구성은 lib/bank-transfer.ts 참고 (은행이 그대로 읽으므로 구조를 바꾸지 않는다).

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCompany } from "@/lib/repo";
import { buildBankTransferWorkbook } from "@/lib/bank-transfer";
import { logActivity } from "@/lib/activity";
import { resignedSummary } from "@/lib/payroll-roster";
import { kstTodayYmd } from "@/lib/format";
import { bizPayerMissingMessage } from "@/lib/ratio-employee";

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
  // payer=biz — 별도 사업장이 보내는 사업소득(비율제 근로자의 근로소득 상한 초과분)만 담은 파일.
  // 출금 계좌가 다른 사업자라 이 회사 파일과 섞지 않는다(lib/ratio-employee.ts).
  const biz = searchParams.get("payer") === "biz";
  if (biz && !company.bizPayer)
    return NextResponse.json({ error: bizPayerMissingMessage(company.bizPayerMissing) }, { status: 400 });
  const { buffer, rows, missingAccount, zeroAmount, bizExcluded, bizToSalaryAccount, total } = buildBankTransferWorkbook({
    year,
    month,
    alias: biz ? company.bizPayer!.alias : company.transferAlias,
    records: records as any,
    payer: biz ? "BIZ" : "COMPANY",
  });
  if (rows.length === 0)
    return NextResponse.json(
      {
        error: biz
          ? missingAccount.length
            ? // 줄 돈은 있는데 받을 계좌가 없다 — '지급할 사업소득이 없다' 고 답하면 그 달 사업소득을 놓친다
              `별도 사업장이 지급할 사업소득은 있지만 받을 계좌가 없습니다: ${missingAccount.join(", ")}. 직원 정보의 사업소득용 계좌(또는 급여 계좌)를 확인하세요.`
            : `${year}년 ${month}월에는 별도 사업장이 지급할 사업소득(근로소득 상한 초과분)이 없습니다.`
          : "이체할 줄이 없습니다. 직원 정보에 은행·계좌번호가 입력돼 있는지 확인하세요.",
      },
      { status: 400 }
    );

  // 실제로 돈이 나가는 파일이라 언제 누구 앞으로 얼마를 뽑았는지는 남겨 둔다
  await logActivity({
    action: "PAYROLL_EXPORT",
    summary:
      `${year}.${month} ${biz ? `별도 사업장(${company.bizPayer!.name}) ` : ""}은행 이체 파일 내려받기 — ${rows.length}건 / ${total.toLocaleString()}원` +
      (missingAccount.length ? ` (계좌 없음 ${missingAccount.length}명 제외)` : "") +
      (bizToSalaryAccount.length ? ` (사업소득용 계좌가 없어 급여 계좌로 ${bizToSalaryAccount.length}명)` : ""),
    meta:
      missingAccount.length || bizToSalaryAccount.length
        ? {
            ...(missingAccount.length ? { missingAccount } : {}),
            // 근로소득과 사업소득을 다른 통장으로 가르려던 달에 어느 계좌로 나갔는지 되짚을 수 있게 남긴다
            ...(bizToSalaryAccount.length ? { bizToSalaryAccount } : {}),
          }
        : undefined,
  }).catch(() => {});

  const filename = `${biz ? "이체_별도사업장" : "이체"}_${year}-${String(month).padStart(2, "0")}.xls`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.ms-excel",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      // 화면이 경고를 띄울 수 있게 (헤더는 ASCII 만 가능해 base64 로 싣는다)
      "X-Export-Warnings": Buffer.from(
        JSON.stringify({
          missingAccount,
          zeroAmount,
          // 이 회사 파일에서 빠진 별도 사업장 몫 — 화면이 '별도 사업장 이체 파일' 을 따로 받으라고 알린다
          bizExcluded,
          // 별도 사업장 파일에서 사업소득용 계좌가 없어 급여 계좌로 보내는 사람 — 통장을 가르려면 직원 정보에 넣어야 한다
          bizToSalaryAccount,
          count: rows.length,
          total,
          // 여기가 돈이 실제로 나가는 자리다 — 오늘 기준 이미 퇴직한 사람이 파일에
          // 들어 있으면 마지막으로 한 번 더 걸리게 한다(막지는 않는다. 마지막 급여와
          // 퇴직 정산은 정상적으로 이 파일에 실려야 한다).
          resigned: resignedSummary(
            records.map((r) => ({
              name: r.employee.name,
              resignDate: r.employee.resignDate?.toISOString() ?? null,
              gross: r.net,
            })),
            kstTodayYmd()
          ),
        }),
        "utf8"
      ).toString("base64"),
    },
  });
}
