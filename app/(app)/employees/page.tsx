import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader, Pill, Empty } from "@/components/ui";
import SlackLinkButton from "@/components/SlackLinkButton";
import { INCOME_TYPE_LABEL, PAY_SCHEME_LABEL } from "@/lib/constants";
import { won, ymd } from "@/lib/format";
import { governingContract, paySchemeOf, contractIssues } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: { dept?: string; q?: string };
}) {
  const where: any = {};
  if (searchParams.dept) where.department = searchParams.dept;
  if (searchParams.q)
    where.OR = [
      { name: { contains: searchParams.q } },
      { position: { contains: searchParams.q } },
    ];

  const [rows, depts] = await Promise.all([
    prisma.employee.findMany({
      where,
      orderBy: { empNo: "asc" },
      include: { contracts: { where: { status: { not: "DRAFT" } }, orderBy: { startDate: "asc" } } },
    }),
    prisma.employee.groupBy({ by: ["department"] }),
  ]);

  // 표시 조건은 '오늘 시점 지배 계약' 기준 (카드 값은 그 거울일 뿐)
  const now = new Date();
  const emps = rows.map((e) => {
    const gov = governingContract(e.contracts, now);
    return {
      ...e,
      payScheme: gov ? paySchemeOf(gov.templateKey) : e.payScheme,
      incomeType: gov?.incomeType ?? e.incomeType,
      baseWage: gov?.baseWage ?? e.baseWage,
      ratioPercent: gov ? gov.ratioPercent : e.ratioPercent,
      contractIssueCount: contractIssues(e, e.contracts, now).length,
    };
  });

  return (
    <div>
      <PageHeader
        title="직원 관리"
        desc={`전체 ${emps.length}명`}
        action={
          <div className="flex gap-2">
            <SlackLinkButton />
            <Link href="/employees/new" className="btn-primary">
              + 신규 직원 등록
            </Link>
          </div>
        }
      />

      <div className="flex gap-2 mb-4 flex-wrap">
        <Link
          href="/employees"
          className={`pill ${!searchParams.dept ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          전체
        </Link>
        {depts
          .filter((d) => d.department)
          .map((d) => (
            <Link
              key={d.department}
              href={`/employees?dept=${encodeURIComponent(d.department!)}`}
              className={`pill ${
                searchParams.dept === d.department
                  ? "bg-brand-600 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {d.department}
            </Link>
          ))}
      </div>

      <div className="card overflow-hidden">
        {emps.length === 0 ? (
          <Empty>등록된 직원이 없습니다.</Empty>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">사번</th>
                <th className="th">성명</th>
                <th className="th">부서 / 직책</th>
                <th className="th">구분</th>
                <th className="th">급여형태</th>
                <th className="th text-right">기준액</th>
                <th className="th">입사일</th>
                <th className="th">슬랙</th>
                <th className="th">상태</th>
              </tr>
            </thead>
            <tbody>
              {emps.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="td tnum text-slate-400">{e.empNo}</td>
                  <td className="td">
                    <Link
                      href={`/employees/${e.id}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {e.name}
                    </Link>
                  </td>
                  <td className="td">
                    <div>{e.department}</div>
                    <div className="text-xs text-slate-400">{e.position}</div>
                    {e.contractIssueCount > 0 && (
                      <div className="text-[11px] text-amber-600 mt-0.5">계약 기간 확인 필요</div>
                    )}
                  </td>
                  <td className="td">
                    <Pill kind={e.incomeType}>{INCOME_TYPE_LABEL[e.incomeType]}</Pill>
                  </td>
                  <td className="td">
                    <Pill kind={e.payScheme}>{PAY_SCHEME_LABEL[e.payScheme]}</Pill>
                  </td>
                  <td className="td text-right tnum">
                    {e.payScheme === "RATIO"
                      ? `${((e.ratioPercent ?? 0) * 100).toFixed(0)}%`
                      : e.payScheme === "HOURLY"
                      ? `${won(e.baseWage)}/h`
                      : `${won(e.baseWage)}`}
                  </td>
                  <td className="td tnum text-slate-500">{ymd(e.hireDate)}</td>
                  <td className="td">
                    {e.slackUserId ? (
                      <span className="pill bg-emerald-50 text-emerald-700" title={e.slackUserId}>
                        연동됨
                      </span>
                    ) : (
                      <span className="pill bg-slate-100 text-slate-400">미연동</span>
                    )}
                  </td>
                  <td className="td">
                    {e.active ? (
                      <Pill kind="ACTIVE">재직</Pill>
                    ) : (
                      <Pill kind="CANCELED">퇴직</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
