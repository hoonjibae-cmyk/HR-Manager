import Link from "next/link";
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
import CompGrantButton from "@/components/CompGrantButton";
import { ymd } from "@/lib/format";

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

  const [employees, txns, pending] = await Promise.all([
    // 완전비율제(위탁)는 프리랜서 계약으로 연차 미적용 → 연차 관리 대상 제외
    prisma.employee.findMany({
      where: { active: true, payScheme: { not: "RATIO" } },
      orderBy: { empNo: "asc" },
    }),
    prisma.leaveTransaction.findMany(),
    prisma.leaveRequest.findMany({
      where: { status: "PENDING" },
      include: { employee: true },
      orderBy: { createdAt: "desc" },
    }),
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

  return (
    <div>
      <PageHeader
        title="연차 관리"
        desc="본래 연차(근로기준법 자동 산정) + 대휴보상연차(운영자 수동 부여) · 슬랙 신청 → 승인 → 반영"
        action={
          <div className="flex items-center gap-2">
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

      <div className="card mb-6">
        <div className="px-5 py-3 border-b border-slate-100 font-bold text-slate-800">
          승인 대기 {serializedReqs.length > 0 && <span className="text-amber-600">({serializedReqs.length})</span>}
        </div>
        <div className="overflow-x-auto">
          <LeaveApprovals requests={serializedReqs} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <span className="font-bold text-slate-800">직원별 연차 현황</span>
          <form method="get" className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">사용 조회 기간</span>
            <input type="date" name="from" defaultValue={fmt(from)} className="input py-1 w-36 text-xs" />
            <span className="text-slate-400">~</span>
            <input type="date" name="to" defaultValue={fmt(to)} className="input py-1 w-36 text-xs" />
            <button className="btn-outline py-1 px-2.5 text-xs">조회</button>
          </form>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th" rowSpan={2}>직원</th>
              <th className="th" rowSpan={2}>근속</th>
              <th className="th" rowSpan={2}>이번 연차기간</th>
              <th className="th text-center border-l border-slate-200" colSpan={3}>본래 연차 <span className="font-normal text-slate-400">(이번 기간)</span></th>
              <th className="th text-center border-l border-slate-200" colSpan={3}>대휴보상연차</th>
              <th className="th text-center border-l border-slate-200" colSpan={2}>기간 내 사용</th>
              <th className="th" rowSpan={2}></th>
            </tr>
            <tr>
              <th className="th text-right border-l border-slate-200">발생</th>
              <th className="th text-right">사용</th>
              <th className="th text-right">잔여</th>
              <th className="th text-right border-l border-slate-200">발생</th>
              <th className="th text-right">사용</th>
              <th className="th text-right">잔여</th>
              <th className="th text-right border-l border-slate-200">연차</th>
              <th className="th text-right">대휴</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, s, c, p, weeklyContractual }) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="td">
                  <Link href={`/employees/${e.id}`} className="font-semibold text-brand-700 hover:underline">{e.name}</Link>
                  {!s.eligible && (
                    <span className="ml-2 pill bg-slate-100 text-slate-500">연차 미적용</span>
                  )}
                  <div className="text-xs text-slate-400">{e.department} {e.position}</div>
                  {!s.eligible && (
                    <div className="text-[11px] text-slate-400">
                      주 소정 {weeklyContractual.toFixed(1)}시간
                      {(e as any).leaveEligible === false ? " · 계약상 미적용" : " · 15시간 미만"}
                    </div>
                  )}
                </td>
                <td className="td text-slate-500 text-xs">{s.serviceLabel}</td>
                <td className="td text-slate-500 text-xs tnum whitespace-nowrap">
                  {fmt(s.period.start)} ~ {fmt(s.period.end)}
                  <div className="text-slate-300">{s.period.label}</div>
                </td>
                <td className="td text-right tnum border-l border-slate-100">
                  {s.period.granted + s.period.carriedOver}
                </td>
                <td className="td text-right tnum text-slate-500">{s.period.used}</td>
                <td className="td text-right tnum font-bold text-brand-600">{s.period.remaining}</td>
                <td className="td text-right tnum border-l border-slate-100">{c.granted}</td>
                <td className="td text-right tnum text-slate-500">{c.used}</td>
                <td className="td text-right tnum font-bold text-emerald-600">{c.remaining}</td>
                <td className="td text-right tnum border-l border-slate-100">{p.statutory || "-"}</td>
                <td className="td text-right tnum">{p.comp || "-"}</td>
                <td className="td text-right">
                  <CompGrantButton employeeId={e.id} employeeName={e.name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-400 px-5 py-3 border-t border-slate-100">
          · <b>본래 연차</b>: 근로기준법 §60 자동 산정 — <b>이번 연차기간(입사일 기준 1년)</b> 의 발생·사용·잔여.
          지난 기간 미사용분은 기간 종료일에 소멸되어 넘어오지 않는다 &nbsp;
          · <b>대휴보상연차</b>: 지정 휴일 근무 보상 등 — <b>"+대휴"</b> 버튼으로 운영자가 직접 부여/차감 &nbsp;
          · <b>기간 내 사용</b>: 위에서 지정한 기간에 사용한 일수 (연차/대휴 구분) &nbsp;
          · <b>연차 미적용</b>: 1주 소정근로시간이 15시간 미만인 초단시간근로자는 연차·주휴가 발생하지 않는다
          (근로기준법 §18③). 직원 카드의 <b>연차 적용</b> 항목으로 계약에 맞춰 바꿀 수 있다.
        </p>
      </div>
    </div>
  );
}
