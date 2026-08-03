// 보강계획 사전신청 ↔ 오버타임 수당 산정의 DB 어댑터.
// 엔진(lib/overtime.ts)은 DB 를 모른다 — 필요한 재료(정책·공휴일·내신기간·근로시간표)를
// 여기서 모아 넘기고, 결과를 급여·화면·명세서가 쓸 형태로 돌려준다.

import { prisma } from "./db";
import { parseSchedule, MAKEUP_CATEGORY_LABEL, MAKEUP_STATUS_LABEL } from "./constants";
import {
  createMakeupEvent,
  updateMakeupEvent,
  deleteMakeupEvent,
  makeupCalendarConfigured,
} from "./gcal";
import {
  computeOvertime,
  overtimeAmount,
  sessionHours,
  workWindow,
  DEFAULT_OT_POLICY,
  type ExamWindow,
  type OtPolicy,
  type OtResult,
  type OtSession,
} from "./overtime";
import { computeWeeklyHours, inclusiveWageBreakdown } from "./payroll";
import { empToPayInput } from "./repo";
import { wageSegmentsFor, applyMidMonthBlend, type MonthContractTerms } from "./payroll-service";

/** 오버타임 정책 (없으면 만들어 준다 — 설정 화면에서 수정) */
export async function getOvertimePolicy(): Promise<OtPolicy & { id: number }> {
  const row = await prisma.overtimePolicy.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return row as any;
}

export async function getExamPeriods(): Promise<ExamWindow[]> {
  const rows = await prisma.examPeriod.findMany({ orderBy: { startDate: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    startDate: r.startDate,
    endDate: r.endDate,
    capHours: r.capHours,
  }));
}

/** 월 경계 (KST 벽시계를 UTC 필드에 담는 앱 규칙 그대로) */
export function monthRange(year: number, month: number) {
  return {
    from: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)),
    to: new Date(Date.UTC(year, month, 0, 23, 59, 59)),
  };
}

const ymdUtc = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 산정에 필요한 조회 범위.
 * 내신의무보강 상한은 **내신 기간 전체**를 봐야 정해지므로(기간이 달을 걸칠 수 있다)
 * 그 달과 겹치는 내신 기간의 전체 구간까지 함께 읽는다.
 */
function scanRange(year: number, month: number, exams: ExamWindow[]) {
  const { from, to } = monthRange(year, month);
  let lo = from;
  let hi = to;
  for (const e of exams) {
    if (e.endDate < from || e.startDate > to) continue;
    if (e.startDate < lo) lo = e.startDate;
    if (e.endDate > hi) hi = e.endDate;
  }
  return { lo, hi, from, to };
}

export interface EmployeeOvertime {
  employeeId: number;
  name: string;
  department: string | null;
  payScheme: string;
  /** 완전비율제는 수당 대상이 아니라 계산에서 빠진다 */
  excludedByScheme: boolean;
  /** 근로시간표가 비어 있으면 소정근로시간을 뺄 수 없다 — 화면에서 경고한다 */
  missingSchedule: boolean;
  hourlyWage: number;
  result: OtResult;
  amount: number;
}

/**
 * 한 달 오버타임 산정 — 직원별.
 *
 * 주의: 내신 상한은 내신 기간 전체를 기준으로 채워지므로, 기간이 달을 걸치면
 * 뒤 달의 신청이 앞 달 배분을 바꿀 수 있다. 명세서를 이미 발송(SENT)한 달은
 * runPayrollMonth 가 재계산하지 않으므로 확정분이 뒤늦게 흔들리지는 않는다.
 */
export async function overtimeForMonth(
  year: number,
  month: number,
  onlyEmployeeIds?: number[]
): Promise<EmployeeOvertime[]> {
  const [policy, exams] = await Promise.all([getOvertimePolicy(), getExamPeriods()]);
  const { lo, hi, from, to } = scanRange(year, month, exams);

  const where: any = { planStart: { gte: lo, lte: hi } };
  if (onlyEmployeeIds?.length) where.employeeId = { in: onlyEmployeeIds };

  const [rows, holidayRows] = await Promise.all([
    prisma.makeupSession.findMany({
      where,
      include: { employee: true },
      orderBy: { planStart: "asc" },
    }),
    prisma.holiday.findMany(),
  ]);
  const holidays = holidayRows.map((h) => ymdUtc(h.date));

  const byEmp = new Map<number, typeof rows>();
  for (const r of rows) {
    const arr = byEmp.get(r.employeeId) ?? [];
    arr.push(r);
    byEmp.set(r.employeeId, arr);
  }

  // 보수조건은 계약이 진실 — 직원 카드는 거울일 뿐이라 그대로 쓰면 통상시급이 어긋난다
  const segMap = await wageSegmentsFor(
    Array.from(byEmp.values()).map((l) => l[0].employee),
    year,
    month
  );

  const out: EmployeeOvertime[] = [];
  for (const [employeeId, list] of byEmp) {
    const emp = list[0].employee;
    const schedule = parseSchedule(emp.schedule);
    const sessions: OtSession[] = list.map((r) => ({
      id: r.id,
      category: r.category,
      status: r.status,
      planStart: r.planStart,
      planEnd: r.planEnd,
      actualStart: r.actualStart,
      actualEnd: r.actualEnd,
      payEligible: r.payEligible,
    }));

    const full = computeOvertime({ sessions, schedule, holidays, examPeriods: exams, policy });
    // 조회 범위를 넓혔으므로 이 달 것만 남긴다 (상한 배분은 전체 기준으로 이미 끝났다)
    const inMonth = (d: string) => {
      const t = new Date(`${d}T00:00:00Z`);
      return t >= from && t <= to;
    };
    const result: OtResult = {
      ...full,
      lines: full.lines.filter((l) => inMonth(l.date)),
      excluded: full.excluded.filter((l) => inMonth(l.date)),
      extraHours: 0,
      overtimeHours: 0,
      holidayHours: 0,
      holidayOverHours: 0,
      nightHours: 0,
      pendingDecision: sessions.filter((s) => {
        const d = ymdUtc(workWindow(s).start);
        return inMonth(d) && s.payEligible == null && !defaultOf(s.category, policy);
      }).length,
    };
    const sum = (f: (l: (typeof result.lines)[number]) => boolean) =>
      Math.round(result.lines.filter(f).reduce((a, l) => a + l.countedHours, 0) * 1000) / 1000;
    result.extraHours = sum((l) => l.kind === "EXTRA");
    result.overtimeHours = sum((l) => l.kind === "OVERTIME");
    result.holidayHours = sum((l) => l.kind === "HOLIDAY" && !l.over);
    result.holidayOverHours = sum((l) => l.kind === "HOLIDAY" && !!l.over);
    result.nightHours = sum((l) => l.night);

    // 수당 산정 제외 —
    //  · RATIO: 완전비율제 프리랜서라 시간 단위 수당 개념이 없다
    //  · HOURLY: 보강 시간이 이미 출퇴근 기록(시간기록표)에 잡혀 실근로시간으로 지급된다.
    //    여기서 또 얹으면 같은 시간을 두 번 주는 셈이다. 시급제는 15시간을 넘긴 주마다
    //    주휴를 인정하는 것으로 초과근로분을 갈음해 왔다(lib/timesheet.ts 머리말).
    const excludedByScheme = emp.payScheme === "RATIO" || emp.payScheme === "HOURLY";
    const hourlyWage = excludedByScheme ? 0 : hourlyWageOf(emp, segMap.get(employeeId));
    if (excludedByScheme) {
      result.extraHours = 0;
      result.overtimeHours = 0;
      result.holidayHours = 0;
      result.holidayOverHours = 0;
      result.nightHours = 0;
    }

    out.push({
      employeeId,
      name: emp.name,
      department: emp.department,
      payScheme: emp.payScheme,
      excludedByScheme,
      missingSchedule: schedule.filter((d) => d.work).length === 0,
      hourlyWage,
      result,
      amount: excludedByScheme ? 0 : overtimeAmount(result, hourlyWage, policy),
    });
  }
  out.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ko"));
  return out;
}

function defaultOf(category: string, p: OtPolicy): boolean {
  switch (category) {
    case "IMMEDIATE":
      return p.immediateDefault;
    case "MANDATORY":
      return p.mandatoryDefault;
    case "ABSENCE":
      return p.absenceDefault;
    default:
      return p.otherDefault;
  }
}

/**
 * 통상시급 — **명세서에 찍히는 값과 같아야** 하므로 급여 엔진을 그대로 통과시킨다.
 * 보수조건은 직원 카드가 아니라 그 달을 지배하는 계약에서 온다(월중 계약변경 가중 포함).
 */
export function hourlyWageOf(emp: any, seg?: MonthContractTerms): number {
  const input = empToPayInput(emp);
  applyMidMonthBlend(input, seg);
  if (input.payScheme === "RATIO") return 0;
  if (input.payScheme === "HOURLY") return input.baseWage;
  const { weeklyContractual, weeklyHoliday } = computeWeeklyHours(input.schedule);
  const scheduleHours = Math.max(weeklyContractual + weeklyHoliday, 0) * 4.345;
  const baseHours = input.fixedBaseHours || (scheduleHours > 0 ? scheduleHours : 209);
  const bd = inclusiveWageBreakdown({
    baseWage: input.baseWage,
    mealAllow: input.mealAllow,
    carAllow: input.carAllow,
    baseHours,
    otHours: input.fixedOtHours ?? 0,
    nightHours: input.fixedNightHours ?? 0,
  });
  return Math.round(bd.exactHourly);
}

/** 급여 산정에 넣을 월 입력값 (runPayrollMonth 가 쓴다) */
export async function overtimeInputsFor(
  year: number,
  month: number,
  employeeIds: number[]
): Promise<
  Map<
    number,
    {
      extraHours: number;
      overtimeHours: number;
      holidayHours: number;
      holidayOverHours: number;
      nightHours: number;
      detail: OtResult["lines"];
      excluded: OtResult["excluded"];
    }
  >
> {
  const map = new Map<number, any>();
  if (!employeeIds.length) return map;
  const rows = await overtimeForMonth(year, month, employeeIds);
  for (const r of rows) {
    if (r.excludedByScheme) continue;
    map.set(r.employeeId, {
      extraHours: r.result.extraHours,
      overtimeHours: r.result.overtimeHours,
      holidayHours: r.result.holidayHours,
      holidayOverHours: r.result.holidayOverHours,
      nightHours: r.result.nightHours,
      detail: r.result.lines,
      excluded: r.result.excluded,
    });
  }
  return map;
}

/* ───────────── 등록 · 확인 (구글 보강캘린더 동기화 포함) ───────────── */

/**
 * 보강 일정을 구글 '보강캘린더' 에 맞춘다.
 * 연차 캘린더와 별개의 캘린더(GOOGLE_MAKEUP_CALENDAR_ID)를 쓰고,
 * **캘린더 실패가 신청·확인 자체를 되돌리지는 않는다** (연차 흐름과 같은 원칙).
 */
export async function syncMakeupCalendar(sessionId: number): Promise<string | null> {
  if (!makeupCalendarConfigured()) return null;
  const r = await prisma.makeupSession.findUnique({
    where: { id: sessionId },
    include: { employee: true },
  });
  if (!r) return null;

  // 취소·미실시는 캘린더에서 내린다 (실제로 하지 않은 수업이 남아 있으면 안 된다)
  if (r.status === "CANCELED" || r.status === "NOSHOW") {
    if (r.gcalEventId) {
      await deleteMakeupEvent(r.gcalEventId);
      await prisma.makeupSession.update({ where: { id: r.id }, data: { gcalEventId: null } });
    }
    return null;
  }

  const w = workWindow(r as any);
  const input = {
    name: r.employee.name,
    department: r.employee.department,
    categoryLabel: MAKEUP_CATEGORY_LABEL[r.category] ?? r.category,
    start: w.start,
    end: w.end,
    targetClass: r.targetClass,
    headcount: r.headcount,
    detail: r.detail,
    note: r.note,
    statusLabel: r.status === "CONFIRMED" ? MAKEUP_STATUS_LABEL.CONFIRMED : undefined,
  };
  const eventId = r.gcalEventId
    ? await updateMakeupEvent(r.gcalEventId, input)
    : await createMakeupEvent(input);
  if (eventId && eventId !== r.gcalEventId)
    await prisma.makeupSession.update({ where: { id: r.id }, data: { gcalEventId: eventId } });
  return eventId;
}

export interface MakeupCreateInput {
  employeeId: number;
  planStart: Date;
  planEnd: Date;
  category: string;
  targetClass: string;
  headcount?: number | null;
  detail?: string;
  note?: string | null;
  source?: string;
  slackUserId?: string | null;
}

/** 보강계획 사전신청 (슬랙·화면 공통) — 승인 절차 없이 바로 등록된다 */
export async function createMakeupSession(input: MakeupCreateInput) {
  const row = await prisma.makeupSession.create({
    data: {
      employeeId: input.employeeId,
      planStart: input.planStart,
      planEnd: input.planEnd,
      category: input.category,
      targetClass: input.targetClass.trim(),
      headcount: input.headcount ?? null,
      detail: (input.detail ?? "").trim(),
      note: input.note?.trim() || null,
      source: input.source ?? "SLACK",
      slackUserId: input.slackUserId ?? null,
    },
    include: { employee: true },
  });
  await syncMakeupCalendar(row.id).catch(() => null);
  return row;
}

export interface MakeupPatch {
  status?: string;
  actualStart?: Date | null;
  actualEnd?: Date | null;
  payEligible?: boolean | null;
  reviewNote?: string | null;
  category?: string;
  targetClass?: string;
  headcount?: number | null;
  detail?: string;
  note?: string | null;
}

/** 관리자 확인 — 실근무 시각·수당 반영 여부를 고치고 캘린더를 다시 맞춘다 */
export async function updateMakeupSession(id: number, patch: MakeupPatch) {
  const before = await prisma.makeupSession.findUnique({ where: { id } });
  if (!before) throw new Error("보강 신청을 찾을 수 없습니다.");

  const data: any = { ...patch };
  // 실근무 시각을 따로 안 적고 확정하면 신청한 시각을 그대로 인정한다
  if (patch.status === "CONFIRMED") {
    data.actualStart = patch.actualStart ?? before.actualStart ?? before.planStart;
    data.actualEnd = patch.actualEnd ?? before.actualEnd ?? before.planEnd;
    data.reviewedAt = new Date();
  }
  const row = await prisma.makeupSession.update({
    where: { id },
    data,
    include: { employee: true },
  });
  await syncMakeupCalendar(id).catch(() => null);
  return row;
}

/** 신청 삭제 — 캘린더 일정도 함께 내린다 */
export async function deleteMakeupSession(id: number) {
  const row = await prisma.makeupSession.findUnique({ where: { id }, include: { employee: true } });
  if (!row) throw new Error("보강 신청을 찾을 수 없습니다.");
  if (row.gcalEventId) await deleteMakeupEvent(row.gcalEventId).catch(() => false);
  await prisma.makeupSession.delete({ where: { id } });
  return row;
}

/* ───────────── 캘린더 화면용 ───────────── */

export interface MakeupRow {
  id: number;
  employeeId: number;
  name: string;
  department: string | null;
  payScheme: string;
  /** YYYY-MM-DD — 달력 칸 배치용 (시업일 기준) */
  date: string;
  startTime: string; // "19:00"
  endTime: string; // "22:00"
  hours: number;
  category: string;
  status: string;
  targetClass: string;
  headcount: number | null;
  detail: string;
  note: string | null;
  reviewNote: string | null;
  payEligible: boolean | null;
  planStart: string; // ISO (폼 초기값)
  planEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  hasGcal: boolean;
  /** 산정 결과 — 확정된 건만 채워진다 */
  kind: string | null;
  countedHours: number;
  amount: number;
  reason: string | null;
  needsDecision: boolean;
}

const hhmm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/** 달력에 뿌릴 한 달 신청 목록 + 산정 결과를 붙여 돌려준다 */
export async function makeupMonth(year: number, month: number) {
  const { from, to } = monthRange(year, month);
  const [rows, otRows, policy, exams, holidayRows] = await Promise.all([
    prisma.makeupSession.findMany({
      where: { planStart: { gte: from, lte: to } },
      include: { employee: true },
      orderBy: { planStart: "asc" },
    }),
    overtimeForMonth(year, month),
    getOvertimePolicy(),
    getExamPeriods(),
    prisma.holiday.findMany({ where: { date: { gte: from, lte: to } } }),
  ]);

  // 신청 → 산정 줄 묶기 (한 신청이 여러 줄로 쪼개질 수 있다: 야간/주간, 8시간 경계)
  const bySession = new Map<number, { counted: number; amount: number; kinds: Set<string>; reasons: Set<string> }>();
  const wageOf = new Map<number, number>();
  for (const r of otRows) {
    wageOf.set(r.employeeId, r.hourlyWage);
    for (const l of r.result.lines) {
      const e = bySession.get(l.sessionId) ?? { counted: 0, amount: 0, kinds: new Set(), reasons: new Set() };
      e.counted += l.countedHours;
      e.amount += Math.round(l.countedHours * r.hourlyWage * l.multiplier);
      e.kinds.add(l.kind);
      bySession.set(l.sessionId, e);
    }
    for (const l of r.result.excluded) {
      const e = bySession.get(l.sessionId) ?? { counted: 0, amount: 0, kinds: new Set(), reasons: new Set() };
      if (l.reason) e.reasons.add(l.reason);
      bySession.set(l.sessionId, e);
    }
  }

  const list: MakeupRow[] = rows.map((r) => {
    const w = workWindow(r as any);
    const hit = bySession.get(r.id);
    const needs = r.payEligible == null && !defaultOf(r.category, policy);
    return {
      id: r.id,
      employeeId: r.employeeId,
      name: r.employee.name,
      department: r.employee.department,
      payScheme: r.employee.payScheme,
      date: ymdUtc(w.start),
      startTime: hhmm(w.start),
      endTime: hhmm(w.end),
      hours: sessionHours(r as any),
      category: r.category,
      status: r.status,
      targetClass: r.targetClass,
      headcount: r.headcount,
      detail: r.detail,
      note: r.note,
      reviewNote: r.reviewNote,
      payEligible: r.payEligible,
      planStart: r.planStart.toISOString(),
      planEnd: r.planEnd.toISOString(),
      actualStart: r.actualStart?.toISOString() ?? null,
      actualEnd: r.actualEnd?.toISOString() ?? null,
      hasGcal: !!r.gcalEventId,
      kind: hit?.kinds.size ? Array.from(hit.kinds).join("+") : null,
      countedHours: Math.round((hit?.counted ?? 0) * 100) / 100,
      amount: hit?.amount ?? 0,
      reason: hit?.reasons.size ? Array.from(hit.reasons).join(" / ") : null,
      needsDecision: needs,
    };
  });

  return {
    rows: list,
    totals: otRows,
    policy,
    examPeriods: exams.map((e) => ({
      id: e.id,
      name: e.name,
      startDate: ymdUtc(e.startDate),
      endDate: ymdUtc(e.endDate),
      capHours: e.capHours,
    })),
    holidays: holidayRows.map((h) => ({ date: ymdUtc(h.date), name: h.name })),
  };
}

export type MakeupMonth = Awaited<ReturnType<typeof makeupMonth>>;
