import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import LogoUpload from "@/components/LogoUpload";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const company = await prisma.company.findFirst({ where: { id: 1 } });
  return (
    <div>
      <PageHeader title="설정" desc="회사 정보 · 로고 · 4대보험 요율 · 급여명세서 자동발송 · 외부 연동을 관리합니다." />
      <div className="mb-6">
        <LogoUpload logo={(company as any)?.logo ?? null} />
      </div>
      <SettingsClient />
    </div>
  );
}
