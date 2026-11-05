// 경업금지 조항 · 경업금지 보상금 — 교수부 근로계약서(월급제 · 월급+인센티브)
//
// 교수부(강사)는 원생·학부모 관계를 직접 쥐는 자리라, 퇴직 후 근처에서 학원을 차리거나 옮겨 가면
// 원생이 따라 나간다. 그래서 근로계약서에 경업금지를 적고 **그 대가를 금액으로 따로 적는다** —
// 대가 없는 경업금지는 직업선택의 자유를 과하게 막는다고 보아 효력이 부정되기 쉽다
// (대법원 2010. 3. 11. 선고 2009다82244 — 유효성 판단 요소에 '근로자에 대한 대가의 제공 유무').
//
// **보상금은 새로 얹는 돈이 아니라 월 지급 총액 안에서 떼어 낸 몫이다**(2026-11 결정).
// 그만큼 기본급이 줄고 지급계는 그대로다(lib/payroll.ts `inclusiveWageBreakdown`).
//
// ⚠ **통상시급은 총액 기준 그대로 둔다**(보상금을 빼지 않는다). 총액에서 떼어 낸 돈은 법원에서
// 임금으로 판단될 여지가 크고, 그때 통상임금에서 뺀 만큼이 연장·야간·연차수당 체불이 된다.
// 덜 주는 쪽으로 틀리지 않게 한다. 과세(근로소득)·4대보험·퇴직급여 산정에도 그대로 넣는다.
//
// 범위(퇴직 후 6개월 · 반경 2km)는 보안서약서의 경업금지 항목과 **같은 값**을 쓴다 —
// 한 사람이 서명한 두 문서의 범위가 갈리면 어느 쪽이 맞는지 다툼이 된다.

import { isContractorContract, type ScheduleDay } from "./constants";
import { computeWeeklyHours, inclusiveWageBreakdown, WEEKS_PER_MONTH } from "./payroll";

/** 퇴직 후 경업금지 기간(개월) — 보안서약서 제3항과 같다 */
export const NON_COMPETE_MONTHS = 6;
/** 경업금지 지역 — 회사 사업장 반경(km). 보안서약서 제3항 라목과 같다 */
export const NON_COMPETE_RADIUS_KM = 2;
/** 위반 시 보상금 반환 기한 — 회사의 서면 청구일부터(일) */
export const NON_COMPETE_RETURN_DAYS = 30;
/**
 * 보상금(그리고 근로계약서의 경업금지 조항)이 **반드시 있어야 하는 부서** — 이름 부분일치.
 * 근로계약서의 다른 부서 조항(교수부 사직 통보 60일·교육운영팀 토요 당번·조교팀 스케줄 통보)과
 * 같은 방식이라 **부서 이름을 바꾸면 여기도 고친다.**
 */
export const NON_COMPETE_REQUIRED_DEPT = "교수부";

/** 보상금을 판정하는 데 필요한 계약의 모양 */
export interface NonCompeteContractLike {
  /** 계약의 급여형태 (MONTHLY | INCENTIVE | HOURLY | RATIO) */
  payScheme?: string | null;
  isContractor?: boolean | null;
}

/**
 * 보상금을 둘 수 있는 계약인가 — **월급제·월급+인센티브 근로계약**만.
 * 시급제는 월 지급 총액이 없어 떼어 낼 자리가 없고, 위탁계약(완전비율제 포함)은 강의위탁계약서가
 * 따로 있다(제7조 기밀유지 및 경업금지 — 원문 그대로 두는 서식이다).
 */
export function nonCompetePayApplies(c: NonCompeteContractLike): boolean {
  if (isContractorContract(c)) return false;
  return c.payScheme === "MONTHLY" || c.payScheme === "INCENTIVE";
}

/** 교수부 월급제·인센티브 근로계약 — 새로 만드는 계약에 보상금이 반드시 있어야 한다 */
export function nonCompeteRequired(
  department: string | null | undefined,
  c: NonCompeteContractLike
): boolean {
  return (department ?? "").includes(NON_COMPETE_REQUIRED_DEPT) && nonCompetePayApplies(c);
}

/**
 * 저장할 값으로 다듬는다 — 대상이 아닌 계약이면 null(급여형태를 시급제로 바꾸면 남은 값이 지워진다).
 * 빈칸·0 도 null(조항 없음). 음수·숫자 아님은 `nonCompetePayError` 가 먼저 거른다.
 */
export function normalizeNonCompetePay(v: unknown, applies: boolean): number | null {
  if (!applies || v === "" || v == null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 보상금 미리보기·검사에 쓰는 계약 조건 */
export interface NonCompeteTerms {
  baseWage: number;
  positionAllow?: number | null;
  mealAllow?: number | null;
  carAllow?: number | null;
  fixedBaseHours?: number | null;
  fixedOtHours?: number | null;
  fixedNightHours?: number | null;
  /** 직원 근로시간표 — 기본급 산정시간을 따로 안 적은 계약은 여기서 환산한다(엔진과 같다) */
  schedule: ScheduleDay[];
}

export interface NonCompetePreview {
  /** 기본급 산정시간(월) — 엔진과 같은 규칙(계약 값 → 근로시간표 환산 → 209시간) */
  baseHours: number;
  /** 보상금을 떼기 전 기본급 — 보상금은 이 안에서만 뗄 수 있다 */
  basePayBefore: number;
  /** 뗀 뒤 기본급 */
  basePayAfter: number;
  /** 월 지급 총액(기준급여 + 직책수당) */
  monthlyTotal: number;
  /** 그중 임금 = 총액 − 보상금 */
  wageTotal: number;
  /**
   * 최저임금 비교용 시간당 임금 = (기본급 + 직책수당 + 식대 + 차량유지비) ÷ 기본급 산정시간.
   * 고정 시간외·야간수당은 최저임금 산입에서 빠지므로 넣지 않는다(최저임금법 §6④).
   * 보상금을 뺀 임금만으로 그해 최저임금을 넘어야 한다 — 보상금이 임금이 아니라는 전제와 맞물린다.
   */
  minWageHourly: number;
}

/** 엔진(computePayroll)과 같은 기본급 산정시간 */
function baseHoursOf(t: NonCompeteTerms): number {
  if (t.fixedBaseHours && t.fixedBaseHours > 0) return t.fixedBaseHours;
  const { weeklyContractual, weeklyHoliday } = computeWeeklyHours(t.schedule);
  const std = Math.max(weeklyContractual + weeklyHoliday, 0) * WEEKS_PER_MONTH;
  return std > 0 ? std : 209;
}

/** 보상금을 뗀 뒤의 임금 항목 — 계약 폼 미리보기와 입력 검사가 같은 값을 본다 */
export function nonCompetePreview(t: NonCompeteTerms, amount: number): NonCompetePreview {
  const baseHours = baseHoursOf(t);
  const iw = inclusiveWageBreakdown({
    baseWage: t.baseWage || 0,
    mealAllow: t.mealAllow,
    carAllow: t.carAllow,
    baseHours,
    otHours: t.fixedOtHours,
    nightHours: t.fixedNightHours,
  });
  const ncp = Math.max(Math.round(amount || 0), 0);
  const basePayAfter = iw.basePay - ncp;
  const positionAllow = t.positionAllow || 0;
  const monthlyTotal = (t.baseWage || 0) + positionAllow;
  const minWageBase = basePayAfter + positionAllow + (t.mealAllow || 0) + (t.carAllow || 0);
  return {
    baseHours,
    basePayBefore: iw.basePay,
    basePayAfter,
    monthlyTotal,
    wageTotal: monthlyTotal - ncp,
    minWageHourly: baseHours > 0 ? Math.round(minWageBase / baseHours) : 0,
  };
}

/**
 * 입력 검사 — 문제가 있으면 화면에 띄울 문구, 없으면 null.
 * 보상금은 기본급에서 떼는 몫이라 **떼고 나서 기본급이 남아야** 한다(0 이하면 계약서가 성립하지 않는다).
 */
export function nonCompetePayError(t: NonCompeteTerms, amount: unknown): string | null {
  if (amount === "" || amount == null) return null;
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return "경업금지 보상금은 0 이상의 금액(원)으로 넣어 주세요.";
  if (n === 0) return null;
  const p = nonCompetePreview(t, n);
  if (p.basePayAfter <= 0)
    return (
      `경업금지 보상금(${Math.round(n).toLocaleString()}원)이 기본급(${p.basePayBefore.toLocaleString()}원)보다 크거나 같습니다 — ` +
      `보상금은 월 급여 총액 안에서 떼는 몫이라 기본급이 남아야 합니다.`
    );
  return null;
}

/**
 * 계약을 저장할 때(API) 보상금 값을 정하고 검사한다 — 신규 계약·조건 수정·직원 등록이 같은 규칙을 쓴다.
 *  · `raw` 가 undefined(요청에 없음)면 `fallback`(직원 카드 또는 기존 계약 값)을 쓴다.
 *  · 대상이 아닌 계약(시급제·위탁)이면 남은 값을 지운다(null).
 *  · 떼고 남는 기본급이 없으면 error.
 */
export function resolveNonCompetePay(args: {
  raw: unknown;
  fallback: number | null | undefined;
  payScheme: string;
  isContractor: boolean;
  terms: NonCompeteTerms;
}): { value: number | null; error: string | null } {
  const applies = nonCompetePayApplies({ payScheme: args.payScheme, isContractor: args.isContractor });
  if (!applies) return { value: null, error: null };
  const candidate = args.raw === undefined ? args.fallback : args.raw;
  const error = nonCompetePayError(args.terms, candidate);
  if (error) return { value: null, error };
  return { value: normalizeNonCompetePay(candidate, true), error: null };
}

/** 교수부인데 보상금이 없을 때의 안내 — API 400 과 화면이 같은 문구를 쓴다 */
export const NON_COMPETE_REQUIRED_MESSAGE =
  `교수부 근로계약서에는 경업금지 조항과 함께 「경업금지 보상금」을 적어야 합니다 — 월 급여 총액 중 보상금으로 구분할 금액을 넣어 주세요. ` +
  `(이미 서명한 옛 계약을 옮겨 적는 경우처럼 조항을 넣지 않을 때는 「이번 계약에는 경업금지 조항을 넣지 않음」을 체크하세요.)`;
