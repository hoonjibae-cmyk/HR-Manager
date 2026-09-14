import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Pill, Empty } from "@/components/ui";
import { ACTION_LABEL, SENSITIVE_ACTIONS } from "@/lib/activity";

export const dynamic = "force-dynamic";

const ACTOR_LABEL: Record<string, string> = {
  ADMIN: "관리자",
  SLACK: "슬랙",
  PORTAL: "포털",
  CRON: "자동(예약)",
  system: "시스템",
  admin: "관리자",
};

function kst(d: Date): string {
  const t = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}.${p(t.getUTCMonth() + 1)}.${p(t.getUTCDate())} ${p(
    t.getUTCHours()
  )}:${p(t.getUTCMinutes())}`;
}

function portalSlackUserId(actor: string, detail: string): string | null {
  if (actor !== "PORTAL") return null;
  try {
    const value = JSON.parse(detail)?.slackUserId;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: { filter?: string; q?: string };
}) {
  const filter = searchParams.filter ?? "sensitive";
  const where: any = {};
  if (filter === "sensitive") where.action = { in: SENSITIVE_ACTIONS };
  else if (filter !== "all") where.action = filter;
  if (searchParams.q)
    where.OR = [
      { summary: { contains: searchParams.q } },
      { target: { contains: searchParams.q } },
      { actorName: { contains: searchParams.q } },
      { detail: { contains: searchParams.q } },
    ];

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const tabs = [
    { key: "sensitive", label: "주요 작업" },
    { key: "all", label: "전체" },
    { key: "PAYROLL_RUN", label: "급여 산정" },
    { key: "PAYSLIP_SEND", label: "명세서 발송" },
    { key: "CONTRACT_UPDATE", label: "계약 수정" },
    { key: "LEAVE_APPROVE", label: "휴가 승인" },
    { key: "LOGIN", label: "로그인" },
  ];

  return (
    <div>
      <PageHeader
        title="작업 이력"
        desc="급여·명세서·계약처럼 되돌리기 어려운 작업이 언제 무엇에 일어났는지 기록합니다"
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/activity?filter=${t.key}`}
            className={`pill ${
              filter === t.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {t.label}
          </Link>
        ))}
        <form method="get" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input
            name="q"
            defaultValue={searchParams.q ?? ""}
            placeholder="직원명 · 내용 검색"
            className="input py-1 w-48 text-xs"
          />
          <button className="btn-outline py-1 px-2.5 text-xs">검색</button>
        </form>
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <Empty>기록이 없습니다.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th w-36">일시 (KST)</th>
                <th className="th w-32">작업</th>
                <th className="th">내용</th>
                <th className="th w-40">실행</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const slackUserId = portalSlackUserId(r.actor, r.detail);
                return (
                  <tr key={r.id} className="hover:bg-slate-50 align-top">
                    <td className="td tnum text-slate-500 whitespace-nowrap">{kst(r.createdAt)}</td>
                    <td className="td">
                      <Pill kind={r.action.startsWith("PAYROLL") || r.action.startsWith("PAYSLIP") ? "INCENTIVE" : "DRAFT"}>
                        {ACTION_LABEL[r.action] ?? r.action}
                      </Pill>
                    </td>
                    <td className="td">
                      <div className="text-slate-700">
                        {r.summary ?? `${ACTION_LABEL[r.action] ?? r.action}${r.target ? ` — ${r.target}` : ""}`}
                      </div>
                      {r.employeeId && (
                        <Link
                          href={`/employees/${r.employeeId}`}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          직원 카드 보기 →
                        </Link>
                      )}
                    </td>
                    <td className="td text-xs text-slate-500">
                      {ACTOR_LABEL[r.actor] ?? r.actor}
                      {r.actorName && (r.actor === "SLACK" || r.actor === "PORTAL") && (
                        <div className="text-slate-400">{r.actorName}</div>
                      )}
                      {slackUserId && (
                        <div className="text-slate-400 tnum">Slack {slackUserId}</div>
                      )}
                      {r.ip && <div className="text-slate-300 tnum">{r.ip}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-xs text-slate-400 px-5 py-3 border-t border-slate-100">
          · 최근 300건까지 표시합니다. &nbsp; · 포털 로그인은 직원명과 Slack 사용자 ID가 남습니다. &nbsp;
          · 슬랙에서 승인·반려한 작업은 슬랙 사용자까지 남습니다.
        </p>
      </div>
    </div>
  );
}
