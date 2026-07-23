import { PageHeader } from "@/components/ui";
import PayrollClient from "./PayrollClient";

export default function PayrollPage() {
  return (
    <div>
      <PageHeader
        title="급여 산정"
        desc="월 기본급·시급·인센티브·비율제·사업소득(3.3%)을 자동 계산하고 급여명세서를 발급·발송합니다."
      />
      <PayrollClient />
    </div>
  );
}
