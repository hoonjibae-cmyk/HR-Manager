import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { listNotices } from "@/lib/vacation-service";
import VacationClient from "@/components/VacationClient";

export const dynamic = "force-dynamic";

/**
 * 방학 근무·연차 — 수업이 없는 기간에 직원이 날짜별로 정상근무/연차 신청을 스스로 고르는 공고.
 * 직원 화면은 슬랙(개인 DM → 모달)이고, 여기서는 공고 작성·발행 전 점검·응답 현황을 본다.
 */
export default async function VacationPage({ searchParams }: { searchParams: { id?: string } }) {
  const [notices, employees, departments] = await Promise.all([
    listNotices(),
    prisma.employee.findMany({
      where: { active: true },
      select: { id: true, name: true, department: true, slackUserId: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    }),
    prisma.department.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { name: true } }),
  ]);
  const selected = Number(searchParams.id) || notices[0]?.id || null;
  return (
    <div>
      <PageHeader
        title="방학 근무·연차"
        desc="수업이 없는 기간에도 정상근무할 수 있다는 전제에서, 직원이 날짜별로 정상근무와 연차 신청 중 하나를 직접 고르게 합니다. 일괄 연차대체와 무관하며 미응답은 어떤 선택으로도 처리되지 않습니다."
      />
      <VacationClient
        notices={notices}
        selectedId={selected}
        employees={employees.map((e) => ({ id: e.id, name: e.name, department: e.department, slack: !!e.slackUserId }))}
        // 등록된 부서 + 직원 카드에 적힌 부서 — 부서 표에 없는 이름의 직원도 대상에서 빠지지 않게
        departments={[...new Set([...departments.map((d) => d.name), ...employees.map((e) => e.department).filter((x): x is string => !!x)])]}
      />
    </div>
  );
}
