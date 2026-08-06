import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import LogoUpload from "@/components/LogoUpload";
import StampUpload from "@/components/StampUpload";
import SettingsClient from "./SettingsClient";
import HolidayPanel from "@/components/HolidayPanel";
import HrNotifyPanel from "@/components/HrNotifyPanel";
import { listHolidays, holidayStatus, holidayApiConfigured } from "@/lib/holiday-service";
import { previewHrNotices } from "@/lib/hr-notify-service";
import { listDepartments } from "@/lib/departments";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [company, holidays, coverage, notify, departments] = await Promise.all([
    prisma.company.findFirst({ where: { id: 1 } }),
    listHolidays(),
    holidayStatus(),
    previewHrNotices(),
    listDepartments(),
  ]);
  return (
    <div>
      <PageHeader title="설정" desc="회사 정보 · 로고 · 법인 인감 · 공휴일 · 경영지원 알림 · 4대보험 요율 · 급여명세서 자동발송 · 외부 연동을 관리합니다." />
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <LogoUpload logo={(company as any)?.logo ?? null} />
        <StampUpload
          stamp={(company as any)?.stamp ?? null}
          seam={(company as any)?.stampSeam ?? true}
          initials={(company as any)?.pageInitials ?? true}
        />
      </div>
      <div className="grid lg:grid-cols-2 gap-4 mb-6 items-start">
        <HolidayPanel items={holidays} coverage={coverage} apiConfigured={holidayApiConfigured()} />
        <HrNotifyPanel
          setting={notify.setting as any}
          preview={notify as any}
          departments={departments.filter((d) => d.active).map((d) => d.name)}
        />
      </div>
      <SettingsClient />
    </div>
  );
}
