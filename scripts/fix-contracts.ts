/**
 * 계약 이력 일괄 정리 — 이미 쌓여 있는 데이터를 앞뒤 맞게 되돌린다.
 *
 * 하는 일 (lib/contracts.ts 의 planContractTimeline 과 같은 규칙):
 *   1) 뒤 계약이 시작하면 앞 계약을 그 전날로 닫는다 (종료일이 비어 있어도).
 *   2) 종료일이 지난 계약은 EXPIRED, 아직 유효하면 ACTIVE.
 * 종료일을 늘리지는 않는다 — 빈 기간은 화면의 경고로 남겨 사람이 판단한다.
 *
 * 앞으로 만들거나 고치는 계약은 API 가 알아서 정리하므로, 이 스크립트는
 * 명단 일괄 등록 등으로 이미 들어간 과거 데이터를 한 번 훑을 때만 쓰면 된다.
 *
 * 사용법:
 *   npm run db:fix-contracts          → 무엇이 바뀔지 보여주기만 함 (미리보기)
 *   APPLY=1 npm run db:fix-contracts  → 실제 반영
 */
import { PrismaClient } from "@prisma/client";
import { planContractTimeline } from "../lib/contracts";

const prisma = new PrismaClient();
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "기한없음");

async function main() {
  const apply = process.env.APPLY === "1";
  const employees = await prisma.employee.findMany({
    orderBy: { empNo: "asc" },
    include: {
      contracts: {
        where: { status: { not: "DRAFT" } },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
      },
    },
  });

  let touched = 0;
  let people = 0;
  for (const emp of employees) {
    const fixes = planContractTimeline(emp.contracts);
    if (!fixes.length) continue;
    people++;
    console.log(`\n${emp.name} (${emp.empNo})`);
    for (const f of fixes) {
      const c = emp.contracts.find((x) => x.id === f.id)!;
      const parts: string[] = [];
      if (f.endDate) parts.push(`종료일 ${ymd(c.endDate)} → ${ymd(f.endDate)}`);
      if (f.status) parts.push(`상태 ${c.status} → ${f.status}`);
      console.log(`  ${ymd(c.startDate)} 시작 계약: ${parts.join(" · ")}`);
      touched++;
      if (apply) {
        const { id, ...data } = f;
        await prisma.contract.update({ where: { id }, data });
      }
    }
  }

  console.log(
    `\n${people}명 / 계약 ${touched}건 ${apply ? "정리했습니다." : "이 정리 대상입니다."}`
  );
  if (!apply && touched > 0)
    console.log("실제로 반영하려면:  APPLY=1 npm run db:fix-contracts");
  if (touched === 0) console.log("이미 앞뒤가 맞습니다 — 바꿀 것이 없습니다.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
