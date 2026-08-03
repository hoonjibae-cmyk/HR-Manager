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
import { parseSchedule } from "@/lib/constants";
import { computeWeeklyHours } from "@/lib/payroll";
import { isLeaveEligible } from "@/lib/leave";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const employees = await prisma.employee.findMany({
    where: {
      payScheme: "HOURLY",
      OR: [{ active: true }, { resignDate: { gte: monthStart } }],
    },
  });

  // 주휴 개근 판정에 필요한 재료 — 공휴일(소정근로일에서 제외)과 연차(출근으로 간주).
  // 주가 달을 걸치므로 앞뒤로 한 주씩 넉넉히 읽는다.
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const [holidayRows, leaveRows] = await Promise.all([
    prisma.holiday.findMany({
      where: {
        date: {
          gte: new Date(monthStart.getTime() - 7 * 86400000),
          lte: new Date(monthEnd.getTime() + 7 * 86400000),
        },
      },
    }),
    prisma.leaveTransaction.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        date: {
          gte: new Date(monthStart.getTime() - 7 * 86400000),
          lte: new Date(monthEnd.getTime() + 7 * 86400000),
        },
        type: { in: ["USE", "PAYOUT"] },
      },
      select: { employeeId: true, date: true, days: true },
    }),
  ]);
  const holidays = holidayRows.map((h) => ymd(h.date));
  const leaveByEmp = new Map<number, Array<{ date: string; days: number }>>();
  for (const t of leaveRows) {
    const arr = leaveByEmp.get(t.employeeId) ?? [];
    arr.push({ date: ymd(t.date), days: Math.abs(t.days) });
    leaveByEmp.set(t.employeeId, arr);
  }

  // 이미 올려 둔 일별 기록 — 달을 걸친 주(예: 7/27~8/2)의 개근을 판정하려면 앞뒤 달이 필요하다
  const savedDays = await prisma.timesheetDay.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      date: {
        gte: new Date(monthStart.getTime() - 14 * 86400000),
        lte: new Date(monthEnd.getTime() + 14 * 86400000),
      },
    },
    select: { employeeId: true, date: true, hours: true },
  });
  const savedByEmp = new Map<number, Array<{ date: string; hours: number }>>();
  for (const d of savedDays) {
    const arr = savedByEmp.get(d.employeeId) ?? [];
    arr.push({ date: ymd(d.date), hours: d.hours });
    savedByEmp.set(d.employeeId, arr);
  }
  // 직원별 '기록이 시작되는 날' — 이보다 앞은 결근이 아니라 기록 없음으로 본다
  const firstDayRows = await prisma.timesheetDay.groupBy({
    by: ["employeeId"],
    where: { employeeId: { in: employees.map((e) => e.id) } },
    _min: { date: true },
  });
  const firstDay = new Map<number, string>();
  for (const r of firstDayRows) if (r._min.date) firstDay.set(r.employeeId, ymd(r._min.date));

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
    // 이번에 올린 파일의 일별 합계 (같은 날 여러 줄이면 합산)
    const fileByDate = new Map<string, number>();
    for (const e of p.entries) fileByDate.set(e.date, (fileByDate.get(e.date) ?? 0) + e.hours);
    // 지난번에 올려 둔 기록 위에 이번 파일을 덮는다 (같은 날은 새 파일이 이긴다)
    const mergedByDate = new Map<string, number>();
    for (const d of savedByEmp.get(emp.id) ?? []) mergedByDate.set(d.date, d.hours);
    for (const [date, hours] of fileByDate) mergedByDate.set(date, hours);

    // 기록이 시작되는 날 — 이보다 앞선 날은 결근이 아니라 '기록 없음' 으로 본다
    const known =
      [firstDay.get(emp.id), ...fileByDate.keys()].filter(Boolean).sort()[0] ?? null;

    const r = computeMonthlyFromEntries([...mergedByDate].map(([date, hours]) => ({ date, hours })), {
      year,
      month,
      breakPaid: emp.breakPaid,
      schedule: parseSchedule(emp.schedule),
      holidays,
      leaveUses: leaveByEmp.get(emp.id) ?? [],
      // 연차 유급 인정은 연차 발생 대상 직원에게만 (초단시간은 §18③ 으로 연차 미적용)
      leavePaid: isLeaveEligible(
        computeWeeklyHours(parseSchedule(emp.schedule)).weeklyContractual,
        (emp as any).leaveEligible
      ),
      hireDate: ymd(emp.hireDate),
      resignDate: emp.resignDate ? ymd(emp.resignDate) : null,
      knownFrom: known,
    });
    if (r.workedDays === 0) {
      noRecords.push(p.rawName);
      continue;
    }
    inputs[emp.id] = {
      workedHours: Math.round(r.paidHours * 100) / 100,
      weeklyHolidayHours: Math.round(r.weeklyHolidayHours * 100) / 100,
      // 명세서에 '체류 / 휴게 / 순 근로 / 연차' 를 나눠 적기 위한 근거
      timesheet: {
        stayHours: r.stayHours,
        breakHours: r.breakHours,
        netHours: r.netHours,
        leaveHours: r.leaveHours,
        leaveDays: r.leaveDays,
        paidHours: r.paidHours,
        workedDays: r.workedDays,
        breakPaid: emp.breakPaid,
        dailyContractual: r.dailyContractual,
      },
    };
    matched.push({
      employeeId: emp.id,
      name: emp.name,
      breakPaid: emp.breakPaid,
      workedDays: r.workedDays,
      stayHours: r.stayHours,
      breakHours: r.breakHours,
      netHours: r.netHours,
      leaveHours: r.leaveHours,
      leaveDays: r.leaveDays,
      workHours: r.paidHours,
      weeklyHolidayHours: Math.round(r.weeklyHolidayHours * 100) / 100,
      noSchedule: r.noSchedule,
      weeks: r.weeks.map((w) => ({
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        hours: Math.round(w.hours * 100) / 100,
        contractualHours: Math.round(w.contractualHours * 100) / 100,
        requiredDays: w.requiredDays,
        attendedDays: w.attendedDays,
        leaveDays: w.leaveDays,
        attendedDates: w.attendedDates,
        partial: w.partial,
        qualified: w.qualified,
        // 주휴일이 다음 달인 주는 이 달 합계에 넣지 않는다 (다음 달에서 센다)
        carriedToNextMonth: !w.weekEnd.startsWith(
          `${year}-${String(month).padStart(2, "0")}-`
        ),
        holidayHours: Math.round(w.holidayHours * 100) / 100,
        reason: w.reason ?? null,
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

  // 올린 일별 기록을 남긴다 — 다음 달에 달을 걸친 주를 판정할 때 쓴다
  for (const p of people) {
    const m = matchEmployee(p.rawName, employees);
    if (!m.emp || !ids.includes(m.emp.id)) continue;
    const byDate = new Map<string, number>();
    for (const e of p.entries) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.hours);
    for (const [date, hours] of byDate) {
      await prisma.timesheetDay.upsert({
        where: { employeeId_date: { employeeId: m.emp.id, date: new Date(`${date}T00:00:00Z`) } },
        update: { hours },
        create: { employeeId: m.emp.id, date: new Date(`${date}T00:00:00Z`), hours },
      });
    }
  }

  await runPayrollMonth(year, month, inputs, ids);
  await prisma.auditLog.create({
    data: {
      action: "PAYROLL_TIMESHEET",
      target: `${year}-${String(month).padStart(2, "0")}`,
      summary: `${year}년 ${month}월 시간기록표를 반영해 ${matched.length}명의 급여를 다시 산정했습니다.`,
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
