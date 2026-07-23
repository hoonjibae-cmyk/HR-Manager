import { prisma } from "./db";
import { sendPayslipsForMonth } from "./email";
import { runPayrollMonth } from "./payroll-service";

/** targetMonthOffset 를 적용해 발송 대상 연/월 계산 */
function targetYearMonth(now: Date, offset: number) {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 예약 발송 조건 충족 시 실행. (내부 스케줄러/외부 크론 공통)
 * force=true 이면 시간 조건 무시하고 즉시 실행 (테스트용)
 */
export async function runDueSchedules(now: Date = new Date(), force = false) {
  const sched = await prisma.emailSchedule.findFirst();
  if (!sched || (!sched.enabled && !force)) return { ran: false, reason: "비활성" };

  if (!force) {
    // 이미 오늘 실행됨 → 스킵
    if (sched.lastRunAt && sameDay(sched.lastRunAt, now))
      return { ran: false, reason: "오늘 이미 실행됨" };
    // 시각 일치 확인
    if (now.getHours() !== sched.hour || now.getMinutes() !== sched.minute)
      return { ran: false, reason: "시각 불일치" };
    // 주기 일치 확인
    if (sched.frequency === "MONTHLY" && now.getDate() !== sched.dayOfMonth)
      return { ran: false, reason: "날짜 불일치" };
    if (sched.frequency === "WEEKLY" && now.getDay() !== sched.dayOfWeek)
      return { ran: false, reason: "요일 불일치" };
  }

  const { year, month } = targetYearMonth(now, sched.targetMonthOffset);

  // 급여기록이 없으면 자동 산정(DRAFT) 후 발송
  const count = await prisma.payrollRecord.count({ where: { year, month } });
  if (count === 0) {
    await runPayrollMonth(year, month);
  }

  const result = await sendPayslipsForMonth(year, month);
  await prisma.emailSchedule.update({
    where: { id: sched.id },
    data: { lastRunAt: now },
  });
  await prisma.auditLog.create({
    data: {
      action: "SCHEDULED_SEND",
      target: `${year}-${month}`,
      detail: JSON.stringify(result),
    },
  });
  return { ran: true, year, month, ...result };
}

// ---- 내부 스케줄러 (next start 등 상시 구동 서버용) ----
let _timer: NodeJS.Timeout | null = null;

export function startScheduler() {
  if (_timer) return;
  if (process.env.ENABLE_SCHEDULER !== "true") return;
  // 60초마다 조건 확인
  _timer = setInterval(() => {
    runDueSchedules().catch((e) => console.error("[scheduler]", e));
  }, 60_000);
  console.log("[scheduler] 내부 스케줄러 시작 (60초 주기)");
}
