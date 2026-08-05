import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import SlackLinkButton from "@/components/SlackLinkButton";
import EmployeeImport from "@/components/EmployeeImport";
import EmployeeTable, { type EmployeeRow } from "@/components/EmployeeTable";
import { ymd } from "@/lib/format";
import { governingContract, paySchemeOf, contractIssues } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const rows = await prisma.employee.findMany({
    orderBy: { empNo: "asc" },
    include: { contracts: { where: { status: { not: "DRAFT" } }, orderBy: { startDate: "asc" } } },
  });

  // 표시 조건은 '오늘 시점 지배 계약' 기준 (카드 값은 그 거울일 뿐)
  const now = new Date();
  const emps: EmployeeRow[] = rows.map((e) => {
    const gov = governingContract(e.contracts, now);
    return {
      id: e.id,
      empNo: e.empNo,
      name: e.name,
      department: e.department,
      position: e.position,
      incomeType: gov?.incomeType ?? e.incomeType,
      payScheme: gov ? paySchemeOf(gov.templateKey) : e.payScheme,
      baseWage: gov?.baseWage ?? e.baseWage,
      ratioPercent: gov ? gov.ratioPercent : e.ratioPercent,
      hireDate: ymd(e.hireDate),
      resignDate: e.resignDate ? ymd(e.resignDate) : null,
      active: e.active,
      hasSlack: !!e.slackUserId,
      contractIssueCount: contractIssues(e, e.contracts, now).length,
    };
  });

  return (
    /* 화면 높이에 맞춰 표만 안에서 스크롤한다 — 검색·필터·머리글이 늘 붙어 있게.
       창이 짧으면 min-h 가 걸려 예전처럼 페이지째 스크롤된다. */
    <div className="flex flex-col h-[calc(100dvh-6.5rem)] lg:h-[calc(100dvh-7.5rem)] min-h-[28rem]">
      <PageHeader
        title="직원 관리"
        desc={`전체 ${emps.length}명 · 재직 ${emps.filter((e) => e.active).length}명`}
        action={
          <div className="flex gap-2">
            <EmployeeImport />
            <SlackLinkButton />
            <Link href="/employees/new" className="btn-primary">
              + 신규 직원 등록
            </Link>
          </div>
        }
      />

      <EmployeeTable rows={emps} />
    </div>
  );
}
