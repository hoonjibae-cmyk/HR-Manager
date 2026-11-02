import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { accessToken } from "./gcal";
import {
  CALENDAR_ALERT_TARGETS, alertId, buildCalendarAlert, changeKind,
  eventFingerprint, normalizeAlertEvent, type AlertEvent, type CalendarAlertTarget,
} from "./calendar-alerts";

const LEASE_MS = 330000;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 800);
const snapshot = (value: unknown) => value as AlertEvent;

export class CalendarSyncExpired extends Error {}

/** singleEvents=false is essential: one recurring master, rather than years of instances. */
export async function readCalendarAlertPage(calendarId: string, syncToken: string | null, pageToken: string | null) {
  const token = await accessToken();
  if (!token) throw new Error("Google Calendar 인증 설정을 확인해 주세요");
  const params = new URLSearchParams({
    singleEvents: "false", showDeleted: "true", maxResults: "2500", timeZone: "Asia/Seoul",
    fields: "nextSyncToken,nextPageToken,items(id,status,etag,created,updated,summary,description,location,start,end,recurrence,recurringEventId,originalStartTime,creator,htmlLink)",
  });
  if (syncToken) params.set("syncToken", syncToken);
  if (pageToken) params.set("pageToken", pageToken);
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(25000),
  });
  if (response.status === 410) throw new CalendarSyncExpired("Calendar sync token expired");
  if (!response.ok) throw new Error(`Google Calendar 조회 실패 (HTTP ${response.status})`);
  return await response.json() as { items?: AlertEvent[]; nextSyncToken?: string; nextPageToken?: string };
}

/** Stable UUID is a secondary duplicate guard; the durable outbox is the primary guard. */
export function deliveryUuid(id: string): string {
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}`;
}

export async function sendCalendarAlert(channel: string, id: string, payload: unknown): Promise<{ ok: boolean; error?: string; retryAfter?: number }> {
  if (!process.env.SLACK_BOT_TOKEN) return { ok: false, error: "SLACK_BOT_TOKEN 미설정" };
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST", headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ ...(payload as object), channel, client_msg_id: deliveryUuid(id) }),
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 429) return { ok: false, error: "ratelimited", retryAfter: Math.max(1, Number(response.headers.get("retry-after")) || 60) };
  if (!response.ok) return { ok: false, error: `Slack HTTP ${response.status}` };
  const result = await response.json() as { ok: boolean; error?: string };
  return { ok: result.ok === true, error: result.error || (result.ok ? undefined : "Slack 발송 실패") };
}

function setupPayload(target: CalendarAlertTarget) {
  return {
    text: `✅ 캘린더 알림 연동 완료\n${target.name}\n새 일정·일정 변경·취소를 이 채널에 알립니다. 반복일정은 시리즈 단위로 표시하고 등록자 이름/이메일을 함께 표시합니다.\n기존 일정은 기준값으로 저장했으며, 지금부터 감지되는 변경부터 알립니다. 약 1분 간격으로 확인합니다.`,
    unfurl_links: false, unfurl_media: false,
  };
}

export async function syncCalendarTarget(target: CalendarAlertTarget, deadline: number) {
  const calendarId = target.calendarId;
  await prisma.calendarAlertState.upsert({ where: { calendarId }, create: { calendarId }, update: {} });
  const owner = randomUUID();
  const locked = await prisma.calendarAlertState.updateMany({
    where: { calendarId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
    data: { leaseOwner: owner, leaseUntil: new Date(Date.now() + LEASE_MS), lastPolledAt: new Date() },
  });
  if (!locked.count) return { calendar: target.name, skipped: "already_running" };
  let scanned = 0;
  let queued = 0;
  let sent = 0;
  let syncError: string | null = null;
  let deliveryError: string | null = null;
  try {
    try {
      let recovered = false;
      while (Date.now() < deadline - 30000) {
        const state = await prisma.calendarAlertState.findUniqueOrThrow({ where: { calendarId } });
        let page;
        try {
          page = await readCalendarAlertPage(calendarId, state.syncToken, state.pageToken);
        } catch (e) {
          if (!(e instanceof CalendarSyncExpired) || recovered) throw e;
          recovered = true;
          // Preserve snapshots/initializedAt: recovering a token must not resend all old events.
          await prisma.calendarAlertState.update({ where: { calendarId }, data: { syncToken: null, pageToken: null } });
          continue;
        }
        if (!page.nextPageToken && !page.nextSyncToken) throw new Error("Google Calendar 응답에 동기화 토큰이 없습니다");
        const items = (page.items || []).filter((event) => !!event.id);
        scanned += items.length;
        const ids = [...new Set(items.flatMap((e) => e.recurringEventId ? [e.id, e.recurringEventId] : [e.id]))];
        const existing = ids.length ? await prisma.calendarAlertEvent.findMany({ where: { calendarId, eventId: { in: ids } } }) : [];
        const known = new Map(existing.map((e) => [e.eventId, snapshot(e.snapshot)]));
        const incoming = new Map(items.map((e) => [e.id, e]));
        const emails = [...new Set(items.map((e) => e.creator?.email?.toLowerCase()).filter(Boolean))] as string[];
        const people = emails.length ? await prisma.employee.findMany({
          where: { OR: [{ email: { in: emails, mode: "insensitive" } }, { workEmail: { in: emails, mode: "insensitive" } }] },
          select: { name: true, email: true, workEmail: true },
        }) : [];
        const names = new Map<string, string>();
        for (const person of people) for (const email of [person.email, person.workEmail]) if (email) names.set(email.toLowerCase(), person.name);
        const changes = items.map((raw) => {
          const before = known.get(raw.id) || null;
          const parent = raw.recurringEventId ? incoming.get(raw.recurringEventId) || known.get(raw.recurringEventId) || null : null;
          const after = normalizeAlertEvent(raw, before, parent);
          const ignoredCancellation = raw.status === "cancelled" && ((!before && !parent) || parent?.status === "cancelled");
          const kind = state.initializedAt && !ignoredCancellation ? changeKind(after, before, state.initializedAt) : null;
          return { before, after, kind };
        });
        await prisma.$transaction(async (tx) => {
          // Refresh and verify ownership in the transaction that commits this page.
          const lease = await tx.calendarAlertState.updateMany({
            where: { calendarId, leaseOwner: owner }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
          });
          if (!lease.count) throw new Error("캘린더 동기화 잠금이 만료되었습니다");
          if (!state.initializedAt && changes.length) await tx.calendarAlertEvent.createMany({
            data: changes.map(({ after }) => ({ calendarId, eventId: after.id, fingerprint: eventFingerprint(after), snapshot: json(after) })),
            skipDuplicates: true,
          });
          for (const { before, after, kind } of state.initializedAt ? changes : []) {
            const fingerprint = eventFingerprint(after);
            if (before && eventFingerprint(before) === fingerprint) continue;
            await tx.calendarAlertEvent.upsert({
              where: { calendarId_eventId: { calendarId, eventId: after.id } },
              create: { calendarId, eventId: after.id, fingerprint, snapshot: json(after) },
              update: { fingerprint, snapshot: json(after) },
            });
            if (kind) {
              const id = alertId(calendarId, after.id, `${after.etag || after.updated}:${fingerprint}`);
              const payload = buildCalendarAlert(target, kind, after, before, names.get((after.creator?.email || "").toLowerCase()));
              await tx.calendarAlertDelivery.upsert({ where: { id }, create: { id, calendarId, channelId: target.channelId, payload: json(payload) }, update: {} });
              queued++;
            }
          }
          if (!page.nextPageToken && !state.initializedAt) {
            const id = alertId(calendarId, "setup", "v1");
            await tx.calendarAlertDelivery.upsert({ where: { id }, create: { id, calendarId, channelId: target.channelId, payload: json(setupPayload(target)) }, update: {} });
          }
          await tx.calendarAlertState.update({ where: { calendarId }, data: {
            pageToken: page.nextPageToken || null,
            ...(page.nextPageToken ? {} : { syncToken: page.nextSyncToken!, initializedAt: state.initializedAt || new Date(), lastSuccessAt: new Date() }),
          } });
        }, { maxWait: 10000, timeout: 120000 });
        if (!page.nextPageToken) break;
      }
    } catch (e) {
      syncError = errorText(e);
    }
    // Drain even if the latest Google request failed; previously queued alerts remain deliverable.
    while (Date.now() < deadline - 23000 && sent < 40) {
      const next = await prisma.calendarAlertDelivery.findFirst({
        where: { calendarId, sentAt: null, nextAttemptAt: { lte: new Date() } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (!next) break;
      let result;
      try { result = await sendCalendarAlert(next.channelId, next.id, next.payload); }
      catch (e) { result = { ok: false, error: errorText(e) }; }
      if (!result.ok) {
        deliveryError = result.error || "Slack 발송 실패";
        await prisma.calendarAlertDelivery.update({ where: { id: next.id }, data: {
          attempts: { increment: 1 }, lastError: deliveryError,
          nextAttemptAt: new Date(Date.now() + (result.retryAfter || Math.min(3600, 30 * 2 ** Math.min(next.attempts, 7))) * 1000),
        } });
        break;
      }
      await prisma.calendarAlertDelivery.update({ where: { id: next.id }, data: { sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      sent++;
      // Slack normally permits one message per second in a channel.
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    const pending = await prisma.calendarAlertDelivery.count({ where: { calendarId, sentAt: null } });
    const state = await prisma.calendarAlertState.findUniqueOrThrow({ where: { calendarId } });
    await prisma.calendarAlertState.update({ where: { calendarId }, data: { lastError: syncError || deliveryError } });
    return { calendar: target.name, initialized: !!state.initializedAt, scanned, queued, sent, pending, error: syncError || deliveryError };
  } finally {
    await prisma.calendarAlertState.updateMany({ where: { calendarId, leaseOwner: owner }, data: { leaseOwner: null, leaseUntil: null } });
  }
}

export async function runCalendarAlerts() {
  const deadline = Date.now() + 250000;
  const results = [];
  for (const target of CALENDAR_ALERT_TARGETS) {
    try { results.push(await syncCalendarTarget(target, deadline)); }
    catch (e) {
      const error = errorText(e);
      console.error("[calendar-alerts]", target.name, error);
      results.push({ calendar: target.name, error });
    }
  }
  console.info("[calendar-alerts]", JSON.stringify(results));
  return results;
}
