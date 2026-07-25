import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseIncentiveWorkbook, summarizeIncentive, studentWeight } from "@/lib/incentive";
import { matchEmployee } from "@/lib/timesheet";
import { runPayrollMonth } from "@/lib/payroll-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 인센티브 학생 명단(엑셀) 업로드 → 회차 비례 가중 인원 산정 → 해당 강사 급여 재계산.
 * 파일 상단의 "○○년 ○월" · "○○○ 선생님" 으로 대상 월·강사를 자동 인식한다.
 * formData: file(xlsx), year, month(화면 선택값 — 파일에 없을 때 사용)
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart form 필요" }, { status: 400 });
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file 이 필요합니다" }, { status: 400 });

  let parsed;
  try {
    parsed = parseIncentiveWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e: any) {
    return NextResponse.json({ error: "엑셀 파싱 실패: " + e.message }, { status: 400 });
  }
  if (!parsed.students.length) {
    return NextResponse.json(
      {
        error:
          "명단에서 학생 표를 찾지 못했습니다. 열 제목(이름/반/입학일/퇴원일)이 있는 양식인지 확인하세요.",
      },
      { status: 400 }
    );
  }

  const now = new Date();
  const year = parsed.year ?? (Number(form.get("year")) || now.getFullYear());
  const month = parsed.month ?? (Number(form.get("month")) || now.getMonth() + 1);

  if (!parsed.teacherName) {
    return NextResponse.json(
      { error: "파일에서 강사명을 찾지 못했습니다. 상단에 '○○○ 선생님' 표기가 필요합니다." },
      { status: 400 }
    );
  }

  const employees = await prisma.employee.findMany();
  const matched = matchEmployee(parsed.teacherName, employees);
  const emp = matched.emp;
  if (!emp) {
    return NextResponse.json(
      {
        error: matched.ambiguous?.length
          ? `'${parsed.teacherName}' 과(와) 이름이 겹치는 직원이 여러 명입니다: ${matched.ambiguous
              .map((e) => e.name)
              .join(", ")}`
          : `'${parsed.teacherName}' 직원 카드를 찾지 못했습니다.`,
        teacherName: parsed.teacherName,
      },
      { status: 400 }
    );
  }
  if (emp.payScheme !== "INCENTIVE") {
    return NextResponse.json(
      {
        error: `${emp.name} 님은 급여형태가 '월급+인센티브'가 아닙니다. 직원 카드에서 변경 후 다시 업로드하세요.`,
      },
      { status: 400 }
    );
  }

  // 명단 교체 (해당 강사·월)
  await prisma.$transaction([
    prisma.incentiveStudent.deleteMany({ where: { employeeId: emp.id, year, month } }),
    prisma.incentiveStudent.createMany({
      data: parsed.students.map((s) => ({
        employeeId: emp.id,
        year,
        month,
        seq: s.seq ?? null,
        status: s.status,
        name: s.name,
        className: s.className ?? null,
        school: s.school ?? null,
        enrollDate: s.enrollDate ?? null,
        withdrawDate: s.withdrawDate ?? null,
        sessions: s.sessions ?? null,
        fullSessions: s.fullSessions ?? 8,
        weight: studentWeight(s),
      })),
    }),
  ]);

  const summary = summarizeIncentive(parsed.students, {
    threshold: emp.incThreshold ?? 0,
    perStudent: emp.incPerStudent ?? 0,
  });

  // 해당 강사만 급여 재계산 (확정·발송된 기록은 서비스에서 보호)
  await runPayrollMonth(year, month, {}, [emp.id]);

  return NextResponse.json({
    ok: true,
    year,
    month,
    employeeId: emp.id,
    name: emp.name,
    teacherName: parsed.teacherName,
    threshold: summary.threshold,
    perStudent: summary.perStudent,
    perSession: summary.perSession,
    totalCount: summary.totalCount,
    fullCount: summary.fullCount,
    partialCount: summary.partialCount,
    units: summary.units,
    over: summary.over,
    amount: summary.amount,
    monthlyPayInFile: parsed.monthlyPay,
    baseWage: emp.baseWage,
    partials: summary.rows
      .filter((r) => r.weight < 1 || r.amount > 0)
      .slice(0, 40)
      .map((r) => ({
        name: r.name,
        status: r.status,
        sessions: r.sessions,
        weight: Number(r.weight.toFixed(3)),
        amount: r.amount,
      })),
  });
}

/** 명단 조회 (강사·월) */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const employeeId = Number(searchParams.get("employeeId"));
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!employeeId || !year || !month)
    return NextResponse.json({ error: "employeeId/year/month 필요" }, { status: 400 });
  const rows = await prisma.incentiveStudent.findMany({
    where: { employeeId, year, month },
    orderBy: [{ seq: "asc" }, { id: "asc" }],
  });
  return NextResponse.json(rows);
}
