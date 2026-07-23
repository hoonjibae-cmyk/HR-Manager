import { PageHeader } from "@/components/ui";
import EmployeeForm from "@/components/EmployeeForm";

export default function NewEmployeePage() {
  return (
    <div>
      <PageHeader title="신규 직원 등록" desc="입력 후 신규입사 패키지(계약서+서약서+동의서)를 발급할 수 있습니다." />
      <EmployeeForm />
    </div>
  );
}
