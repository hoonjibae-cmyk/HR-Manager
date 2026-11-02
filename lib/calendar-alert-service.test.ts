import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_ALERT_TARGETS, normalizeAlertEvent, type AlertEvent } from "./calendar-alerts";

const memory = vi.hoisted(() => ({
  state: null as any, events: new Map<string, any>(), deliveries: new Map<string, any>(),
  pages: [] as any[], posted: [] as any[], googleCalls: [] as string[], slackOk: true, failWrite: false,
}));

vi.mock("./gcal", () => ({ accessToken: async () => "test-token" }));
vi.mock("./db", () => {
  const database = {
    calendarAlertState: {
      upsert: async ({ create }: any) => memory.state ||= { ...create, syncToken: null, pageToken: null, initializedAt: null, leaseOwner: null, leaseUntil: null },
      updateMany: async ({ where, data }: any) => {
        if (where.leaseOwner && memory.state.leaseOwner !== where.leaseOwner) return { count: 0 };
        if (where.OR && memory.state.leaseUntil && memory.state.leaseUntil >= new Date()) return { count: 0 };
        Object.assign(memory.state, data); return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ ...memory.state }),
      update: async ({ data }: any) => Object.assign(memory.state, data),
    },
    calendarAlertEvent: {
      findMany: async ({ where }: any) => [...memory.events.values()].filter((v) => where.eventId.in.includes(v.eventId)),
      createMany: async ({ data }: any) => { for (const row of data) if (!memory.events.has(row.eventId)) memory.events.set(row.eventId, row); },
      upsert: async ({ create, update }: any) => {
        if (memory.failWrite) throw new Error("simulated database failure");
        const previous = memory.events.get(create.eventId);
        memory.events.set(create.eventId, previous ? { ...previous, ...update } : create);
      },
    },
    calendarAlertDelivery: {
      upsert: async ({ create }: any) => {
        if (!memory.deliveries.has(create.id)) memory.deliveries.set(create.id, { ...create, createdAt: new Date(), nextAttemptAt: new Date(), sentAt: null, attempts: 0 });
      },
      findFirst: async () => [...memory.deliveries.values()].find((v) => !v.sentAt && v.nextAttemptAt <= new Date()),
      count: async () => [...memory.deliveries.values()].filter((v) => !v.sentAt).length,
      update: async ({ where, data }: any) => {
        const row = memory.deliveries.get(where.id);
        const { attempts, ...rest } = data;
        Object.assign(row, rest);
        if (attempts) row.attempts += attempts.increment;
      },
    },
    employee: { findMany: async () => [] },
    $transaction: async (fn: any) => {
      const backup = structuredClone({ state: memory.state, events: memory.events, deliveries: memory.deliveries });
      try { return await fn(database); }
      catch (error) { Object.assign(memory, backup); throw error; }
    },
  };
  return { prisma: database };
});

import { syncCalendarTarget } from "./calendar-alert-service";
const target = CALENDAR_ALERT_TARGETS[0];
const event: AlertEvent = {
  id: "weekly", summary: "회의", description: "내용", created: "2026-10-22T11:00:00Z", etag: "version1",
  start: { dateTime: "2026-10-27T14:00:00+09:00" }, end: { dateTime: "2026-10-27T15:00:00+09:00" },
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"], creator: { email: "teacher@example.com" },
};
const run = () => syncCalendarTarget(target, Date.now() + 250000);
function initialized() {
  memory.state = { calendarId: target.calendarId, initializedAt: new Date("2026-10-22T10:00:00Z"), syncToken: "sync-old", pageToken: null, leaseUntil: null, leaseOwner: null };
}

beforeEach(() => {
  memory.state = null; memory.events.clear(); memory.deliveries.clear(); memory.pages = []; memory.posted = []; memory.googleCalls = []; memory.slackOk = true; memory.failWrite = false;
  vi.stubEnv("SLACK_BOT_TOKEN", "test-token");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    if (url.includes("googleapis.com")) {
      memory.googleCalls.push(url);
      const page = memory.pages.shift();
      if (!page) throw new Error("unexpected Google request");
      return new Response(JSON.stringify(page.status ? {} : page), { status: page.status || 200 });
    }
    memory.posted.push(JSON.parse(init.body));
    return new Response(JSON.stringify(memory.slackOk ? { ok: true, ts: "1.1" } : { ok: false, error: "not_in_channel" }));
  }));
});

describe("calendar incremental sync and durable delivery", () => {
  it("baselines every page without posting old recurring schedules", async () => {
    memory.pages.push({ items: [event], nextPageToken: "page2" }, { items: [{ ...event, id: "old-other" }], nextSyncToken: "sync-new" });
    const result = await run();
    expect(result).toMatchObject({ initialized: true, scanned: 2, queued: 0, sent: 1, pending: 0, error: null });
    expect(memory.events.size).toBe(2);
    expect(memory.posted[0].text).toContain("연동 완료");
    expect(memory.googleCalls[1]).toContain("pageToken=page2");
    expect(memory.state.syncToken).toBe("sync-new");
  });
  it("posts one new-series notification and no duplicate on an unchanged next poll", async () => {
    initialized();
    memory.pages.push({ items: [event], nextSyncToken: "sync-new" }, { items: [event], nextSyncToken: "sync-next" });
    expect(await run()).toMatchObject({ queued: 1, sent: 1 });
    expect(await run()).toMatchObject({ queued: 0, sent: 0 });
    expect(memory.posted).toHaveLength(1);
    expect(memory.posted[0].text).toContain("매주 화요일");
    expect(memory.googleCalls[0]).toContain("singleEvents=false");
    expect(memory.googleCalls[0]).toContain("syncToken=sync-old");
  });
  it("shows changed values, with no notification for metadata-only updates", async () => {
    initialized();
    const old = normalizeAlertEvent(event);
    memory.events.set(event.id, { eventId: event.id, snapshot: old });
    memory.pages.push({ items: [{ ...event, etag: "metadata", updated: "2026-10-23T00:00:00Z" }], nextSyncToken: "s2" }, { items: [{ ...event, etag: "realchange", summary: "바뀐 회의" }], nextSyncToken: "s3" });
    expect(await run()).toMatchObject({ queued: 0, sent: 0 });
    expect(await run()).toMatchObject({ queued: 1, sent: 1 });
    expect(memory.posted[0].text).toContain("제목: 회의 → 바뀐 회의");
  });
  it("retains failed Slack posts for retry even after advancing the Google token", async () => {
    initialized(); memory.slackOk = false;
    memory.pages.push({ items: [event], nextSyncToken: "s2" }, { items: [], nextSyncToken: "s3" });
    expect(await run()).toMatchObject({ queued: 1, sent: 0, pending: 1, error: "not_in_channel" });
    expect(memory.state.syncToken).toBe("s2");
    const delivery = [...memory.deliveries.values()][0];
    delivery.nextAttemptAt = new Date(0); memory.slackOk = true;
    expect(await run()).toMatchObject({ queued: 0, sent: 1, pending: 0, error: null });
    expect(memory.posted[0].client_msg_id).toBe(memory.posted[1].client_msg_id);
  });
  it("recovers an expired token without replaying existing schedules", async () => {
    initialized(); memory.events.set(event.id, { eventId: event.id, snapshot: normalizeAlertEvent(event) });
    memory.pages.push({ status: 410 }, { items: [event], nextSyncToken: "fresh-token" });
    expect(await run()).toMatchObject({ queued: 0, sent: 0, error: null });
    expect(memory.state.syncToken).toBe("fresh-token");
    expect(memory.googleCalls[1]).not.toContain("syncToken");
  });
  it("rolls back the page and token when persistence fails", async () => {
    initialized(); memory.failWrite = true;
    memory.pages.push({ items: [event], nextSyncToken: "must-not-commit" });
    expect(await run()).toMatchObject({ sent: 0, error: "simulated database failure" });
    expect(memory.state.syncToken).toBe("sync-old");
    expect(memory.deliveries.size).toBe(0);
  });
  it("suppresses concurrent workers under the same calendar lease", async () => {
    initialized(); memory.state.leaseUntil = new Date(Date.now() + 60000); memory.state.leaseOwner = "other-worker";
    expect(await run()).toMatchObject({ skipped: "already_running" });
    expect(memory.googleCalls).toHaveLength(0);
  });
  it("notifies cancellation of one previously unexpanded recurring occurrence", async () => {
    initialized(); memory.events.set(event.id, { eventId: event.id, snapshot: normalizeAlertEvent(event) });
    memory.pages.push({ items: [{ id: "exception", status: "cancelled", recurringEventId: event.id, originalStartTime: { dateTime: "2026-11-03T14:00:00+09:00" } }], nextSyncToken: "next" });
    expect(await run()).toMatchObject({ queued: 1, sent: 1 });
    expect(memory.posted[0].text).toContain("일정 취소");
    expect(memory.posted[0].text).toContain("2026년 11월 3일 회차만");
  });
});
