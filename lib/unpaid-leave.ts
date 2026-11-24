// 휴직·휴업 — 순수 함수(DB 무관), 테스트 있음(lib/unpaid-leave.test.ts · lib/paid-leave.test.ts)
//
// ⚠ 파일·모델·타입 이름이 `unpaid-leave` / `UnpaidLeave…` 인 것은 **처음에 무급휴직만 담았기 때문**이다(v1.63).
// v1.64 부터 유급휴직·휴업도 여기서 다룬다 — 테이블이 이미 배포돼 이름은 그대로 뒀다(바꾸면 `prisma db push` 가
// 지우고 다시 만든다).
//
// ## 무엇인가
// 정상 급여가 나가지 않는 기간이다. 구분(`kind`)이 셋이다.
//  · **UNPAID 무급휴직** — 그 기간의 급여가 없다(개인 사정 등).
//  · **PAID 유급휴직** — 그 기간의 급여를 **원급여 대비 비율** 또는 **직접 넣은 금액**으로 준다.
//  · **SHUTDOWN 휴업** — 계산은 유급휴직과 같고, 주는 돈의 이름이 「휴업수당」이다(근로기준법 §46).
// **연차가 아니다** — 연차 원장(`LeaveTransaction`)에 넣지 않고 `UnpaidLeave` 에 따로 둔다. 원장에 넣으면
// `summarizeLeave` 가 훑어 잔여가 조용히 줄어든다(평일 휴무 `DayOff` 를 따로 둔 것과 같은 이유).
//
// ## 급여 — 두 덩어리로 나눠 계산한다
//
//   ① 정상 급여 = 월액 × (그 달 재직 역일수 − 휴직·휴업 역일수) ÷ 그 달 역일수        (2026-11 결정)
//   ② 유급휴직 급여·휴업수당 — 따로 서는 지급 항목(`PayrollRecord.leavePayP`)
//        비율 지급 : 원급여 × 지급 비율,   원급여 = 월 기준액 × 그 기간 역일수 ÷ 그 달 역일수
//        금액 지정 : 넣은 금액 — **그 건 기간 전체의 총액**이고 달을 걸치면 역일수로 나눠 싣는다
//
// ①은 구분과 무관하다 — 유급휴직·휴업일도 정상 급여에서는 빠지고, 그 날의 돈은 ②로 나간다. 그래야 명세서에
// 「휴업수당」이 따로 서고(임금대장·세무 자료가 갈라 본다), 비율이 100% 가 아니어도 한 식으로 계산된다.
// 비율 100% 면 ①+②가 휴직이 없던 달과 같다(반올림 1원 이내).
//
// ①은 월중 입·퇴사 일할(`prorationRatioFor`, lib/payroll-service.ts)과 **같은 방식**이라 한 달 안에 둘이 겹쳐도
// 한 번에 계산된다. 근무일수(소정근로일)가 아니라 역일수로 세는 이유: 월급에는 주휴일·휴일의 몫이 함께
// 들어 있어 달력의 날 수로 나눠야 입·퇴사 일할과 답이 갈리지 않는다(11/16 입사와 11/1~11/15 무급휴직이 같은 금액).
//
// ### 원급여(월 기준액)
// 휴직·휴업이 없었다면 한 달에 받았을 **계약상 월 임금**이다(`leaveWageBasis`, lib/payroll.ts).
// 월급제·인센티브 = 월 지급 총액 − 경업금지 보상금 + 직책수당, 시급제 = 시급 × (주 소정+주휴) × 4.345 + 월 정액 수당.
// **경업금지 보상금은 넣지 않는다** — 근로의 대가가 아니라 임금으로 다루지 않는다는 원칙(통상시급·퇴직급여와 같다).
// 완전비율제는 매출에 달려 원급여가 정해져 있지 않다 — **금액 지정만** 된다.
// 달 안에서 계약이 바뀌면 그 날짜의 계약 조건으로 센다(`settleLeavePay` 의 `pieces`).
//
// ⚠ 근로기준법 §46 의 휴업수당 기준은 **평균임금**(직전 3개월 임금 총액 ÷ 그 기간 역일수)의 70% 다. 여기의
// 비율은 **원급여(계약 월 급여) 대비**라 연장수당·상여가 많았던 사람은 법정 기준보다 적게 나올 수 있다 —
// 그래서 금액을 직접 넣는 길을 함께 둔다(화면이 같은 말을 한다: `SHUTDOWN_BASIS_NOTE`).
//
// ### 비율 지급의 산정 기준이 둘이다 (v1.65 — `payBasis`)
// 같은 「70%」라도 **무엇의 70% 인가**가 다르다. 건마다 고른다(기본은 역일수 기준 — 옛 행은 그대로다).
//
//   역일수 기준(CALENDAR)   : 원급여 = 월 기준액 × 그 기간 역일수 ÷ 그 달 역일수
//   소정근로일 기준(WORKDAY) : 원급여 = 통상시급 × 1일 환산시간 × 그 기간의 평일(월~금) 수
//                              통상시급 = 월 급여 ÷ 월 유급시간,  1일 환산시간 = 주 소정근로시간 ÷ 5 (상한 8)
//
//  · 역일수 기준은 월급을 달력의 날 수로 나눈다 — **주휴일·휴일의 몫이 들어 있어** 100% 면 평소 급여와 같다.
//  · 소정근로일 기준은 **통상임금**으로 센다(1일 통상임금 × 일할 날 수). 주휴일·토요일의 몫이 없어 100% 여도
//    평소 한 달 급여보다 적다. 평일에 든 공휴일은 센다(유급휴일이다 — §55②).
//    1일 환산시간을 「주 소정 ÷ 5」로 두고 평일을 세므로 근무 요일이 어떻게 짜여 있든 **한 주에 주 소정근로시간만큼**
//    이 된다(단시간근로자의 1일 소정근로시간 환산 — 근로기준법 시행령 별표 2 와 같은 방식).
//  · 통상시급은 급여 엔진의 통상시급과 **같은 값**이다(`leaveWageBasis` 의 `hourlyBase ÷ hourlyHours`) —
//    월급제는 (월 지급 총액 − 경업금지 보상금) ÷ (기본급 산정시간 + 1.5×약정 시간외 + 0.5×약정 야간), 시급제는 시급.
//    **반올림하지 않은 값으로 곱하고 원급여에서 한 번 반올림한다** — 통상시급을 먼저 반올림하면 날 수만큼 오차가 불어난다.
//  · 근로시간표가 비면 1일 환산시간을 낼 수 없다 — 등록 검사가 막고, 지나오면 0원 + 「원급여 없음」으로 띄운다.
//
// ⚠ **소정근로일 기준에는 주휴일 몫이 없다 — 사용자 귀책 휴업(§46)이면 그만큼 모자랄 수 있다.**
// 고용노동부 행정해석은 휴업기간에 든 날을 이렇게 가른다고 검색된다(2026-11):
//   - 무급휴무일(토요일 등) — 근로제공 의무가 없어 달리 정한 바 없으면 휴업수당 지급의무가 없다
//     (근로기준정책과-1448, 2015.4.10.)
//   - 유급휴일(주휴일 등) — 휴업기간에 포함하여 휴업수당을 산정한다(「휴업수당제도 해석 기준」 2009,
//     법제처 국가법령정보센터의 중앙부처 1차 해석 「휴업기간 중 유급휴일 계산 방법」)
// 이 기준은 토요일을 빼는 것까지는 그 해석과 같고, **주휴일을 세지 않는 점이 다르다**(2026-11 협의 건이 그렇게
// 산정됐다 — 당사자가 합의한 금액이라 그 산식을 그대로 옮겼다). 주휴일 몫이 들어가는 쪽은 역일수 기준이다.
// 주휴일 쪽 해석은 **검색 결과의 인용으로만 확인했다** — 원문 페이지(law.go.kr 등)는 이 작업 환경에서 열리지 않아
// 직접 대조하지 못했다. 화면은 단정하지 않고 「확인해 주세요」로 적는다(`LEAVE_WORKDAY_BASIS_NOTE`).
// 어느 쪽이 맞는지는 앱이 정하지 않는다 — 휴업의 성격(사용자 귀책인지, 합의된 휴직인지)과 노무 자문의 몫이다.
//
// 2026-11 실제 협의 건이 이 기준이다(월 3,200,000원 · 주 18시간 → 월 유급 93.852시간 · 1일 3.6시간 · 70%):
//   11/7~11/30 평일 16일 → 1,374,760원,  12/1~12/31 평일 23일 → 1,976,218원,  1/1~1/22 평일 16일 → 1,374,760원
// 테스트(lib/leave-workday.test.ts)가 이 세 금액을 원 단위로 못박아 둔다.
//
// ## 재직 판정과 섞지 않는다
// **시트에 누가 오르는가**는 여전히 재직 기간 하나로 정한다(`employedInMonth` ≡ `prorationRatioFor > 0`).
// 한 달을 통째로 쉬어도 그 사람은 재직자라 시트에 **0원 행으로 남는다** — 빠지면 그 달 4대보험·세무 자료에서
// 사람이 사라지고, 상여·연차수당처럼 따로 줄 몫을 넣을 자리도 없어진다.
//
// ## 손대지 않는 것
//  · **연차 발생·근속** — 반영하지 않는다(2026-11 결정). 연차 원장·연차기간은 그대로다.
//  · **완전비율제** — 매출 기준이라 일할하지 않는다(입·퇴사 일할과 같은 규칙). 최저보장(만근 조건)은 관리자가 조정한다.
//    유급휴직 급여·휴업수당은 넣은 금액만큼 비율급 위에 따로 선다.
//  · **시급제** — 출퇴근 기록의 실근로시간으로 지급하므로 쉰 날은 원래 지급되지 않는다. 기록표 없이
//    어림잡은 달과 월 정액 수당(식대 등)만 같은 비율로 줄어든다.
//  · **통상시급** — 월 금액끼리 나눈 값이라 그대로다(연장·휴일·연차수당의 단가는 줄지 않는다).
//
// ## 퇴직급여(DC 부담금·충당금)
// 그 달 급여 기록에서 파생되므로(lib/severance-service.ts) 줄어든 만큼 함께 줄어든다. 유급휴직 급여·휴업수당은
// 임금이라 산정기준에 든다. 계약 추산으로 메우는 달(도입 이전)도 같은 계산을 쓴다(scripts/severance-migrate.ts).
// ⚠ 육아휴직·출산전후휴가, 사용자 귀책 휴업처럼 **평균임금 산정에서 빼는 기간**(근로기준법 시행령 §2①)은 이렇게
// 줄이면 부담금 미달이 된다 — 화면이 적는 주의(`UNPAID_SEVERANCE_NOTE`)를 볼 것. 그런 달은 퇴직급여 화면에서
// 기준급여를 직접 지정한다.

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

const dayNoOfYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
};
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

/** 월~금인가 — 공휴일은 가리지 않는다(평일에 든 공휴일은 유급휴일이라 센다) */
const isWeekdayNo = (n: number) => {
  const dow = dateOf(n).getUTCDay();
  return dow >= 1 && dow <= 5;
};
/** [lo, hi](둘 다 포함) 안의 평일(월~금) 수 */
function weekdaysWithin(lo: number, hi: number): number {
  let c = 0;
  for (let n = lo; n <= hi; n++) if (isWeekdayNo(n)) c += 1;
  return c;
}

/**
 * 원 단위 반올림 — **곱셈·나눗셈의 부동소수점 오차를 먼저 걷어낸다**(소수 6자리에서 한 번 반올림).
 * 통상시급은 나눗셈이라 2진수로 정확히 안 담긴다 — 참값이 ….5 인 금액이 ….4999999 로 나와 1원이 갈리는 일을 막는다
 * (`floor10`, lib/payroll.ts 과 같은 성질).
 */
const roundWon = (x: number) => (Number.isFinite(x) ? Math.round(Math.round(x * 1e6) / 1e6) : 0);

/** 시간 표기 — 소수 셋째 자리까지, 끝의 0 은 뗀다(93.852 · 209 · 3.6). `hoursLabel`(lib/format.ts)과 같다 */
const hoursText = (h: number) => String(Number((Number.isFinite(h) ? h : 0).toFixed(3)));

/* ───────────── 구분 ───────────── */

/** 휴직·휴업의 구분 — 저장은 문자열(`UnpaidLeave.kind`). 없거나 모르는 값은 무급휴직으로 읽는다 */
export type LeaveKind = "UNPAID" | "PAID" | "SHUTDOWN";
/** 급여가 따로 나가는 구분 */
export type PaidLeaveKind = "PAID" | "SHUTDOWN";

export const LEAVE_KINDS: readonly LeaveKind[] = ["UNPAID", "PAID", "SHUTDOWN"];

export const LEAVE_KIND_LABEL: Record<LeaveKind, string> = {
  UNPAID: "무급휴직",
  PAID: "유급휴직",
  SHUTDOWN: "휴업",
};

/** 그 기간에 따로 지급하는 돈의 이름 — 명세서의 지급 항목 */
export const LEAVE_PAY_LABEL: Record<PaidLeaveKind, string> = {
  PAID: "유급휴직 급여",
  SHUTDOWN: "휴업수당",
};

/** 구분을 가릴 수 없는 기록(구간 근거가 없는 옛 기록 등)의 지급 항목 이름 */
export const LEAVE_PAY_LABEL_ANY = "휴업수당·유급휴직 급여";

/** 모르는 값은 **무급휴직**이다 — v1.63 의 행에는 구분이 없다. 지어내 유급으로 읽으면 없는 돈이 나간다 */
export function leaveKindOf(v: unknown): LeaveKind {
  return v === "PAID" || v === "SHUTDOWN" ? v : "UNPAID";
}

export function isPaidLeaveKind(v: unknown): v is PaidLeaveKind {
  return v === "PAID" || v === "SHUTDOWN";
}

/** 휴업수당 비율의 기본값 — 근로기준법 §46① 의 「평균임금의 100분의 70」에서 온 숫자다 */
export const DEFAULT_SHUTDOWN_RATE = 0.7;
/** 유급휴직 비율의 기본값 — 급여를 그대로 주는 휴직 */
export const DEFAULT_PAID_LEAVE_RATE = 1;

/**
 * 비율 지급의 **산정 기준** — 「원급여의 70%」에서 원급여를 어떻게 내는가.
 *  · CALENDAR 역일수 기준   — 월 기준액 × 그 기간 역일수 ÷ 그 달 역일수 (주휴일·휴일 몫 포함)
 *  · WORKDAY  소정근로일 기준 — 통상시급 × 1일 환산시간(주 소정 ÷ 5) × 그 기간의 평일 수 (주휴일·토요일 몫 제외)
 * 저장은 문자열(`UnpaidLeave.payBasis`) — **없거나 모르는 값은 역일수 기준**이다(v1.64 의 행에는 기준이 없다.
 * 지어내 소정근로일 기준으로 읽으면 이미 산정한 금액이 달라진다).
 */
export type LeavePayBasis = "CALENDAR" | "WORKDAY";

export const LEAVE_PAY_BASES: readonly LeavePayBasis[] = ["CALENDAR", "WORKDAY"];

export const LEAVE_PAY_BASIS_LABEL: Record<LeavePayBasis, string> = {
  CALENDAR: "역일수 기준",
  WORKDAY: "소정근로일 기준",
};

export function leavePayBasisOf(v: unknown): LeavePayBasis {
  return v === "WORKDAY" ? "WORKDAY" : "CALENDAR";
}

/** 비율을 만분율(정수)로 — 0.7 → 7000. 소수 넷째 자리(% 로는 둘째 자리)까지만 쓴다 */
const rateBp = (rate: number) => Math.round(rate * 10000);

/** `70%` · `66.67%` */
export function ratePercentLabel(rate: number): string {
  return `${rateBp(rate) / 100}%`;
}

/**
 * 휴직·휴업 한 건 — 첫날과 마지막 날(둘 다 포함).
 *
 * 구분·지급 조건은 **없어도 된다** — 없으면 무급휴직이다(v1.63 의 행, 그리고 날짜만 세면 되는 자리).
 */
export interface UnpaidLeaveSpan {
  startDate: Date;
  endDate: Date;
  /** UNPAID | PAID | SHUTDOWN — 없으면 무급휴직 */
  kind?: string | null;
  /** 원급여 대비 지급 비율(0.7 = 70%) — 유급휴직·휴업을 비율로 줄 때 */
  payRate?: number | null;
  /** 직접 넣은 지급액(원) — **그 건 기간 전체의 총액**. 있으면 비율 대신 이 금액을 준다 */
  payAmount?: number | null;
  /** 비율 지급의 산정 기준 — "WORKDAY" 면 소정근로일 기준, 없으면 역일수 기준 */
  payBasis?: string | null;
}

/** 한 건을 어떻게 지급하는가 */
export type LeavePayTerms =
  | { mode: "NONE" }
  | { mode: "RATE"; rate: number; basis: LeavePayBasis }
  | { mode: "AMOUNT"; amount: number };

/**
 * 한 건의 지급 방식 — 무급 / 비율 / 금액 지정.
 *
 * **금액이 있으면 금액이 이긴다**(비율은 무시). 유급 구분인데 둘 다 없으면 비율 0% 로 읽는다 —
 * 지어내 채우지 않는다(등록 검사가 먼저 막는다. `unpaidLeaveError`).
 */
export function leavePayTermsOf(l: {
  kind?: unknown;
  payRate?: unknown;
  payAmount?: unknown;
  payBasis?: unknown;
}): LeavePayTerms {
  if (!isPaidLeaveKind(leaveKindOf(l.kind))) return { mode: "NONE" };
  const amount =
    typeof l.payAmount === "number" && Number.isFinite(l.payAmount) ? Math.round(l.payAmount) : 0;
  if (amount > 0) return { mode: "AMOUNT", amount };
  const rate = typeof l.payRate === "number" && Number.isFinite(l.payRate) ? l.payRate : 0;
  return {
    mode: "RATE",
    rate: Math.min(Math.max(rateBp(rate) / 10000, 0), 1),
    basis: leavePayBasisOf(l.payBasis),
  };
}

/**
 * 그 달 안으로 자른 휴직·휴업 구간 — `YYYY-MM-DD`, 둘 다 포함.
 *
 * **무급휴직 구간에는 `kind` 키가 없다** — v1.63 이 남긴 기록과 같은 모양이라 옛 기록·새 기록을 한 길로 읽는다.
 * 유급휴직·휴업 구간은 구분과 지급 조건을 함께 싣고, 산정을 거치면(`settleLeavePay`) 원급여·지급액이 붙는다.
 */
export interface UnpaidMonthSpan {
  from: string;
  to: string;
  days: number;
  /** 유급휴직·휴업일 때만 — 없으면 무급휴직 */
  kind?: PaidLeaveKind;
  /** 비율 지급 — 원급여 대비(0.7 = 70%) */
  rate?: number;
  /** 금액 지정 — **이 달 몫**(원) */
  amount?: number;
  /** 금액 지정 — 그 건 기간 전체의 금액(원). 이 달 몫과 다르면 달을 걸친 건이다 */
  amountTotal?: number;
  /**
   * 비율 지급의 산정 기준 — **소정근로일 기준일 때만** 있다. 없으면 역일수 기준이다
   * (v1.64 가 남긴 기록에는 이 키가 없다 — 그 기록의 지문·표기가 한 글자도 달라지지 않는다).
   */
  basis?: "WORKDAY";
  /** 소정근로일 기준 — 그 구간의 평일(월~금) 수. 날짜로 정해지므로 산정 전에도 있다 */
  workdays?: number;
  /** (산정 뒤) 그 구간의 원급여(원) — 비율 지급일 때. 소정근로일 기준이면 그 기간 평일분의 통상임금이다 */
  orig?: number;
  /** (산정 뒤) 원급여를 낸 월 기준액 — 역일수 기준이고 구간 안에서 계약 조건이 하나일 때만 */
  monthly?: number;
  /**
   * (산정 뒤) 소정근로일 기준의 재료 — 구간 안에서 계약 조건이 하나일 때만.
   * 통상시급 = `wage`(원) ÷ `hours`(시간), 1일 환산시간 = `dailyHours`. 명세서가 이 값으로 식을 적는다
   */
  wage?: number;
  hours?: number;
  dailyHours?: number;
  /** (산정 뒤) 이 달 지급액(원) */
  pay?: number;
}

/** 그 달의 지급 일수 */
export interface MonthPayDays {
  /** 그 달 역일수 (28~31) */
  daysInMonth: number;
  /** 그 달 재직 역일수 (입·퇴사일로 자른 것) */
  employedDays: number;
  /** 그중 휴직·휴업 역일수(**구분 무관**) — 정상 급여가 나가지 않는 날. 겹쳐 등록돼 있어도 한 번만 센다 */
  leaveDays: number;
  /** 그중 무급휴직 역일수 — 아무 돈도 나가지 않는 날 */
  unpaidDays: number;
  /**
   * **정상 급여**가 나가는 역일수 = 재직 − 휴직·휴업.
   * 유급휴직·휴업일은 여기에 들지 않는다 — 그 날의 돈은 따로 선다(`settleLeavePay` 의 `leavePay`).
   */
  paidDays: number;
  /** 정상 급여 지급 비율 = paidDays ÷ daysInMonth (0~1). 휴직·휴업이 없으면 재직비율과 같다 */
  ratio: number;
  /** 그 달에 걸친 구간(재직 기간 안으로 자른 것. 겹치거나 이어진 **무급휴직**은 합친다) */
  spans: UnpaidMonthSpan[];
}

interface Piece {
  from: number;
  to: number;
  /** 그 건의 첫날·마지막 날(자르기 전) — 금액 지정의 달별 몫을 내는 데 쓴다 */
  start: number;
  end: number;
  leaf: UnpaidLeaveSpan;
}

/**
 * [lo, hi] 안으로 자른 조각 — **하루는 한 건에만 준다**(먼저 시작한 건이 이긴다).
 *
 * 등록할 때 겹침을 막지만(`unpaidLeaveError`) 계산은 그 약속에 기대지 않는다 — 겹친 날을 두 번 세면
 * 급여가 두 번 빠지고 휴업수당이 두 번 나간다.
 */
function piecesWithin(leaves: UnpaidLeaveSpan[], lo: number, hi: number): Piece[] {
  const sorted = leaves
    .map((leaf, i) => ({ leaf, i, start: dayNo(leaf.startDate), end: dayNo(leaf.endDate) }))
    .filter((x) => x.start <= x.end)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.i - b.i);
  const out: Piece[] = [];
  let cursor = lo - 1;
  for (const x of sorted) {
    const from = Math.max(x.start, cursor + 1);
    const to = Math.min(x.end, hi);
    if (from > to) continue;
    out.push({ from, to, start: x.start, end: x.end, leaf: x.leaf });
    cursor = to;
  }
  return out;
}

/**
 * [from, to](둘 다 포함) 안의 휴직·휴업 역일수(**구분 무관**) — 겹친 등록은 한 번만 센다.
 * 월중 계약 변경 가중(`wageSegmentsFor`)이 구간마다 '정상 급여가 나가는 날' 만 세는 데 쓴다.
 */
export function leaveDaysBetween(from: Date, to: Date, leaves: UnpaidLeaveSpan[]): number {
  const lo = dayNo(from);
  const hi = dayNo(to);
  if (lo > hi || !leaves.length) return 0;
  return piecesWithin(leaves, lo, hi).reduce((a, s) => a + (s.to - s.from + 1), 0);
}

/**
 * 금액 지정의 조각 몫 — **누적 반올림**이라 조각들을 다 더하면 넣은 금액과 정확히 같다.
 * (달마다 따로 반올림하면 1원씩 남거나 모자란다.) 조각은 그 건의 `a`번째 날부터 `b`번째 날 앞까지다.
 */
function amountShare(total: number, a: number, b: number, length: number): number {
  if (length <= 0) return 0;
  return Math.round((total * b) / length) - Math.round((total * a) / length);
}

/**
 * 그 달 지급 일수와 비율, 그리고 그 달에 걸친 구간.
 *
 * 재직 기간이 없는 달은 전부 0 이다(휴직·휴업도 세지 않는다 — 재직하지 않은 날은 휴직일 수 없다).
 * 유급 구간의 **지급액은 여기서 정하지 않는다** — 비율 지급은 그 날짜의 계약 조건(원급여)이 있어야 하므로
 * `settleLeavePay` 가 맡는다. 금액 지정의 이 달 몫만은 날짜로 정해지므로 여기서 싣는다.
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
    return { daysInMonth, employedDays: 0, leaveDays: 0, unpaidDays: 0, paidDays: 0, ratio: 0, spans: [] };

  const employedDays = to - from + 1;
  const spans: UnpaidMonthSpan[] = [];
  // 무급휴직끼리 맞닿은 조각(11/10 끝 + 11/11 시작)은 한 덩어리로 — 명세서에 두 줄로 쪼개져 나갈 이유가 없다.
  // 유급 구간은 합치지 않는다 — 건마다 비율·금액이 다르다
  let lastUnpaidTo: number | null = null;
  let leaveDays = 0;
  let unpaidDays = 0;
  for (const p of piecesWithin(leaves, from, to)) {
    const days = p.to - p.from + 1;
    leaveDays += days;
    const kind = leaveKindOf(p.leaf.kind);
    if (!isPaidLeaveKind(kind)) {
      unpaidDays += days;
      const prev = spans[spans.length - 1];
      if (prev && !prev.kind && lastUnpaidTo != null && p.from <= lastUnpaidTo + 1) {
        prev.to = ymdOf(p.to);
        prev.days += days;
      } else spans.push({ from: ymdOf(p.from), to: ymdOf(p.to), days });
      lastUnpaidTo = p.to;
      continue;
    }
    lastUnpaidTo = null;
    const terms = leavePayTermsOf(p.leaf);
    const base = { from: ymdOf(p.from), to: ymdOf(p.to), days, kind };
    if (terms.mode === "AMOUNT")
      spans.push({
        ...base,
        amount: amountShare(terms.amount, p.from - p.start, p.to - p.start + 1, p.end - p.start + 1),
        amountTotal: terms.amount,
      });
    else if (terms.mode === "RATE" && terms.basis === "WORKDAY")
      spans.push({ ...base, rate: terms.rate, basis: "WORKDAY", workdays: weekdaysWithin(p.from, p.to) });
    else spans.push({ ...base, rate: terms.mode === "RATE" ? terms.rate : 0 });
  }
  const paidDays = employedDays - leaveDays;
  return {
    daysInMonth,
    employedDays,
    leaveDays,
    unpaidDays,
    paidDays,
    ratio: Math.min(Math.max(paidDays / daysInMonth, 0), 1),
    spans,
  };
}

/* ───────────── 유급휴직 급여·휴업수당 ───────────── */

/**
 * 한 계약 조건의 **원급여 재료** — 두 산정 기준이 쓰는 값을 함께 싣는다(`leaveWageBasis`, lib/payroll.ts).
 * 소정근로일 기준의 재료(`hourlyBase`·`hourlyHours`·`dailyHours`)가 없으면 그 기준은 0원이다(지어내지 않는다).
 */
export interface LeaveWageTerms {
  /** 월 기준액(원) — 역일수 기준의 원급여를 낸다 */
  monthly: number;
  /** 통상시급의 분자(원) — 월급제·인센티브: 월 지급 총액 − 경업금지 보상금. 시급제: 시급 */
  hourlyBase?: number;
  /** 통상시급의 분모(시간) — 월 유급시간(기본급 산정시간 + 1.5×약정 시간외 + 0.5×약정 야간). 시급제: 1 */
  hourlyHours?: number;
  /** 1일 환산 소정근로시간 = 주 소정근로시간 ÷ 5 (상한 8) */
  dailyHours?: number;
}

/** 그 달 안에서 한 계약 조건이 적용된 날짜 구간과, 그 조건의 원급여 재료 */
export interface WageBasisPiece extends LeaveWageTerms {
  from: string;
  to: string;
}

/** 지급액까지 정한 그 달 일수 */
export interface SettledPayDays extends MonthPayDays {
  /** 그 달 유급휴직 급여·휴업수당 합계(원) */
  leavePay: number;
}

const positive = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * 유급 구간의 **원급여와 지급액을 정한다**.
 *
 *   역일수 기준    : 원급여 = Σ(그 날짜의 월 기준액 × 날 수) ÷ 그 달 역일수
 *   소정근로일 기준 : 원급여 = Σ(그 날짜의 통상시급 × 1일 환산시간 × 평일 수),   통상시급 = hourlyBase ÷ hourlyHours
 *   지급액 = 원급여 × 지급 비율                                  (둘 다 원 단위 반올림)
 *
 * 지급액을 **반올림한 원급여에서** 낸다 — 명세서가 「원급여 1,500,000원 × 70% = 1,050,000원」을 그대로 적으므로
 * 손으로 다시 곱해도 같은 수가 나와야 한다. 비율은 만분율 정수로 곱해 부동소수점 오차가 끼지 않는다
 * (0.7 은 2진수로 정확히 안 담긴다 — floor10 에서 겪은 것과 같은 성질).
 * 소정근로일 기준의 통상시급은 **반올림하지 않고** 곱한다(원급여에서 한 번만 반올림) — 34,096.24원을 34,096원으로
 * 먼저 자르면 16일치에 9원이 빠진다. 식은 「월 3,200,000원 ÷ 93.852시간 × …」으로 적어 그대로 다시 계산된다.
 *
 * `pieces` 는 그 달의 계약 구간이다(월중에 계약이 바뀌면 둘 이상). 덮이지 않은 날은 `fallback` 으로 센다
 * (숫자를 넘기면 월 기준액만 아는 것이다 — 소정근로일 기준 구간은 0원이 된다).
 * 금액 지정 구간은 `monthPayDays` 가 실어 둔 이 달 몫이 곧 지급액이다(계약과 무관).
 */
export function settleLeavePay(
  pd: MonthPayDays,
  pieces: WageBasisPiece[],
  fallback: number | LeaveWageTerms
): SettledPayDays {
  const D = pd.daysInMonth;
  const whole = (n: number) => (Number.isFinite(n) ? Math.max(Math.round(n), 0) : 0);
  const fb: LeaveWageTerms = typeof fallback === "number" ? { monthly: fallback } : fallback;
  const ranges = pieces.map((p) => ({ lo: dayNoOfYmd(p.from), hi: dayNoOfYmd(p.to), terms: p as LeaveWageTerms }));
  let leavePay = 0;
  const spans = pd.spans.map((s): UnpaidMonthSpan => {
    if (!s.kind) return s;
    if (s.amount != null) {
      leavePay += s.amount;
      return { ...s, pay: s.amount };
    }
    const lo = dayNoOfYmd(s.from);
    const hi = dayNoOfYmd(s.to);
    const bp = rateBp(s.rate ?? 0);

    if (s.basis === "WORKDAY") {
      // 평일마다 그 날짜의 계약 조건을 찾는다(먼저 덮은 구간이 이긴다). 같은 조건끼리 날 수를 모아 한 번에 곱한다 —
      // 하루씩 더하면 같은 값을 열여섯 번 더하는 사이 끝자리가 흔들린다
      const groups = new Map<string, { t: LeaveWageTerms; n: number }>();
      let workdays = 0;
      for (let n = lo; n <= hi; n++) {
        if (!isWeekdayNo(n)) continue;
        workdays += 1;
        const t = ranges.find((r) => r.lo <= n && n <= r.hi)?.terms ?? fb;
        const key = `${positive(t.hourlyBase)}|${positive(t.hourlyHours)}|${positive(t.dailyHours)}`;
        const g = groups.get(key);
        if (g) g.n += 1;
        else groups.set(key, { t, n: 1 });
      }
      let sum = 0;
      for (const { t, n } of groups.values()) {
        const wage = positive(t.hourlyBase);
        const hours = positive(t.hourlyHours);
        const daily = positive(t.dailyHours);
        if (wage && hours && daily) sum += (wage * daily * n) / hours;
      }
      const orig = roundWon(sum);
      const pay = Math.round((orig * bp) / 10000);
      leavePay += pay;
      const only = groups.size === 1 ? [...groups.values()][0].t : null;
      const usable = only && positive(only.hourlyBase) && positive(only.hourlyHours) && positive(only.dailyHours);
      return {
        ...s,
        workdays,
        orig,
        ...(usable
          ? { wage: positive(only.hourlyBase), hours: positive(only.hourlyHours), dailyHours: positive(only.dailyHours) }
          : {}),
        pay,
      };
    }

    let covered = 0;
    let sum = 0;
    const monthlies = new Set<number>();
    for (const p of ranges) {
      const a = Math.max(lo, p.lo);
      const b = Math.min(hi, p.hi);
      if (a > b) continue;
      const n = Math.min(b - a + 1, s.days - covered);
      if (n <= 0) continue;
      const m = whole(p.terms.monthly);
      covered += n;
      sum += m * n;
      monthlies.add(m);
    }
    if (covered < s.days) {
      const m = whole(fb.monthly);
      sum += m * (s.days - covered);
      monthlies.add(m);
    }
    const orig = D > 0 ? Math.round(sum / D) : 0;
    const pay = Math.round((orig * bp) / 10000);
    leavePay += pay;
    return { ...s, orig, ...(monthlies.size === 1 ? { monthly: [...monthlies][0] } : {}), pay };
  });
  return { ...pd, spans, leavePay };
}

/**
 * **비율 지급인데 원급여가 0 이라 0원으로 산정된 구간이 있는가.**
 *
 * 완전비율제(매출 기준이라 월 급여가 없다)이거나 시급제인데 근로시간표가 비어 있으면 원급여를 낼 수 없다.
 * 등록 검사가 대개 먼저 막지만(직원 카드 기준), 그 달의 계약이 카드와 다르면 지나올 수 있다 — 그때 조용히
 * 0원이 나가지 않게 급여 화면이 그 행에 띄운다. 0% 로 등록한 휴업(휴업수당 없는 휴업)은 해당하지 않는다.
 */
export function leaveZeroBasis(m: { spans: UnpaidMonthSpan[] } | null | undefined): boolean {
  return !!m?.spans.some(
    (s) =>
      s.kind &&
      s.amount == null &&
      rateBp(s.rate ?? 0) > 0 &&
      s.orig != null &&
      s.orig <= 0 &&
      // 소정근로일 기준인데 그 구간에 평일이 하루도 없으면(주말뿐) 0원이 맞다 — 원급여를 못 낸 것이 아니다
      !(s.basis === "WORKDAY" && (s.workdays ?? 0) <= 0)
  );
}

/** 산정 근거에 남기는 한 줄 — 위의 경우 */
export const LEAVE_ZERO_BASIS_NOTE =
  "⚠️ 유급휴직·휴업을 원급여 대비 비율로 지급하도록 등록돼 있지만 원급여를 계산할 수 없어 0원으로 산정했습니다" +
  "(완전비율제이거나, 시급제 근로시간표가 비어 있거나, 소정근로일 기준인데 근로시간표가 비어 있습니다) — " +
  "직원 상세의 휴직·휴업에서 금액을 직접 넣어 주세요.";

/* ───────────── 급여 기록에 남기는 근거 ───────────── */

/**
 * 그 달 산정에 실제로 쓴 휴직·휴업 — 급여 기록의 `breakdown.unpaidLeave` 에 남긴다
 * (키 이름은 v1.63 그대로다 — 이미 저장된 기록을 읽어야 한다).
 *
 * 명세서·세무 자료·화면이 **지금의 등록이 아니라 이 값**을 읽는다 — 산정한 뒤에 기간·비율을 고쳐도
 * 이미 산정한 달의 문서가 따라 바뀌지 않는다(다시 산정하면 그때 등록을 따른다).
 */
export interface UnpaidLeaveMeta {
  /** 그 달 휴직·휴업 역일수(구분 무관). v1.63 기록에서는 무급휴직 역일수다 */
  days: number;
  daysInMonth: number;
  employedDays: number;
  /** 정상 급여가 나간 역일수 */
  paidDays: number;
  spans: UnpaidMonthSpan[];
  /** 유급휴직 급여·휴업수당 합계(원) — 유급 구간이 있는 달만 */
  leavePay?: number;
}

/** 휴직·휴업이 없는 달은 null — 근거를 남기지 않는다(그런 달의 기록은 예전과 한 글자도 다르지 않다) */
export function unpaidLeaveMetaOf(pd: MonthPayDays | SettledPayDays): UnpaidLeaveMeta | null {
  if (pd.leaveDays <= 0) return null;
  const settled = "leavePay" in pd && pd.spans.some((s) => s.kind);
  return {
    days: pd.leaveDays,
    daysInMonth: pd.daysInMonth,
    employedDays: pd.employedDays,
    paidDays: pd.paidDays,
    spans: pd.spans,
    ...(settled ? { leavePay: (pd as SettledPayDays).leavePay } : {}),
  };
}

const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 저장된 산출 근거(JSON 문자열 또는 이미 푼 객체)에서 휴직·휴업 근거를 읽는다. 없거나 모양이 다르면 null */
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
        .map((s: any): UnpaidMonthSpan => {
          const base: UnpaidMonthSpan = { from: s.from, to: s.to, days: num(s.days) ?? 0 };
          // 구분이 없는 구간은 무급휴직이다(v1.63 기록) — 지급 조건을 읽지 않는다
          if (!isPaidLeaveKind(s.kind)) return base;
          const opt = (
            k: "rate" | "amount" | "amountTotal" | "workdays" | "orig" | "monthly" | "wage" | "hours" | "dailyHours" | "pay"
          ) => {
            const v = num(s[k]);
            return v != null && v >= 0 ? { [k]: v } : {};
          };
          // 기준 키가 없는 구간은 역일수 기준이다(v1.64 기록) — 소정근로일 기준의 재료를 읽지 않는다
          const workday = s.basis === "WORKDAY";
          return {
            ...base,
            kind: s.kind,
            ...opt("rate"),
            ...opt("amount"),
            ...opt("amountTotal"),
            ...(workday ? { basis: "WORKDAY" as const, ...opt("workdays") } : {}),
            ...opt("orig"),
            ...opt("monthly"),
            ...(workday ? { ...opt("wage"), ...opt("hours"), ...opt("dailyHours") } : {}),
            ...opt("pay"),
          };
        })
    : [];
  const employedDays = num(m.employedDays) ?? daysInMonth;
  const leavePay = num(m.leavePay);
  return {
    days,
    daysInMonth,
    employedDays,
    paidDays: num(m.paidDays) ?? Math.max(employedDays - days, 0),
    spans,
    ...(leavePay != null && leavePay >= 0 ? { leavePay } : {}),
  };
}

/**
 * 구간의 지문 — 산정 때 쓴 것과 지금 등록된 것이 같은지 견주는 데만 쓴다.
 *
 * 무급휴직은 날짜만(v1.63 기록과 같은 지문이라 옛 기록이 '바뀌었다' 로 읽히지 않는다),
 * 유급 구간은 **구분과 지급 조건까지** 본다 — 날짜는 그대로인데 70% 를 100% 로 고친 것도 다시 산정해야 한다.
 * 금액 지정은 이 달 몫으로 견준다(기간을 늘리면서 총액을 맞춰 이 달 몫이 그대로면 이 달은 손댈 것이 없다).
 * 산정 결과(원급여·지급액)는 지문에 넣지 않는다 — 계약이 바뀌어 달라지는 것은 계약 수정의 몫이다.
 * **산정 기준도 본다** — 같은 70% 라도 역일수 기준(`r7000`)과 소정근로일 기준(`w7000`)은 금액이 다르다.
 * 역일수 기준의 지문은 v1.64 와 같다(그때 산정한 기록이 '바뀌었다' 로 읽히지 않는다).
 */
const signatureOf = (s: UnpaidMonthSpan) =>
  `${s.from}~${s.to}` +
  (s.kind
    ? `:${s.kind}:${
        s.amount != null
          ? `a${Math.round(s.amount)}`
          : `${s.basis === "WORKDAY" ? "w" : "r"}${rateBp(s.rate ?? 0)}`
      }`
    : "");
const signature = (spans: UnpaidMonthSpan[]) => spans.map(signatureOf).join(",");

/**
 * **산정한 뒤에 휴직·휴업이 바뀌었는가** — 급여 화면이 이 행을 「다시 산정 필요」로 띄운다.
 *
 * 등록·수정·삭제해도 이미 만들어 둔 급여 기록은 저절로 바뀌지 않는다(계약 수정과 같다 —
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

const kindOfSpan = (s: UnpaidMonthSpan): LeaveKind => s.kind ?? "UNPAID";

/** 구간을 구분별로 묶는다 — 처음 나온 순서대로 */
export function leaveSpansByKind(
  spans: UnpaidMonthSpan[]
): Array<{ kind: LeaveKind; spans: UnpaidMonthSpan[]; days: number }> {
  const out: Array<{ kind: LeaveKind; spans: UnpaidMonthSpan[]; days: number }> = [];
  for (const s of spans) {
    const kind = kindOfSpan(s);
    let g = out.find((x) => x.kind === kind);
    if (!g) out.push((g = { kind, spans: [], days: 0 }));
    g.spans.push(s);
    g.days += s.days;
  }
  return out;
}

/**
 * 이 달을 무엇이라 부르는가 — 무급휴직만이면 「무급휴직」, 유급휴직·휴업이 끼면 그 이름, 섞이면 「휴직·휴업」.
 * 화면의 배지·안내가 '무급휴직' 이라고만 적으면 휴업수당이 걸린 달을 급여 없는 달로 읽는다.
 */
export function leaveWordOf(...metas: Array<{ spans: UnpaidMonthSpan[] } | null | undefined>): string {
  const kinds = new Set<LeaveKind>();
  for (const m of metas) for (const s of m?.spans ?? []) kinds.add(kindOfSpan(s));
  if (kinds.size === 1) return LEAVE_KIND_LABEL[[...kinds][0]];
  return kinds.size ? "휴직·휴업" : LEAVE_KIND_LABEL.UNPAID;
}

/** 유급 구간 묶음의 지급 표기 — 산정을 거쳤으면 금액, 아니면 조건만 */
function leavePayPhrase(kind: PaidLeaveKind, spans: UnpaidMonthSpan[]): string {
  const byAmount = spans.every((s) => s.amount != null);
  const byRate = spans.every((s) => s.amount == null);
  const oneRate = byRate && new Set(spans.map((s) => rateBp(s.rate ?? 0))).size === 1;
  const rate = spans[0]?.rate ?? 0;
  // 0% 는 돈이 나가지 않는 휴업이다 — 「휴업수당 0원」보다 「무급」이 바로 읽힌다
  if (oneRate && rateBp(rate) === 0) return "무급(0%)";
  // 소정근로일 기준으로만 낸 묶음 — 같은 70% 라도 역일수 기준과 금액이 달라 기준을 함께 적는다.
  // (역일수 기준의 표기는 v1.64 와 한 글자도 다르지 않다)
  const allWorkday = byRate && spans.every((s) => s.basis === "WORKDAY");
  const workdays = spans.reduce((a, s) => a + (s.workdays ?? 0), 0);
  if (spans.every((s) => s.pay != null)) {
    const total = spans.reduce((a, s) => a + (s.pay ?? 0), 0);
    return (
      `${LEAVE_PAY_LABEL[kind]} ${won(total)}` +
      (oneRate
        ? allWorkday
          ? `(통상임금의 ${ratePercentLabel(rate)} · 평일 ${workdays}일)`
          : `(${ratePercentLabel(rate)})`
        : byAmount
          ? "(금액 지정)"
          : "")
    );
  }
  if (oneRate)
    return allWorkday
      ? `통상임금의 ${ratePercentLabel(rate)} 지급(소정근로일 기준 · 평일 ${workdays}일)`
      : `원급여의 ${ratePercentLabel(rate)} 지급`;
  if (byAmount) return `${won(spans.reduce((a, s) => a + (s.amount ?? 0), 0))} 지급(금액 지정)`;
  return "";
}

/**
 * 세무사무소 제출자료 비고 · 화면의 한 줄.
 *
 *   무급휴직 11/16~11/30(15일)
 *   휴업 11/16~11/30(15일) 휴업수당 1,050,000원(70%)
 *   무급휴직 11/3(1일) · 유급휴직 11/10~11/14(5일) 유급휴직 급여 400,000원(금액 지정)
 *   휴업 11/7~11/30(24일) 휴업수당 1,374,760원(통상임금의 70% · 평일 16일)          ← 소정근로일 기준
 *
 * 산정을 거치지 않은 구간(지금 등록을 그대로 보일 때)은 금액 대신 조건을 적는다 — 「원급여의 70% 지급」.
 */
export function unpaidLeaveNote(m: UnpaidLeaveMeta): string {
  const groups = leaveSpansByKind(m.spans);
  // 구간이 남지 않은 기록 — 일수만 안다
  if (!groups.length) return `${LEAVE_KIND_LABEL.UNPAID} ${m.days}일`;
  const only = groups.length === 1;
  return groups
    .map((g) => {
      const head = `${LEAVE_KIND_LABEL[g.kind]} ${unpaidSpansLabel(g.spans)}(${only ? m.days : g.days}일)`;
      if (!isPaidLeaveKind(g.kind)) return head;
      const pay = leavePayPhrase(g.kind, g.spans);
      return pay ? `${head} ${pay}` : head;
    })
    .join(" · ");
}

/** 그 달에 따로 지급한 유급휴직 급여·휴업수당 — 「휴업수당 1,050,000원」. 없으면 "" */
function leavePaySummary(m: UnpaidLeaveMeta): string {
  const parts = leaveSpansByKind(m.spans)
    .filter((g) => isPaidLeaveKind(g.kind))
    .map((g) => [g.kind as PaidLeaveKind, g.spans.reduce((a, s) => a + (s.pay ?? 0), 0)] as const)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${LEAVE_PAY_LABEL[k]} ${won(v)}`);
  return parts.join(" · ");
}

/** 급여 엔진의 산정 근거 한 줄 — 급여형태에 따라 '무엇이 줄었는지' 가 다르다 */
export function unpaidLeaveCalcNote(
  m: UnpaidLeaveMeta,
  kind: "PRORATED" | "RATIO" | "HOURLY_ACTUAL"
): string {
  const head = `${unpaidLeaveNote(m)}`;
  const paid = leavePaySummary(m);
  // 유급 구간이 있는 달 — 정상 급여와 따로 나간 돈을 갈라 적는다
  const extra = paid ? ` ${paid}을 따로 지급합니다.` : "";
  const hasPaidKind = m.spans.some((s) => s.kind);
  if (kind === "RATIO")
    return (
      `${head} — 완전비율제는 매출 기준이라 ${hasPaidKind ? "비율급은 " : ""}일할하지 않습니다. ` +
      `최저보장(만근 조건)이 있으면 관리자가 조정해 주세요.` +
      extra
    );
  if (kind === "HOURLY_ACTUAL")
    return (
      `${head} — 시급제는 출퇴근 기록의 실근로시간으로 지급합니다(쉰 날은 근로시간이 없습니다). ` +
      `월 정액 수당만 ${m.paidDays}/${m.daysInMonth} 로 일할했습니다.` +
      extra
    );
  return (
    `${head} — ${hasPaidKind ? "정상 급여는 " : ""}역일수 일할: 지급 대상 ${m.paidDays}일 ÷ ${m.daysInMonth}일 ` +
    `= ${((m.paidDays / m.daysInMonth) * 100).toFixed(1)}%` +
    (m.employedDays < m.daysInMonth ? ` (그 달 재직 ${m.employedDays}일 중)` : "") +
    (extra ? `.${extra}` : "")
  );
}

/**
 * 명세서의 지급 항목 줄 — `[이름, 금액]`.
 *
 * 구분별로 갈라 적는다(휴업수당 / 유급휴직 급여). 기록의 구간 근거와 지급액이 맞지 않으면(근거가 없는 기록,
 * 손으로 고친 기록) **지어내 가르지 않고** 한 줄로 적는다 — 줄을 더했을 때 지급액 계와 어긋나면 안 된다.
 */
export function leavePayRows(m: UnpaidLeaveMeta | null, leavePayP: number): Array<[string, number]> {
  if (!leavePayP) return [];
  const rows = leaveSpansByKind(m?.spans ?? [])
    .filter((g) => isPaidLeaveKind(g.kind))
    .map((g): [string, number] => [
      LEAVE_PAY_LABEL[g.kind as PaidLeaveKind],
      g.spans.reduce((a, s) => a + (s.pay ?? 0), 0),
    ])
    .filter(([, v]) => v !== 0);
  const sum = rows.reduce((a, [, v]) => a + v, 0);
  return rows.length && sum === leavePayP ? rows : [[LEAVE_PAY_LABEL_ANY, leavePayP]];
}

/**
 * 명세서 「산출 근거」가 소정근로일 기준 구간 아래에 한 번 적는 풀이 — 「통상임금」「평일 16일」이 무엇인지.
 * 직원이 읽는 문서라 계산 방식만 적는다(법적 판단·주의는 관리자 화면의 몫이다 — `LEAVE_WORKDAY_BASIS_NOTE`).
 */
export const LEAVE_WORKDAY_PAYSLIP_NOTE =
  "통상임금은 통상시급(월 급여 ÷ 월 유급시간)에 1일 환산 소정근로시간(주 소정근로시간 ÷ 5)과 " +
  "그 기간의 평일(월~금. 평일에 든 공휴일 포함) 수를 곱한 금액입니다.";

/** 소정근로일 기준으로 낸 구간이 있는가 — 명세서가 위 풀이를 붙일지 정한다 */
export function hasWorkdayBasis(m: { spans: UnpaidMonthSpan[] } | null | undefined): boolean {
  return !!m?.spans.some((s) => s.kind && s.amount == null && s.basis === "WORKDAY" && rateBp(s.rate ?? 0) > 0);
}

/**
 * 통상시급을 낸 식 — `월 3,200,000원 ÷ 93.852시간`. 시급제는 나눌 것이 없어 `시급 12,000원`.
 * 화면의 미리보기와 명세서가 같은 표기를 쓴다.
 */
export function workdayWageText(wage: number, hours: number): string {
  return hours === 1 ? `시급 ${won(wage)}` : `월 ${won(wage)} ÷ ${hoursText(hours)}시간`;
}

/**
 * 명세서 「산출 근거」에 적는 유급 구간의 계산식 — 구간마다 한 줄.
 *
 *   휴업수당 — 11월 16일 ~ 11월 30일(15일): 원급여 1,500,000원(월 3,000,000원 × 15/30일) × 70% = 1,050,000원
 *   유급휴직 급여 — 11월 10일 ~ 11월 14일(5일): 400,000원(지정한 금액)
 *   휴업수당 — 11월 7일 ~ 11월 30일(24일): 통상임금 1,963,943원(월 3,200,000원 ÷ 93.852시간 × 1일 3.6시간 × 평일 16일) × 70% = 1,374,760원
 *
 * 소정근로일 기준의 식은 **통상시급을 반올림해 적지 않는다** — 「월 금액 ÷ 시간」을 그대로 적어야 손으로 다시
 * 계산해도 같은 수가 나온다(34,096원으로 적으면 16일치에 9원이 어긋난다).
 */
export function leavePayDetailLines(m: UnpaidLeaveMeta): string[] {
  const out: string[] = [];
  for (const s of m.spans) {
    if (!s.kind) continue;
    const when = `${unpaidSpansLabelKo([s])}(${s.days}일)`;
    const label = LEAVE_PAY_LABEL[s.kind];
    if (s.amount != null) {
      const whole =
        s.amountTotal != null && s.amountTotal !== s.amount
          ? `지정한 금액 — 기간 전체 ${won(s.amountTotal)} 중 이 달 몫`
          : "지정한 금액";
      out.push(`${label} — ${when}: ${won(s.pay ?? s.amount)}(${whole})`);
      continue;
    }
    const rate = s.rate ?? 0;
    if (rateBp(rate) === 0) {
      out.push(`${LEAVE_KIND_LABEL[s.kind]} — ${when}: ${label} 없음(지급 비율 0%)`);
      continue;
    }
    if (s.basis === "WORKDAY") {
      const n = s.workdays ?? 0;
      if (s.orig == null || s.pay == null) {
        out.push(`${label} — ${when}: 통상임금의 ${ratePercentLabel(rate)}(소정근로일 기준 · 평일 ${n}일)`);
        continue;
      }
      const how =
        s.wage != null && s.hours != null && s.dailyHours != null
          ? `${workdayWageText(s.wage, s.hours)} × 1일 ${hoursText(s.dailyHours)}시간 × 평일 ${n}일`
          : n > 0
            ? `기간 중 계약이 바뀌어 날짜별 통상시급 × 1일 환산시간 × 평일 ${n}일로 계산`
            : `평일 ${n}일`;
      out.push(`${label} — ${when}: 통상임금 ${won(s.orig)}(${how}) × ${ratePercentLabel(rate)} = ${won(s.pay)}`);
      continue;
    }
    if (s.orig == null || s.pay == null) {
      out.push(`${label} — ${when}: 원급여의 ${ratePercentLabel(rate)}`);
      continue;
    }
    const how =
      s.monthly != null
        ? `월 ${won(s.monthly)} × ${s.days}/${m.daysInMonth}일`
        : `기간 중 계약이 바뀌어 날짜별 월 급여를 역일수로 계산`;
    out.push(`${label} — ${when}: 원급여 ${won(s.orig)}(${how}) × ${ratePercentLabel(rate)} = ${won(s.pay)}`);
  }
  return out;
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

/** 금액 지정의 상한 — 자릿수를 잘못 친 값(0 이 두 개 더 붙은 것)을 거른다 */
export const LEAVE_PAY_AMOUNT_MAX = 100_000_000;

/** 화면·API 가 보내는 한 건 */
export interface LeaveInput {
  startDate: unknown;
  endDate: unknown;
  reason?: unknown;
  /** 없으면 무급휴직 */
  kind?: unknown;
  /** 원급여 대비 비율(0.7 = 70%) — **화면은 % 로 받고 API 는 비율로 받는다**(위탁 비율과 같다) */
  payRate?: unknown;
  /** 그 건 기간 전체의 지급액(원) */
  payAmount?: unknown;
  /** 비율 지급의 산정 기준 — CALENDAR(역일수) | WORKDAY(소정근로일). 없으면 역일수 기준 */
  payBasis?: unknown;
}

const blank = (v: unknown) => v == null || v === "";

/**
 * 저장할 구분·지급 조건을 한 가지 모양으로 — 신규 등록과 수정이 같은 함수를 쓴다.
 *
 * 무급휴직이면 비율·금액을 지운다(유급휴직을 무급으로 바꿨는데 옛 비율이 남으면, 다시 유급으로 돌릴 때
 * 보이지 않던 값이 되살아난다). 금액 지정이면 비율을, 비율 지급이면 금액을 지운다 — 둘 다 남으면
 * 어느 쪽으로 지급했는지 기록만 보고 알 수 없다.
 * **산정 기준은 비율 지급에만 뜻이 있다** — 무급휴직·금액 지정이면 지운다. 역일수 기준은 null 로 둔다
 * (v1.64 의 행과 같은 모양 — 기준이 없으면 역일수 기준이다).
 */
export function normalizeLeaveTerms(input: {
  kind?: unknown;
  payRate?: unknown;
  payAmount?: unknown;
  payBasis?: unknown;
}): {
  kind: LeaveKind;
  payRate: number | null;
  payAmount: number | null;
  payBasis: "WORKDAY" | null;
} {
  const kind = leaveKindOf(input.kind);
  const terms = leavePayTermsOf({
    kind,
    payRate: input.payRate,
    payAmount: input.payAmount,
    payBasis: input.payBasis,
  });
  if (terms.mode === "AMOUNT") return { kind, payRate: null, payAmount: terms.amount, payBasis: null };
  if (terms.mode === "RATE")
    return { kind, payRate: terms.rate, payAmount: null, payBasis: terms.basis === "WORKDAY" ? "WORKDAY" : null };
  return { kind, payRate: null, payAmount: null, payBasis: null };
}

/**
 * 휴직·휴업 등록·수정 검사 — **화면과 서버가 같은 함수**를 쓴다.
 *
 * 겹치는 등록을 막는다(구분이 달라도). 계산은 겹쳐도 같은 날을 한 번만 세지만, 겹친 채 두면 한 건을 지워도
 * 그 날들이 여전히 쉬는 날로 남아 '지웠는데 왜 그대로냐' 가 된다.
 */
export function unpaidLeaveError(
  input: LeaveInput,
  ctx: {
    hireDate: Date;
    resignDate?: Date | null;
    /** 위탁계약(프리랜서) — `isContractorContract()` 결과 */
    contractor: boolean;
    /** 완전비율제(근로계약) — 원급여가 매출에 달려 비율 지급을 쓸 수 없다 */
    ratio?: boolean;
    /** 근로시간표가 비어 있다(주 소정근로시간 0) — 소정근로일 기준의 1일 환산시간·통상시급을 낼 수 없다 */
    noSchedule?: boolean;
    /** 같은 직원의 다른 휴직·휴업(수정이면 자기 자신은 뺀다) */
    others: UnpaidLeaveSpan[];
  }
): string | null {
  if (ctx.contractor)
    return (
      "위탁계약(프리랜서)은 근로자가 아니라 무급휴직·유급휴직·휴업 대상이 아닙니다 — " +
      "지급액은 계약의 시급·비율로만 정해집니다."
    );
  if (!blank(input.kind) && !(LEAVE_KINDS as readonly unknown[]).includes(input.kind))
    return "구분은 무급휴직·유급휴직·휴업 중에서 골라 주세요.";
  if (!blank(input.payBasis) && !(LEAVE_PAY_BASES as readonly unknown[]).includes(input.payBasis))
    return "산정 기준은 역일수 기준·소정근로일 기준 중에서 골라 주세요.";
  const kind = leaveKindOf(input.kind);
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
      `이미 등록된 ${LEAVE_KIND_LABEL[leaveKindOf(hit.kind)]}(${ymdOf(dayNo(hit.startDate))} ~ ` +
      `${ymdOf(dayNo(hit.endDate))})과 겹칩니다 — 그 건을 고치거나 지운 뒤 다시 넣어 주세요.`
    );

  // ── 유급휴직·휴업의 지급 조건 — 비율과 금액 중 **하나만** ──
  if (isPaidLeaveKind(kind)) {
    // 조사가 갈린다 — 「휴업수당은·을」 / 「유급휴직 급여는·를」
    const label = LEAVE_PAY_LABEL[kind];
    const [topic, object] = kind === "PAID" ? [`${label}는`, `${label}를`] : [`${label}은`, `${label}을`];
    const hasRate = !blank(input.payRate);
    const hasAmount = !blank(input.payAmount);
    if (hasRate && hasAmount)
      return `${topic} 지급 비율과 금액 중 하나만 정해 주세요 — 둘 다 있으면 어느 쪽으로 줄지 알 수 없습니다.`;
    if (!hasRate && !hasAmount)
      return (
        `${object} 어떻게 줄지 정해 주세요 — 원급여 대비 지급 비율(%)을 고르거나 금액을 직접 넣습니다.` +
        (kind === "SHUTDOWN" ? " 휴업수당 없이 쉬는 휴업이면 비율을 0% 로 넣습니다." : "")
      );
    if (hasAmount) {
      const a = input.payAmount;
      if (typeof a !== "number" || !Number.isFinite(a) || !Number.isInteger(a) || a <= 0)
        return "지급 금액은 1원 이상의 정수(원)로 넣어 주세요.";
      if (a > LEAVE_PAY_AMOUNT_MAX)
        return `지급 금액이 너무 큽니다(${LEAVE_PAY_AMOUNT_MAX.toLocaleString()}원 초과) — 자릿수를 확인해 주세요.`;
    } else {
      const r = input.payRate;
      if (typeof r !== "number" || !Number.isFinite(r) || r < 0 || r > 1)
        return "지급 비율은 0% ~ 100% 사이로 넣어 주세요.";
      if (Math.abs(r * 10000 - Math.round(r * 10000)) > 1e-6)
        return "지급 비율은 소수 둘째 자리(%)까지만 넣을 수 있습니다.";
      // 유급휴직의 0% 는 무급휴직이다 — 구분과 내용이 어긋난 채 저장되지 않게 한다
      if (kind === "PAID" && Math.round(r * 10000) === 0)
        return "유급휴직인데 지급 비율이 0% 입니다 — 급여가 없는 휴직이면 구분을 무급휴직으로 골라 주세요.";
      if (ctx.ratio)
        return (
          "완전비율제는 급여가 매출에 달려 있어 원급여가 정해져 있지 않습니다 — " +
          "비율 대신 지급할 금액을 직접 넣어 주세요."
        );
      // 소정근로일 기준은 근로시간표가 있어야 한다 — 없는 채로 받으면 조용히 0원이 산정된다.
      // 0% 휴업은 어느 기준이든 0원이라 묻지 않는다
      if (leavePayBasisOf(input.payBasis) === "WORKDAY" && ctx.noSchedule && Math.round(r * 10000) > 0)
        return (
          "소정근로일 기준은 근로시간표(주 소정근로시간)로 통상시급과 1일 환산시간을 계산합니다 — " +
          "직원 정보에 근로시간표를 채우거나, 역일수 기준 또는 금액 직접 입력을 써 주세요."
        );
    }
  }

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

/**
 * 한 건의 지급 조건만 — `원급여의 70%` / `통상임금의 70%(소정근로일 기준)` / `800,000원(금액 지정)` / `무급(0%)`.
 * 무급휴직은 ""
 */
export function leavePayTermsLabel(l: {
  kind?: unknown;
  payRate?: unknown;
  payAmount?: unknown;
  payBasis?: unknown;
}): string {
  const terms = leavePayTermsOf(l);
  if (terms.mode === "AMOUNT") return `${won(terms.amount)}(금액 지정)`;
  if (terms.mode === "RATE") {
    if (rateBp(terms.rate) === 0) return "무급(0%)";
    return terms.basis === "WORKDAY"
      ? `통상임금의 ${ratePercentLabel(terms.rate)}(소정근로일 기준)`
      : `원급여의 ${ratePercentLabel(terms.rate)}`;
  }
  return "";
}

/** 한 건의 한 줄 요약 — 작업 이력·목록. `휴업 · 원급여의 70%` / `유급휴직 · 800,000원(금액 지정)` / `무급휴직` */
export function leaveTermsLabel(l: {
  kind?: unknown;
  payRate?: unknown;
  payAmount?: unknown;
  payBasis?: unknown;
}): string {
  const kind = LEAVE_KIND_LABEL[leaveKindOf(l.kind)];
  const pay = leavePayTermsLabel(l);
  return pay ? `${kind} · ${pay}` : kind;
}

/* ───────────── 화면이 함께 적는 주의 ───────────── */

/**
 * 등록 창이 적는 안내 — 무엇이 바뀌고 무엇이 안 바뀌는지.
 * 조용히 줄어드는 돈이 있으므로(급여·퇴직급여) 등록하는 자리에서 먼저 읽히게 한다.
 */
export const UNPAID_LEAVE_EFFECT_NOTE =
  "등록한 기간만큼 그 달 정상 급여가 역일수로 일할됩니다(월중 입·퇴사와 같은 방식 — 기본급과 월 정액 수당). " +
  "유급휴직·휴업은 그 기간의 급여를 원급여 대비 비율이나 직접 넣은 금액으로 따로 지급합니다(명세서에 " +
  "「유급휴직 급여」·「휴업수당」으로 적힙니다). 연차 발생·근속은 바뀌지 않습니다. " +
  "이미 산정해 둔 달은 급여 화면에서 「급여 일괄 산정」을 다시 눌러야 반영됩니다.";

/**
 * 원급여가 무엇인지 — 비율을 고르는 자리에서 함께 적는다.
 * '원급여의 70%' 가 무엇의 70% 인지 모르면 금액을 보고도 맞는지 판단할 수 없다.
 */
export const LEAVE_WAGE_BASIS_NOTE =
  "원급여는 휴직·휴업이 없었다면 그 기간에 받았을 계약상 급여입니다 — 월 급여(월 지급 총액 + 직책수당. " +
  "시급제는 시급 × 월 소정·주휴시간 + 월 정액 수당)를 그 기간의 역일수만큼 나눈 금액입니다. " +
  "경업금지 보상금은 근로의 대가가 아니라 넣지 않고(보상금 자체는 근로계약서 제8조에 따라 근무하지 않은 " +
  "기간만큼 일할로 빠집니다 — 그래서 보상금이 있는 직원은 비율이 100% 여도 그 몫만큼 평소보다 적게 나갑니다), " +
  "인센티브·상여·연장수당도 넣지 않습니다. 유급휴직 급여·휴업수당은 전액 과세로 잡습니다(그 기간의 식대 " +
  "비과세는 따로 떼지 않습니다). 다른 기준으로 주려면 금액을 직접 넣으세요.";

/**
 * 산정 기준 둘의 차이 — 비율을 고르는 자리에서 함께 적는다.
 * 같은 70% 라도 금액이 다르므로(주휴일·토요일 몫) 고르는 자리에서 무엇이 다른지 읽혀야 한다.
 */
export const LEAVE_PAY_BASIS_HINT: Record<LeavePayBasis, string> = {
  CALENDAR:
    "원급여 = 월 급여 × 그 기간 역일수 ÷ 그 달 역일수. 주휴일·휴일의 몫이 들어 있어 100% 면 평소 급여와 같습니다.",
  WORKDAY:
    "원급여 = 그 기간 평일분의 통상임금 — 통상시급 × 1일 환산시간(주 소정근로시간 ÷ 5) × 평일(월~금) 수. " +
    "주휴일·토요일의 몫은 들어가지 않습니다(평일에 든 공휴일은 셉니다).",
};

/**
 * 소정근로일 기준이 무엇인지 — 그 기준을 고르면 보인다.
 *
 * ⚠ **주휴일 몫이 빠진다는 것을 감추지 않는다.** 월급에는 주휴일의 몫이 들어 있어(월 유급시간 = (주 소정 + 주휴) × 4.345)
 * 이 기준으로는 100% 를 줘도 평소 한 달 급여의 5/6 쯤이다. 고용노동부 행정해석은 휴업기간에 든 **유급휴일(주휴일)을
 * 휴업수당 산정에 포함**하고 무급휴무일(토요일)은 뺀다고 검색된다(파일 머리말 — 원문은 직접 대조하지 못했다).
 * 그 해석대로면 사용자 귀책 휴업에서 이 기준은 주휴일분만큼 모자라다. 앱은 단정하지 않고 확인하라고 적는다 —
 * 휴업의 성격과 노무 자문의 몫이다. 주휴일 몫이 들어가는 쪽은 역일수 기준이고, 다른 금액이면 직접 넣는다.
 */
export const LEAVE_WORKDAY_BASIS_NOTE =
  "소정근로일 기준은 통상임금으로 셉니다 — 통상시급(월 급여 ÷ 월 유급시간. 명세서의 통상시급과 같은 값이고 " +
  "경업금지 보상금·직책수당은 들지 않습니다) × 1일 환산시간(주 소정근로시간 ÷ 5) × 그 기간의 평일(월~금) 수 × 지급 비율. " +
  "평일에 든 공휴일은 세고, 주휴일·토요일의 몫은 넣지 않습니다 — 그래서 비율이 100% 여도 평소 한 달 급여보다 적습니다. " +
  "⚠ 사용자 귀책 휴업(근로기준법 §46)이면 휴업기간에 든 주휴일(유급휴일)도 휴업수당 산정에 포함해야 한다는 고용노동부 " +
  "행정해석이 있는 것으로 확인됩니다(무급휴무일인 토요일은 제외) — 그 경우 이 기준은 주휴일분만큼 적으니 노무 자문으로 " +
  "확인해 주세요. 주휴일 몫이 들어가는 쪽은 역일수 기준이고, 다른 금액으로 주려면 금액을 직접 넣습니다.";

/** 소정근로일 기준을 고른 자리에 바로 붙는 짧은 주의 — 위 안내의 요점만 */
export const LEAVE_WORKDAY_BASIS_CAUTION =
  "주휴일·토요일의 몫은 들어가지 않습니다 — 비율이 100% 여도 평소 한 달 급여보다 적습니다. 사용자 귀책 휴업이면 " +
  "휴업기간에 든 주휴일도 휴업수당에 포함해야 한다는 행정해석이 있으니(토요일은 제외) 확인해 주세요 — " +
  "주휴일 몫이 들어가는 쪽은 역일수 기준입니다.";

/**
 * 휴업수당의 법정 기준 — 휴업을 고르면 늘 보인다.
 *
 * 근로기준법 §46: ① 사용자의 귀책사유로 휴업하는 경우 휴업기간 동안 **평균임금의 100분의 70 이상**을 지급해야
 * 한다. 다만 평균임금의 70% 가 통상임금을 초과하면 통상임금을 휴업수당으로 지급할 수 있다. ② 부득이한 사유로
 * 사업을 계속할 수 없어 노동위원회의 승인을 받으면 그 기준에 못 미치는 휴업수당을 지급할 수 있다.
 *
 * 앱의 비율은 **원급여(계약 월 급여) 대비**다. 평균임금은 직전 3개월에 실제로 받은 임금 총액을 그 기간의
 * 역일수로 나눈 것이라 연장·휴일수당이나 정기 상여가 있던 사람은 원급여보다 높다 — 같은 70% 라도 법정 기준에
 * 못 미칠 수 있다. 그래서 금액을 직접 넣는 길을 함께 둔다. 어느 쪽이 맞는지는 앱이 정하지 않는다.
 */
export const SHUTDOWN_BASIS_NOTE =
  "사용자 귀책으로 휴업하면 휴업기간 동안 평균임금의 70% 이상을 휴업수당으로 줘야 합니다(근로기준법 §46① — " +
  "평균임금의 70%가 통상임금보다 많으면 통상임금). 여기의 비율은 평균임금이 아니라 계약 급여(역일수 기준은 월 급여, " +
  "소정근로일 기준은 통상임금) 대비라, 직전 3개월에 연장·휴일수당이나 상여를 받은 사람은 같은 70% 라도 법정 기준보다 " +
  "적을 수 있습니다 — 평균임금으로 계산한 금액이 있으면 금액을 직접 넣으세요.";

/**
 * 휴업수당 비율이 70% 에 못 미칠 때의 주의 — **막지 않는다**.
 * 노동위원회 승인을 받았거나(§46②), 사용자 귀책이 아닌 휴업(천재지변 등 불가항력)이면 정당하다.
 * 금액 지정은 견줄 기준(평균임금)을 앱이 모르므로 판단하지 않는다.
 */
export function shutdownRateWarning(l: { kind?: unknown; payRate?: unknown; payAmount?: unknown }): string | null {
  if (leaveKindOf(l.kind) !== "SHUTDOWN") return null;
  const terms = leavePayTermsOf(l);
  if (terms.mode !== "RATE" || rateBp(terms.rate) >= rateBp(DEFAULT_SHUTDOWN_RATE)) return null;
  return (
    `휴업수당 비율이 70% 에 못 미칩니다(${ratePercentLabel(terms.rate)}). 사용자 귀책 휴업이면 노동위원회의 승인이 ` +
    `있어야 그보다 적게 줄 수 있습니다(근로기준법 §46②). 천재지변처럼 사용자 귀책이 아닌 휴업이면 해당하지 않습니다.`
  );
}

/**
 * 퇴직급여에 대한 주의.
 *
 * DC 부담금은 '연간 임금총액의 1/12' 이라(근로자퇴직급여보장법 §20①) 임금이 줄어든 기간에는 쌓이는 몫도 준다 —
 * 그래서 그 달 급여가 줄면 함께 줄어든다(2026-11 결정: 「DC형이므로 퇴직급여 적립에도 반영」). 유급휴직 급여·
 * 휴업수당은 임금이라 산정기준에 들지만, 비율이 100% 에 못 미치면 그만큼 적게 쌓인다.
 *
 * ⚠ **법으로 보호되는 휴직은 그렇게 하면 안 된다.** 출산전후휴가·육아휴직(·육아기 근로시간 단축) 기간은
 * 「그 기간의 임금을 뺀 연간 임금총액 ÷ 그 기간을 뺀 기간」으로 부담금을 내야 한다는 것이 고용노동부의 해석이다 —
 * 평균임금 산정에서 빼는 기간(근로기준법 시행령 §2①)을 DC 에도 같은 취지로 적용한 것이라, 그 기간에도 평소만큼
 * 쌓아야 한다. 이 기능으로 급여를 줄이면 적립도 함께 줄어 **부담금 미달**이 된다. 그런 기간이면 퇴직급여 화면에서
 * 그 달 기준급여를 직접 지정한다(관리자 지정이 급여보다 우선한다 — lib/severance-service.ts).
 *
 * **사용자 귀책 휴업과 개인 사정 휴직이 어느 쪽인지는 앱이 정하지 않는다.** 같은 항 2호가 「사용자의 귀책사유로
 * 휴업한 기간」을, 8호가 「업무 외 부상이나 질병, 그 밖의 사유로 사용자의 승인을 받아 휴업한 기간」을 들고 있어
 * 위 방식을 적용해야 한다고 볼 여지가 있다 — 다만 이 두 경우를 직접 다룬 해석은 확인하지 못했다(2026-11 검색).
 * 퇴직연금규약·취업규칙과 노무 자문으로 확인할 대목이다.
 */
export const UNPAID_SEVERANCE_NOTE =
  "퇴직급여(DC 부담금·충당금)는 그 달 급여에서 산정하므로 휴직·휴업으로 줄어든 만큼 함께 줄어듭니다" +
  "(유급휴직 급여·휴업수당은 산정에 들지만, 비율이 100% 에 못 미치면 그만큼 적게 쌓입니다). " +
  "⚠ 육아휴직·출산전후휴가처럼 법으로 보호되는 휴직은 다릅니다 — 그 기간의 임금을 뺀 임금총액을 그 기간을 뺀 " +
  "기간으로 나눠 부담금을 내야 해서(고용노동부 해석) 줄여 쌓으면 미달이 됩니다. 그런 휴직이면 퇴직급여 화면에서 " +
  "그 달 기준급여를 직접 지정하세요. 사용자 귀책 휴업(근로기준법 시행령 제2조제1항제2호)과 회사 승인을 받은 " +
  "개인 사정 휴직(같은 항 제8호)도 같은 방식을 적용해야 하는지는 퇴직연금규약과 노무 자문으로 확인해 주세요.";
