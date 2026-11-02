/**
 * **미사용 연차수당 정산 제안** — 순수 함수(DB 무관). 짚어 주는 갈래가 둘이다.
 *
 *  ① **연차기간이 그 달에 끝나는 사람** — 연차는 입사일 기준 1년 단위로 발생하고 기간이
 *     끝나면 소멸한다(근로기준법 §60⑦). 종료월이 사람마다 달라 담당자가 헤아릴 수 없다.
 *  ② **그 달에 퇴사하는 사람** — 퇴직하면 남은 연차를 더 쓸 수 없게 되므로 미사용분은
 *     수당으로 정산해 **마지막 급여에 실어야** 한다. 기간이 안 끝났어도 마찬가지다.
 *     같은 달에 둘 다 해당하면 **퇴사 정산**으로 본다(근로관계가 끝나는 쪽이 우선한다).
 *
 * ⚠ **자동으로 넣지 않는다.** 수당으로 줄지, (재직자라면) 이월할지, 사용촉진(§61)을
 * 했는지는 회사가 정할 일이다. 화면은 금액까지 계산해 보여 주고
 * **넣을지 말지는 사람이 누른다**.
 */

import { addYears } from "date-fns";
import { summarizeLeave, currentLeavePeriod, type LeaveTxn } from "./leave";

const DAY = 86400000;

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * 연차기간의 **마지막 날**(= 사용기한). `currentLeavePeriod` 의 `endExclusive` 는
 * 다음 기간의 첫날이므로 하루를 뺀다 — 이 하루를 안 빼면 종료월이 한 달씩 밀린다.
 */
export function periodLastDay(endExclusive: Date): Date {
  return new Date(endExclusive.getTime() - DAY);
}

/** 그 날짜가 이 연·월에 속하는가 */
export function inMonth(d: Date, year: number, month: number): boolean {
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
}

/** 그날 23:59:59.999 — 잔여를 '그날까지 쓴 것' 기준으로 재는 시점 */
const endOfDay = (d: Date) => new Date(d.getTime() + DAY - 1);

/**
 * 그 달 안에서 **마지막 날을 맞는 연차기간**. 없으면 null.
 *
 * 연차기간은 입사기념일마다 바뀌므로 k 주년 기념일(= 다음 기간 첫날)의 **전날**이 그 달에
 * 들면 그 기간이 그 달에 끝난다 — 기념일이 그달 2일 ~ 다음달 1일 사이일 때다.
 *
 * ⚠ 말일 시점의 `currentLeavePeriod` 로 가리면 **입사일이 1일인 사람만 잡힌다.** 11/2 입사자는
 * 10월 말일 기준으로는 '11/1 에 끝나는 기간' 이라 10월에서 빠지고, 11월 말일 기준으로는 이미
 * 새 기간(11/2~)이라 11월에서도 빠져 **어느 달에도 올라오지 않았다**(2026-11 박영은 — 실제로 겪었다).
 */
export function leavePeriodEndingIn(
  hireDate: Date,
  year: number,
  month: number
): { endExclusive: Date; lastDay: Date; serviceYear: number } | null {
  const hireYear = hireDate.getUTCFullYear();
  // 기념일은 해마다 하나라 후보는 셋뿐이다 (1/1 입사자의 12월 = 다음 해 기념일의 전날이라 +1 까지 본다)
  for (let k = Math.max(1, year - hireYear - 1); k <= year - hireYear + 1; k++) {
    const endExclusive = addYears(hireDate, k);
    const lastDay = periodLastDay(endExclusive);
    if (inMonth(lastDay, year, month)) return { endExclusive, lastDay, serviceYear: k };
  }
  return null;
}

/**
 * 그 달 정산에 쓸 **기준 시점과 잔여**를 정한다.
 *
 * - 퇴사자(그 달 말일 전 퇴사)는 **퇴사일** 기준 — 말일 기준이면 퇴사 후에 발생할 리 없는
 *   월 개근분이 끼어 잔여가 부푼다(연차 화면과 같은 규칙).
 * - 그 달에 끝나는 연차기간이 있으면 **그 기간의 마지막 날** 기준 — 말일 기준이면 11/2 에 새로
 *   생긴 17일이 잔여로 잡혀, 11/1 에 만료된 5일 대신 엉뚱한 수가 나온다. 월초로 잡으면 그 달
 *   개근분(1년 미만)이 아직 안 생겨 기간이 하나 앞으로 밀려 잡힌다.
 * - 둘 다 아니면 말일 — 어차피 그 달 정산 대상이 아니다(`payoutSuggestions` 가 거른다).
 * - 같은 달에 기간이 끝난 **뒤** 퇴사하면(기념일 11/2 · 퇴사 11/20) 만료된 기간의 미사용분과
 *   새 기간 잔여를 **합친다** — 둘 다 더는 쓸 수 없게 된 연차라 마지막 급여에서 함께 정산한다.
 *
 * 다음 기간 날짜로 미리 승인해 둔 휴가는 `summarizeLeave` 가 이번 기간 lot 에서 빼지 않으므로
 * 여기 잔여도 그만큼 줄지 않는다.
 */
export function payoutRemaining(
  hireDate: Date,
  year: number,
  month: number,
  txns: LeaveTxn[],
  opts: { eligible: boolean; resignDate?: Date | null }
): { asOf: Date; periodEnd: Date; remaining: number; carriedDays: number } {
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const ending = leavePeriodEndingIn(hireDate, year, month);
  // 그 기념일 날짜로 이미 이월해 둔 일수 — 지급할 것이 아니라 제안에서 빠지고, 화면엔 '이월' 로 남는다
  const carriedDays = ending ? carriedOverDays(txns, ending.endExclusive) : 0;
  const resignEod = opts.resignDate ? endOfDay(opts.resignDate) : null;
  const asOf =
    resignEod && resignEod < monthEnd ? resignEod : ending ? endOfDay(ending.lastDay) : monthEnd;
  const summarize = (at: Date) => summarizeLeave(hireDate, at, txns, { eligible: opts.eligible });
  let remaining = summarize(asOf).period.remaining;
  if (ending && asOf.getTime() > endOfDay(ending.lastDay).getTime()) {
    // 기간이 끝난 뒤 같은 달에 퇴사 — 만료분을 더하되, 이미 이월한 일수는 새 기간 잔여에 들어 있으므로
    // 뺀다(두 번 세지 않게)
    remaining += Math.max(0, round1(summarize(endOfDay(ending.lastDay)).period.remaining - carriedDays));
  }
  const periodEnd = ending?.lastDay ?? periodLastDay(currentLeavePeriod(hireDate, asOf).endExclusive);
  return { asOf, periodEnd, remaining, carriedDays };
}

/**
 * 그 기념일(다음 기간 첫날) 날짜로 적힌 **이월 처리 일수** — 연차수당 상세가 '이미 이월했다' 를
 * 알아보는 열쇠. 이월 줄은 `leavePeriodEndingIn().endExclusive` 날짜로만 적는다(lib/leave-payout-service.ts).
 */
export function carriedOverDays(txns: LeaveTxn[], endExclusive: Date): number {
  const key = ymd(endExclusive);
  return round1(
    txns
      .filter(
        (t) =>
          t.type === "CARRYOVER" && t.days > 0 && (t.category ?? "STATUTORY") !== "COMP" && ymd(t.date) === key
      )
      .reduce((a, t) => a + t.days, 0)
  );
}

export interface PayoutInput {
  employeeId: number;
  name: string;
  /** 연차 발생 대상인가 — 주 15시간 미만·계약상 미적용이면 제안하지 않는다 */
  eligible: boolean;
  /** 이번 연차기간의 마지막 날 */
  periodEnd: Date;
  /** 퇴사일 — 그 달에 퇴사하면 기간 만료와 무관하게 정산 대상이다 */
  resignDate?: Date | null;
  /** 이번 연차기간의 남은 일수 */
  remaining: number;
  /** 이미 그 달 급여의 '미사용' 칸에 넣어 둔 일수 */
  alreadyDays: number;
  /** 수당 대신 다음 기간으로 이미 이월해 둔 일수 (`payoutRemaining().carriedDays`) */
  carriedDays?: number;
  /** 통상시급 — 금액 미리보기용. 0 이면 금액을 못 보여 준다 */
  hourlyWage: number;
  /** 연차 하루의 유급 시간 (주 소정 ÷ 근무일수, 상한 8) — 엔진의 dailyLeaveHours 와 같은 값 */
  dailyHours: number;
  /**
   * 초과사용 급여공제 동의 기록이 있는 **살아 있는**(승인·취소 요청 중) 신청 id — 퇴사 정산 공제의 근거.
   * 반려·취소된 신청의 동의는 그 초과가 실제로 일어나지 않았으므로 근거로 세지 않는다.
   */
  consentRequestIds?: number[];
}

export interface PayoutSuggestion {
  employeeId: number;
  name: string;
  /** 왜 이 달에 정산해야 하는가 — EXPIRY(연차기간 만료) | RESIGN(퇴사 정산) */
  kind: "EXPIRY" | "RESIGN";
  /** 기준일 YYYY-MM-DD — EXPIRY 면 사용기한, RESIGN 이면 퇴사일 */
  expiry: string;
  remaining: number;
  alreadyDays: number;
  /** 다음 기간으로 이월해 둔 일수 — 기간 만료 줄에만 (퇴사 정산은 0) */
  carriedDays: number;
  /** 넣기를 제안하는 일수 = 남은 − 이미 넣은 − 이월한 (음수면 0) */
  suggestDays: number;
  /** 제안 일수로 계산한 수당 (원) — 엔진과 **같은 식**: 일수 × 통상시급 × 1일 소정근로시간 */
  suggestAmount: number;
  /** 이미 넣은 일수가 남은 일수를 채웠는가 */
  done: boolean;
  /** 퇴사 정산인데 잔여가 마이너스 — 초과분을 마지막 급여에서 **공제**하는 줄 */
  overdraft: boolean;
  /** 공제 근거가 되는 동의 기록(신청 id) — 초과사용 줄에만 */
  consentRequestIds: number[];
  /** 초과사용인데 동의 기록이 없을 때의 경고 — 근거 없이 공제하면 §43 위반 소지 */
  evidenceWarning: string | null;
}

/** 동의 기록 없이 초과분을 공제하려 할 때 띄우는 경고 */
export const NO_CONSENT_WARNING =
  "초과사용 급여공제 동의 기록이 없습니다. 임금공제 동의서(연차 초과사용 정산 조항) 서명본을 확인한 뒤 반영하세요 — " +
  "근거 없이 공제하면 임금 전액 지급 원칙(근로기준법 §43) 위반이 될 수 있습니다.";

/**
 * 미사용 연차수당 = 일수 × 통상시급 × **1일 소정근로시간** (lib/payroll.ts 의 unusedLeaveP 와 같은 식).
 * 8시간 고정이 아니다 — 휴게 30분 체계(1일 7.5시간)에서 8 을 곱하면 미리보기와 실제 명세서가 갈린다.
 * dailyHours 는 엔진의 `dailyLeaveHours(schedule)` 로 구해 넘긴다(없으면 8).
 */
export function payoutAmount(days: number, hourlyWage: number, dailyHours = 8): number {
  return Math.round(days * hourlyWage * dailyHours);
}

/**
 * 그 달에 연차기간이 끝나는 사람만 골라 제안을 만든다.
 *
 * - **연차 미적용자는 뺀다** — 발생한 적이 없으니 정산할 것도 없다.
 * - **남은 일수가 0 이하면 뺀다** — 다 쓴 사람에게 정산 제안이 뜨면 소음이다.
 * - 이미 넣어 둔 만큼은 빼서 제안한다. 다 넣었으면 `done` 으로 표시해 **그대로 남긴다** —
 *   목록에서 사라지면 '내가 넣었는지' 를 확인할 길이 없다.
 */
export function payoutSuggestions(
  rows: PayoutInput[],
  year: number,
  month: number
): PayoutSuggestion[] {
  return rows
    .filter((r) => {
      if (!r.eligible) return false;
      const resigns = !!r.resignDate && inMonth(r.resignDate, year, month);
      // **퇴사자는 잔여가 마이너스(초과사용)여도 올린다** — 발생분보다 많이 쓰고 나가는
      // 경우 초과일수를 (−)로 정산(마지막 급여에서 공제, 임금공제 동의서 근거)해야 하는데
      // 목록에서 빠지면 그대로 놓친다. 재직자의 기간 만료는 예전대로 양수만 — 초과분을
      // 다음 기간에서 조정할지는 회사가 따로 정할 일이라 자동 제안하지 않는다.
      if (resigns) return r.remaining !== 0;
      return r.remaining > 0 && inMonth(r.periodEnd, year, month);
    })
    .map((r) => {
      const resigns = !!r.resignDate && inMonth(r.resignDate!, year, month);
      // 이월해 둔 일수는 지급할 것이 아니다 — 퇴사 정산 줄에서는 따로 빼지 않는다(그 일수는 이미
      // 새 기간 잔여에 들어 있고 `payoutRemaining` 이 만료분에서 뺐다)
      const carried = resigns ? 0 : round1(r.carriedDays ?? 0);
      // 퇴사 정산은 음수 제안을 그대로 둔다(공제). 기간 만료는 0 밑으로 내려가지 않는다.
      const raw = round1(r.remaining - r.alreadyDays - carried);
      const suggest = resigns ? raw : Math.max(0, raw);
      // 초과사용 공제 여부는 **잔여**로 가른다(이미 일부 넣어 제안이 0 이 된 줄도 공제 줄이다)
      const overdraft = resigns && r.remaining < 0;
      const consentRequestIds = overdraft ? [...(r.consentRequestIds ?? [])] : [];
      return {
        employeeId: r.employeeId,
        name: r.name,
        kind: (resigns ? "RESIGN" : "EXPIRY") as "RESIGN" | "EXPIRY",
        expiry: resigns ? ymd(r.resignDate!) : ymd(r.periodEnd),
        remaining: round1(r.remaining),
        alreadyDays: round1(r.alreadyDays),
        carriedDays: carried,
        suggestDays: suggest,
        suggestAmount: payoutAmount(suggest, r.hourlyWage, r.dailyHours),
        done: suggest === 0,
        overdraft,
        consentRequestIds,
        evidenceWarning: overdraft && !consentRequestIds.length ? NO_CONSENT_WARNING : null,
      };
    })
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.name.localeCompare(b.name, "ko"));
}

/** 반차(0.5) 단위까지만 쓰므로 소수점 한 자리로 맞춘다 — 부동소수 잔차를 화면에 흘리지 않는다 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 지급(+)과 공제(−)를 갈라 합친다 — 한데 더하면 서로 상쇄돼 둘 다 안 보인다 */
export function payoutTotals(list: PayoutSuggestion[]): {
  payDays: number;
  payAmount: number;
  deductDays: number;
  deductAmount: number;
} {
  const pay = list.filter((s) => s.suggestDays > 0);
  const ded = list.filter((s) => s.suggestDays < 0);
  return {
    payDays: round1(pay.reduce((a, s) => a + s.suggestDays, 0)),
    payAmount: pay.reduce((a, s) => a + s.suggestAmount, 0),
    deductDays: round1(ded.reduce((a, s) => a + s.suggestDays, 0)),
    deductAmount: ded.reduce((a, s) => a + s.suggestAmount, 0),
  };
}

/**
 * 표 위에 띄우는 한 줄 — 몇 명이 며칠치인지. **초과사용 공제는 따로 적는다** — 미사용 일수와
 * 한데 더하면 +3일과 −2일이 '1일' 로 뭉개져 공제 대상이 있다는 사실이 사라진다.
 */
export function payoutNotice(list: PayoutSuggestion[]): string | null {
  const todo = list.filter((s) => !s.done);
  if (!todo.length) return null;
  const pay = todo.filter((s) => s.suggestDays > 0);
  const ded = todo.filter((s) => s.suggestDays < 0);
  const parts: string[] = [];
  if (pay.length) {
    const resigns = pay.filter((s) => s.kind === "RESIGN").length;
    const what = resigns ? (resigns === pay.length ? "퇴사 정산" : "연차기간 만료·퇴사 정산") : "연차기간 만료";
    parts.push(`${what} ${pay.length}명 · 미사용 ${round1(pay.reduce((a, s) => a + s.suggestDays, 0))}일`);
  }
  if (ded.length) {
    const noConsent = ded.filter((s) => s.evidenceWarning).length;
    parts.push(
      `퇴사 초과사용 공제 ${ded.length}명 · ${round1(ded.reduce((a, s) => a + s.suggestDays, 0))}일` +
        (noConsent ? ` (동의 기록 없음 ${noConsent}명)` : "")
    );
  }
  return `이 달 ${parts.join(" / ")}`;
}

/* ============================ 이월 ============================ */

/** 수당 대신 이월하지 못하는 이유 */
export type CarryoverBlock = "RESIGN" | "NOT_ENDED" | "NOTHING";
export const CARRYOVER_BLOCK_LABEL: Record<CarryoverBlock, string> = {
  RESIGN: "퇴사 정산은 이월할 수 없습니다 — 수당으로 정산합니다",
  NOT_ENDED: "연차기간이 아직 끝나지 않았습니다 — 끝난 다음 날부터 처리할 수 있습니다",
  NOTHING: "이월하거나 지급할 남은 일수가 없습니다",
};

/**
 * 이 줄을 **이월 처리할 수 있는가**, 며칠인가.
 * - 퇴사 정산(RESIGN)은 안 된다 — 넘겨 줄 다음 기간이 없다.
 * - **기간이 끝나기 전에는 안 된다** — 남은 날에 연차를 더 쓸 수 있어 잔여가 아직 움직인다. 미리 적으면
 *   다음 기간 첫날에 실제보다 많은 이월 lot 이 생기고, 직원은 슬랙에서 그 잔여를 곧바로 본다.
 *   수당 반영은 급여 입력값이라 나중에 고치면 되지만 이월은 원장에 바로 적히는 발생분이라 더 엄격하다.
 * - 이미 넣은(수당)·이월한 만큼을 뺀 나머지(`suggestDays`)만 이월한다.
 */
export function carryoverPlan(
  s: PayoutSuggestion,
  todayYmd: string
): { ok: true; days: number } | { ok: false; reason: CarryoverBlock } {
  if (s.kind === "RESIGN") return { ok: false, reason: "RESIGN" };
  if (s.suggestDays <= 0) return { ok: false, reason: "NOTHING" };
  if (todayYmd <= s.expiry) return { ok: false, reason: "NOT_ENDED" };
  return { ok: true, days: s.suggestDays };
}

/** 명세서·원장·이력에 적는 이월 내용 */
export interface CarryoverInfo {
  days: number;
  /** 끝난 연차기간 */
  periodStart: string;
  periodEnd: string;
  /** 이월분이 사는 다음 연차기간 */
  nextStart: string;
  nextEnd: string;
  /** 처리일(KST) — 없으면 안 적는다 */
  processedOn?: string | null;
}

/**
 * 급여명세서에 싣는 이월 안내 — 수당이 왜 없는지, 그 일수가 어디로 갔는지를 **문서만 보고** 알 수 있어야
 * 한다. 이월분을 다음 기간에도 못 쓰면 그때 수당으로 정산한다는 것까지 적는다(소멸시키면 체불이다).
 */
export function carryoverNotice(c: CarryoverInfo): string {
  return (
    `연차 이월: 연차기간 ${c.periodStart} ~ ${c.periodEnd}의 미사용 연차 ${c.days}일은 근로자 동의에 따라 ` +
    `수당으로 지급하지 않고 다음 연차기간(${c.nextStart} ~ ${c.nextEnd})으로 이월하였습니다. ` +
    `이월분은 다음 기간 안에 사용할 수 있으며, 기간 안에 사용하지 못한 일수는 그때 연차미사용수당으로 정산합니다.` +
    (c.processedOn ? ` (처리일 ${c.processedOn})` : "")
  );
}

/** 원장(CARRYOVER 줄)의 메모 — 직원별 연차 내역·작업 이력에 그대로 보인다 */
export function carryoverTxnNote(
  c: Pick<CarryoverInfo, "days" | "periodStart" | "periodEnd">,
  by?: string | null
): string {
  return `연차기간 ${c.periodStart}~${c.periodEnd} 미사용 ${c.days}일 이월 — 근로자 동의 확인${by ? ` (${by})` : ""}`;
}
