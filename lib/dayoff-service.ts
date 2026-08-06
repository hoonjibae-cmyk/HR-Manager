// 평일 휴무 — 구글 연차 캘린더에서 끌어와 표에 맞춘다.
//
// 판정·파싱은 lib/dayoff.ts(순수 함수, 테스트 있음)에 있고 여기서는 부르고 읽고 쓰기만 한다.
// **연차가 아니다** — `LeaveTransaction` 을 건드리지 않는다(그쪽은 연차 잔여를 만든다).

import { prisma } from "./db";
import { listLeaveCalendarEvents, gcalConfigured } from "./gcal";
import { matchEmployee } from "./timesheet";
import { logActivity } from "./activity";
import {
  parseDayOffEvents,
  planDayOffs,
  diffDayOffs,
  syncWindow,
  dayOffWarning,
  type DayOffPlan,
} from "./dayoff";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);

export interface DayOffItem {
  id: number;
  employeeId: number;
  name: string;
  department: string | null;
  /** YYYY-MM-DD */
  date: string;
  title: string | null;
  source: string;
}

export async function listDayOffs(from?: string, to?: string): Promise<DayOffItem[]> {
  const rows = await prisma.dayOff.findMany({
    where: from && to ? { date: { gte: toDate(from), lte: toDate(to) } } : undefined,
    include: { employee: { select: { name: true, department: true } } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    name: r.employee?.name ?? "",
    department: r.employee?.department ?? null,
    date: ymd(r.date),
    title: r.title,
    source: r.source,
  }));
}

export interface DayOffSyncResult {
  added: number;
  removed: number;
  total: number;
  window: { from: string; to: string };
  warning: string | null;
  unmatched: DayOffPlan["unmatched"];
  unreadable: DayOffPlan["unreadable"];
  error?: string;
}

/**
 * 캘린더 → 표.
 *
 * **일정을 못 읽으면 아무것도 하지 않는다.** `listLeaveCalendarEvents` 는 실패할 때 `null` 을
 * 돌려준다(빈 배열이 아니다) — 빈 배열로 받으면 '휴무가 하나도 없다' 로 읽고 표를 통째로 지운다.
 * 캘린더가 잠깐 안 되는 것과 휴무가 없는 것은 전혀 다른 일이다.
 */
export async function syncDayOffs(
  now: Date = new Date(),
  opts: { back?: number; ahead?: number; dryRun?: boolean } = {}
): Promise<DayOffSyncResult> {
  const window = syncWindow(now, opts);
  const empty = { added: 0, removed: 0, total: 0, window, warning: null, unmatched: [], unreadable: [] };

  if (!gcalConfigured())
    return { ...empty, error: "구글 캘린더가 연결되어 있지 않습니다 (GOOGLE_CALENDAR_ID)." };

  const events = await listLeaveCalendarEvents(window.from, window.to);
  if (events == null)
    return { ...empty, error: "캘린더 일정을 읽지 못했습니다. 연결 상태를 확인해 주세요." };

  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true, name: true, department: true },
  });
  const plan = planDayOffs(parseDayOffEvents(events as any), employees, matchEmployee);

  const stored = (await listDayOffs(window.from, window.to)).map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    date: r.date,
    gcalEventId: null,
    source: r.source,
  }));
  const { add, remove } = diffDayOffs(stored, plan.resolved, window);

  const result: DayOffSyncResult = {
    added: add.length,
    removed: remove.length,
    total: plan.resolved.length,
    window,
    warning: dayOffWarning(plan),
    unmatched: plan.unmatched,
    unreadable: plan.unreadable,
  };
  if (opts.dryRun) return result;

  for (const a of add)
    await prisma.dayOff.upsert({
      where: { employeeId_date: { employeeId: a.employeeId, date: toDate(a.date) } },
      update: { title: a.title, gcalEventId: a.gcalEventId, source: "GCAL" },
      create: {
        employeeId: a.employeeId,
        date: toDate(a.date),
        title: a.title,
        gcalEventId: a.gcalEventId,
        source: "GCAL",
      },
    });
  if (remove.length)
    await prisma.dayOff.deleteMany({ where: { id: { in: remove.map((r) => r.id) } } });

  await logActivity({
    action: "DAYOFF_SYNC",
    summary:
      `평일 휴무 동기화 — ${plan.resolved.length}건 (추가 ${add.length} · 삭제 ${remove.length})` +
      (result.warning ? " ⚠ 확인 필요" : ""),
    meta: { window, unmatched: plan.unmatched, unreadable: plan.unreadable },
  }).catch(() => {});

  return result;
}
