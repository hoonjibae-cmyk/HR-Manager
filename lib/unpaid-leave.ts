// 무급휴직 — 순수 함수(DB 무관), 테스트 있음(lib/unpaid-leave.test.ts)
//
// ## 무엇인가
// 급여를 지급하지 않는 휴직 기간(개인 사정 등)이다. **연차가 아니다** — 연차 원장(`LeaveTransaction`)에
// 넣지 않고 `UnpaidLeave` 에 따로 둔다. 원장에 넣으면 `summarizeLeave` 가 훑어 잔여가 조용히 줄어든다
// (평일 휴무 `DayOff` 를 따로 둔 것과 같은 이유).
//
// ## 급여 — 역일수 일할 (2026-11 결정)
//
//     그 달 지급 비율 = (그 달 재직 역일수 − 무급휴직 역일수) ÷ 그 달 역일수
//
// 월중 입·퇴사 일할(`prorationRatioFor`, lib/payroll-service.ts)과 **같은 방식**이라 한 달 안에 둘이 겹쳐도
// 한 번에 계산된다. 근무일수(소정근로일)가 아니라 역일수로 세는 이유: 월급에는 주휴일·휴일의 몫이 함께
// 들어 있어 달력의 날 수로 나눠야 입·퇴사 일할과 답이 갈리지 않는다(11/16 입사와 11/1~11/15 무급휴직이 같은 금액).
//
// ## 재직 판정과 섞지 않는다
// **시트에 누가 오르는가**는 여전히 재직 기간 하나로 정한다(`employedInMonth` ≡ `prorationRatioFor > 0`).
// 한 달을 통째로 쉬어도 그 사람은 재직자라 시트에 **0원 행으로 남는다** — 빠지면 그 달 4대보험·세무 자료에서
// 사람이 사라지고, 상여·연차수당처럼 따로 줄 몫을 넣을 자리도 없어진다.
//
// ## 손대지 않는 것
//  · **연차 발생·근속** — 반영하지 않는다(2026-11 결정). 연차 원장·연차기간은 그대로다.
//  · **완전비율제** — 매출 기준이라 일할하지 않는다(입·퇴사 일할과 같은 규칙). 최저보장(만근 조건)은 관리자가 조정한다.
//  · **시급제** — 출퇴근 기록의 실근로시간으로 지급하므로 쉰 날은 원래 지급되지 않는다. 기록표 없이
//    어림잡은 달과 월 정액 수당(식대 등)만 같은 비율로 줄어든다.
//  · **통상시급** — 월 금액끼리 나눈 값이라 그대로다(연장·휴일·연차수당의 단가는 줄지 않는다).
//
// ## 퇴직급여(DC 부담금·충당금)
// 그 달 급여 기록에서 파생되므로(lib/severance-service.ts) 줄어든 만큼 함께 줄어든다. 계약 추산으로 메우는
// 달(도입 이전)도 같은 비율을 쓴다(scripts/severance-migrate.ts).
// ⚠ 육아휴직·출산전후휴가처럼 법으로 보호되는 휴직은 이렇게 줄이면 부담금 미달이 된다 — 화면이 적는 주의
// (`UNPAID_SEVERANCE_NOTE`)를 볼 것. 그런 달은 퇴직급여 화면에서 기준급여를 직접 지정한다.

const DAY_MS = 86400000;

/** UTC 날짜 번호 — 시각을 떼고 '며칠째 날인가' 만 남긴다(앱의 날짜는 KST 벽시계를 UTC 필드에 담는다) */
function dayNo(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
}
const dateOf = (n: number) => new Date(n * DAY_MS);
const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (n: number) => {
  const d = dateOf(n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** 무급휴직 한 건 — 첫날과 마지막 날(둘 다 포함) */
export interface UnpaidLeaveSpan {
  startDate: Date;
  endDate: Date;
}

/** 그 달 안으로 자른 무급휴직 구간 — `YYYY-MM-DD`, 둘 다 포함 */
export interface UnpaidMonthSpan {
  from: string;
  to: string;
  days: number;
}

/** 그 달의 지급 일수 */
export interface MonthPayDays {
  /** 그 달 역일수 (28~31) */
  daysInMonth: number;
  /** 그 달 재직 역일수 (입·퇴사일로 자른 것) */
  employedDays: number;
  /** 그중 무급휴직 역일수 — 겹쳐 등록돼 있어도 같은 날은 한 번만 센다 */
  unpaidDays: number;
  /** 급여가 나가는 역일수 = 재직 − 무급휴직 */
  paidDays: number;
  /** 지급 비율 = paidDays ÷ daysInMonth (0~1). 무급휴직이 없으면 재직비율과 같다 */
  ratio: number;
  /** 그 달에 걸친 무급휴직 구간(재직 기간 안으로 자르고, 겹치거나 이어진 것은 합친다) */
  spans: UnpaidMonthSpan[];
}

/** [lo, hi] 안으로 자르고 겹치거나 맞닿은 구간을 합친다 (날짜 번호) */
function mergedWithin(
  leaves: UnpaidLeaveSpan[],
  lo: number,
  hi: number
): Array<{ from: number; to: number }> {
  const cut = leaves
    .map((l) => ({ from: Math.max(dayNo(l.startDate), lo), to: Math.min(dayNo(l.endDate), hi) }))
    .filter((s) => s.from <= s.to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Array<{ from: number; to: number }> = [];
  for (const s of cut) {
    const last = out[out.length - 1];
    // 맞닿은 구간(11/10 끝 + 11/11 시작)도 한 덩어리로 — 명세서에 두 줄로 쪼개져 나갈 이유가 없다
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/**
 * [from, to](둘 다 포함) 안의 무급휴직 역일수 — 겹친 등록은 한 번만 센다.
 * 월중 계약 변경 가중(`wageSegmentsFor`)이 구간마다 '급여가 나가는 날' 만 세는 데 쓴다.
 */
export function unpaidDaysBetween(from: Date, to: Date, leaves: UnpaidLeaveSpan[]): number {
  const lo = dayNo(from);
  const hi = dayNo(to);
  if (lo > hi || !leaves.length) return 0;
  return mergedWithin(leaves, lo, hi).reduce((a, s) => a + (s.to - s.from + 1), 0);
}

/**
 * 그 달 지급 일수와 비율.
 *
 * 재직 기간이 없는 달은 전부 0 이다(무급휴직도 세지 않는다 — 재직하지 않은 날은 휴직일 수 없다).
 */
export function monthPayDays(
  year: number,
  month: number,
  hireDate: Date,
  resignDate: Date | null | undefined,
  leaves: UnpaidLeaveSpan[]
): MonthPayDays {
  const first = Math.floor(Date.UTC(year, month - 1, 1) / DAY_MS);
  const last = Math.floor(Date.UTC(year, month, 0) / DAY_MS);
  const daysInMonth = last - first + 1;
  const from = Math.max(dayNo(hireDate), first);
  const to = resignDate ? Math.min(dayNo(resignDate), last) : last;
  if (from > to)
    return { daysInMonth, employedDays: 0, unpaidDays: 0, paidDays: 0, ratio: 0, spans: [] };

  const employedDays = to - from + 1;
  const merged = mergedWithin(leaves, from, to);
  const unpaidDays = merged.reduce((a, s) => a + (s.to - s.from + 1), 0);
  const paidDays = employedDays - unpaidDays;
  return {
    daysInMonth,
    employedDays,
    unpaidDays,
    paidDays,
    ratio: Math.min(Math.max(paidDays / daysInMonth, 0), 1),
    spans: merged.map((s) => ({ from: ymdOf(s.from), to: ymdOf(s.to), days: s.to - s.from + 1 })),
  };
}

/* ───────────── 급여 기록에 남기는 근거 ───────────── */

/**
 * 그 달 산정에 실제로 쓴 무급휴직 — 급여 기록의 `breakdown.unpaidLeave` 에 남긴다.
 *
 * 명세서·세무 자료·화면이 **지금의 휴직 등록이 아니라 이 값**을 읽는다 — 산정한 뒤에 휴직 기간을 고쳐도
 * 이미 산정한 달의 문서가 따라 바뀌지 않는다(다시 산정하면 그때 등록을 따른다).
 */
export interface UnpaidLeaveMeta {
  /** 그 달 무급휴직 역일수 */
  days: number;
  daysInMonth: number;
  employedDays: number;
  paidDays: number;
  spans: UnpaidMonthSpan[];
}

/** 무급휴직이 없는 달은 null — 근거를 남기지 않는다(그런 달의 기록은 예전과 한 글자도 다르지 않다) */
export function unpaidLeaveMetaOf(pd: MonthPayDays): UnpaidLeaveMeta | null {
  if (pd.unpaidDays <= 0) return null;
  return {
    days: pd.unpaidDays,
    daysInMonth: pd.daysInMonth,
    employedDays: pd.employedDays,
    paidDays: pd.paidDays,
    spans: pd.spans,
  };
}

const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 저장된 산출 근거(JSON 문자열 또는 이미 푼 객체)에서 무급휴직 근거를 읽는다. 없거나 모양이 다르면 null */
export function readUnpaidLeaveMeta(breakdown: unknown): UnpaidLeaveMeta | null {
  let bd: any = breakdown;
  if (typeof breakdown === "string") {
    try {
      bd = JSON.parse(breakdown);
    } catch {
      return null;
    }
  }
  const m = bd?.unpaidLeave;
  if (!m || typeof m !== "object") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const days = num(m.days);
  const daysInMonth = num(m.daysInMonth);
  if (days == null || days <= 0 || daysInMonth == null || daysInMonth <= 0) return null;
  const spans: UnpaidMonthSpan[] = Array.isArray(m.spans)
    ? m.spans
        .filter((s: any) => isYmd(s?.from) && isYmd(s?.to))
        .map((s: any) => ({ from: s.from, to: s.to, days: num(s.days) ?? 0 }))
    : [];
  const employedDays = num(m.employedDays) ?? daysInMonth;
  return {
    days,
    daysInMonth,
    employedDays,
    paidDays: num(m.paidDays) ?? Math.max(employedDays - days, 0),
    spans,
  };
}

/** 구간들의 지문 — 산정 때 쓴 휴직과 지금 등록된 휴직이 같은지 견주는 데만 쓴다 */
const signature = (spans: UnpaidMonthSpan[]) => spans.map((s) => `${s.from}~${s.to}`).join(",");

/**
 * **산정한 뒤에 무급휴직이 바뀌었는가** — 급여 화면이 이 행을 「다시 산정 필요」로 띄운다.
 *
 * 휴직을 등록·수정·삭제해도 이미 만들어 둔 급여 기록은 저절로 바뀌지 않는다(계약 수정과 같다 —
 * 「급여 일괄 산정」을 다시 눌러야 반영된다). 조용히 지나가면 쉬는 동안의 급여가 그대로 이체된다.
 */
export function unpaidLeaveStale(stored: UnpaidLeaveMeta | null, now: MonthPayDays): boolean {
  return signature(stored?.spans ?? []) !== signature(now.spans);
}

/* ───────────── 표기 ───────────── */

const mdOf = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const koOf = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;

/** `11/16~11/30` — 하루짜리는 `11/16`. 여러 구간은 쉼표로 잇는다 */
export function unpaidSpansLabel(spans: UnpaidMonthSpan[]): string {
  return spans.map((s) => (s.from === s.to ? mdOf(s.from) : `${mdOf(s.from)}~${mdOf(s.to)}`)).join(", ");
}

/** `11월 16일 ~ 11월 30일` — 명세서용 */
export function unpaidSpansLabelKo(spans: UnpaidMonthSpan[]): string {
  return spans.map((s) => (s.from === s.to ? koOf(s.from) : `${koOf(s.from)} ~ ${koOf(s.to)}`)).join(", ");
}

/** 세무사무소 제출자료 비고 · 화면의 한 줄 — `무급휴직 11/16~11/30(15일)` */
export function unpaidLeaveNote(m: UnpaidLeaveMeta): string {
  const span = unpaidSpansLabel(m.spans);
  return `무급휴직 ${span ? `${span}(${m.days}일)` : `${m.days}일`}`;
}

/** 급여 엔진의 산정 근거 한 줄 — 급여형태에 따라 '무엇이 줄었는지' 가 다르다 */
export function unpaidLeaveCalcNote(
  m: UnpaidLeaveMeta,
  kind: "PRORATED" | "RATIO" | "HOURLY_ACTUAL"
): string {
  const head = `${unpaidLeaveNote(m)}`;
  if (kind === "RATIO")
    return (
      `${head} — 완전비율제는 매출 기준이라 일할하지 않습니다. ` +
      `최저보장(만근 조건)이 있으면 관리자가 조정해 주세요.`
    );
  if (kind === "HOURLY_ACTUAL")
    return (
      `${head} — 시급제는 출퇴근 기록의 실근로시간으로 지급합니다(쉰 날은 근로시간이 없습니다). ` +
      `월 정액 수당만 ${m.paidDays}/${m.daysInMonth} 로 일할했습니다.`
    );
  return (
    `${head} — 역일수 일할: 지급 대상 ${m.paidDays}일 ÷ ${m.daysInMonth}일 ` +
    `= ${((m.paidDays / m.daysInMonth) * 100).toFixed(1)}%` +
    (m.employedDays < m.daysInMonth ? ` (그 달 재직 ${m.employedDays}일 중)` : "")
  );
}

/* ───────────── 등록 검사 ───────────── */

/** `YYYY-MM-DD` → UTC 자정. 모양이 다르거나 없는 날짜(2/30)면 null */
export function parseYmd(s: unknown): Date | null {
  if (!isYmd(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** 첫날~마지막 날의 역일수(둘 다 포함) */
export function spanDays(start: Date, end: Date): number {
  return Math.max(dayNo(end) - dayNo(start) + 1, 0);
}

/** 사유 최대 길이 — 내부 메모라 길 이유가 없다 */
export const UNPAID_REASON_MAX = 200;

/**
 * 무급휴직 등록·수정 검사 — **화면과 서버가 같은 함수**를 쓴다.
 *
 * 겹치는 등록을 막는다. 계산은 겹쳐도 같은 날을 한 번만 세지만, 겹친 채 두면 한 건을 지워도
 * 그 날들이 여전히 무급으로 남아 '지웠는데 왜 그대로냐' 가 된다.
 */
export function unpaidLeaveError(
  input: { startDate: unknown; endDate: unknown; reason?: unknown },
  ctx: {
    hireDate: Date;
    resignDate?: Date | null;
    /** 위탁계약(프리랜서) — `isContractorContract()` 결과 */
    contractor: boolean;
    /** 같은 직원의 다른 무급휴직(수정이면 자기 자신은 뺀다) */
    others: UnpaidLeaveSpan[];
  }
): string | null {
  if (ctx.contractor)
    return (
      "위탁계약(프리랜서)은 근로자가 아니라 무급휴직 대상이 아닙니다 — " +
      "지급액은 계약의 시급·비율로만 정해집니다."
    );
  const start = parseYmd(input.startDate);
  const end = parseYmd(input.endDate);
  if (!start || !end) return "시작일과 종료일을 날짜(YYYY-MM-DD)로 넣어 주세요.";
  if (start > end) return "종료일이 시작일보다 빠릅니다.";
  if (dayNo(start) < dayNo(ctx.hireDate))
    return `시작일이 입사일(${ymdOf(dayNo(ctx.hireDate))})보다 빠릅니다.`;
  if (ctx.resignDate && dayNo(end) > dayNo(ctx.resignDate))
    return `종료일이 퇴사일(${ymdOf(dayNo(ctx.resignDate))})보다 늦습니다.`;
  const hit = ctx.others.find(
    (o) => dayNo(o.startDate) <= dayNo(end) && dayNo(start) <= dayNo(o.endDate)
  );
  if (hit)
    return (
      `이미 등록된 무급휴직(${ymdOf(dayNo(hit.startDate))} ~ ${ymdOf(dayNo(hit.endDate))})과 겹칩니다 — ` +
      `그 건을 고치거나 지운 뒤 다시 넣어 주세요.`
    );
  if (input.reason != null && typeof input.reason !== "string") return "사유는 글자로 넣어 주세요.";
  if (typeof input.reason === "string" && input.reason.trim().length > UNPAID_REASON_MAX)
    return `사유는 ${UNPAID_REASON_MAX}자까지 넣을 수 있습니다.`;
  return null;
}

/** 한 건이 걸치는 달 목록 — 등록·삭제 뒤 '어느 달 급여를 다시 봐야 하는지' 알리는 데 쓴다 */
export function monthsOfSpan(
  start: Date,
  end: Date,
  cap = 36
): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  const ey = end.getUTCFullYear();
  const em = end.getUTCMonth() + 1;
  while ((y < ey || (y === ey && m <= em)) && out.length < cap) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/* ───────────── 화면이 함께 적는 주의 ───────────── */

/**
 * 무급휴직 등록 창이 적는 안내 — 무엇이 바뀌고 무엇이 안 바뀌는지.
 * 조용히 줄어드는 돈이 있으므로(급여·퇴직급여) 등록하는 자리에서 먼저 읽히게 한다.
 */
export const UNPAID_LEAVE_EFFECT_NOTE =
  "등록한 기간만큼 그 달 급여가 역일수로 일할됩니다(월중 입·퇴사와 같은 방식 — 기본급과 월 정액 수당). " +
  "연차 발생·근속은 바뀌지 않습니다. 이미 산정해 둔 달은 급여 화면에서 「급여 일괄 산정」을 다시 눌러야 반영됩니다.";

/**
 * 퇴직급여에 대한 주의.
 *
 * DC 부담금은 '연간 임금총액의 1/12' 이라(근로자퇴직급여보장법 §20①) 임금이 없던 기간에는 쌓이는 몫도 없다 —
 * 그래서 그 달 급여가 줄면 함께 줄어든다(2026-11 결정: 「DC형이므로 퇴직급여 적립에도 반영」).
 *
 * ⚠ **법으로 보호되는 휴직은 그렇게 하면 안 된다.** 출산전후휴가·육아휴직(·육아기 근로시간 단축) 기간은
 * 「그 기간의 임금을 뺀 연간 임금총액 ÷ 그 기간을 뺀 기간」으로 부담금을 내야 한다는 것이 고용노동부의 해석이다 —
 * 평균임금 산정에서 빼는 기간(근로기준법 시행령 §2①)을 DC 에도 같은 취지로 적용한 것이라, 그 기간에도 평소만큼
 * 쌓아야 한다. 이 기능으로 급여를 멈추면 적립도 함께 줄어 **부담금 미달**이 된다. 그런 휴직이면 퇴직급여 화면에서
 * 그 달 기준급여를 직접 지정한다(관리자 지정이 급여보다 우선한다 — lib/severance-service.ts).
 *
 * 개인 사정으로 인한 휴직이 어느 쪽인지는 앱이 정하지 않는다. 같은 조 8호가 「업무 외 부상이나 질병, 그 밖의
 * 사유로 사용자의 승인을 받아 휴업한 기간」을 들고 있어, 회사가 승인한 개인 휴직에도 위 방식을 적용해야 한다고
 * 볼 여지가 있다(이 경우를 직접 다룬 해석은 확인하지 못했다). 퇴직연금규약·취업규칙과 노무 자문으로 확인할 대목이다.
 */
export const UNPAID_SEVERANCE_NOTE =
  "퇴직급여(DC 부담금·충당금)는 그 달 급여에서 산정하므로 무급휴직으로 줄어든 만큼 함께 줄어듭니다. " +
  "⚠ 육아휴직·출산전후휴가처럼 법으로 보호되는 휴직은 다릅니다 — 그 기간의 임금을 뺀 임금총액을 그 기간을 뺀 " +
  "기간으로 나눠 부담금을 내야 해서(고용노동부 해석) 줄여 쌓으면 미달이 됩니다. 그런 휴직이면 퇴직급여 화면에서 " +
  "그 달 기준급여를 직접 지정하세요. 개인 사정으로 인한 휴직도 회사 승인을 받은 휴업(근로기준법 시행령 " +
  "제2조제1항제8호)으로 보아 같은 방식을 적용해야 하는지는 퇴직연금규약과 노무 자문으로 확인해 주세요.";
