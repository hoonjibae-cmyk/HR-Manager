import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import EmployeeForm from "@/components/EmployeeForm";

export const dynamic = "force-dynamic";

export default async function EditEmployeePage({
  params,
}: {
  params: { id: string };
}) {
  const emp = await prisma.employee.findUnique({ where: { id: Number(params.id) } });
  if (!emp) notFound();
  // Date → 문자열 직렬화
  const initial = {
    ...emp,
    hireDate: emp.hireDate.toISOString(),
    resignDate: emp.resignDate?.toISOString() ?? null,
  };
  return (
    <div>
      <PageHeader title={`${emp.name} 정보 수정`} />
      <EmployeeForm initial={initial} />
    </div>
  );
}
