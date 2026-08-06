// 경영지원 알림 — DB 어댑터 + 슬랙 발송.
//
// 판정 규칙은 lib/hr-notify.ts(순수 함수, 테스트 있음)에 있고 여기서는 읽고 보내고 새기기만 한다.
// 크론이 매시 부르므로(app/api/cron), **보낼 시각이 아니면 조회도 최소로** 끝난다.

import { prisma } from "./db";
import { postMessage, slackConfigured } from "./slack";
import { logActivity } from "./activity";
import { CONTRACT_STAGE_LABEL } from "./constants";
import {
  notifyDue,
  contractsToAnnounce,
  birthdaysOn,
  contractAlertText,
  birthdayAlertText,
  recipientWarning,
  kstToday,
  addDays,
  DEFAULT_CONTRACT_TIMING,
  DEFAULT_BIRTHDAY_TIMING,
  DEFAULT_NOTIFY_DEPARTMENT,
  type NotifyTiming,
} from "./hr-notify";

export type NotifySetting = {
  id: number;
  targetDepartment: string;
  channel: string | null;
  contractEnabled: boolean;
  contractLeadDays: number;
  contractHour: number;
  contractMinute: number;
  contractLastRunAt: Date | null;
  birthdayEnabled: boolean;
  birthdayLeadDays: number;
  birthdayHour: number;
  birthdayMinute: number;
  birthdayLastRunAt: Date | null;
};

/**
 * 설정 (없으면 만들어 준다).
 *
 * `getOvertimePolicy` 와 같은 이유로 **동시에 두 번 불려도 터지지 않아야 한다** —
 * 한 화면·크론에서 여러 갈래가 병렬로 부르는데 행이 아직 없으면 두 upsert 가 함께 insert 로
 * 가서 유일키 충돌(P2002)이 난다.
 */
export async function getNotifySetting(): Promise<NotifySetting> {
  try {
    return (await prisma.hrNotifySetting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    })) as any;
  } catch {
    const row = await prisma.hrNotifySetting.findUnique({ where: { id: 1 } });
    if (row) return row as any;
    throw new Error("알림 설정을 읽지 못했습니다.");
  }
}

const contractTiming = (s: NotifySetting): NotifyTiming => ({
  enabled: s.contractEnabled,
  leadDays: s.contractLeadDays,
  hour: s.contractHour,
  minute: s.contractMinute,
  lastRunAt: s.contractLastRunAt,
});
const birthdayTiming = (s: NotifySetting): NotifyTiming => ({
  enabled: s.birthdayEnabled,
  leadDays: s.birthdayLeadDays,
  hour: s.birthdayHour,
  minute: s.birthdayMinute,
  lastRunAt: s.birthdayLastRunAt,
});

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/* ───────────── 받는 사람 ───────────── */

export interface Recipients {
  /** 그 부서 재직 직원 수 */
  total: number;
  /** 슬랙이 연결된 사람들의 slackUserId */
  userIds: string[];
  warning: string | null;
}

export async function notifyRecipients(department: string, channel?: string | null): Promise<Recipients> {
  const rows = await prisma.employee.findMany({
    where: { active: true, department },
    select: { slackUserId: true },
  });
  const userIds = rows.map((r) => r.slackUserId).filter(Boolean) as string[];
  // 채널로 보낼 때는 부서에 사람이 없어도 알림 자체는 나간다 — 경고를 띄우지 않는다
  const warning = channel ? null : recipientWarning(department, rows.length, userIds.length);
  return { total: rows.length, userIds, warning };
}

/**
 * 보내기 — 채널이 지정돼 있으면 채널로, 아니면 **부서 소속 각자에게 DM**.
 *
 * DM 을 기본으로 둔 이유: 계약 종료·생일은 그 부서가 처리할 일이지 전사가 볼 것이 아니다.
 * 한 사람에게 실패해도 나머지는 계속 보낸다 — 슬랙 하나 때문에 알림이 통째로 죽으면 안 된다.
 */
async function deliver(s: NotifySetting, msg: { text: string; blocks: any[] }) {
  if (!slackConfigured()) return { sent: 0, failed: 0, skipped: "슬랙 미설정" };
  const targets = s.channel ? [s.channel] : (await notifyRecipients(s.targetDepartment, s.channel)).userIds;
  let sent = 0;
  let failed = 0;
  for (const to of targets) {
    const r: any = await postMessage(to, msg.text, msg.blocks).catch(() => ({ ok: false }));
    if (r?.ok) sent++;
    else failed++;
  }
  return { sent, failed, targets: targets.length };
}

/* ───────────── 계약 종료 예고 ───────────── */

export async function runContractExpiryNotice(
  now: Date = new Date(),
  opts: { force?: boolean; dryRun?: boolean } = {}
) {
  const s = await getNotifySetting();
  const { due, reason } = notifyDue(contractTiming(s), now, opts);
  if (!due) return { ran: false, reason };

  const today = kstToday(now);
  const until = addDays(today, Math.max(0, s.contractLeadDays));
  const rows = await prisma.contract.findMany({
    where: {
      endDate: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${until}T23:59:59Z`) },
      expiryNotifiedAt: null,
      status: { not: "TERMINATED" },
    },
    include: { employee: { select: { name: true, department: true, position: true, active: true } } },
    orderBy: { endDate: "asc" },
  });

  const alerts = contractsToAnnounce(
    rows
      // 퇴사자는 재계약 대상이 아니다
      .filter((c) => c.employee?.active !== false)
      .map((c) => ({
        id: c.id,
        employeeId: c.employeeId,
        name: c.employee?.name ?? "(이름 없음)",
        department: c.employee?.department ?? null,
        position: c.employee?.position ?? null,
        stage: c.stage,
        endDate: c.endDate ? ymd(c.endDate) : null,
        notifiedAt: c.expiryNotifiedAt,
        status: c.status,
      })),
    now,
    s.contractLeadDays
  );

  if (opts.dryRun) return { ran: false, dryRun: true, reason, count: alerts.length, alerts };
  if (!alerts.length) {
    // 보낼 것이 없어도 '오늘 확인했다' 는 새긴다 — 안 그러면 매시 크론이 같은 조회를 되풀이한다
    await prisma.hrNotifySetting.update({ where: { id: 1 }, data: { contractLastRunAt: now } });
    return { ran: true, count: 0, reason: "예고할 계약 없음" };
  }

  const msg = contractAlertText(alerts, {
    stageLabel: CONTRACT_STAGE_LABEL,
    appUrl: process.env.APP_URL || null,
  });
  const out = await deliver(s, msg);

  // **보낸 뒤에 새긴다** — 먼저 새기고 발송이 실패하면 그 계약은 영영 안 알려진다.
  // 반대로 새기기가 실패하면 내일 한 번 더 갈 뿐이라, 이쪽이 덜 나쁘다.
  if (out.sent > 0)
    await prisma.contract.updateMany({
      where: { id: { in: alerts.map((a) => a.id) } },
      data: { expiryNotifiedAt: now },
    });
  await prisma.hrNotifySetting.update({ where: { id: 1 }, data: { contractLastRunAt: now } });

  await logActivity({
    action: "NOTIFY_CONTRACT_EXPIRY",
    actor: opts.force ? "ADMIN" : "CRON",
    summary: `계약 종료 예고 ${alerts.length}건을 ${s.channel ?? `${s.targetDepartment} 부서`}에 알렸습니다 (${s.contractLeadDays}일 전 기준).`,
    meta: { alerts: alerts.map((a) => ({ name: a.name, endDate: a.endDate, dDay: a.dDay })), ...out },
  }).catch(() => {});

  return { ran: true, count: alerts.length, alerts, ...out };
}

/* ───────────── 생일 ───────────── */

export async function runBirthdayNotice(
  now: Date = new Date(),
  opts: { force?: boolean; dryRun?: boolean } = {}
) {
  const s = await getNotifySetting();
  const { due, reason } = notifyDue(birthdayTiming(s), now, opts);
  if (!due) return { ran: false, reason };

  // 생년월일은 문자열이라 DB 에서 월·일로 거를 수 없다 — 재직자만 읽어 메모리에서 가린다
  // (수십 명 규모라 이 편이 단순하고, 표기가 여러 가지인 것도 여기서 함께 흡수한다).
  const rows = await prisma.employee.findMany({
    where: { active: true, birth: { not: null } },
    select: { id: true, name: true, department: true, position: true, birth: true },
  });
  const alerts = birthdaysOn(rows as any, now, s.birthdayLeadDays);

  if (opts.dryRun) return { ran: false, dryRun: true, reason, count: alerts.length, alerts };
  if (!alerts.length) {
    await prisma.hrNotifySetting.update({ where: { id: 1 }, data: { birthdayLastRunAt: now } });
    return { ran: true, count: 0, reason: "오늘 생일인 직원 없음" };
  }

  const msg = birthdayAlertText(alerts, { today: s.birthdayLeadDays === 0 });
  const out = await deliver(s, msg);
  await prisma.hrNotifySetting.update({ where: { id: 1 }, data: { birthdayLastRunAt: now } });

  await logActivity({
    action: "NOTIFY_BIRTHDAY",
    actor: opts.force ? "ADMIN" : "CRON",
    summary: `생일 안내 ${alerts.length}명을 ${s.channel ?? `${s.targetDepartment} 부서`}에 알렸습니다.`,
    meta: { names: alerts.map((a) => a.name), ...out },
  }).catch(() => {});

  return { ran: true, count: alerts.length, alerts, ...out };
}

/** 크론에서 한 번에 — 한쪽이 실패해도 나머지는 돌린다 */
export async function runHrNotices(now: Date = new Date(), opts: { force?: boolean } = {}) {
  const [contract, birthday] = await Promise.all([
    runContractExpiryNotice(now, opts).catch((e) => ({ error: String(e?.message ?? e) })),
    runBirthdayNotice(now, opts).catch((e) => ({ error: String(e?.message ?? e) })),
  ]);
  return { contract, birthday };
}

/** 설정 화면용 — 지금 조건이면 무엇이 나갈지 미리 보여 준다 */
export async function previewHrNotices(now: Date = new Date()) {
  const s = await getNotifySetting();
  const [contract, birthday, recipients] = await Promise.all([
    runContractExpiryNotice(now, { force: true, dryRun: true }),
    runBirthdayNotice(now, { force: true, dryRun: true }),
    notifyRecipients(s.targetDepartment, s.channel),
  ]);
  return { setting: s, contract, birthday, recipients, slack: slackConfigured() };
}

export { DEFAULT_CONTRACT_TIMING, DEFAULT_BIRTHDAY_TIMING, DEFAULT_NOTIFY_DEPARTMENT };
