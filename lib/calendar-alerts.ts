import { createHash } from "crypto";

export const CALENDAR_ALERT_TARGETS = [
  {
    calendarId: "f5e1c8e1ee97b6bc15d3158f47666bf6228a98078b4547fe94593488c0379fcf@group.calendar.google.com",
    name: "유쌤에듀_학사일정",
    channelId: "C056VGMNKLP",
  },
  {
    calendarId: "rja0771etk1hjcmrdaqe0tofrg@group.calendar.google.com",
    name: "목동유샘영어_관리자",
    channelId: "C057NN63VFT",
  },
] as const;

export type CalendarAlertTarget = (typeof CALENDAR_ALERT_TARGETS)[number];
export type EventTime = { date?: string; dateTime?: string; timeZone?: string };
export interface AlertEvent {
  id: string;
  status?: string;
  etag?: string;
  created?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventTime;
  end?: EventTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: EventTime;
  creator?: { displayName?: string; email?: string };
  htmlLink?: string;
}

const DAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
const CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const TIMEZONE = "Asia/Seoul";
const trim = (value: string | undefined) => (value || "").trim();

/** Google descriptions can contain HTML. Calendar content is never interpreted as Slack markup. */
export function plainDescription(value?: string): string {
  return trim(value)
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clockParts(value: EventTime, zone = TIMEZONE) {
  if (!value.dateTime) return null;
  const date = new Date(value.dateTime);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    weekday: DAYS[new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`).getUTCDay()],
    clock: `${Number(p.hour) < 12 ? "오전" : "오후"} ${Number(p.hour) % 12 || 12}시${Number(p.minute) ? ` ${Number(p.minute)}분` : ""}`,
  };
}

function koreanDate(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

function dateMinusOne(ymd: string): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
}

export function formatEventWhen(event: AlertEvent): string {
  if (event.start?.date) {
    const last = event.end?.date ? dateMinusOne(event.end.date) : event.start.date;
    return `${koreanDate(event.start.date)}${last > event.start.date ? `~${koreanDate(last)}` : ""} (종일)`;
  }
  if (!event.start?.dateTime) return "일시 정보 확인 불가";
  const start = clockParts(event.start);
  const end = event.end ? clockParts(event.end) : null;
  if (!start) return "일시 정보 확인 불가";
  return `${koreanDate(start.ymd)} (${start.weekday}) ${start.clock}${end ? `~${start.ymd === end.ymd ? "" : `${koreanDate(end.ymd)} `}${end.clock}` : ""} (한국시간)`;
}

function weekdayLabel(code: string): string {
  const match = code.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
  if (!match) return code;
  const day = DAYS[CODES.indexOf(match[2])];
  if (!match[1]) return day;
  const n = Number(match[1]);
  return `${n === -1 ? "마지막" : n < 0 ? `뒤에서 ${-n}번째` : `${n}번째`} ${day}`;
}

/** Describe the rule, never expand an unbounded series into future occurrences. */
export function formatRecurrence(event: AlertEvent): string | null {
  const lines = event.recurrence || [];
  const rules = lines.filter((line) => line.startsWith("RRULE:"));
  if (!lines.length) return null;
  if (rules.length !== 1) return `고급 반복 일정 (${lines.join(" · ")})`;
  const r: Record<string, string> = Object.fromEntries(rules[0].slice(6).split(";").map((s) => s.split("=")));
  const interval = Math.max(1, Number(r.INTERVAL || 1));
  const date = event.start?.date || clockParts(event.start || {}, event.start?.timeZone || TIMEZONE)?.ymd;
  const day = date ? DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] : "";
  const byday = r.BYDAY ? r.BYDAY.split(",").map(weekdayLabel).join("·") : day;
  const monthlyDay = r.BYMONTHDAY
    ? r.BYMONTHDAY.split(",").map((d) => Number(d) === -1 ? "말일" : Number(d) < 0 ? `뒤에서 ${-Number(d)}일` : `${Number(d)}일`).join("·")
    : r.BYDAY ? `${r.BYSETPOS ? `${Number(r.BYSETPOS) === -1 ? "마지막" : `${r.BYSETPOS}번째`} ` : ""}${byday}`
      : date ? `${Number(date.slice(8, 10))}일` : "";
  let pattern = "";
  if (r.FREQ === "DAILY") pattern = interval === 1 ? "매일" : `${interval}일마다`;
  if (r.FREQ === "WEEKLY") pattern = `${interval === 1 ? "매주" : `${interval}주마다`} ${byday}`;
  if (r.FREQ === "MONTHLY") pattern = `${interval === 1 ? "매월" : `${interval}개월마다`} ${monthlyDay}`;
  if (r.FREQ === "YEARLY") pattern = `${interval === 1 ? "매년" : `${interval}년마다`} ${r.BYMONTH ? r.BYMONTH.split(",").join("·") : date ? Number(date.slice(5, 7)) : ""}월 ${monthlyDay}`;
  const unsupported = Object.keys(r).some((key) => !["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST", "UNTIL", "COUNT"].includes(key))
    || (r.FREQ === "DAILY" && !!r.BYDAY)
    || (r.FREQ === "WEEKLY" && (!!r.BYMONTHDAY || !!r.BYMONTH))
    || (r.FREQ === "MONTHLY" && (!!r.BYMONTH || (!!r.BYDAY && !!r.BYMONTHDAY)))
    || (!!r.BYSETPOS && r.BYSETPOS.includes(","));
  if (!pattern || unsupported) return `고급 반복 일정 (${rules[0].slice(6)})`;
  let until = "종료일 없이 반복";
  if (r.UNTIL) {
    const u = r.UNTIL;
    const iso = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
    const ymd = u.includes("T")
      ? clockParts({ dateTime: `${iso}T${u.slice(9, 11)}:${u.slice(11, 13)}:${u.slice(13, 15)}${u.endsWith("Z") ? "Z" : "+09:00"}` })?.ymd || iso
      : iso;
    until = `${koreanDate(ymd)}까지 반복`;
  } else if (r.COUNT) until = `총 ${r.COUNT}회 반복`;
  const recurrenceZone = event.start?.timeZone || TIMEZONE;
  const start = event.start ? clockParts(event.start, recurrenceZone) : null;
  const end = event.end ? clockParts(event.end, recurrenceZone) : null;
  const durationDays = start && end
    ? Math.round((Date.parse(`${end.ymd}T00:00:00Z`) - Date.parse(`${start.ymd}T00:00:00Z`)) / 86400000) : 0;
  const time = event.start?.date ? "종일" : start ? `${start.clock}${end ? `~${durationDays ? `${durationDays}일 후 ` : ""}${end.clock}` : ""}` : "";
  const originalZone = event.start?.timeZone;
  const zoneNotice = originalZone && originalZone !== TIMEZONE ? ` · ${originalZone} 현지시간 기준` : "";
  return `${pattern} ${time}, ${until}${zoneNotice}${lines.some((l) => /^(EXDATE|RDATE)/.test(l)) ? " · 추가/제외 날짜 있음" : ""}`.trim();
}

export function normalizeAlertEvent(event: AlertEvent, previous?: AlertEvent | null, parent?: AlertEvent | null): AlertEvent {
  // A normal API resource is complete: omitted description/location means it was cleared.
  // Only cancellation tombstones may omit unchanged fields.
  const source = event.status === "cancelled" ? { ...parent, ...previous, ...event } : event;
  let start = source.start;
  let end = source.end;
  if (event.status === "cancelled" && event.recurringEventId && !previous && event.originalStartTime) {
    start = event.originalStartTime;
    if (start.date && parent?.start?.date && parent?.end?.date) {
      const days = Date.parse(parent.end.date) - Date.parse(parent.start.date);
      end = { date: new Date(Date.parse(start.date) + days).toISOString().slice(0, 10) };
    } else if (start.dateTime && parent?.start?.dateTime && parent?.end?.dateTime) {
      const duration = Date.parse(parent.end.dateTime) - Date.parse(parent.start.dateTime);
      end = { dateTime: new Date(Date.parse(start.dateTime) + duration).toISOString() };
    }
  }
  const creator = source.creator || parent?.creator;
  return {
    id: event.id, status: event.status || "confirmed", etag: event.etag || "",
    created: source.created || "", updated: event.updated || "",
    summary: trim(source.summary || parent?.summary) || "(제목 없음)", description: plainDescription(source.description),
    location: trim(source.location), start: start || {}, end: end || {},
    // An exception inherits creator/title, but does not inherit the master's recurrence rule.
    recurrence: event.recurringEventId ? [] : source.recurrence || [],
    recurringEventId: event.recurringEventId || "", originalStartTime: event.originalStartTime || {},
    creator: creator ? { displayName: trim(creator.displayName), email: trim(creator.email) } : {},
    htmlLink: source.htmlLink || "",
  };
}

export function eventFingerprint(event: AlertEvent): string {
  const { etag, created, updated, htmlLink, ...meaningful } = event;
  return createHash("sha256").update(JSON.stringify(meaningful)).digest("hex");
}

export function alertId(calendarId: string, eventId: string, version: string): string {
  return createHash("sha256").update(JSON.stringify([calendarId, eventId, version])).digest("hex");
}

export function changeKind(event: AlertEvent, previous: AlertEvent | null, baselineAt: Date): "created" | "updated" | "cancelled" | null {
  if (event.status === "cancelled") return previous?.status === "cancelled" ? null : previous || event.recurringEventId ? "cancelled" : null;
  if (previous) return eventFingerprint(previous) === eventFingerprint(event) ? null : "updated";
  if (event.recurringEventId) return "updated";
  return event.created && Date.parse(event.created) < baselineAt.getTime() ? "updated" : "created";
}

const cut = (s: string, n = 500) => s.length > n ? `${s.slice(0, n - 1)}…` : s;
const escapeSlack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildCalendarAlert(target: CalendarAlertTarget, kind: "created" | "updated" | "cancelled", event: AlertEvent, previous: AlertEvent | null, creatorName?: string) {
  const label = kind === "created" ? "새 일정 등록" : kind === "cancelled" ? "일정 취소" : "일정 변경";
  const creator = event.creator || {};
  const name = creator.displayName || creatorName;
  const who = name && creator.email ? `${name} (${creator.email})` : name || creator.email || "확인 불가 (구글에서 등록자 정보를 제공하지 않음)";
  const lines = [`캘린더: ${target.name}`, `일정: ${cut(event.summary || "(제목 없음)")}`];
  const recurrence = formatRecurrence(event);
  lines.push(`${recurrence ? "반복" : "일시"}: ${recurrence || formatEventWhen(event)}`);
  if (recurrence) lines.push(`시작: ${formatEventWhen(event)}`);
  if (event.recurringEventId) {
    const original = event.originalStartTime || {};
    const date = original.date || clockParts(original)?.ymd;
    lines.push(`적용 범위: ${date ? koreanDate(date) : "선택한 날짜"} 회차만`);
  }
  if (event.location) lines.push(`장소: ${cut(event.location, 250)}`);
  if (event.description) lines.push(`내용: ${cut(event.description, 700)}`);
  lines.push(`등록자: ${cut(who, 250)}`);
  if (kind === "updated" && previous) {
    const changes: string[] = [];
    if (previous.summary !== event.summary) changes.push(`제목: ${cut(previous.summary || "(없음)", 120)} → ${cut(event.summary || "(없음)", 120)}`);
    if (JSON.stringify(previous.start) !== JSON.stringify(event.start) || JSON.stringify(previous.end) !== JSON.stringify(event.end))
      changes.push(`일시: ${formatEventWhen(previous)} → ${formatEventWhen(event)}`);
    if (JSON.stringify(previous.recurrence) !== JSON.stringify(event.recurrence)) changes.push(`반복: ${cut(formatRecurrence(previous) || "반복 없음", 180)} → ${cut(recurrence || "반복 없음", 180)}`);
    if (previous.location !== event.location) changes.push(`장소: ${cut(previous.location || "(없음)", 120)} → ${cut(event.location || "(없음)", 120)}`);
    if (previous.description !== event.description) changes.push(`내용: ${cut(previous.description || "(없음)", 200)} → ${cut(event.description || "(없음)", 200)}`);
    if (changes.length) lines.push("", "변경사항", ...changes);
  }
  const body = cut(lines.join("\n"), 2900);
  const blocks: object[] = [
    { type: "header", text: { type: "plain_text", text: `📅 ${label}`, emoji: true } },
    { type: "section", text: { type: "plain_text", text: body, emoji: false } },
  ];
  try {
    const link = new URL(event.htmlLink || "");
    if (link.protocol === "https:" && ["calendar.google.com", "www.google.com"].includes(link.hostname))
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `<${link.href.replace(/[<>|]/g, encodeURIComponent)}|구글캘린더에서 보기>` }] });
  } catch { /* No usable event link. */ }
  return { text: escapeSlack(`${label}\n${body}`), blocks, unfurl_links: false, unfurl_media: false };
}
