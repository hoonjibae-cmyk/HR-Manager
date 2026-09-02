import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { leaveSummaryFor } from "@/lib/repo";
import { PageHeader, Pill, Empty } from "@/components/ui";
import { LEAVE_TYPE_LABEL } from "@/lib/constants";
import CompGrantButton from "@/components/CompGrantButton";

export const dynamic = "force-dynamic";

/** 2026-07-29 → "7월 29일 (수)" */
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(d: Date): string {
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** 트랜잭션 한 줄을 사람 말로 — "연차 1일 사용" */
function txnLabel(t: { days: number; type: string; category: string }): string {
  const pool = t.category === "COMP" ? "대휴" : "연차";
  const n = Math.abs(t.days);
  if (t.days < 0) return `${pool} ${n}일 사용`;
  if (t.type === "GRANT") return `${pool} ${n}일 발생`;
  if (t.type === "PAYOUT") return `${pool} ${n}일 수당 지급`;
  return `${pool} ${n}일 부여(조정)`;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "승인 대기",
  APPROVED: "승인",
  REJECTED: "반려",
  CANCEL_PENDING: "취소 요청",
  CANCELED: "취소됨",
};

export default async function EmployeeLeavePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { year?: string };
}) {
  const id = Number(params.id);
  if (!id) notFound();

  const now = new Date();
  const year = searchParams.year ? Number(searchParams.year) : null; // null = 전체

  const [{ emp, summary, comp, weeklyContractual }, txns, requests] = await Promise.all([
    leaveSummaryFor(id, now).catch(() => null as any),
    prisma.leaveTransaction.findMany({ where: { employeeId: id }, orderBy: { date: "desc" } }),
    prisma.leaveRequest.findMany({ where: { employeeId: id }, orderBy: { startDate: "desc" } }),
  ]).catch(() => [null, [], []] as any);
  if (!emp) notFound();

  // 연도 필터 — 기록이 있는 연도만 고른다
  const years = Array.from(
    new Set([
      ...txns.map((t: any) => t.date.getUTCFullYear()),
      ...requests.map((r: any) => r.startDate.getUTCFullYear()),
    ])
  ).sort((a, b) => b - a);

  const inYear = (d: Date) => year == null || d.getUTCFullYear() === year;
  const shownTxns = txns.filter((t: any) => inYear(t.date));
  const shownReqs = requests.filter((r: any) => inYear(r.startDate));

  // 사용/부여를 나눠 합계를 낸다 (표시 중인 범위 기준)
  const usedAnnual = shownTxns
    .filter((t: any) => t.days < 0 && (t.category ?? "STATUTORY") !== "COMP")
    .reduce((a: number, t: any) => a + Math.abs(t.days), 0);
  const usedComp = shownTxns
    .filter((t: any) => t.days < 0 && t.category === "COMP")
    .reduce((a: number, t: any) => a + Math.abs(t.days), 0);

  const p = summary.period;
  const tab = (y: number | null, label: string) => (
    <Link
      key={label}
      href={y == null ? `/leave/${id}` : `/leave/${id}?year=${y}`}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
        year === y ? "bg-brand-50 text-brand-700" : "text-slate-400 hover:text-slate-600"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div>
      <PageHeader
        title={`${emp.name} — 연차 내역`}
        desc={`${emp.department ?? ""} ${emp.position ?? ""} · 입사 ${ymd(emp.hireDate)} · ${
          summary.serviceLabel.startsWith("입사")
            ? summary.serviceLabel
            : `근속 ${summary.serviceLabel}`
        }`}
        action={
          <div className="flex items-center gap-2">
            <Link href={`/employees/${emp.id}`} className="btn-outline">
              직원 정보
            </Link>
            <Link href="/leave" className="btn-ghost">
              목록
            </Link>
          </div>
        }
      />

      {!summary.eligible && (
        <div className="card p-4 mb-6 bg-slate-50 border-slate-200">
          <p className="text-sm text-slate-600">
            <b>연차 미적용</b> — 1주 소정근로시간 {weeklyContractual.toFixed(1)}시간
            {(emp as any).leaveEligible === false
              ? " · 계약상 연차 미적용으로 지정됨"
              : " (15시간 미만)"}
            . 근로기준법 제18조 제3항에 따라 법정 연차가 발생하지 않습니다.
            아래 <b>발생</b>은 관리자가 직접 부여한 분만 표시됩니다.
          </p>
        </div>
      )}

      {/* 현재 상태 */}
      <div className="grid sm:grid-cols-4 gap-3 mb-6">
        <div className="card p-4">
          <div className="text-xs text-slate-400">이번 연차기간 발생</div>
          <div className="text-2xl font-bold tnum mt-1">
            {p.granted + p.carriedOver}
            <span className="text-sm font-normal text-slate-400 ml-1">일</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {ymd(p.start)} ~ {ymd(p.end)} · {p.label}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-400">이번 기간 사용</div>
          <div className="text-2xl font-bold tnum mt-1 text-slate-600">
            {p.used}
            <span className="text-sm font-normal text-slate-400 ml-1">일</span>
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-400">잔여</div>
          <div className="text-2xl font-bold tnum mt-1 text-brand-600">
            {p.remaining}
            <span className="text-sm font-normal text-slate-400 ml-1">일</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            사용기한 {ymd(p.end)} — 미사용분 소멸
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">대휴보상연차</div>
            <CompGrantButton employeeId={emp.id} employeeName={emp.name} />
          </div>
          <div className="text-2xl font-bold tnum mt-1 text-emerald-600">
            {comp.remaining}
            <span className="text-sm font-normal text-slate-400 ml-1">일</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            발생 {comp.granted} · 사용 {comp.used} · 기한 없음
          </div>
        </div>
      </div>

      {/* 사용·반영 내역 — 이 화면의 본체 */}
      <div className="card mb-6">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <span className="font-bold text-slate-800">사용 · 반영 내역</span>
          <span className="text-xs text-slate-400">
            {year ? `${year}년` : "전체"} · 연차 {usedAnnual}일
            {usedComp > 0 && ` · 대휴 ${usedComp}일`} 사용
          </span>
          <div className="ml-auto flex items-center gap-1">
            {tab(null, "전체")}
            {years.map((y) => tab(y, `${y}년`))}
          </div>
        </div>

        {shownTxns.length === 0 ? (
          <Empty>기록이 없습니다.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shownTxns.map((t: any) => {
              const isUse = t.days < 0;
              const isComp = t.category === "COMP";
              return (
                <li key={t.id} className="px-5 py-3 flex items-start gap-4 hover:bg-slate-50">
                  <div className="w-40 shrink-0">
                    <div className="font-semibold text-slate-800 tnum">{dayLabel(t.date)}</div>
                    <div className="text-[11px] text-slate-400 tnum">{t.date.getUTCFullYear()}년</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span
                      className={`font-semibold ${
                        isUse
                          ? isComp
                            ? "text-emerald-700"
                            : "text-slate-800"
                          : "text-brand-600"
                      }`}
                    >
                      {txnLabel({ days: t.days, type: t.type, category: t.category ?? "STATUTORY" })}
                    </span>
                    {t.note && (
                      <div className="text-xs text-slate-400 mt-0.5 break-words">{t.note}</div>
                    )}
                  </div>
                  <div className="shrink-0 tnum font-bold text-sm">
                    <span className={isUse ? "text-slate-400" : "text-brand-600"}>
                      {t.days > 0 ? "+" : "−"}
                      {Math.abs(t.days)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 슬랙으로 들어온 신청 이력 */}
      <div className="card mb-6">
        <div className="px-5 py-3 border-b border-slate-100 font-bold text-slate-800">
          연차 신청 이력{" "}
          <span className="text-xs font-normal text-slate-400">
            (슬랙 신청 → 승인/반려. 관리자 직접 반영분은 위 목록에만 남습니다)
          </span>
        </div>
        {shownReqs.length === 0 ? (
          <Empty>신청 이력이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">기간</th>
                  <th className="th text-right">일수</th>
                  <th className="th">종류</th>
                  <th className="th">상태</th>
                  <th className="th">사유</th>
                  <th className="th">업무조치사항</th>
                  <th className="th">경로</th>
                </tr>
              </thead>
              <tbody>
                {shownReqs.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="td tnum whitespace-nowrap">
                      {ymd(r.startDate)}
                      {r.days > 1 && ` ~ ${ymd(r.endDate)}`}
                    </td>
                    <td className="td text-right tnum">{r.days}일</td>
                    <td className="td">{LEAVE_TYPE_LABEL[r.leaveType] ?? r.leaveType}</td>
                    <td className="td">
                      <Pill
                        kind={
                          r.status === "APPROVED"
                            ? "ACTIVE"
                            : r.status === "PENDING" || r.status === "PRE_PENDING"
                            ? "DRAFT"
                            : "EXPIRED"
                        }
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Pill>
                    </td>
                    <td className="td text-slate-500">{r.reason ?? "-"}</td>
                    <td className="td text-slate-500 whitespace-pre-line">{r.workPlan || "-"}</td>
                    <td className="td text-slate-400 text-xs">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 발생 이력 — 언제 몇 일이 생겼고 얼마나 남았는지 */}
      <div className="card">
        <div className="px-5 py-3 border-b border-slate-100 font-bold text-slate-800">
          연차 발생 이력
          <span className="text-xs font-normal text-slate-400 ml-2">
            입사일 기준 · 사용기한이 지나면 남은 연차는 소멸됩니다
          </span>
        </div>
        {summary.lots.length === 0 ? (
          <Empty>발생 이력이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">발생일</th>
                  <th className="th">사용기한</th>
                  <th className="th">사유</th>
                  <th className="th text-right">발생</th>
                  <th className="th text-right">사용</th>
                  <th className="th text-right">잔여</th>
                  <th className="th text-right">소멸</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.lots]
                  .sort((a, b) => b.grantDate.getTime() - a.grantDate.getTime())
                  .map((l, i) => {
                    const expired = l.expiryDate <= now;
                    return (
                      <tr key={i} className={expired ? "text-slate-400" : ""}>
                        <td className="td tnum">{ymd(l.grantDate)}</td>
                        <td className="td tnum">{ymd(l.expiryDate)}</td>
                        <td className="td text-xs">
                          {l.source === "MONTHLY"
                            ? "1년 미만 월 개근"
                            : l.source === "ANNUAL"
                            ? `${l.serviceYear}년차 연차`
                            : "관리자 부여"}
                        </td>
                        <td className="td text-right tnum">{l.days}</td>
                        <td className="td text-right tnum">{l.used || "-"}</td>
                        <td className="td text-right tnum font-semibold">
                          {expired ? "-" : l.remaining}
                        </td>
                        <td className="td text-right tnum text-red-500">
                          {l.expiredLost || "-"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-400 px-5 py-3 border-t border-slate-100">
          입사 후 누계: 발생 {summary.granted} · 사용 {summary.used}
          {summary.expired > 0 && ` · 소멸 ${summary.expired}`}
          {summary.nextGrantDate &&
            ` · 다음 발생 ${ymd(summary.nextGrantDate)} (${summary.nextGrantDays}일)`}
        </p>
      </div>
    </div>
  );
}
