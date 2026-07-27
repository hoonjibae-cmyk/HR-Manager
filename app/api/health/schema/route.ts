import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * DB 스키마가 코드와 맞는지 점검.
 * 코드가 먼저 배포되고 `prisma db push` 를 잊으면 해당 표를 읽는 화면이 전부 실패하는데,
 * 운영 빌드에서는 원인 메시지가 화면에 안 나와 원인 파악이 어렵다.
 */
const CHECKS: Array<{ label: string; run: () => Promise<unknown> }> = [
  {
    label: "Contract.incomeType (계약 세무구분)",
    run: () => prisma.contract.findFirst({ select: { incomeType: true } }),
  },
  {
    label: "LeaveRequest.workPlan (업무조치사항)",
    run: () => prisma.leaveRequest.findFirst({ select: { workPlan: true } }),
  },
  {
    label: "LeaveRequest.calendarEventId (구글 캘린더 연동)",
    run: () => prisma.leaveRequest.findFirst({ select: { calendarEventId: true } }),
  },
  {
    label: "PayrollRecord.otherItems (기타공제 항목)",
    run: () => prisma.payrollRecord.findFirst({ select: { otherItems: true } }),
  },
  {
    label: "PayrollRecord.studentUnits (인센티브 재원계수)",
    run: () => prisma.payrollRecord.findFirst({ select: { studentUnits: true } }),
  },
  {
    label: "IncentiveStudent (인센티브 명단)",
    run: () => prisma.incentiveStudent.findFirst({ select: { id: true } }),
  },
];

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const results: Array<{ label: string; ok: boolean; error?: string }> = [];
  for (const c of CHECKS) {
    try {
      await c.run();
      results.push({ label: c.label, ok: true });
    } catch (e: any) {
      results.push({ label: c.label, ok: false, error: e?.code === "P2022" ? "DB에 없음" : e?.message });
    }
  }
  const missing = results.filter((r) => !r.ok);
  return NextResponse.json({
    ok: missing.length === 0,
    results,
    hint: missing.length
      ? "코드스페이스에서 `git pull && npx prisma db push` 를 실행하세요. (재배포 불필요)"
      : undefined,
  });
}
