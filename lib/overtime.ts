// 보강·초과근무 → 오버타임 수당 산정 엔진 (순수 함수, DB 무관)
//
// 산정 규칙 (관리자가 정한 지급 조건 + 근로기준법 §56)
//  1. 평일 소정근로시간 밖 또는 토요일 근무분 → **연장근로, 가산 없음(×1.0)**.
//     이 학원은 주 소정근로가 37.5시간(14~22시·휴게 0.5)이라 주 40시간 안쪽의 추가근로는
//     법정 가산 대상이 아니다(법내연장). 가산은 휴일근로에만 붙는다.
//     주 40시간·1일 8시간을 넘는 부분까지 법정 가산(×1.5)하려면
//     정책의 applyStatutoryOvertime 을 켠다(기본 꺼짐).
//  2. 일요일·공휴일 근무분 → **휴일근로** (8시간 이내 ×1.5, 초과분 ×2.0)
//  3. 소정근로시간 안에서 이뤄진 보강은 수당 대상이 아니다 (이미 월급에 들어 있다)
//  4. 완전비율제(위탁)는 근로기준법 적용 대상이 아니므로 제외 — 호출부에서 걸러 낸다
//  5. 보강 종류 — 기본 반영 여부는 **종류 + 근무일이 토·일·공휴일인지**로 갈린다
//     - 직전보강: 토·일·공휴일이면 대상. **평일이면 관리자 판단**(아래)
//     - 내신의무보강: 위와 같고, 내신기간당 상한(기본 10시간)까지만.
//       **수당이 큰 쪽부터** 채운다 (예: 토 7h·일 7h → 일요일 7h 전부 + 토요일 3h)
//     - 결시보강: 기본 미반영. 관리자가 payEligible 로 건건이 켠다
//     평일 보강을 자동 반영하지 않는 이유: 평일은 소정근로시간을 조금 넘긴 것일 뿐인 경우가
//     많고(그 안이면 애초에 대상이 아니다) 종류만으로 일률 판단하면 실제와 어긋난다.
//  야간(22~06) 가산(+0.5)은 **기본 꺼짐** — 필요하면 정책의 countNight 를 켠다.
//
// 시각 표기: 이 엔진이 받는 Date 는 **KST 벽시계 값이 UTC 필드에 담긴 것**이다
// (앱 전체가 같은 규칙 — ymd()·달력·공휴일 모두 getUTC* 를 쓴다).

import type { ScheduleDay } from "./constants";

/* ───────────── 입력 ───────────── */

export interface OtPolicy {
  /** 법내연장 — 평일 소정 외·토요일. 주 40시간 안쪽이라 가산이 붙지 않는다 */
  extraMultiplier: number;
  /** 법정연장 — 1일 8시간·주 40시간을 넘는 부분 (applyStatutoryOvertime 이 켜져 있을 때만) */
  overtimeMultiplier: number;
  /** 켜면 1일 8시간·주 40시간 초과분을 법정 가산(×1.5)으로 올린다. 기본 꺼짐 */
  applyStatutoryOvertime: boolean;
  holidayMultiplier: number;
  holidayOverMultiplier: number;
  holidayOverAfterHours: number;
  nightMultiplier: number;
  nightStartHour: number;
  nightEndHour: number;
  countNight: boolean;
  mandatoryCapHours: number;
  roundingMinutes: number;
  immediateDefault: boolean;
  mandatoryDefault: boolean;
  absenceDefault: boolean;
  otherDefault: boolean;
  /** 주말근무 — 실제로 나와 일한 것이라 기본 반영 */
  weekendDefault: boolean;
}

export const DEFAULT_OT_POLICY: OtPolicy = {
  extraMultiplier: 1.0,
  overtimeMultiplier: 1.5,
  applyStatutoryOvertime: false,
  holidayMultiplier: 1.5,
  holidayOverMultiplier: 2.0,
  holidayOverAfterHours: 8,
  nightMultiplier: 0.5,
  nightStartHour: 22,
  nightEndHour: 6,
  countNight: false,
  mandatoryCapHours: 10,
  roundingMinutes: 0,
  immediateDefault: true,
  mandatoryDefault: true,
  absenceDefault: false,
  otherDefault: false,
  weekendDefault: true,
};

export interface OtSession {
  id: number;
  category: string; // MAKEUP_CATEGORY
  status: string; // PLANNED | CONFIRMED | NOSHOW | CANCELED
  planStart: Date;
  planEnd: Date;
  /** 관리자가 확정한 실근무 시각 (없으면 예정값을 그대로 쓴다) */
  actualStart?: Date | null;
  actualEnd?: Date | null;
  /** null = 카테고리 기본값, true/false = 관리자 지정 */
  payEligible?: boolean | null;
}

/** 내신 기간 — 내신의무보강 상한의 적용 단위 */
export interface ExamWindow {
  id: number;
  name: string;
  startDate: Date;
  endDate: Date;
  capHours: number;
}

export interface OtInput {
  sessions: OtSession[];
  schedule: ScheduleDay[];
  /** 공휴일 (YYYY-MM-DD) */
  holidays: string[];
  examPeriods?: ExamWindow[];
  policy?: Partial<OtPolicy>;
}

/* ───────────── 출력 ───────────── */

/** EXTRA=법내연장(가산 없음) · OVERTIME=법정연장(가산) · HOLIDAY=휴일근로 */
export type OtKind = "EXTRA" | "OVERTIME" | "HOLIDAY" | "NONE";

/** 산정 결과 한 줄 — 명세서 첨부 내역서와 화면이 같은 줄을 쓴다 */
export interface OtLine {
  sessionId: number;
  category: string;
  /** 근로 시작일 (YYYY-MM-DD). 자정을 넘겨도 시업일 기준으로 묶는다 */
  date: string;
  /** "19:00~22:30" — 이 줄이 차지하는 시간대 */
  timeLabel: string;
  kind: OtKind;
  night: boolean;
  /** 휴일근로 1일 8시간 초과분인가 (배수가 다르다) */
  over?: boolean;
  /** 소정근로시간을 뺀 산정 대상 시간 */
  hours: number;
  /** 상한(내신)까지 적용한 뒤 실제로 수당에 반영되는 시간 */
  countedHours: number;
  /** 반영 배수 (야간 가산 포함) */
  multiplier: number;
  /** 제외·축소된 경우의 사유 */
  reason?: string;
}

export interface OtResult {
  /** 급여 엔진에 넣을 월 집계 */
  extraHours: number;
  overtimeHours: number;
  holidayHours: number;
  holidayOverHours: number;
  nightHours: number;
  /** 수당에 반영된 줄 */
  lines: OtLine[];
  /** 대상에서 빠진 줄 (사유 포함) — 화면에서 왜 0원인지 설명하는 데 쓴다 */
  excluded: OtLine[];
  /** 관리자 판단이 필요한 신청 건수 (결시보강 등) */
  pendingDecision: number;
}

/* ───────────── 시간 유틸 ───────────── */

const DOW_KEY: ScheduleDay["day"][] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Date → 그 날 00:00 부터의 분 */
function minOfDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "HH:MM" → 분 */
function hhmmToMin(s: string): number {
  const [h, m] = String(s || "0:00").split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function minToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

type Range = [number, number]; // [시작분, 종료분) — 시업일 00:00 기준, 1440 을 넘을 수 있다

function subtract(base: Range, cut: Range): Range[] {
  const [s, e] = base;
  const [cs, ce] = cut;
  if (ce <= s || cs >= e) return [[s, e]];
  const out: Range[] = [];
  if (cs > s) out.push([s, Math.min(cs, e)]);
  if (ce < e) out.push([Math.max(ce, s), e]);
  return out.filter(([a, b]) => b > a);
}

function intersect(a: Range, b: Range): Range | null {
  const s = Math.max(a[0], b[0]);
  const e = Math.min(a[1], b[1]);
  return e > s ? [s, e] : null;
}

/** 야간(22:00~06:00) 구간들 — 시업일 00:00 기준으로 이틀치를 펼쳐 둔다 */
function nightRanges(p: OtPolicy): Range[] {
  const ns = p.nightStartHour * 60;
  const ne = p.nightEndHour * 60;
  const out: Range[] = [];
  for (const base of [0, 1440]) {
    if (ne > 0) out.push([base, base + ne]);
    if (ns < 1440) out.push([base + ns, base + 1440]);
  }
  return out;
}

/** 소수 시간을 반올림 단위(분)에 맞춘다. 0 이면 그대로 */
function roundHours(h: number, minutes: number): number {
  if (!minutes || minutes <= 0) return Math.round(h * 1000) / 1000;
  const unit = minutes / 60;
  return Math.round(h / unit) * unit;
}

/* ───────────── 산정 ───────────── */

/**
 * **가산이 붙는 날인가** — 토요일·일요일·공휴일.
 *
 * 평일 근무는 소정근로시간 밖이어도 법내연장(×1.0)이라 '더 일한 만큼' 이지
 * 휴일을 반납한 것이 아니다. 그래서 자동 수당 반영을 이 날들로 한정한다.
 *
 * ⚠ `holidays` 를 안 넘기면 **공휴일을 모르는 채로 판정**한다 — 토·일은 요일로 알 수 있지만
 * 공휴일은 표가 있어야 한다. 모르면 평일로 보므로 자동 반영이 아니라 관리자 판단으로 떨어진다
 * (조용히 더 주는 쪽이 아니라 사람이 보게 되는 쪽으로 기운다).
 */
export function isPremiumDay(dateYmd: string, holidays: string[] = []): boolean {
  const d = new Date(`${dateYmd}T00:00:00Z`);
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6 || holidays.includes(dateYmd);
}

/**
 * 카테고리별 '수당 반영' 기본값.
 *
 * 여기가 **확정 요청 알림을 자동으로 보낼지**도 가른다 — 기본 반영되는 유형은
 * 근무 다음날 신청자에게 알림이 나가고, 기본 미반영(결시보강 등)은 관리자가
 * 반영 여부를 정한 뒤 직접 보낸다(`lib/makeup-service.ts`).
 *
 * **직전보강·내신의무보강은 토·일·공휴일에만 자동 반영된다.** 평일 보강은 결시보강과
 * 마찬가지로 관리자가 건건이 판단한다 — 평일 근무는 소정근로시간을 조금 넘긴 것일 뿐인
 * 경우가 많아 일률적으로 수당을 붙이면 실제와 어긋난다.
 */
export function categoryDefault(
  category: string,
  p: OtPolicy = DEFAULT_OT_POLICY,
  opts: { premiumDay?: boolean } = {}
): boolean {
  const base = (() => {
    switch (category) {
      case "IMMEDIATE":
        return p.immediateDefault;
      case "MANDATORY":
        return p.mandatoryDefault;
      case "ABSENCE":
        return p.absenceDefault;
      case "WEEKEND":
      // 평일 초과근무(직원)도 주말근무와 같은 스위치 — 성질이 같다(실제로 나와 일한 것).
      // 소정근로시간 안의 시간은 어차피 엔진이 세지 않으므로(computeOvertime ③)
      // 기본 반영이어도 소정 안 근무가 수당이 되지는 않는다.
      case "OVERTIME":
        return p.weekendDefault;
      default:
        return p.otherDefault;
    }
  })();
  // 평일에 한 직전·내신보강은 자동 반영하지 않는다 (관리자 판단으로 넘긴다)
  if (opts.premiumDay === false && (category === "IMMEDIATE" || category === "MANDATORY"))
    return false;
  return base;
}

/** 판정에 필요한 최소 필드 — 근무일을 알아야 토·일·공휴일인지 가린다 */
type PayJudgeSession = Pick<
  OtSession,
  "category" | "payEligible" | "planStart" | "planEnd" | "actualStart" | "actualEnd"
>;

/** 이 건의 근무일(시업일) — 자정을 넘겨도 시작한 날로 묶는다 */
function workDateOf(s: PayJudgeSession): string {
  return workWindow(s as OtSession).start.toISOString().slice(0, 10);
}

/**
 * 이 신청이 수당 대상인지 — 관리자 지정이 기본값을 이긴다.
 * 기본값은 카테고리 + **근무일이 토·일·공휴일인지**로 정해진다.
 */
export function isPayEligible(
  s: PayJudgeSession,
  policy: OtPolicy = DEFAULT_OT_POLICY,
  holidays: string[] = []
): boolean {
  return (
    s.payEligible ??
    categoryDefault(s.category, policy, { premiumDay: isPremiumDay(workDateOf(s), holidays) })
  );
}

/** 관리자 판단을 기다리는 상태인가 (기본값이 '미반영' 인데 지정도 없는 경우) */
export function needsDecision(
  s: PayJudgeSession,
  policy: OtPolicy = DEFAULT_OT_POLICY,
  holidays: string[] = []
): boolean {
  return s.payEligible == null && !isPayEligible(s, policy, holidays);
}

/** 실제로 산정에 쓸 근무 시각 (관리자가 고쳤으면 그 값) */
export function workWindow(s: OtSession): { start: Date; end: Date } {
  return { start: s.actualStart ?? s.planStart, end: s.actualEnd ?? s.planEnd };
}

/** 근무 시간 길이(시간) — 자정을 넘기면 다음 날로 이어진 것으로 본다 */
export function sessionHours(s: OtSession): number {
  const { start, end } = workWindow(s);
  let mins = minOfDay(end) - minOfDay(start);
  const dayDiff = Math.round(
    (Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) /
      86400000
  );
  mins += dayDiff * 1440;
  if (mins <= 0) mins += 1440; // 종료일을 안 적고 자정을 넘긴 경우
  return Math.round((mins / 60) * 1000) / 1000;
}

/**
 * 신청 한 건을 '수당 대상 시간 조각' 으로 쪼갠다.
 * 소정근로시간과 겹치는 부분을 덜어 내고, 남은 시간을 야간/주간으로 다시 나눈다.
 */
function sessionLines(s: OtSession, holidays: Set<string>, schedule: ScheduleDay[], p: OtPolicy): OtLine[] {
  const { start, end } = workWindow(s);
  const date = dayKey(start);
  const dow = start.getUTCDay();
  const isHoliday = holidays.has(date) || dow === 0; // 일요일 = 주휴일
  const base: Range = [minOfDay(start), minOfDay(start) + sessionHours(s) * 60];

  const mk = (r: Range, kind: OtKind, night: boolean, reason?: string): OtLine => ({
    sessionId: s.id,
    category: s.category,
    date,
    timeLabel: `${minToHHMM(r[0])}~${minToHHMM(r[1])}`,
    kind,
    night,
    hours: roundHours((r[1] - r[0]) / 60, p.roundingMinutes),
    countedHours: 0,
    multiplier: 0,
    reason,
  });

  // 휴일(일요일·공휴일)은 소정근로가 없다 — 근무한 시간 전부가 휴일근로
  let payable: Range[] = [base];
  if (!isHoliday) {
    const sd = schedule.find((d) => d.day === DOW_KEY[dow]);
    if (sd?.work) {
      let ws = hhmmToMin(sd.start);
      let we = hhmmToMin(sd.end);
      if (we <= ws) we += 1440;
      payable = subtract(base, [ws, we]);
      if (!payable.length)
        return [mk(base, "NONE", false, "소정근로시간 안에서 진행 — 월 급여에 이미 포함")];
    }
  }

  // 야간(22~06)을 따로 떼어 낸다 — 같은 시간에 +0.5 가 더 붙기 때문
  const nights = p.countNight ? nightRanges(p) : [];
  const out: OtLine[] = [];
  for (const seg of payable) {
    const nightParts = nights.map((n) => intersect(seg, n)).filter(Boolean) as Range[];
    let rest: Range[] = [seg];
    for (const n of nightParts) rest = rest.flatMap((r) => subtract(r, n));
    // 평일 소정 외·토요일은 '법내연장'(EXTRA) — 가산 없음. 법정 가산은 뒤에서 따로 올린다
    for (const n of nightParts) out.push(mk(n, isHoliday ? "HOLIDAY" : "EXTRA", true));
    for (const r of rest) out.push(mk(r, isHoliday ? "HOLIDAY" : "EXTRA", false));
  }
  return out.filter((l) => l.hours > 0).sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
}

/** 줄 하나의 값어치 — 상한을 채울 때 '수당이 큰 쪽부터' 고르는 기준 */
function baseMultiplier(kind: OtKind, over: boolean, p: OtPolicy): number {
  if (kind === "HOLIDAY") return over ? p.holidayOverMultiplier : p.holidayMultiplier;
  if (kind === "OVERTIME") return p.overtimeMultiplier;
  return p.extraMultiplier;
}

function lineValue(l: OtLine, p: OtPolicy): number {
  return baseMultiplier(l.kind, !!l.over, p) + (l.night && p.countNight ? p.nightMultiplier : 0);
}

/** 스케줄상 그 요일의 소정근로시간 (휴게 제외) */
function scheduledHoursOf(schedule: ScheduleDay[], dow: number): number {
  const d = schedule.find((x) => x.day === DOW_KEY[dow]);
  if (!d?.work) return 0;
  let ws = hhmmToMin(d.start);
  let we = hhmmToMin(d.end);
  if (we <= ws) we += 1440;
  return Math.max((we - ws) / 60 - (d.breakH || 0), 0);
}

/** "09:00~16:00" 을 앞쪽 keptHours 지점에서 둘로 나눈 라벨 */
function splitLabel(label: string, keptHours: number): [string, string] {
  const [a, b] = label.split("~");
  const cut = hhmmToMin(a) + Math.round(keptHours * 60);
  return [`${a}~${minToHHMM(cut)}`, `${minToHHMM(cut)}~${b}`];
}

/** 그 날짜가 속한 주의 월요일 (근로기준법상 1주 단위) */
function weekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7; // 월=0
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

/**
 * 1일 8시간·주 40시간을 넘는 부분을 법내연장(EXTRA) → 법정연장(OVERTIME) 으로 올린다.
 * 넘긴 건 '나중에 한 근로' 이므로 시간순으로 뒤쪽부터 올린다.
 * 휴일근로(일요일·공휴일)는 연장근로시간에 산입하지 않으므로 여기서 제외한다.
 */
function promoteStatutory(lines: OtLine[], schedule: ScheduleDay[], p: OtPolicy): OtLine[] {
  const extras = lines.filter((l) => l.kind === "EXTRA");
  if (!extras.length) return lines;

  // 뒤쪽(늦은 시각)부터 need 만큼 EXTRA 를 OVERTIME 으로 바꾼다. 경계에 걸치면 쪼갠다
  const promote = (pool: OtLine[], need: number, reason: string) => {
    let left = roundHours(need, 0);
    for (let i = pool.length - 1; i >= 0 && left > 1e-9; i--) {
      const l = pool[i];
      if (l.kind !== "EXTRA") continue;
      const take = Math.min(l.hours, left);
      left -= take;
      const idx = lines.indexOf(l);
      if (take >= l.hours - 1e-9) {
        lines[idx] = { ...l, kind: "OVERTIME", reason: l.reason ?? reason };
        pool[i] = lines[idx];
      } else {
        // 한 줄의 뒷부분만 넘긴 경우 — 시간대 표시도 잘린 지점에 맞춘다
        const [earlyLabel, lateLabel] = splitLabel(l.timeLabel, l.hours - take);
        const kept: OtLine = { ...l, hours: roundHours(l.hours - take, 0), timeLabel: earlyLabel };
        const up: OtLine = {
          ...l,
          kind: "OVERTIME",
          hours: roundHours(take, 0),
          timeLabel: lateLabel,
          reason,
        };
        lines.splice(idx, 1, kept, up);
        pool[i] = kept;
      }
    }
  };

  // 1) 1일 8시간 초과 — 소정근로시간에 보강을 얹은 하루 총량 기준
  const byDate = new Map<string, OtLine[]>();
  for (const l of extras) (byDate.get(l.date) ?? byDate.set(l.date, []).get(l.date)!).push(l);
  const dailyPromoted = new Map<string, number>();
  for (const [date, group] of byDate) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const worked = group.reduce((a, l) => a + l.hours, 0);
    const excess = Math.min(Math.max(scheduledHoursOf(schedule, dow) + worked - 8, 0), worked);
    if (excess > 0) {
      promote(group, excess, "1일 8시간 초과");
      dailyPromoted.set(date, excess);
    }
  }

  // 2) 주 40시간 초과 — 이미 일 8시간으로 올린 몫은 빼고 계산한다(이중 산입 방지)
  const byWeek = new Map<string, string[]>();
  for (const date of byDate.keys()) {
    const k = weekKey(date);
    (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(date);
  }
  for (const [wk, dates] of byWeek) {
    // 그 주의 소정근로시간 총합 (보강이 없는 날도 포함)
    let scheduled = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(`${wk}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      scheduled += scheduledHoursOf(schedule, d.getUTCDay());
    }
    const pool = lines
      .filter((l) => l.kind === "EXTRA" && dates.includes(l.date))
      .sort((a, b) => (a.date + a.timeLabel).localeCompare(b.date + b.timeLabel));
    const worked = pool.reduce((a, l) => a + l.hours, 0);
    const alreadyUp = dates.reduce((a, d) => a + (dailyPromoted.get(d) ?? 0), 0);
    const excess = Math.min(Math.max(scheduled + worked + alreadyUp - 40, 0) - alreadyUp, worked);
    if (excess > 0) promote(pool, excess, "주 40시간 초과");
  }
  return lines;
}

/**
 * 오버타임 수당 시간을 산정한다.
 *
 * 반환값의 overtimeHours/holidayHours/holidayOverHours/nightHours 를 그대로
 * 급여 엔진(MonthlyInput)에 넣으면 금액이 나온다.
 */
export function computeOvertime(input: OtInput): OtResult {
  const p = { ...DEFAULT_OT_POLICY, ...(input.policy ?? {}) };
  const holidays = new Set(input.holidays ?? []);
  const excluded: OtLine[] = [];
  let pendingDecision = 0;

  // 1) 확정된 신청만 본다 — 실근무 확인 전에는 수당을 만들지 않는다
  const usable: OtSession[] = [];
  for (const s of input.sessions) {
    if (s.status === "CANCELED" || s.status === "NOSHOW") continue;
    // 아직 확인되지 않았어도 판단이 필요한 건은 세어 둔다 (화면 배지용)
    if (needsDecision(s, p, input.holidays)) pendingDecision++;
    if (s.status !== "CONFIRMED") continue;
    if (!isPayEligible(s, p, input.holidays)) {
      const { start } = workWindow(s);
      excluded.push({
        sessionId: s.id,
        category: s.category,
        date: dayKey(start),
        timeLabel: "",
        kind: "NONE",
        night: false,
        hours: sessionHours(s),
        countedHours: 0,
        multiplier: 0,
        reason: s.payEligible === false ? "관리자가 수당 미반영으로 지정" : "수당 대상 아닌 보강 종류",
      });
      continue;
    }
    usable.push(s);
  }

  // 2) 신청별로 시간 조각을 만든다
  const all: OtLine[] = [];
  for (const s of usable) {
    for (const l of sessionLines(s, holidays, input.schedule, p)) {
      if (l.kind === "NONE") excluded.push(l);
      else all.push(l);
    }
  }

  // 3) 휴일근로 1일 8시간 초과분은 배수가 다르다 (근로기준법 §56②) — 날짜별로 누적해 가른다
  const holidayUsed = new Map<string, number>();
  const graded: OtLine[] = [];
  for (const l of [...all].sort((a, b) => (a.date + a.timeLabel).localeCompare(b.date + b.timeLabel))) {
    if (l.kind !== "HOLIDAY") {
      graded.push({ ...l, over: false });
      continue;
    }
    const used = holidayUsed.get(l.date) ?? 0;
    const room = Math.max(p.holidayOverAfterHours - used, 0);
    holidayUsed.set(l.date, used + l.hours);
    if (l.hours <= room) {
      graded.push({ ...l, over: false });
    } else if (room <= 0) {
      graded.push({ ...l, over: true });
    } else {
      // 한 줄이 8시간 경계를 걸치면 둘로 나눈다
      graded.push({ ...l, hours: room, over: false });
      graded.push({ ...l, hours: roundHours(l.hours - room, 0), over: true, reason: "휴일 8시간 초과" });
    }
  }

  // 3-2) 법정 가산 승격 (정책이 켜져 있을 때만) — 1일 8시간·주 40시간 초과분
  const leveled = p.applyStatutoryOvertime
    ? promoteStatutory(graded, input.schedule, p)
    : graded;

  // 4) 내신의무보강 상한 — 기간별로 '수당이 큰 쪽부터' 채운다
  const capBuckets = new Map<string, number>(); // 버킷키 → 남은 시간
  const bucketName = new Map<string, string>();
  const bucketOf = (date: string): string => {
    const d = new Date(`${date}T00:00:00Z`);
    const w = (input.examPeriods ?? []).find((e) => d >= e.startDate && d <= e.endDate);
    if (w) {
      const key = `exam:${w.id}`;
      if (!capBuckets.has(key)) {
        capBuckets.set(key, w.capHours ?? p.mandatoryCapHours);
        bucketName.set(key, w.name);
      }
      return key;
    }
    // 내신 기간이 등록돼 있지 않으면 분기(연 4회)로 대신 묶는다 — 상한이 새지 않게
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    const key = `q:${d.getUTCFullYear()}-${q}`;
    if (!capBuckets.has(key)) {
      capBuckets.set(key, p.mandatoryCapHours);
      bucketName.set(key, `${d.getUTCFullYear()}년 ${q}분기(내신 기간 미등록)`);
    }
    return key;
  };

  const mandatory = leveled.filter((l) => l.category === "MANDATORY");
  const others = leveled.filter((l) => l.category !== "MANDATORY");
  // 값어치 큰 순 → 같으면 휴일 먼저 → 같으면 이른 날짜부터 (뒤늦은 신청이 앞선 달의 확정분을 밀어내지 않도록)
  mandatory.sort((a, b) => {
    const d = lineValue(b, p) - lineValue(a, p);
    if (d !== 0) return d;
    if (a.kind !== b.kind) return a.kind === "HOLIDAY" ? -1 : 1;
    return (a.date + a.timeLabel).localeCompare(b.date + b.timeLabel);
  });

  const lines: OtLine[] = [];
  const finish = (l: OtLine, counted: number, reason?: string) => {
    const mult = lineValue(l, p);
    const row: OtLine = {
      ...l,
      countedHours: roundHours(counted, 0),
      multiplier: mult,
      reason: reason ?? l.reason,
    };
    if (counted > 0) lines.push(row);
    if (counted < l.hours)
      excluded.push({ ...row, countedHours: 0, hours: roundHours(l.hours - counted, 0) });
  };

  for (const l of mandatory) {
    const key = bucketOf(l.date);
    const left = capBuckets.get(key) ?? 0;
    const take = Math.min(l.hours, Math.max(left, 0));
    capBuckets.set(key, left - take);
    finish(
      l,
      take,
      take < l.hours
        ? `내신의무보강 상한 초과 (${bucketName.get(key)} · 상한 ${
            (input.examPeriods ?? []).find((e) => `exam:${e.id}` === key)?.capHours ?? p.mandatoryCapHours
          }시간)`
        : undefined
    );
  }
  for (const l of others) finish(l, l.hours);

  lines.sort((a, b) => (a.date + a.timeLabel).localeCompare(b.date + b.timeLabel));
  excluded.sort((a, b) => (a.date + a.timeLabel).localeCompare(b.date + b.timeLabel));

  const sum = (f: (l: OtLine) => boolean) =>
    roundHours(
      lines.filter(f).reduce((a, l) => a + l.countedHours, 0),
      0
    );

  return {
    extraHours: sum((l) => l.kind === "EXTRA"),
    overtimeHours: sum((l) => l.kind === "OVERTIME"),
    holidayHours: sum((l) => l.kind === "HOLIDAY" && !l.over),
    holidayOverHours: sum((l) => l.kind === "HOLIDAY" && !!l.over),
    nightHours: p.countNight ? sum((l) => l.night) : 0,
    lines,
    excluded,
    pendingDecision,
  };
}

/** 산정 결과 → 금액 (통상시급 기준). 명세서·화면 미리보기가 같은 식을 쓴다 */
export function overtimeAmount(r: OtResult, hourlyWage: number, policy?: Partial<OtPolicy>): number {
  const p = { ...DEFAULT_OT_POLICY, ...(policy ?? {}) };
  return Math.round(
    r.extraHours * hourlyWage * p.extraMultiplier +
      r.overtimeHours * hourlyWage * p.overtimeMultiplier +
      r.holidayHours * hourlyWage * p.holidayMultiplier +
      r.holidayOverHours * hourlyWage * p.holidayOverMultiplier +
      r.nightHours * hourlyWage * p.nightMultiplier
  );
}
