import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, StatCard, Pill } from "@/components/ui";
import PayrollTrendChart from "@/components/PayrollTrendChart";
import type { TrendRecord } from "@/lib/payroll-trend";
import { INCOME_TYPE_LABEL, PAY_SCHEME_LABEL, LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL } from "@/lib/constants";
import { ymd } from "@/lib/format";
import {
  buildLeaveCalendar,
  upcomingLeave,
  blockRangeLabel,
  leaveAmountLabel,
} from "@/lib/leave-calendar";
import { listHolidays } from "@/lib/holiday-service";
import { listDayOffs } from "@/lib/dayoff-service";
import { renewalAlerts, daysLabel, renewalKindLabel, RENEWAL_LEAD_DAYS } from "@/lib/renewal";
import { upcomingBirthdays } from "@/lib/hr-notify";

export const dynamic = "force-dynamic";

/** 저장된 KST 벽시계를 그대로 읽는다 (앱 전체가 getUTC* 규칙) */
const ymdUtc = (d: Date) => d.toISOString().slice(0, 10);

export default async function Dashboard() {
  const now = new Date();
  const [birthRows, active, byScheme, byDept, pendingLeaves, staffForRenewal, company] =
    await Promise.all([
      // '1주일 내 생일' 카드용 — 재직자의 이름·부서·생일만
      prisma.employee.findMany({
        where: { active: true },
        select: { name: true, department: true, birth: true },
      }),
      prisma.employee.count({ where: { active: true } }),
      // 급여형태·부서 분포는 **재직자만** 센다 — 퇴사자까지 섞으면 분포 합계가 '재직 중' 카드와
      // 어긋나 어느 쪽이 지금 인원인지 알 수 없다
      prisma.employee.groupBy({ by: ["payScheme"], _count: true, where: { active: true } }),
      prisma.employee.groupBy({ by: ["department"], _count: true, where: { active: true } }),
      prisma.leaveRequest.findMany({
        // 중간결재 대기도 함께 — 결재자 부재로 멈춘 건이 대시보드에서 보여야 한다
        where: { status: { in: ["PRE_PENDING", "PENDING"] } },
        include: { employee: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      /*
       * 재계약·연봉협의 판정에는 **재직자의 계약 전부**와 **서명본 스캔의 유무**가 필요하다.
       * 만료일이 있는 계약만 읽던 예전 방식으로는 기한 없는 계약의 연봉협의를 잡을 수 없고,
       * 스캔 여부를 모르면 '재계약서만 만들어 둔 상태' 와 '서명까지 끝난 상태' 를 못 가른다.
       * ⚠ 스캔은 **있는지만** 보면 되므로 `take: 1` 로 끊는다(본문은 절대 읽지 않는다).
       */
      prisma.employee.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          department: true,
          payScheme: true,
          contracts: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              status: true,
              files: { where: { complete: true }, select: { id: true }, take: 1 },
            },
          },
        },
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

  // 1주일 안에 잡힌 휴가 — 승인분과 **승인 대기분을 함께** 낸다.
  // 모레 시작인데 결재가 안 된 건이 가장 급한데, 그건 생성일 순인 승인 대기 목록에서는 안 보인다.
  // 창(오늘~+7일)에 걸치는 신청만 읽는다 — 대시보드는 자주 열리는 화면이라 전부 읽지 않는다.
  const WEEK_MS = 7 * 86400000;
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windowEnd = new Date(windowStart.getTime() + WEEK_MS);
  const [weekRequests, weekTxns, weekHolidays, weekDayOffs] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { startDate: { lte: windowEnd }, endDate: { gte: windowStart } },
      include: { employee: true },
    }),
    // 신청서 없이 관리자가 바로 반영한 사용분 (`requestId == null`) 도 자리를 비우는 것은 같다
    prisma.leaveTransaction.findMany({
      where: { date: { gte: windowStart, lte: windowEnd }, days: { lt: 0 }, requestId: null },
      include: { employee: { select: { name: true, department: true } } },
    }),
    listHolidays(),
    // 평일 휴무도 '그날 자리에 없다' 는 같은 정보다 — 빼면 대시보드와 연차 달력이 어긋난다
    listDayOffs(ymdUtc(windowStart), ymdUtc(windowEnd)),
  ]);
  const upcoming = upcomingLeave(
    buildLeaveCalendar({
      requests: weekRequests.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        name: r.employee.name,
        department: r.employee.department,
        startDate: ymdUtc(r.startDate),
        endDate: ymdUtc(r.endDate),
        days: r.days,
        leaveType: r.leaveType,
        status: r.status,
        reason: r.reason,
      })),
      txns: weekTxns.map((t) => ({
        id: t.id,
        employeeId: t.employeeId,
        name: t.employee?.name ?? "",
        department: t.employee?.department ?? null,
        date: ymdUtc(t.date),
        days: t.days,
        category: (t as any).category ?? "STATUTORY",
        note: t.note,
        requestId: t.requestId,
      })),
      dayOffs: weekDayOffs,
      holidays: weekHolidays.map((h) => h.date),
    }),
    now,
    { holidays: weekHolidays.map((h) => h.date) }
  );

  /*
   * 재계약 · 연봉협의 — 판정은 lib/renewal.ts(순수 함수, 테스트 있음).
   * **새 계약을 만든 것만으로는 안 내려간다** — 그 계약에 서명본 스캔이 붙어야 합의가 끝난 것이다.
   */
  const renewals = renewalAlerts(
    staffForRenewal.map((e) => ({
      id: e.id,
      name: e.name,
      department: e.department,
      payScheme: e.payScheme,
      contracts: e.contracts.map((c) => ({
        id: c.id,
        startDate: c.startDate,
        endDate: c.endDate,
        status: c.status,
        hasScan: c.files.length > 0,
      })),
    })),
    now
  );

  const schemeMap: Record<string, number> = {};
  byScheme.forEach((s) => (schemeMap[s.payScheme] = s._count));

  // 부서별 분포 — 인원 많은 순, 부서가 빈 사람은 '미지정' 으로 맨 뒤에
  const deptRows = byDept
    .map((d) => ({ label: d.department?.trim() || "미지정", n: d._count }))
    .sort((a, b) => (a.label === "미지정" ? 1 : b.label === "미지정" ? -1 : b.n - a.n));

  // 1주일 내 생일 — 실제 생일 날짜 그대로 (슬랙 알림의 평일 앞당김과 다른 용도)
  const bdays = upcomingBirthdays(birthRows, ymdUtc(now));
  const bdayLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const bdaySub = bdays.length
    ? bdays
        .slice(0, 3)
        .map((b) => `${bdayLabel(b.date)} ${b.name}`)
        .join(" · ") + (bdays.length > 3 ? ` 외 ${bdays.length - 3}명` : "")
    : undefined;

  return (
    <div>
      <PageHeader
        title="대시보드"
        desc={`${company?.name ?? "주식회사 유쌤에듀"} · 오늘 ${ymd(now)}`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="재직 중" value={`${active}명`} href="/employees" accent="text-emerald-600" />
        {/* '전체 직원(퇴사자 포함)' 은 뺐다 — 매일 보는 화면에서 판단에 쓰이는 수가 아니다.
            퇴사자 수는 직원 관리의 재직상태 필터로 본다. */}
        <StatCard
          label="1주일 내 생일"
          value={`${bdays.length}명`}
          sub={bdaySub}
          accent={bdays.length ? "text-brand-600" : ""}
        />
        <StatCard
          label="연차 승인대기"
          value={`${pendingLeaves.length}건`}
          href="/leave"
          accent={pendingLeaves.length ? "text-amber-600" : ""}
        />
        <StatCard
          label={`재계약·연봉협의(${RENEWAL_LEAD_DAYS}일)`}
          value={`${renewals.length}건`}
          accent={renewals.length ? "text-red-600" : ""}
        />
      </div>

      <div className="mb-6">
        <PayrollTrendChart records={trendRecords} />
      </div>

      {/* 넷을 한 줄에 두되 **연차 승인 대기 옆에 '곧 자리를 비울 사람'** 이 붙게 한다 —
          결재할 것과 그 결과로 생기는 공백은 함께 봐야 판단이 된다.
          좁은 화면(lg)에서는 2×2 로 접히고, 그때도 두 분포 카드끼리·두 연차 카드끼리 이웃한다. */}
      <div className="grid lg:grid-cols-2 xl:grid-cols-4 gap-6">
        {/* 급여형태 분포 */}
        <DistributionCard
          title="급여형태 분포"
          active={active}
          rows={Object.entries(PAY_SCHEME_LABEL).map(([k, label]) => ({
            label,
            n: schemeMap[k] ?? 0,
          }))}
        />
        {/* 부서별 분포 — 같은 골격 */}
        <DistributionCard title="부서별 분포" active={active} rows={deptRows} />

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

        {/* 1주일 내 연차 예정 — 승인 대기 바로 옆 */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-800">
              1주일 내 휴가 · 휴무
              {upcoming.length > 0 && (
                <span className="text-xs font-normal text-slate-400 ml-2">
                  {new Set(upcoming.map((b) => b.employeeId)).size}명
                </span>
              )}
            </h2>
            <Link href="/leave" className="text-xs text-brand-600 font-semibold">
              달력 보기 →
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              앞으로 7일 안에 잡힌 휴가·휴무가 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((b) => (
                <li key={b.key} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/leave/${b.employeeId}`}
                      className="font-semibold text-sm hover:text-brand-600 truncate"
                    >
                      {b.name}
                    </Link>
                    <span className="text-xs text-slate-500 shrink-0">{blockRangeLabel(b, now)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-slate-400 truncate">
                      {b.department ?? "부서 미지정"} ·{" "}
                      {leaveAmountLabel(b.leaveType, b.days, LEAVE_TYPE_LABEL[b.leaveType] ?? b.leaveType)}
                    </span>
                    {/* 승인분에는 배지를 달지 않는다 — 대부분이 승인분이라 배지가 늘어서면 대기 건이 묻힌다 */}
                    {b.status === "PENDING" && (
                      <span className="pill bg-amber-100 text-amber-800 shrink-0">승인 대기</span>
                    )}
                    {b.status === "CANCEL_PENDING" && (
                      <span className="pill bg-slate-100 text-slate-500 shrink-0">취소 요청</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 재계약 · 연봉협의 */}
      {renewals.length > 0 && (
        <div className="card p-5 mt-6">
          <h2 className="font-bold text-slate-800 mb-1">재계약 · 연봉협의 필요</h2>
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            새 계약을 <b>만드는 것만으로는 사라지지 않습니다</b> — 그 계약 카드에{" "}
            <b>서명본 스캔</b>을 올려야 상호 합의가 끝난 것으로 보고 내려갑니다.
            기한이 지난 건도 계속 남습니다.
          </p>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">직원</th>
                <th className="th">구분</th>
                <th className="th">계약형태</th>
                <th className="th">기준일</th>
                <th className="th">남은 일수</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {renewals.map((r) => (
                <tr key={`${r.employeeId}-${r.kind}`} className={r.overdue ? "bg-rose-50/40" : ""}>
                  <td className="td font-medium">{r.name}</td>
                  <td className="td">
                    <span
                      className={`pill ${
                        r.kind === "RENEW"
                          ? "bg-rose-50 text-rose-700"
                          : "bg-indigo-50 text-indigo-700"
                      }`}
                    >
                      {renewalKindLabel(r.kind, r.payScheme)}
                    </span>
                  </td>
                  <td className="td">
                    <Pill kind={r.payScheme}>{PAY_SCHEME_LABEL[r.payScheme]}</Pill>
                  </td>
                  <td className="td tnum">{r.dueDate}</td>
                  <td className="td tnum">
                    <span
                      className={
                        r.overdue
                          ? "text-red-600 font-bold"
                          : r.daysLeft <= 30
                          ? "text-red-600 font-semibold"
                          : ""
                      }
                    >
                      {daysLabel(r)}
                    </span>
                  </td>
                  <td className="td text-right">
                    <Link
                      href={`/employees/${r.employeeId}#contracts`}
                      className="text-xs text-brand-600 font-semibold"
                    >
                      {r.kind === "RENEW" ? "재계약서 발급 →" : "계약 관리 →"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 분포 카드 — 급여형태·부서가 같은 골격을 쓴다 (두 벌로 두면 한쪽만 고쳐 갈라진다) */
function DistributionCard({
  title,
  active,
  rows,
}: {
  title: string;
  active: number;
  rows: Array<{ label: string; n: number }>;
}) {
  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-4">
        {title} <span className="text-xs font-normal text-slate-400">재직 {active}명 기준</span>
      </h2>
      <div className="space-y-3">
        {rows.map(({ label, n }) => {
          // 분모도 재직자 — 전체(퇴사자 포함)로 나누면 막대 합이 100% 에 못 미친다
          const pct = active ? Math.round((n / active) * 100) : 0;
          return (
            <div key={label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600">{label}</span>
                <span className="font-semibold tnum">{n}명</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
