import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  parseTimesheetWorkbook,
  computeMonthlyFromEntries,
  normalizeName,
} from "@/lib/timesheet";
import { runPayrollMonth, type PayrollInputMap } from "@/lib/payroll-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 시급제 시간기록표(엑셀) 업로드 → 실근로시간·주휴수당 자동 산정 → 급여 생성.
 * formData: file(xlsx), year, month
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart form 필요" }, { status: 400 });
  const file = form.get("file") as File | null;
  const year = Number(form.get("year"));
  const month = Number(form.get("month"));
  if (!file || !year || !month) {
    return NextResponse.json({ error: "file, year, month 가 필요합니다" }, { status: 400 });
  }

  let people;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    people = parseTimesheetWorkbook(buf);
  } catch (e: any) {
    return NextResponse.json({ error: "엑셀 파싱 실패: " + e.message }, { status: 400 });
  }
  if (people.length === 0) {
    return NextResponse.json(
      { error: "기록표에서 직원 표를 찾지 못했습니다. 양식(날짜/출근/퇴근/근무시간 열)을 확인하세요." },
      { status: 400 }
    );
  }

  // 시급제 직원과 이름 매칭 (해당 월 퇴사자 포함)
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const employees = await prisma.employee.findMany({
    where: {
      payScheme: "HOURLY",
      OR: [{ active: true }, { resignDate: { gte: monthStart } }],
    },
  });
  const byName = new Map(employees.map((e) => [normalizeName(e.name), e]));

  const inputs: PayrollInputMap = {};
  const matched: any[] = [];
  const unmatched: string[] = [];

  for (const p of people) {
    const emp = byName.get(p.name);
    if (!emp) {
      unmatched.push(p.rawName);
      continue;
    }
    const r = computeMonthlyFromEntries(p.entries, {
      year,
      month,
      breakPaid: emp.breakPaid,
    });
    if (r.workedDays === 0) {
      unmatched.push(`${p.rawName} (해당 월 기록 없음)`);
      continue;
    }
    inputs[emp.id] = {
      workedHours: Math.round(r.workHours * 100) / 100,
      weeklyHolidayHours: Math.round(r.weeklyHolidayHours * 100) / 100,
    };
    matched.push({
      employeeId: emp.id,
      name: emp.name,
      breakPaid: emp.breakPaid,
      workedDays: r.workedDays,
      workHours: Math.round(r.workHours * 100) / 100,
      weeklyHolidayHours: Math.round(r.weeklyHolidayHours * 100) / 100,
      weeks: r.weeks.map((w) => ({
        weekStart: w.weekStart,
        hours: Math.round(w.hours * 100) / 100,
        qualified: w.qualified,
        holidayHours: Math.round(w.holidayHours * 100) / 100,
      })),
    });
  }

  if (matched.length === 0) {
    return NextResponse.json(
      { error: "매칭된 시급제 직원이 없습니다.", unmatched },
      { status: 400 }
    );
  }

  const ids = matched.map((m) => m.employeeId);
  await runPayrollMonth(year, month, inputs, ids);
  await prisma.auditLog.create({
    data: {
      action: "TIMESHEET_UPLOAD",
      target: `${year}-${month}`,
      detail: JSON.stringify({ matched: matched.length, unmatched }),
    },
  });

  return NextResponse.json({ ok: true, year, month, matched, unmatched });
}
