// 급여명세서 예약 발송 스케줄러
//
// 실행 경로 2가지
//  1) 서버리스(Vercel): Vercel Cron → GET /api/cron (하루 1회). 크론이 '시각'을
//     정하므로 앱은 날짜·요일 조건만 확인(ignoreClock=true).
//  2) 자체서버/외부 크론(cron-job.org 등 분 단위 호출): /api/cron?strict=1 →
//     앱에 저장된 시:분(KST)까지 확인하여 정확한 시각에 발송.
//
// 모든 시각 판단은 한국시간(KST, UTC+9) 기준. Vercel 런타임은 UTC 이므로
// Date 의 로컬 메서드를 쓰면 날짜가 어긋난다 → kstParts()로만 판단한다.

import { prisma } from "./db";
import { sendPayslipsForMonth } from "./email";
import { runPayrollMonth } from "./payroll-service";
import { postMessage, slackConfigured } from "./slack";

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface KstParts {
  year: number;
  month: number; // 1~12
  day: number;
  dow: number; // 0=일 .. 6=토
  hour: number;
  minute: number;
}

/** UTC Date → 한국시간 달력 값 */
export function kstParts(d: Date): KstParts {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth() + 1,
    day: k.getUTCDate(),
    dow: k.getUTCDay(),
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
  };
}

/** 한국시간 벽시계 → UTC Date */
export function kstToUtc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS);
}

/** 같은 한국 날짜인지 */
export function sameKstDay(a: Date, b: Date): boolean {
  const x = kstParts(a);
  const y = kstParts(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 지정일이 해당 월 말일을 넘으면 말일로 보정 (예: 31일 설정 + 2월 → 28/29일) */
export function effectiveDayOfMonth(year: number, month: number, dayOfMonth: number): number {
  return Math.min(Math.max(dayOfMonth, 1), daysInMonth(year, month));
}

export interface ScheduleLike {
  enabled: boolean;
  frequency: string; // MONTHLY | WEEKLY
  dayOfMonth: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
  targetMonthOffset: number;
  lastRunAt?: Date | null;
}

/** 발송 대상 연·월 (한국시간 기준, offset: 0=당월분 / -1=전월분) */
export function targetYearMonth(now: Date, offset: number) {
  const p = kstParts(now);
  const d = new Date(Date.UTC(p.year, p.month - 1 + offset, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** 지금 발송 조건을 충족하는지 (순수 판단 — DB 접근 없음) */
export function scheduleDue(
  sched: ScheduleLike,
  now: Date,
  opts: { force?: boolean; ignoreClock?: boolean } = {}
): { due: boolean; reason: string } {
  const { force = false, ignoreClock = false } = opts;
  if (force) return { due: true, reason: "강제 실행" };
  if (!sched.enabled) return { due: false, reason: "자동발송 비활성" };

  const k = kstParts(now);
  // 같은 한국 날짜에 이미 실행됨 → 중복 발송 방지
  if (sched.lastRunAt && sameKstDay(sched.lastRunAt, now))
    return { due: false, reason: "오늘 이미 실행됨" };

  if (sched.frequency === "MONTHLY") {
    const target = effectiveDayOfMonth(k.year, k.month, sched.dayOfMonth);
    if (k.day !== target) return { due: false, reason: `날짜 불일치 (매월 ${target}일)` };
  } else if (sched.frequency === "WEEKLY") {
    if (k.dow !== sched.dayOfWeek) return { due: false, reason: "요일 불일치" };
  }

  if (!ignoreClock) {
    const nowMin = k.hour * 60 + k.minute;
    const schedMin = sched.hour * 60 + sched.minute;
    // 예정 시각 이후면 발송 (당일 내 지각 실행도 허용 — lastRunAt 로 중복 방지)
    if (nowMin < schedMin)
      return {
        due: false,
        reason: `예정 시각 이전 (${String(sched.hour).padStart(2, "0")}:${String(sched.minute).padStart(2, "0")} KST)`,
      };
  }
  return { due: true, reason: "조건 충족" };
}

/** 다음 발송 예정 시각 (UTC Date). 비활성이면 null. */
export function computeNextRun(sched: ScheduleLike, from: Date = new Date()): Date | null {
  if (!sched.enabled) return null;
  const k = kstParts(from);
  const nowMin = k.hour * 60 + k.minute;
  const schedMin = sched.hour * 60 + sched.minute;

  if (sched.frequency === "WEEKLY") {
    for (let add = 0; add <= 7; add++) {
      const d = new Date(Date.UTC(k.year, k.month - 1, k.day + add));
      if (d.getUTCDay() !== sched.dayOfWeek) continue;
      if (add === 0 && nowMin >= schedMin) continue; // 오늘 시각 지남 → 다음 주
      return kstToUtc(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        sched.hour,
        sched.minute
      );
    }
    return null;
  }

  // MONTHLY — 이번 달 지정일(말일 보정)이 지났으면 다음 달
  for (let addMonth = 0; addMonth <= 12; addMonth++) {
    const base = new Date(Date.UTC(k.year, k.month - 1 + addMonth, 1));
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + 1;
    const day = effectiveDayOfMonth(y, m, sched.dayOfMonth);
    if (addMonth === 0) {
      if (day < k.day) continue;
      if (day === k.day && nowMin >= schedMin) continue;
    }
    return kstToUtc(y, m, day, sched.hour, sched.minute);
  }
  return null;
}

/** 한국시간 표기 (YYYY-MM-DD HH:mm) */
export function formatKst(d: Date): string {
  const k = kstParts(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.year}-${p(k.month)}-${p(k.day)} ${p(k.hour)}:${p(k.minute)}`;
}

/**
 * 예약 조건 충족 시 발송 실행.
 * - dryRun: 조건 판단·대상 집계만 하고 실제 발송은 하지 않음.
 */
export async function runDueSchedules(
  now: Date = new Date(),
  opts: {
    force?: boolean;
    ignoreClock?: boolean;
    dryRun?: boolean;
    /** 발송 대상 월 직접 지정 (관리자 수동 실행 — 미리보기와 대상이 어긋나지 않도록) */
    override?: { year: number; month: number };
  } = {}
) {
  const sched = await prisma.emailSchedule.findFirst();
  if (!sched) return { ran: false, reason: "예약 설정 없음" };

  const { due, reason } = scheduleDue(sched, now, opts);
  if (!due) return { ran: false, reason };

  const { year, month } = opts.override ?? targetYearMonth(now, sched.targetMonthOffset);

  if (opts.dryRun) {
    const [total, pending] = await Promise.all([
      prisma.payrollRecord.count({ where: { year, month } }),
      prisma.payrollRecord.count({ where: { year, month, status: { not: "SENT" } } }),
    ]);
    return { ran: false, dryRun: true, reason: "조건 충족 (모의 실행)", year, month, total, pending };
  }

  // 급여기록이 없으면 자동 산정(작성중) 후 발송
  const count = await prisma.payrollRecord.count({ where: { year, month } });
  if (count === 0) await runPayrollMonth(year, month);

  const result = await sendPayslipsForMonth(year, month);

  const nextRunAt = computeNextRun(sched, new Date(now.getTime() + 60_000));
  await prisma.emailSchedule.update({
    where: { id: sched.id },
    data: { lastRunAt: now, nextRunAt },
  });
  await prisma.auditLog.create({
    data: {
      action: "SCHEDULED_SEND",
      target: `${year}-${month}`,
      detail: JSON.stringify({ ...result, nextRunAt }),
    },
  });

  // 슬랙 요약 알림 (설정된 경우)
  const channel = process.env.SLACK_APPROVAL_CHANNEL;
  if (slackConfigured() && channel) {
    const failedNames = result.results
      .filter((r) => !r.ok)
      .map((r) => `${r.name}(${r.error ?? "실패"})`)
      .join(", ");
    await postMessage(
      channel,
      `📧 *${year}년 ${month}월 급여명세서 자동발송 완료*\n` +
        `• 성공 ${result.sent}건 / 실패 ${result.failed}건` +
        (result.skippedSent ? ` / 이미발송 제외 ${result.skippedSent}건` : "") +
        (failedNames ? `\n• 실패: ${failedNames}` : "") +
        (nextRunAt ? `\n• 다음 예정: ${formatKst(nextRunAt)} (KST)` : "")
    ).catch(() => {});
  }

  return { ran: true, year, month, nextRunAt, ...result };
}

// ---- 내부 스케줄러 (next start 등 상시 구동 서버용) ----
let _timer: NodeJS.Timeout | null = null;

export function startScheduler() {
  if (_timer) return;
  // 서버리스(Vercel)에서는 상시 프로세스가 없으므로 내부 스케줄러 대신 Vercel Cron 사용
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return;
  if (process.env.ENABLE_SCHEDULER !== "true") return;
  // 60초마다 조건 확인 (시:분까지 정확히 판단)
  _timer = setInterval(() => {
    runDueSchedules().catch((e) => console.error("[scheduler]", e));
  }, 60_000);
  console.log("[scheduler] 내부 스케줄러 시작 (60초 주기, KST 기준)");
}
