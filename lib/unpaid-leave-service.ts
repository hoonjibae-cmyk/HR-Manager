// 휴직·휴업(무급휴직·유급휴직·휴업) ↔ DB 어댑터. 판정·계산은 lib/unpaid-leave.ts(순수 함수)에 있고
// 여기서는 재료만 읽어 넘긴다. 이름이 `unpaid…` 인 것은 무급휴직만 있던 때(v1.63)의 흔적이다.
//
// 급여 서비스(lib/payroll-service.ts)가 이 파일을 부른다 — **이 파일은 급여 서비스를 부르지 않는다**
// (서로 부르면 순환 참조가 된다).

import { prisma } from "./db";
import {
  monthPayDays,
  monthsOfSpan,
  readUnpaidLeaveMeta,
  unpaidLeaveMetaOf,
  unpaidLeaveNote,
  unpaidLeaveStale,
  leaveWordOf,
  leaveZeroBasis,
  parseYmd,
  type UnpaidLeaveMeta,
  type UnpaidLeaveSpan,
} from "./unpaid-leave";

const monthFirst = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));
const monthLast = (y: number, m: number) => new Date(Date.UTC(y, m, 0));

/**
 * 계산에 쓰는 열 — 날짜와 구분·지급 조건·산정 기준. **다 읽어야 한다** — 구분을 빠뜨리면 유급휴직이 무급으로,
 * 산정 기준을 빠뜨리면 소정근로일 기준으로 등록한 휴업이 역일수 기준으로 계산된다(같은 70% 인데 금액이 다르다)
 */
const LEAVE_SELECT = {
  startDate: true,
  endDate: true,
  kind: true,
  payRate: true,
  payAmount: true,
  payBasis: true,
} as const;

/** 그 달에 하루라도 걸친 휴직·휴업 — 직원별로 묶는다 */
export async function unpaidLeavesInMonth(
  employeeIds: number[],
  year: number,
  month: number
): Promise<Map<number, UnpaidLeaveSpan[]>> {
  const out = new Map<number, UnpaidLeaveSpan[]>();
  if (!employeeIds.length) return out;
  const rows = await prisma.unpaidLeave.findMany({
    where: {
      employeeId: { in: employeeIds },
      startDate: { lte: monthLast(year, month) },
      endDate: { gte: monthFirst(year, month) },
    },
    select: { employeeId: true, ...LEAVE_SELECT },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  for (const r of rows) {
    const arr = out.get(r.employeeId) ?? [];
    arr.push({
      startDate: r.startDate,
      endDate: r.endDate,
      kind: r.kind,
      payRate: r.payRate,
      payAmount: r.payAmount,
      payBasis: r.payBasis,
    });
    out.set(r.employeeId, arr);
  }
  return out;
}

/**
 * 급여 기록에 **산정 때 남긴** 휴직·휴업 구간을 계산용 구간으로 되돌린다.
 *
 * 공제만 다시 낼 때(`updateDeductions`) 쓴다 — 그 사이 등록이 바뀌었어도 그 기록을 산정한
 * 조건 그대로 다시 계산해야 지급액과 공제가 같은 근거에 선다.
 * **날짜만 되돌린다**(구분·지급 조건은 싣지 않는다) — 여기서 필요한 것은 '정상 급여가 나가지 않은 날' 뿐이고,
 * 유급휴직 급여·휴업수당은 다시 계산하지 않고 기록에 저장된 금액(`leavePayP`)을 그대로 쓴다.
 */
export function spansFromMeta(meta: UnpaidLeaveMeta | null): UnpaidLeaveSpan[] {
  const out: UnpaidLeaveSpan[] = [];
  for (const s of meta?.spans ?? []) {
    const startDate = parseYmd(s.from);
    const endDate = parseYmd(s.to);
    if (startDate && endDate) out.push({ startDate, endDate });
  }
  return out;
}

/** 급여 화면의 행마다 붙는 휴직·휴업 표시 */
export interface UnpaidRowFlag {
  /**
   * 이 기록을 산정할 때 쓴 휴직·휴업 — `무급휴직 11/16~11/30(15일)` ·
   * `휴업 11/16~11/30(15일) 휴업수당 1,050,000원(70%)`. 없으면 null
   */
  applied: string | null;
  appliedDays: number;
  /**
   * 무엇이라 부르는가 — 「무급휴직」·「유급휴직」·「휴업」, 섞였으면 「휴직·휴업」(산정 때와 지금 등록을 함께 본다).
   * 배지가 늘 '무급휴직' 이라고 적으면 휴업수당이 걸린 달을 급여 없는 달로 읽는다
   */
  word: string;
  /**
   * 산정한 뒤에 휴직 등록이 바뀌었다 — **다시 산정해야 지급액에 반영된다.**
   * 발송(SENT)된 기록이면 잠금 해제를 먼저 거쳐야 한다(화면이 갈라 적는다).
   */
  stale: boolean;
  /**
   * 지금 등록 기준 한 줄(`stale` 일 때 무엇으로 바뀌는지). 지금은 휴직·휴업이 없으면 null.
   * 유급 구간은 금액이 아니라 조건을 적는다(`원급여의 70% 지급`) — 금액은 산정해야 나온다
   */
  now: string | null;
  /**
   * 비율로 지급하도록 등록돼 있는데 원급여를 낼 수 없어 **0원으로 산정된** 행(완전비율제·근로시간표 없는 시급제).
   * 금액을 직접 지정해야 한다 — 조용히 0원이 나가지 않게 행에 띄운다
   */
  zeroBasis: boolean;
}

/**
 * 그 달 급여 기록들의 휴직·휴업 표시.
 *
 * 등록·수정·삭제해도 이미 만든 급여 기록은 저절로 바뀌지 않는다(계약 수정과 같다).
 * 그래서 **산정 때 쓴 것과 지금 등록된 것을 견줘** 다르면 행에 띄운다 — 조용히 지나가면
 * 쉬는 동안의 급여가 그대로 이체된다. 날짜가 같아도 **구분·비율·금액이 다르면** 잡는다.
 */
export async function unpaidFlagsFor(
  year: number,
  month: number,
  records: Array<{
    id: number;
    employeeId: number;
    breakdown?: string | null;
    employee: { hireDate: Date; resignDate?: Date | null };
  }>
): Promise<Map<number, UnpaidRowFlag>> {
  const out = new Map<number, UnpaidRowFlag>();
  if (!records.length) return out;
  const byEmp = await unpaidLeavesInMonth(
    records.map((r) => r.employeeId),
    year,
    month
  );
  for (const r of records) {
    const stored = readUnpaidLeaveMeta(r.breakdown);
    const now = monthPayDays(
      year,
      month,
      r.employee.hireDate,
      r.employee.resignDate ?? null,
      byEmp.get(r.employeeId) ?? []
    );
    const nowMeta = unpaidLeaveMetaOf(now);
    const stale = unpaidLeaveStale(stored, now);
    if (!stored && !nowMeta) continue; // 휴직과 무관한 행 — 표시할 것이 없다
    out.set(r.id, {
      applied: stored ? unpaidLeaveNote(stored) : null,
      appliedDays: stored?.days ?? 0,
      word: leaveWordOf(stored, nowMeta),
      stale,
      now: nowMeta ? unpaidLeaveNote(nowMeta) : null,
      zeroBasis: leaveZeroBasis(stored),
    });
  }
  return out;
}

/**
 * 그 달 기록 가운데 **휴직·휴업 등록이 반영되지 않은 사람의 이름** — 세무 자료·은행 이체 파일을 받을 때
 * 한 번 더 걸리게 한다. 못 읽으면 빈 목록(내려받기를 막지 않는다 — 경고만 빠진다).
 */
export async function unpaidStaleNames(
  year: number,
  month: number,
  records: Array<{
    id: number;
    employeeId: number;
    breakdown?: string | null;
    employee: { name: string; hireDate: Date; resignDate?: Date | null };
  }>
): Promise<string[]> {
  try {
    const flags = await unpaidFlagsFor(year, month, records);
    return records.filter((r) => flags.get(r.id)?.stale).map((r) => r.employee.name);
  } catch (e: any) {
    console.error("[unpaid-leave] 미반영 확인 실패:", e?.message ?? e);
    return [];
  }
}

/** 휴직·휴업 한 건이 걸친 달의 급여 상태 — 등록·수정·삭제 뒤 화면이 '무엇을 해야 하는지' 알리는 데 쓴다 */
export interface UnpaidMonthImpact {
  year: number;
  month: number;
  /** 그 달 휴직·휴업 역일수(지금 등록 기준 · 구분 무관) */
  leaveDays: number;
  daysInMonth: number;
  /**
   * · `NONE`  — 아직 급여를 산정하지 않은 달. 산정할 때 저절로 반영된다.
   * · `OK`    — 산정돼 있고 지금 등록과 같다.
   * · `STALE` — 산정돼 있는데 지금 등록과 다르다. **다시 산정해야 한다.**
   * · `SENT`  — 명세서가 이미 발송된 달인데 지금 등록과 다르다. 잠금 해제 → 재산정 → 정정 발송.
   */
  state: "NONE" | "OK" | "STALE" | "SENT";
  /** 지금 기록의 지급액 계(기록이 있을 때) */
  gross: number | null;
}

/**
 * 주어진 달들의 급여 상태. 휴직을 지운 뒤에도 불러야 하므로(그 달들이 '휴직 없음' 으로 바뀌었는지)
 * 휴직 행이 아니라 **달 목록**을 받는다.
 */
export async function unpaidImpactFor(
  emp: { id: number; hireDate: Date; resignDate?: Date | null },
  months: Array<{ year: number; month: number }>
): Promise<UnpaidMonthImpact[]> {
  if (!months.length) return [];
  const [leaves, records] = await Promise.all([
    prisma.unpaidLeave.findMany({
      where: { employeeId: emp.id },
      select: LEAVE_SELECT,
    }),
    prisma.payrollRecord.findMany({
      where: { employeeId: emp.id, OR: months.map((m) => ({ year: m.year, month: m.month })) },
      select: { year: true, month: true, status: true, gross: true, breakdown: true },
    }),
  ]);
  const recAt = new Map(records.map((r) => [`${r.year}:${r.month}`, r]));
  const out: UnpaidMonthImpact[] = [];
  for (const { year, month } of months) {
    const now = monthPayDays(year, month, emp.hireDate, emp.resignDate ?? null, leaves);
    if (now.employedDays <= 0) continue; // 재직하지 않은 달 — 급여와 무관하다
    const rec = recAt.get(`${year}:${month}`);
    const stale = rec ? unpaidLeaveStale(readUnpaidLeaveMeta(rec.breakdown), now) : false;
    out.push({
      year,
      month,
      leaveDays: now.leaveDays,
      daysInMonth: now.daysInMonth,
      state: !rec ? "NONE" : !stale ? "OK" : rec.status === "SENT" ? "SENT" : "STALE",
      gross: rec ? rec.gross : null,
    });
  }
  return out;
}

/**
 * 직원 한 사람의 **지금 봐야 할 달 전부** — 직원 상세의 휴직·휴업 카드가 늘 띄우는 목록.
 *
 * 지금 등록된 휴직이 걸친 달만 보면 모자라다: 휴직을 **지우거나 다른 달로 옮긴 뒤**에는 옛 달이 어느 휴직에도
 * 걸리지 않는데, 그 달 급여 기록은 여전히 휴직으로 일할된 채다(덜 지급된 상태). 그래서 **휴직으로 일할해
 * 산정한 급여 기록이 있는 달**을 함께 본다.
 */
export async function unpaidImpactsOfEmployee(
  emp: { id: number; hireDate: Date; resignDate?: Date | null },
  leaves: Array<{ startDate: Date; endDate: Date }>
): Promise<UnpaidMonthImpact[]> {
  const applied = await prisma.payrollRecord.findMany({
    where: { employeeId: emp.id, breakdown: { contains: '"unpaidLeave"' } },
    select: { year: true, month: true },
  });
  const months = monthsTouched(leaves);
  const seen = new Set(months.map((m) => `${m.year}:${m.month}`));
  for (const r of applied) {
    const k = `${r.year}:${r.month}`;
    if (seen.has(k)) continue;
    seen.add(k);
    months.push({ year: r.year, month: r.month });
  }
  months.sort((a, b) => a.year - b.year || a.month - b.month);
  return unpaidImpactFor(emp, months);
}

/** 두 기간이 걸친 달을 합친다(수정 — 옛 기간과 새 기간 양쪽 달을 모두 다시 봐야 한다) */
export function monthsTouched(
  spans: Array<{ startDate: Date; endDate: Date }>
): Array<{ year: number; month: number }> {
  const seen = new Set<string>();
  const out: Array<{ year: number; month: number }> = [];
  for (const s of spans)
    for (const m of monthsOfSpan(s.startDate, s.endDate)) {
      const k = `${m.year}:${m.month}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
  return out.sort((a, b) => a.year - b.year || a.month - b.month);
}

/** 등록·수정·삭제 결과에 붙이는 한 줄 안내 — 다시 산정해야 하는 달을 이름으로 적는다 */
export function impactNotice(impacts: UnpaidMonthImpact[]): string {
  const label = (i: UnpaidMonthImpact) => `${i.year}년 ${i.month}월`;
  const stale = impacts.filter((i) => i.state === "STALE");
  const sent = impacts.filter((i) => i.state === "SENT");
  const lines: string[] = [];
  if (stale.length)
    lines.push(
      `이미 산정해 둔 급여가 있습니다 — ${stale.map(label).join(", ")}. ` +
        `급여 화면에서 그 달의 「급여 일괄 산정」을 다시 눌러야 반영됩니다.`
    );
  if (sent.length)
    lines.push(
      `⚠ 명세서가 이미 발송된 달입니다 — ${sent.map(label).join(", ")}. ` +
        `「발송 잠금 해제」 후 다시 산정하고 정정 명세서를 보내야 합니다.`
    );
  return lines.join("\n");
}
