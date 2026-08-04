import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import LogoUpload from "@/components/LogoUpload";
import StampUpload from "@/components/StampUpload";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const company = await prisma.company.findFirst({ where: { id: 1 } });
  return (
    <div>
      <PageHeader title="설정" desc="회사 정보 · 로고 · 법인 인감 · 4대보험 요율 · 급여명세서 자동발송 · 외부 연동을 관리합니다." />
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <LogoUpload logo={(company as any)?.logo ?? null} />
        <StampUpload stamp={(company as any)?.stamp ?? null} seam={(company as any)?.stampSeam ?? true} />
      </div>
      <SettingsClient />
    </div>
  );
}
