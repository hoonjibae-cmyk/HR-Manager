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
  /** 통상시급 — 금액 미리보기용. 0 이면 금액을 못 보여 준다 */
  hourlyWage: number;
  /** 연차 하루의 유급 시간 (주 소정 ÷ 근무일수, 상한 8) — 엔진의 dailyLeaveHours 와 같은 값 */
  dailyHours: number;
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
  /** 넣기를 제안하는 일수 = 남은 − 이미 넣은 (음수면 0) */
  suggestDays: number;
  /** 제안 일수로 계산한 수당 (원) — 엔진과 **같은 식**: 일수 × 통상시급 × 1일 소정근로시간 */
  suggestAmount: number;
  /** 이미 넣은 일수가 남은 일수를 채웠는가 */
  done: boolean;
}

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
      // 퇴사 정산은 음수 제안을 그대로 둔다(공제). 기간 만료는 0 밑으로 내려가지 않는다.
      const raw = round1(r.remaining - r.alreadyDays);
      const suggest = resigns ? raw : Math.max(0, raw);
      return {
        employeeId: r.employeeId,
        name: r.name,
        kind: (resigns ? "RESIGN" : "EXPIRY") as "RESIGN" | "EXPIRY",
        expiry: resigns ? ymd(r.resignDate!) : ymd(r.periodEnd),
        remaining: round1(r.remaining),
        alreadyDays: round1(r.alreadyDays),
        suggestDays: suggest,
        suggestAmount: payoutAmount(suggest, r.hourlyWage, r.dailyHours),
        done: suggest === 0,
      };
    })
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.name.localeCompare(b.name, "ko"));
}

/** 반차(0.5) 단위까지만 쓰므로 소수점 한 자리로 맞춘다 — 부동소수 잔차를 화면에 흘리지 않는다 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 표 위에 띄우는 한 줄 — 몇 명이 며칠치인지 */
export function payoutNotice(list: PayoutSuggestion[]): string | null {
  const todo = list.filter((s) => !s.done);
  if (!todo.length) return null;
  const days = round1(todo.reduce((a, s) => a + s.suggestDays, 0));
  const resigns = todo.filter((s) => s.kind === "RESIGN").length;
  const what = resigns
    ? resigns === todo.length
      ? "퇴사 정산"
      : "연차기간 만료·퇴사 정산"
    : "연차기간 만료";
  return `이 달 ${what} 대상 ${todo.length}명 · 미사용 ${days}일`;
}
