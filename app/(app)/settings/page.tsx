import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import LogoUpload from "@/components/LogoUpload";
import StampUpload from "@/components/StampUpload";
import SettingsClient from "./SettingsClient";
import HolidayPanel from "@/components/HolidayPanel";
import { listHolidays, holidayStatus, holidayApiConfigured } from "@/lib/holiday-service";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [company, holidays, coverage] = await Promise.all([
    prisma.company.findFirst({ where: { id: 1 } }),
    listHolidays(),
    holidayStatus(),
  ]);
  return (
    <div>
      <PageHeader title="설정" desc="회사 정보 · 로고 · 법인 인감 · 공휴일 · 4대보험 요율 · 급여명세서 자동발송 · 외부 연동을 관리합니다." />
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <LogoUpload logo={(company as any)?.logo ?? null} />
        <StampUpload
          stamp={(company as any)?.stamp ?? null}
          seam={(company as any)?.stampSeam ?? true}
          initials={(company as any)?.pageInitials ?? true}
        />
      </div>
      <div className="mb-6">
        <HolidayPanel items={holidays} coverage={coverage} apiConfigured={holidayApiConfigured()} />
      </div>
      <SettingsClient />
    </div>
  );
}
