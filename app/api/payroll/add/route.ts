import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runPayrollMonth } from "@/lib/payroll-service";
import { rosterVerdict, employedInMonth, ymd } from "@/lib/payroll-roster";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 그 달 시트에 **없는** 직원 목록 — 수동 추가 후보.
 * 퇴직자가 먼저 나오게 세운다(이 화면을 여는 이유가 대개 그쪽이다).
 */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });

  const [onSheet, emps] = await Promise.all([
    prisma.payrollRecord.findMany({ where: { year, month }, select: { employeeId: true } }),
    prisma.employee.findMany({
      select: {
        id: true,
        name: true,
        empNo: true,
        department: true,
        position: true,
        active: true,
        hireDate: true,
        resignDate: true,
      },
      orderBy: { empNo: "asc" },
    }),
  ]);
  const on = new Set(onSheet.map((r) => r.employeeId));
  const candidates = emps
    .filter((e) => !on.has(e.id))
    .map((e) => {
      const v = rosterVerdict(e, year, month);
      return {
        id: e.id,
        name: e.name,
        empNo: e.empNo,
        department: e.department,
        position: e.position,
        resignDate: e.resignDate ? ymd(e.resignDate) : null,
        hireDate: ymd(e.hireDate),
        /** 재직 기간이 있는데도 시트에 없는 사람 — 산정을 아직 안 돌린 것뿐이다 */
        employed: employedInMonth(e, year, month),
        reason: v.reason,
        note: v.note,
      };
    })
    .sort((a, b) => {
      const rank = (c: typeof a) => (c.reason === "RESIGNED" ? 0 : c.reason === "NOT_HIRED" ? 2 : 1);
      return rank(a) - rank(b) || a.empNo.localeCompare(b.empNo);
    });
  return NextResponse.json({ year, month, candidates });
}

/**
 * 지목한 직원을 그 달 시트에 올린다.
 * 재직 기간이 없으면 `manualAdd` 표시가 남아 다음 배치 산정이 다시 내리지 않는다.
 * 기본급은 일할계산 0% 라 0 원이고, 인센티브·상여·미사용 연차수당처럼
 * **직접 넣는 항목만** 지급된다 — 퇴직 정산이 이 경로의 쓰임새다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { year, month, employeeIds } = await req.json();
  if (!year || !month) return NextResponse.json({ error: "year/month 필요" }, { status: 400 });
  const ids = (Array.isArray(employeeIds) ? employeeIds : []).map(Number).filter(Boolean);
  if (!ids.length) return NextResponse.json({ error: "추가할 직원을 고르세요" }, { status: 400 });

  const { records } = await runPayrollMonth(Number(year), Number(month), {}, ids, {
    manualAdd: true,
  });
  const added = records.filter((r: any) => ids.includes(r.employeeId));
  const emps = await prisma.employee.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const names = emps.map((e) => e.name).join(", ");
  await logActivity({
    action: "PAYROLL_ADD",
    target: `${year}-${String(month).padStart(2, "0")}`,
    summary: `${year}년 ${month}월 급여 시트에 ${added.length}명을 직접 추가했습니다. ${names}`,
    meta: { employeeIds: ids, manual: added.filter((r: any) => r.manualAdd).length },
  });
  return NextResponse.json({ ok: true, count: added.length });
}
