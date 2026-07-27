/**
 * 직원 데이터 전체 삭제 (실제 데이터 이관 전 초기화용).
 *
 * 지우는 것: 직원 · 계약 · 급여기록 · 인센티브 명단 · 연차(발생/사용/신청) · 발급문서 기록
 * 남기는 것: 회사정보 · 4대보험 요율 · 간이세액표 · 공휴일 · 예약발송 설정 · 작업이력
 *
 * 사용법 (코드스페이스):
 *   npm run db:clear-employees          → 무엇이 지워질지 보여주기만 함 (미리보기)
 *   CONFIRM=DELETE npm run db:clear-employees   → 실제 삭제
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [emps, contracts, payrolls, incentives, grants, txns, reqs, docs] = await Promise.all([
    prisma.employee.count(),
    prisma.contract.count(),
    prisma.payrollRecord.count(),
    prisma.incentiveStudent.count(),
    prisma.leaveGrant.count(),
    prisma.leaveTransaction.count(),
    prisma.leaveRequest.count(),
    prisma.document.count(),
  ]);

  console.log("\n삭제 대상");
  console.log(`  직원              ${emps}건`);
  console.log(`  계약              ${contracts}건`);
  console.log(`  급여기록          ${payrolls}건`);
  console.log(`  인센티브 명단      ${incentives}건`);
  console.log(`  연차 발생/사용     ${grants + txns}건`);
  console.log(`  휴가 신청          ${reqs}건`);
  console.log(`  발급문서 기록      ${docs}건`);

  const [company, rates, brackets, holidays] = await Promise.all([
    prisma.company.count(),
    prisma.insuranceRate.count(),
    prisma.taxBracket.count(),
    prisma.holiday.count(),
  ]);
  console.log("\n유지되는 설정");
  console.log(`  회사정보 ${company} · 보험요율 ${rates} · 간이세액표 ${brackets} · 공휴일 ${holidays}`);

  if (process.env.CONFIRM !== "DELETE") {
    console.log("\n미리보기만 실행했습니다. 실제로 지우려면:");
    console.log("  CONFIRM=DELETE npm run db:clear-employees\n");
    return;
  }

  if (emps === 0) {
    console.log("\n직원 데이터가 이미 비어 있습니다.\n");
    return;
  }

  console.log("\n삭제 중…");
  // Employee 삭제 시 계약·급여·연차·문서는 onDelete: Cascade 로 함께 지워진다.
  // 직원과 무관한 잔여 기록(휴가 신청 등)이 남지 않도록 명시적으로 먼저 정리한다.
  await prisma.$transaction([
    prisma.leaveRequest.deleteMany({}),
    prisma.leaveTransaction.deleteMany({}),
    prisma.leaveGrant.deleteMany({}),
    prisma.incentiveStudent.deleteMany({}),
    prisma.payrollRecord.deleteMany({}),
    prisma.document.deleteMany({}),
    prisma.contract.deleteMany({}),
    prisma.employee.deleteMany({}),
  ]);

  await prisma.auditLog.create({
    data: {
      action: "EMPLOYEE_DELETE",
      actor: "system",
      target: "전체",
      summary: `실제 데이터 이관을 위해 더미 직원 ${emps}명과 관련 기록을 모두 삭제했습니다.`,
      detail: JSON.stringify({ emps, contracts, payrolls, incentives, reqs, docs }),
    },
  });

  console.log(`완료 — 직원 ${emps}명과 관련 기록을 모두 삭제했습니다.`);
  console.log("이제 '직원 관리 → 일괄 등록' 에서 실제 명단을 올리면 됩니다.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
