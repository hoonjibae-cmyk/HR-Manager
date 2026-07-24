import Link from "next/link";
import { prisma } from "@/lib/db";
import { summarizeLeave, type LeaveTxn } from "@/lib/leave";
import { PageHeader } from "@/components/ui";
import LeaveApprovals from "@/components/LeaveApprovals";
import AddLeaveRequest from "@/components/AddLeaveRequest";
import { ymd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeavePage() {
  const now = new Date();
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
      note: t.note ?? undefined,
    });
  });

  const rows = employees.map((e) => ({
    e,
    s: summarizeLeave(e.hireDate, now, txnByEmp[e.id] ?? []),
  }));

  const serializedReqs = pending.map((r) => ({
    id: r.id,
    startDate: r.startDate.toISOString(),
    endDate: r.endDate.toISOString(),
    days: r.days,
    leaveType: r.leaveType,
    reason: r.reason,
    source: r.source,
    employee: { name: r.employee.name, department: r.employee.department },
  }));

  return (
    <div>
      <PageHeader
        title="연차 관리"
        desc="근로기준법 제60조 기준 자동 산정 · 슬랙 신청 → 관리자 승인 → 현황 반영"
        action={<AddLeaveRequest employees={employees.map((e) => ({ id: e.id, name: e.name, department: e.department }))} />}
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
        <div className="px-5 py-3 border-b border-slate-100 font-bold text-slate-800">직원별 연차 현황</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">직원</th>
              <th className="th">근속</th>
              <th className="th text-right">발생</th>
              <th className="th text-right">사용</th>
              <th className="th text-right">소멸</th>
              <th className="th text-right">잔여</th>
              <th className="th">다음 발생</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, s }) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="td">
                  <div className="font-semibold">{e.name}</div>
                  <div className="text-xs text-slate-400">{e.department} {e.position}</div>
                </td>
                <td className="td text-slate-500">{s.serviceLabel}</td>
                <td className="td text-right tnum">{s.granted}</td>
                <td className="td text-right tnum text-slate-500">{s.used}</td>
                <td className="td text-right tnum text-slate-400">{s.expired || "-"}</td>
                <td className="td text-right tnum font-bold text-brand-600">{s.remaining}</td>
                <td className="td text-xs text-slate-400">
                  {s.nextGrantDate ? `${ymd(s.nextGrantDate)} (${s.nextGrantDays}일)` : "-"}
                </td>
                <td className="td text-right">
                  <Link href={`/employees/${e.id}`} className="text-xs text-brand-600 font-semibold">상세 →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
