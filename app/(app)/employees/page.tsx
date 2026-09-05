import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import SlackLinkButton from "@/components/SlackLinkButton";
import EmployeeImport from "@/components/EmployeeImport";
import EmployeeTable, { type EmployeeRow } from "@/components/EmployeeTable";
import { ymd, birthIsoOf, ageOf, tenureOf, kstTodayYmd } from "@/lib/format";
import { governingContract, paySchemeOf, contractIssues } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const rows = await prisma.employee.findMany({
    orderBy: { empNo: "asc" },
    include: { contracts: { where: { status: { not: "DRAFT" } }, orderBy: { startDate: "asc" } } },
  });

  // 표시 조건은 '오늘 시점 지배 계약' 기준 (카드 값은 그 거울일 뿐)
  const now = new Date();
  const today = kstTodayYmd(now);
  const emps: EmployeeRow[] = rows.map((e) => {
    const gov = governingContract(e.contracts, now);
    // 생년월일 — 두 자리 연도(YYMMDD)는 세기를 알 수 없어 나이를 만들지 않는다(생일 알림과 같은 규칙)
    const birthIso = birthIsoOf(e.birth);
    // 근속 — 퇴직자는 퇴사일에 멈춘 값 (연차·퇴직급여 화면과 같은 규칙)
    const tenure = tenureOf(e.hireDate, e.resignDate && e.resignDate < now ? e.resignDate : now);
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
      // 표시 날짜는 이 표의 다른 날짜(입사일)와 같은 점 표기 — 정렬용 birthIso 만 ISO 로 둔다
      birth: birthIso ? birthIso.replace(/-/g, ".") : e.birth?.trim() || null,
      birthIso,
      age: ageOf(birthIso, today),
      tenureLabel: tenure.label,
      tenureMonths: tenure.months,
      // 계약만료일 — 지배 계약 기준. 기한 없는 계약은 만료일이 없는 것이지 계약이 없는 게 아니다
      contractEnd: gov?.endDate ? ymd(gov.endDate) : null,
      contractEndless: !!gov && !gov.endDate,
      today: today.replace(/-/g, "."),
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
