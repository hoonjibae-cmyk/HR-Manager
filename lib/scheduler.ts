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
 * 예약 발송 조건 충족 시 실행.
 * - 내부 스케줄러(VPS): 매분 호출, 인앱 설정의 시:분까지 확인.
 * - Vercel Cron(서버리스): cron 스케줄이 '시각'을 정하므로 ignoreClock=true 로
 *   호출 → 시:분 검사는 건너뛰고 enabled·주기(일/요일)·중복(당일)만 확인.
 * - force=true: 모든 조건 무시 즉시 실행(테스트용).
 */
export async function runDueSchedules(
  now: Date = new Date(),
  opts: { force?: boolean; ignoreClock?: boolean } = {}
) {
  const { force = false, ignoreClock = false } = opts;
  const sched = await prisma.emailSchedule.findFirst();
  if (!sched || (!sched.enabled && !force)) return { ran: false, reason: "비활성" };

  if (!force) {
    // 이미 오늘 실행됨 → 스킵
    if (sched.lastRunAt && sameDay(sched.lastRunAt, now))
      return { ran: false, reason: "오늘 이미 실행됨" };
    // 시각 일치 확인 (서버리스 크론은 건너뜀)
    if (!ignoreClock && (now.getHours() !== sched.hour || now.getMinutes() !== sched.minute))
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
  // 서버리스(Vercel)에서는 상시 프로세스가 없으므로 내부 스케줄러 대신 Vercel Cron 사용
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return;
  if (process.env.ENABLE_SCHEDULER !== "true") return;
  // 60초마다 조건 확인
  _timer = setInterval(() => {
    runDueSchedules().catch((e) => console.error("[scheduler]", e));
  }, 60_000);
  console.log("[scheduler] 내부 스케줄러 시작 (60초 주기)");
}
