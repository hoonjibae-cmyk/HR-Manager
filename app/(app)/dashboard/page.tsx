import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, StatCard, Pill } from "@/components/ui";
import PayrollTrendChart from "@/components/PayrollTrendChart";
import type { TrendRecord } from "@/lib/payroll-trend";
import { INCOME_TYPE_LABEL, PAY_SCHEME_LABEL, LEAVE_STATUS_LABEL } from "@/lib/constants";
import { ymd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const now = new Date();
  const [total, active, byScheme, pendingLeaves, recentContracts, company] =
    await Promise.all([
      prisma.employee.count(),
      prisma.employee.count({ where: { active: true } }),
      prisma.employee.groupBy({ by: ["payScheme"], _count: true }),
      prisma.leaveRequest.findMany({
        where: { status: "PENDING" },
        include: { employee: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.contract.findMany({
        where: { endDate: { not: null } },
        include: { employee: true },
        orderBy: { endDate: "asc" },
      }),
      prisma.company.findFirst(),
    ]);

  // 월별 급여 추이 — **급여가 산정된 달만** 나온다(빈 달을 0으로 채우면 '0원이었던 달' 로 읽힌다).
  // 부서는 급여 레코드에 없어 직원 카드에서 가져온다 — 지금 부서 기준이라는 뜻이다.
  const payrolls = await prisma.payrollRecord.findMany({
    orderBy: [{ year: "asc" }, { month: "asc" }],
    include: { employee: { select: { department: true } } },
  });
  const trendRecords: TrendRecord[] = payrolls.map((p) => ({
    year: p.year,
    month: p.month,
    department: p.employee?.department ?? null,
    payScheme: p.payScheme,
    baseP: p.baseP,
    weeklyHolidayP: p.weeklyHolidayP,
    positionP: p.positionP,
    mealP: p.mealP,
    carP: p.carP,
    incentiveP: p.incentiveP,
    bonusP: p.bonusP,
    unusedLeaveP: p.unusedLeaveP,
    extraP: p.extraP,
    overtimeP: p.overtimeP,
    nightP: p.nightP,
    holidayP: p.holidayP,
    extraHours: p.extraHours,
    overtimeHours: p.overtimeHours,
    nightHours: p.nightHours,
    holidayHours: p.holidayHours,
    holidayOverHours: p.holidayOverHours,
    hourlyWage: p.hourlyWage,
  }));

  // 60일 내 계약 만료 예정
  const soon = recentContracts.filter((c) => {
    if (!c.endDate) return false;
    const days = (c.endDate.getTime() - now.getTime()) / 86400000;
    return days >= 0 && days <= 60;
  });

  const schemeMap: Record<string, number> = {};
  byScheme.forEach((s) => (schemeMap[s.payScheme] = s._count));

  return (
    <div>
      <PageHeader
        title="대시보드"
        desc={`${company?.name ?? "주식회사 유쌤에듀"} · 오늘 ${ymd(now)}`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="전체 직원" value={`${total}명`} href="/employees" />
        <StatCard label="재직 중" value={`${active}명`} accent="text-emerald-600" />
        <StatCard
          label="연차 승인대기"
          value={`${pendingLeaves.length}건`}
          href="/leave"
          accent={pendingLeaves.length ? "text-amber-600" : ""}
        />
        <StatCard
          label="계약 만료 임박(60일)"
          value={`${soon.length}건`}
          accent={soon.length ? "text-red-600" : ""}
        />
      </div>

      <div className="mb-6">
        <PayrollTrendChart records={trendRecords} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* 급여형태 분포 */}
        <div className="card p-5">
          <h2 className="font-bold text-slate-800 mb-4">급여형태 분포</h2>
          <div className="space-y-3">
            {Object.entries(PAY_SCHEME_LABEL).map(([k, label]) => {
              const n = schemeMap[k] ?? 0;
              const pct = total ? Math.round((n / total) * 100) : 0;
              return (
                <div key={k}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">{label}</span>
                    <span className="font-semibold tnum">{n}명</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 연차 승인 대기 */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-800">연차 승인 대기</h2>
            <Link href="/leave" className="text-xs text-brand-600 font-semibold">
              전체 보기 →
            </Link>
          </div>
          {pendingLeaves.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              대기 중인 연차 신청이 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pendingLeaves.map((l) => (
                <li key={l.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sm">{l.employee.name}</span>
                    <span className="text-xs text-slate-400 ml-2">
                      {ymd(l.startDate)}
                      {l.days > 1 ? ` ~ ${ymd(l.endDate)}` : ""} · {l.days}일
                    </span>
                  </div>
                  <Pill kind={l.status}>{LEAVE_STATUS_LABEL[l.status]}</Pill>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 계약 만료 임박 */}
      {soon.length > 0 && (
        <div className="card p-5 mt-6">
          <h2 className="font-bold text-slate-800 mb-4">
            재계약 필요 (60일 내 만료)
          </h2>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">직원</th>
                <th className="th">계약형태</th>
                <th className="th">만료일</th>
                <th className="th">남은 일수</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {soon.map((c) => {
                const days = Math.ceil(
                  (c.endDate!.getTime() - now.getTime()) / 86400000
                );
                return (
                  <tr key={c.id}>
                    <td className="td font-medium">{c.employee.name}</td>
                    <td className="td">
                      <Pill kind={c.employee.payScheme}>
                        {PAY_SCHEME_LABEL[c.employee.payScheme]}
                      </Pill>
                    </td>
                    <td className="td tnum">{ymd(c.endDate)}</td>
                    <td className="td tnum">
                      <span className={days <= 30 ? "text-red-600 font-semibold" : ""}>
                        {days}일
                      </span>
                    </td>
                    <td className="td text-right">
                      <Link
                        href={`/employees/${c.employeeId}`}
                        className="text-xs text-brand-600 font-semibold"
                      >
                        재계약서 발급 →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
