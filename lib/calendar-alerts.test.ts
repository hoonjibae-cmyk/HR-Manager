import { describe, expect, it } from "vitest";
import { CALENDAR_ALERT_TARGETS, alertId, buildCalendarAlert, changeKind, eventFingerprint, formatEventWhen, formatRecurrence, normalizeAlertEvent, type AlertEvent } from "./calendar-alerts";

const target = CALENDAR_ALERT_TARGETS[0];
const baseline = new Date("2026-10-22T10:00:00Z");
const event: AlertEvent = {
  id: "meeting", created: "2026-10-22T11:00:00Z", updated: "2026-10-22T11:00:00Z",
  summary: "교수부 회의", description: "회의 내용", location: "회의실",
  start: { dateTime: "2026-10-27T14:00:00+09:00", timeZone: "Asia/Seoul" },
  end: { dateTime: "2026-10-27T15:00:00+09:00", timeZone: "Asia/Seoul" },
  creator: { displayName: "홍길동", email: "teacher@example.com" },
};

describe("calendar alert content", () => {
  it("routes the two calendars to the requested channels", () => {
    expect(CALENDAR_ALERT_TARGETS.map((t) => t.channelId)).toEqual(["C056VGMNKLP", "C057NN63VFT"]);
  });
  it("formats weekly recurrence and inclusive UNTIL in Korean", () => {
    expect(formatRecurrence({ ...event, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261229T050000Z"] }))
      .toBe("매주 화요일 오후 2시~오후 3시, 2026년 12월 29일까지 반복");
  });
  it("handles a UTC limit that crosses into the next Korean date", () => {
    expect(formatRecurrence({ ...event, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261228T150000Z"] })).toContain("2026년 12월 29일까지");
  });
  it("distinguishes endless series and counted series", () => {
    expect(formatRecurrence({ ...event, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"] })).toContain("종료일 없이 반복");
    expect(formatRecurrence({ ...event, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=10"] })).toContain("총 10회 반복");
  });
  it("formats every other week and monthly last weekdays", () => {
    expect(formatRecurrence({ ...event, recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"] })).toContain("2주마다 월요일·수요일");
    expect(formatRecurrence({ ...event, recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=-1FR"] })).toContain("매월 마지막 금요일");
  });
  it("keeps advanced recurrence constraints instead of inventing a simpler rule", () => {
    expect(formatRecurrence({ ...event, recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=TU;BYMONTHDAY=3"] })).toContain("고급 반복 일정");
  });
  it("corrects exclusive all-day end dates and shows overnight end dates", () => {
    expect(formatEventWhen({ id: "a", start: { date: "2026-10-27" }, end: { date: "2026-10-28" } })).toBe("2026년 10월 27일 (종일)");
    expect(formatEventWhen({ id: "a", start: { date: "2026-10-27" }, end: { date: "2026-10-30" } })).toBe("2026년 10월 27일~2026년 10월 29일 (종일)");
    expect(formatEventWhen({ ...event, end: { dateTime: "2026-10-28T01:00:00+09:00" } })).toContain("~2026년 10월 28일 오전 1시");
  });
  it("uses original local weekdays/time for non-Korean recurring calendars", () => {
    const sample = { ...event, start: { dateTime: "2026-10-27T10:00:00-07:00", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-10-27T11:00:00-07:00" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"] };
    expect(formatRecurrence(sample)).toContain("화요일 오전 10시~오전 11시");
    expect(formatRecurrence(sample)).toContain("America/Los_Angeles 현지시간 기준");
  });
  it("includes the creator rather than mislabeling the calendar organizer", () => {
    expect(buildCalendarAlert(target, "created", event, null).text).toContain("등록자: 홍길동 (teacher@example.com)");
    expect(buildCalendarAlert(target, "created", { ...event, creator: { email: "teacher@example.com" } }, null, "홍길동").text).toContain("등록자: 홍길동 (teacher@example.com)");
    expect(buildCalendarAlert(target, "created", { ...event, creator: {} }, null).text).toContain("등록자: 확인 불가");
  });
  it("shows before/after values including cleared description and location", () => {
    const previous = normalizeAlertEvent(event);
    const current = normalizeAlertEvent({ ...event, description: undefined, location: undefined }, previous);
    expect(current.description).toBe("");
    expect(current.location).toBe("");
    const msg = buildCalendarAlert(target, "updated", current, previous);
    expect(msg.text).toContain("내용: 회의 내용 → (없음)");
    expect(msg.text).toContain("장소: 회의실 → (없음)");
  });
  it("ignores API metadata-only updates while recognizing real content changes", () => {
    const first = normalizeAlertEvent(event);
    const metadataOnly = normalizeAlertEvent({ ...event, updated: "2026-10-23T00:00:00Z", etag: "new" });
    expect(eventFingerprint(first)).toBe(eventFingerprint(metadataOnly));
    expect(changeKind(metadataOnly, first, baseline)).toBeNull();
    expect(changeKind(normalizeAlertEvent({ ...event, summary: "변경됨" }), first, baseline)).toBe("updated");
  });
  it("keeps each occurrence change separate from the master series", () => {
    const current = normalizeAlertEvent({ ...event, id: "instance", recurringEventId: "master", originalStartTime: event.start }, null, { ...event, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"] });
    expect(current.recurrence).toEqual([]);
    expect(changeKind(current, null, baseline)).toBe("updated");
    expect(buildCalendarAlert(target, "updated", current, null).text).toContain("2026년 10월 27일 회차만");
  });
  it("recovers cancelled occurrence details from its master and originalStartTime", () => {
    const cancelled = normalizeAlertEvent({ id: "cancelled-instance", status: "cancelled", recurringEventId: "master", originalStartTime: { dateTime: "2026-11-03T14:00:00+09:00" } }, null, event);
    expect(formatEventWhen(cancelled)).toContain("2026년 11월 3일");
    expect(formatEventWhen(cancelled)).toContain("오후 2시~오후 3시");
    expect(changeKind(cancelled, null, baseline)).toBe("cancelled");
    expect(cancelled.creator?.email).toBe("teacher@example.com");
  });
  it("never turns event-provided Slack mentions into active markup", () => {
    const msg = buildCalendarAlert(target, "created", { ...event, summary: "<!channel> <@U123>", description: "<b>내용</b>" }, null);
    expect(msg.text).not.toContain("<!channel>");
    expect(msg.blocks[1]).toMatchObject({ text: { type: "plain_text" } });
  });
  it("uses distinct durable delivery IDs for the same event across real revisions", () => {
    expect(alertId(target.calendarId, event.id, "v1")).not.toBe(alertId(target.calendarId, event.id, "v2"));
    expect(alertId(target.calendarId, event.id, "v1")).toBe(alertId(target.calendarId, event.id, "v1"));
  });
});
