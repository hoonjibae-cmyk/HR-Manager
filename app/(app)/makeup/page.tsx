import { PageHeader } from "@/components/ui";
import { makeupMonth } from "@/lib/makeup-service";
import { makeupCalendarConfigured } from "@/lib/gcal";
import MakeupCalendar from "@/components/MakeupCalendar";
import MakeupPolicyPanel from "@/components/MakeupPolicyPanel";
import { holidayStatus } from "@/lib/holiday-service";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function MakeupPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const now = new Date();
  const year = Number(searchParams.year) || now.getFullYear();
  const month = Number(searchParams.month) || now.getMonth() + 1;

  const [{ rows, totals, policy, examPeriods, holidays }, coverage] = await Promise.all([
    makeupMonth(year, month),
    holidayStatus(),
  ]);

  return (
    <div>
      <PageHeader
        title="보강 · 오버타임"
        desc="슬랙 사전신청(보강·주말근무) → 근무 다음날 신청자가 실근무 시간 확정 → 오버타임 수당 자동 산출 → 급여명세서 반영"
        action={<MakeupPolicyPanel policy={policy as any} examPeriods={examPeriods} />}
      />

      {/* 공휴일 표가 얇으면 휴일근로 가산과 보강 자동 반영이 조용히 빠진다 — 여기서 알린다 */}
      {coverage.warning && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 mb-3 leading-relaxed">
          ⚠ {coverage.warning}{" "}
          <Link href="/settings" className="underline font-bold">
            설정 → 공휴일
          </Link>{" "}
          에서 채워 주세요.
        </div>
      )}

      <MakeupCalendar
        year={year}
        month={month}
        rows={rows}
        totals={totals.map((t) => ({
          employeeId: t.employeeId,
          name: t.name,
          department: t.department,
          payScheme: t.payScheme,
          excludedByScheme: t.excludedByScheme,
          missingSchedule: t.missingSchedule,
          hourlyWage: t.hourlyWage,
          amount: t.amount,
          result: {
            extraHours: t.result.extraHours,
            overtimeHours: t.result.overtimeHours,
            holidayHours: t.result.holidayHours,
            holidayOverHours: t.result.holidayOverHours,
            nightHours: t.result.nightHours,
            pendingDecision: t.result.pendingDecision,
          },
        }))}
        holidays={holidays}
        examPeriods={examPeriods}
        calendarSynced={makeupCalendarConfigured()}
      />

      <p className="text-xs text-slate-400 mt-4 leading-relaxed">
        · <b>연장근로</b>: 평일 소정근로시간 밖 또는 토요일 근무 — 주 소정근로가 40시간 미만이라
        법정 가산 대상이 아니므로 <b>통상시급 ×1.0(가산 없음)</b> &nbsp;
        · <b>휴일근로</b>: 일요일·공휴일 근무 — 8시간까지 ×1.5, 초과분 ×2.0 &nbsp;
        · 1일 8시간·주 40시간을 넘는 부분까지 법정 가산(×1.5)하려면 <b>수당 지급 조건</b> 에서
        &apos;법정 초과분 가산&apos; 을 켠다 (기본 꺼짐) &nbsp;
        · <b>야간</b>(22~06시) 가산은 기본으로 붙지 않는다 &nbsp;
        · 소정근로시간 안에서 진행된 보강은 월 급여에 이미 포함되어 수당이 발생하지 않는다 &nbsp;
        · 완전비율제(위탁)는 근로기준법 적용 대상이 아니라 수당에서 제외된다 &nbsp;
        · <b>내신의무보강</b>은 내신 기간별 상한(기본 10시간)까지만 인정하며, 수당이 큰 근무부터 채운다 &nbsp;
        · <b>결시보강</b>은 관리자가 건건이 <b>수당 반영</b> 여부를 정한다 (⚠ 표시) &nbsp;
        · <b>직전보강·내신의무보강</b>도 <b>평일</b>에 한 것은 자동 반영하지 않고 결시보강과 같이
        관리자가 판단한다 — 토·일·공휴일 근무만 자동 반영된다 &nbsp;
        · <b>주말근무</b>(🗓)는 교수부가 아닌 직원의 주말 근무 신청이다 — 보강이 아니라서
        보강캘린더에는 올라가지 않는다 &nbsp;
        · <b>실근무 확정은 신청자가 직접</b> 한다(근무 다음날부터). 수당이 기본 반영되는 종류는
        확정 요청이 자동으로 나가고, 그 외는 관리자가 골라서 보낸다. 아직 확정되지 않은 지난
        근무는 ⏱ 로 표시된다 &nbsp;
        · 관리자는 신청자가 확정한 시간도 <b>최종적으로 다시 고칠 수 있다</b> (고치면 당사자에게 알림이 간다) &nbsp;
        · 실근무를 확정한 뒤 <b>급여 산정</b>을 다시 돌리면 명세서에 수당과 산정 내역서가 함께 반영된다.
      </p>
    </div>
  );
}
