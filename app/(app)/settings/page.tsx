import { PageHeader } from "@/components/ui";
import SettingsClient from "./SettingsClient";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="설정" desc="회사 정보 · 4대보험 요율 · 급여명세서 자동발송 · 외부 연동을 관리합니다." />
      <SettingsClient />
    </div>
  );
}
