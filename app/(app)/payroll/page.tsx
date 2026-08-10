import { PageHeader } from "@/components/ui";
import { kstTodayYmd } from "@/lib/format";
import PayrollClient from "./PayrollClient";

export const dynamic = "force-dynamic";

export default function PayrollPage() {
  // 오늘 날짜는 **서버에서 구해 넘긴다** — 클라이언트에서 Date.now() 로 구하면
  // 서버가 그린 HTML 과 달라져 하이드레이션이 어긋난다(자정 언저리에 실제로 갈린다).
  return (
    <div>
      <PageHeader
        title="급여 산정"
        desc="월 기본급·시급·인센티브·비율제·사업소득(3.3%)을 자동 계산하고 급여명세서를 발급·발송합니다."
      />
      <PayrollClient today={kstTodayYmd()} />
    </div>
  );
}
