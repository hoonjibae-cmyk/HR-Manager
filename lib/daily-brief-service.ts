// 운영진 일일 안내 — DB 어댑터 + 슬랙 발송.
//
// 판정·문안은 lib/daily-brief.ts(순수 함수, 테스트 있음)에 있고 여기서는 읽고 보내고 새기기만 한다.
// 크론이 매시 부르므로 **보낼 시각이 아니면 조회도 하지 않고** 곧장 돌아간다.

import { prisma } from "./db";
import { postMessage, slackConfigured } from "./slack";
import { logActivity } from "./activity";
import { MAKEUP_CATEGORY_LABEL } from "./constants";
import { notifyDue, kstToday, type NotifyTiming } from "./hr-notify";
import { getNotifySetting } from "./hr-notify-service";
import { buildLeaveCalendar } from "./leave-calendar";
import { listHolidays } from "./holiday-service";
import { listDayOffs } from "./dayoff-service";
import { leaveBriefText, makeupBriefText, isBriefable } from "./daily-brief";

const ymdUtc = (d: Date) => d.toISOString().slice(0, 10);

function timing(s: any, lastRunAt: Date | null): NotifyTiming {
  return {
    enabled: !!s.dailyEnabled,
    leadDays: 0, // 당일 것만 낸다 — 앞당길 개념이 없다
    hour: s.dailyHour ?? 14,
    minute: s.dailyMinute ?? 0,
    lastRunAt,
  };
}

/**
 * 채널로만 보낸다 — 전 직원 일정이라 DM 으로 흩뿌릴 성격이 아니다.
 * 채널이 비어 있으면 **조용히 넘어가지 않고** 이유를 돌려준다(설정 화면이 경고를 띄운다).
 */
async function send(channel: string | null, text: string) {
  if (!slackConfigured()) return { sent: 0, skipped: "슬랙 미설정" };
  if (!channel) return { sent: 0, skipped: "운영진 채널이 설정되지 않음" };
  const r: any = await postMessage(channel, text).catch(() => ({ ok: false }));
  return r?.ok ? { sent: 1 } : { sent: 0, skipped: "발송 실패" };
}

/* ───────────── 오늘 휴가 ───────────── */

export async function runDailyLeaveBrief(
  now: Date = new Date(),
  opts: { force?: boolean; dryRun?: boolean } = {}
) {
  const s: any = await getNotifySetting();
  const { due, reason } = notifyDue(timing(s, s.dailyLeaveLastRunAt), now, opts);
  if (!due) return { ran: false, reason };

  const today = kstToday(now);
  const from = new Date(`${today}T00:00:00Z`);
  const to = new Date(`${today}T23:59:59Z`);

  // 연차 달력과 **같은 함수**로 만든다 — 화면과 알림이 다른 답을 내면 안 된다.
  // (신청서는 기간으로, 관리자 반영분은 하루씩 남으므로 원장만 봐서는 그릴 수 없다)
  const [requests, txns, holidays, dayOffs] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { startDate: { lte: to }, endDate: { gte: from } },
      include: { employee: { select: { name: true, department: true } } },
    }),
    prisma.leaveTransaction.findMany({
      where: { date: { gte: from, lte: to }, days: { lt: 0 }, requestId: null },
      include: { employee: { select: { name: true, department: true } } },
    }),
    listHolidays(),
    listDayOffs(today, today),
  ]);

  const days = buildLeaveCalendar({
    requests: requests.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      name: r.employee.name,
      department: r.employee.department,
      startDate: ymdUtc(r.startDate),
      endDate: ymdUtc(r.endDate),
      days: r.days,
      leaveType: r.leaveType,
      status: r.status,
      reason: r.reason,
    })),
    txns: txns.map((t) => ({
      id: t.id,
      employeeId: t.employeeId,
      name: t.employee?.name ?? "",
      department: t.employee?.department ?? null,
      date: ymdUtc(t.date),
      days: t.days,
      category: (t as any).category ?? "STATUTORY",
      note: t.note,
      requestId: t.requestId,
    })),
    dayOffs,
    holidays: holidays.map((h) => h.date),
  });

  const text = leaveBriefText(days, today);
  const count = days.filter((d) => d.date === today).length;
  if (opts.dryRun) return { ran: false, dryRun: true, reason, count, text };

  // 낼 것이 없어도 '오늘 확인했다' 는 새긴다 — 안 그러면 매시 크론이 같은 조회를 되풀이한다
  if (!text) {
    await prisma.hrNotifySetting.update({ where: { id: 1 }, data: { dailyLeaveLastRunAt: now } });
    return { ran: true, count: 0, reason: "오늘 휴가 없음 — 발송 안 함" };
  }

  const out = await send(s.dailyChannel, text);
  // **보낸 뒤에 새긴다** — 먼저 새기고 실패하면 그날은 영영 안 나간다.
  // 반대는 다음 시각에 한 번 더 갈 뿐이라 이쪽이 덜 나쁘다.
  if (out.sent > 0) {
    await prisma.hrNotifySetting.update({ where: { id: 1 }, data: { dailyLeaveLastRunAt: now } });
    await logActivity({
      action: "NOTIFY_DAILY_LEAVE",
      actor: opts.force ? "ADMIN" : "CRON",
      summary: `오늘 휴가 ${count}건을 운영진 채널에 알렸습니다.`,
      meta: { count },
    }).catch(() => {});
  }
  return { ran: true, count, ...out };
}

/* ───────────── 오늘 보강 ───────────── */

export async function runDailyMakeupBrief(
  now: Date = new Date(),
  opts: { force?: boolean; dryRun?: boolean } = {}
) {
  const s: any = await getNotifySetting();
  const { due, reason } = notifyDue(timing(s, s.dailyMakeupLastRunAt), now, opts);
  if (!due) return { ran: false, reason };

  const today = kstToday(now);
  const rows = await prisma.makeupSession.findMany({
    // planStart 는 KST 벽시계를 UTC 필드에 담은 값이라 그날 00:00~23:59 로 자르면 된다
    where: { planStart: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${today}T23:59:59Z`) } },
    include: { employee: { select: { name: true, department: true } } },
    orderBy: { planStart: "asc" },
  });

  const sessions = rows.map((r) => ({
    id: r.id,
    name: r.employee?.name ?? "(이름 없음)",
    department: r.employee?.department ?? null,
    category: r.category,
    status: r.status,
    planStart: r.planStart,
    planEnd: r.planEnd,
    targetClass: r.targetClass,
    headcount: (r as any).headcount ?? null,
  }));

  const text = makeupBriefText(sessions, today, MAKEUP_CATEGORY_LABEL);
  const count = sessions.filter(isBriefable).length;
  if (opts.dryRun) return { ran: false, dryRun: true, reason, count, text };

  if (!text) {
    await prisma.hrNotifySetting.update({ where: { id: 1 }, data: { dailyMakeupLastRunAt: now } });
    return { ran: true, count: 0, reason: "오늘 보강 없음 — 발송 안 함" };
  }

  const out = await send(s.dailyChannel, text);
  if (out.sent > 0) {
    await prisma.hrNotifySetting.update({ where: { id: 1 }, data: { dailyMakeupLastRunAt: now } });
    await logActivity({
      action: "NOTIFY_DAILY_MAKEUP",
      actor: opts.force ? "ADMIN" : "CRON",
      summary: `오늘 보강·주말근무 ${count}건을 운영진 채널에 알렸습니다.`,
      meta: { count },
    }).catch(() => {});
  }
  return { ran: true, count, ...out };
}

/** 크론에서 한 번에 — 한쪽이 실패해도 다른 쪽은 나간다 */
export async function runDailyBriefs(
  now: Date = new Date(),
  opts: { force?: boolean; dryRun?: boolean } = {}
) {
  const [leave, makeup] = await Promise.all([
    runDailyLeaveBrief(now, opts).catch((e) => ({ error: String(e?.message ?? e) })),
    runDailyMakeupBrief(now, opts).catch((e) => ({ error: String(e?.message ?? e) })),
  ]);
  return { leave, makeup };
}
