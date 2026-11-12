import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import EmployeeForm from "@/components/EmployeeForm";
import { paySchemeOfTemplate } from "@/lib/contracts";
import { hasSplitIncome } from "@/lib/ratio-employee";

export const dynamic = "force-dynamic";

export default async function EditEmployeePage({
  params,
}: {
  params: { id: string };
}) {
  const emp = await prisma.employee.findUnique({ where: { id: Number(params.id) } });
  if (!emp) notFound();
  // 사업소득용 계좌 칸을 보일지 — 근로소득 상한을 둔 비율제 근로계약이 **계약 이력에 하나라도** 있으면 보인다.
  // 카드(오늘의 거울)만 보면 발효 전인 계약에 미리 계좌를 넣을 수 없고, 끝난 계약의 마지막 달 지급분
  // (급여는 다음 달에 나간다)을 받을 계좌를 고칠 수도 없다.
  const contracts = await prisma.contract.findMany({
    where: { employeeId: emp.id },
    select: { templateKey: true, ratioEmployee: true, ratioWageCap: true },
  });
  const splitIncome = contracts.some((c) =>
    hasSplitIncome({
      payScheme: paySchemeOfTemplate(c.templateKey) ?? emp.payScheme,
      ratioEmployee: c.ratioEmployee,
      ratioWageCap: c.ratioWageCap,
    })
  );
  // Date → 문자열 직렬화
  const initial = {
    ...emp,
    hireDate: emp.hireDate.toISOString(),
    resignDate: emp.resignDate?.toISOString() ?? null,
  };
  return (
    <div>
      <PageHeader title={`${emp.name} 정보 수정`} />
      <EmployeeForm initial={initial} splitIncome={splitIncome} />
    </div>
  );
}
