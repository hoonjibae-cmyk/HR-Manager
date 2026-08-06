import { prisma } from "@/lib/db";
import {
  summarizeLeave,
  summarizeComp,
  usedInPeriod,
  isLeaveEligible,
  type LeaveTxn,
} from "@/lib/leave";
import { computeWeeklyHours } from "@/lib/payroll";
import { parseSchedule } from "@/lib/constants";
import { PageHeader } from "@/components/ui";
import LeaveApprovals from "@/components/LeaveApprovals";
import LeaveImport from "@/components/LeaveImport";
import LeaveAdjust from "@/components/LeaveAdjust";
import { type LeaveRow } from "@/components/LeaveTable";
import LeaveViews from "@/components/LeaveViews";
import { buildLeaveCalendar } from "@/lib/leave-calendar";
import { listHolidays } from "@/lib/holiday-service";
import { listDayOffs } from "@/lib/dayoff-service";
import { gcalConfigured } from "@/lib/gcal";
import DayOffSync from "@/components/DayOffSync";

export const dynamic = "force-dynamic";

export default async function LeavePage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const now = new Date();
  // 기간 필터 (기본: 올해 1/1 ~ 12/31)
  const year = now.getFullYear();
  const from = searchParams.from
    ? new Date(searchParams.from + "T00:00:00Z")
    : new Date(Date.UTC(year, 0, 1));
  const to = searchParams.to
    ? new Date(searchParams.to + "T23:59:59Z")
    : new Date(Date.UTC(year, 11, 31, 23, 59, 59));

  const [employees, txns, pending, allRequests, holidays, dayOffs] = await Promise.all([
    // 위탁계약(프리랜서·완전비율제)은 근로기준법 미적용 → 연차 관리 대상에서 제외
    prisma.employee.findMany({
      where: { active: true, payScheme: { not: "RATIO" }, isContractor: false },
      orderBy: { empNo: "asc" },
    }),
    prisma.leaveTransaction.findMany(),
    prisma.leaveRequest.findMany({
      where: { status: "PENDING" },
      include: { employee: true },
      orderBy: { createdAt: "desc" },
    }),
    // 달력용 — 반려·취소분은 `buildLeaveCalendar` 가 걸러 낸다
    prisma.leaveRequest.findMany({ include: { employee: true }, orderBy: { startDate: "asc" } }),
    listHolidays(),
    // 평일 휴무 — 연차가 아니라 그 주 토요일 당번 근무의 대체다(lib/dayoff.ts)
    listDayOffs(),
  ]);

  const txnByEmp: Record<number, LeaveTxn[]> = {};
  txns.forEach((t) => {
    (txnByEmp[t.employeeId] ??= []).push({
      date: t.date,
      days: t.days,
      type: t.type as any,
      category: (t as any).category ?? "STATUTORY",
      note: t.note ?? undefined,
    });
  });

  const rows = employees.map((e) => {
    const list = txnByEmp[e.id] ?? [];
    // 주 소정근로시간 15시간 미만이면 법정 연차 미발생 (근로기준법 §18③).
    // 계약상 별도로 정한 경우 Employee.leaveEligible 이 우선한다.
    const { weeklyContractual } = computeWeeklyHours(parseSchedule(e.schedule));
    const eligible = isLeaveEligible(weeklyContractual, (e as any).leaveEligible);
    return {
      e,
      weeklyContractual,
      s: summarizeLeave(e.hireDate, now, list, { eligible }),
      c: summarizeComp(list, now),
      p: usedInPeriod(list, from, to),
    };
  });

  const DAY = 86400000;
  const leaveRows: LeaveRow[] = rows.map(({ e, s, c, p, weeklyContractual }) => ({
    id: e.id,
    name: e.name,
    department: e.department,
    position: e.position,
    eligible: s.eligible,
    forcedOff: (e as any).leaveEligible === false,
    weeklyContractual,
    hireDate: e.hireDate.toISOString().slice(0, 10),
    serviceLabel: s.serviceLabel,
    serviceDays: Math.floor((now.getTime() - e.hireDate.getTime()) / DAY),
    periodStart: s.period.start.toISOString().slice(0, 10),
    periodEnd: s.period.end.toISOString().slice(0, 10),
    periodLabel: s.period.label,
    granted: s.period.granted + s.period.carriedOver,
    used: s.period.used,
    remaining: s.period.remaining,
    compGranted: c.granted,
    compUsed: c.used,
    compRemaining: c.remaining,
    rangeStatutory: p.statutory,
    rangeComp: p.comp,
  }));

  const serializedReqs = pending.map((r) => ({
    id: r.id,
    startDate: r.startDate.toISOString(),
    endDate: r.endDate.toISOString(),
    days: r.days,
    leaveType: r.leaveType,
    reason: r.reason,
    workPlan: r.workPlan,
    source: r.source,
    employee: { name: r.employee.name, department: r.employee.department },
  }));

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  // 달력 — 신청서(기간)와 원장(날짜)을 합쳐 날짜별로 편다.
  // 승인 원장은 **시작일 한 줄에 총 일수**라 그것만으로는 여러 날 휴가가 하루로 뭉친다
  // (자세한 사정은 lib/leave-calendar.ts 머리말).
  const empById = new Map(employees.map((e) => [e.id, e]));
  const calendarDays = buildLeaveCalendar({
    requests: allRequests.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      name: r.employee.name,
      department: r.employee.department,
      startDate: fmt(r.startDate),
      endDate: fmt(r.endDate),
      days: r.days,
      leaveType: r.leaveType,
      status: r.status,
      reason: r.reason,
      source: r.source,
    })),
    txns: txns
      // 연차 관리 대상이 아닌 사람(위탁 등)은 표와 같은 기준으로 뺀다
      .filter((t) => empById.has(t.employeeId))
      .map((t) => ({
        id: t.id,
        employeeId: t.employeeId,
        name: empById.get(t.employeeId)!.name,
        department: empById.get(t.employeeId)!.department,
        date: fmt(t.date),
        days: t.days,
        category: (t as any).category ?? "STATUTORY",
        note: t.note,
        requestId: t.requestId,
      })),
    dayOffs: dayOffs
      // 연차 표와 같은 기준으로 대상자만 (위탁 등은 뺀다)
      .filter((d) => empById.has(d.employeeId))
      .map((d) => ({
        id: d.id,
        employeeId: d.employeeId,
        name: d.name,
        department: d.department,
        date: d.date,
        title: d.title,
      })),
    holidays: holidays.map((h) => h.date),
  });

  return (
    /* 화면 높이에 맞춰 표만 안에서 스크롤한다 — 조회 기간·필터·머리글이 늘 붙어 있게 */
    <div className="flex flex-col h-[calc(100dvh-6.5rem)] lg:h-[calc(100dvh-7.5rem)] min-h-[28rem]">
      <PageHeader
        title="연차 관리"
        desc="본래 연차(근로기준법 자동 산정) + 대휴보상연차(운영자 수동 부여) · 슬랙 신청 → 승인 → 반영"
        action={
          <div className="flex items-start gap-2 flex-wrap justify-end">
            <DayOffSync configured={gcalConfigured()} />
            <LeaveImport />
            <LeaveAdjust
              employees={rows.map(({ e, s }) => ({
                id: e.id,
                name: e.name,
                department: e.department,
                hasSlack: !!e.slackUserId,
                eligible: s.eligible,
              }))}
            />
          </div>
        }
      />

      <div className="card mb-4 shrink-0">
        <div className="px-5 py-3 border-b border-slate-100 font-bold text-slate-800">
          승인 대기 {serializedReqs.length > 0 && <span className="text-amber-600">({serializedReqs.length})</span>}
        </div>
        {/* 신청이 몰린 날 이 칸이 화면을 다 먹지 않게 높이를 묶는다 */}
        <div className="overflow-auto max-h-[32vh]">
          <LeaveApprovals requests={serializedReqs} />
        </div>
      </div>

      <LeaveViews
        rows={leaveRows}
        days={calendarDays}
        holidays={holidays}
        year={now.getFullYear()}
        month={now.getMonth() + 1}
        rangeLabel={
          <form method="get" className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">사용 조회 기간</span>
            <input type="date" name="from" defaultValue={fmt(from)} className="input py-1 w-36 text-xs" />
            <span className="text-slate-400">~</span>
            <input type="date" name="to" defaultValue={fmt(to)} className="input py-1 w-36 text-xs" />
            <button className="btn-outline py-1 px-2.5 text-xs">조회</button>
          </form>
        }
      />

      <details className="shrink-0 mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700 select-none">
          표·달력 보는 법 · 연차 규칙
        </summary>
        <p className="text-xs text-slate-400 mt-2 leading-relaxed max-h-[40vh] overflow-auto">
        · <b>본래 연차</b>: 근로기준법 §60 자동 산정 — <b>이번 연차기간(입사일 기준 1년)</b> 의 발생·사용·잔여.
        지난 기간 미사용분은 기간 종료일에 소멸되어 넘어오지 않는다 &nbsp;
        · <b>대휴보상연차</b>: 지정 휴일 근무 보상 등 — <b>&quot;+대휴&quot;</b> 버튼으로 운영자가 직접 부여/차감 &nbsp;
        · <b>기간 내 사용</b>: 위에서 지정한 기간에 사용한 일수 (연차/대휴 구분) &nbsp;
        · <b>연차 미적용</b>: 1주 소정근로시간이 15시간 미만인 초단시간근로자는 연차·주휴가 발생하지 않는다
        (근로기준법 §18③). 직원 카드의 <b>연차 적용</b> 항목으로 계약에 맞춰 바꿀 수 있다 &nbsp;
        · 열 머리글을 누르면 오름차순 → 내림차순 → 원래 순서로 정렬된다 &nbsp;
        · <b>달력 보기</b>: 그날 누가 자리를 비우는지를 날짜 축으로 본다. 표는 &apos;누가 얼마나
        남았나&apos;, 달력은 &apos;그날 누가 없나&apos; 를 보는 자리라 방학·연휴처럼 여러 사람이 겹치는
        날은 달력에서만 보인다 &nbsp;
        · 달력에서 <b>여러 날 휴가는 날짜별로 펼쳐진다</b> — 주말·공휴일은 건너뛰고, 아직 승인하지
        않은 신청은 <b>⚠ 노란색</b>으로 함께 뜬다 (칩을 누르면 사유와 상태가 나온다) &nbsp;
        · 병가·경조사는 연차를 깎지 않지만 자리를 비우는 것은 같아 달력에는 나온다 &nbsp;
        · <b>휴무(주황)</b>는 <b>연차가 아니다</b> — 운영팀이 그 주 토요일 당번 근무 대신 평일 하루를
        쉬는 것이라 <b>연차 잔여를 깎지 않고</b> 위의 &apos;이 달 연차 사용&apos; 합계에도 들어가지 않는다.
        구글 연차 캘린더의 <b>(휴무)홍길동</b> 일정에서 가져오며(매시 자동 · <b>휴무 가져오기</b> 로
        바로 갱신), <b>캘린더가 진실</b>이라 거기서 지우면 여기서도 사라진다.
        </p>
      </details>
    </div>
  );
}
