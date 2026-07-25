import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  parseTimesheetWorkbook,
  computeMonthlyFromEntries,
  dominantPeriod,
  matchEmployee,
} from "@/lib/timesheet";
import { runPayrollMonth, type PayrollInputMap } from "@/lib/payroll-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 시급제 시간기록표(엑셀) 업로드 → 실근로시간·주휴수당 자동 산정 → 급여 생성.
 * 대상 연·월은 파일의 기록 날짜에서 자동 감지한다 (화면 선택값은 예비용).
 * formData: file(xlsx), year, month
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart form 필요" }, { status: 400 });
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file 이 필요합니다" }, { status: 400 });

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

  // 대상 연·월: 파일 기록에서 자동 감지 (없으면 화면 선택값)
  const detected = dominantPeriod(people);
  const year = detected?.year ?? Number(form.get("year"));
  const month = detected?.month ?? Number(form.get("month"));
  if (!year || !month) {
    return NextResponse.json({ error: "기록에서 날짜를 찾지 못했습니다" }, { status: 400 });
  }

  // 시급제 직원 (해당 월 중 퇴사자 포함)
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const employees = await prisma.employee.findMany({
    where: {
      payScheme: "HOURLY",
      OR: [{ active: true }, { resignDate: { gte: monthStart } }],
    },
  });

  const inputs: PayrollInputMap = {};
  const matched: any[] = [];
  const unmatched: string[] = []; // 직원 카드 없음 / 동명 모호
  const noRecords: string[] = []; // 매칭됐지만 해당 월 기록 없음

  for (const p of people) {
    const m = matchEmployee(p.rawName, employees);
    if (m.ambiguous) {
      unmatched.push(`${p.rawName} (동명 후보: ${m.ambiguous.map((e) => e.name).join("/")})`);
      continue;
    }
    if (!m.emp) {
      unmatched.push(p.rawName);
      continue;
    }
    const emp = m.emp;
    const r = computeMonthlyFromEntries(p.entries, {
      year,
      month,
      breakPaid: emp.breakPaid,
    });
    if (r.workedDays === 0) {
      noRecords.push(p.rawName);
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
      {
        error:
          `${year}년 ${month}월 기록과 매칭된 시급제 직원이 없습니다. ` +
          `직원 관리에 해당 직원들이 '시급제'로 등록되어 있는지 확인하세요.`,
        unmatched,
        noRecords,
      },
      { status: 400 }
    );
  }

  const ids = matched.map((m) => m.employeeId);
  await runPayrollMonth(year, month, inputs, ids);
  await prisma.auditLog.create({
    data: {
      action: "TIMESHEET_UPLOAD",
      target: `${year}-${month}`,
      detail: JSON.stringify({ matched: matched.length, unmatched, noRecords }),
    },
  });

  return NextResponse.json({
    ok: true,
    year,
    month,
    periodDetected: !!detected,
    matched,
    unmatched,
    noRecords,
  });
}
