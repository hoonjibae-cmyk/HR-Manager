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
// 덜 주는 쪽으로 틀리지 않게 한다. 퇴직급여 산정에도 그대로 넣는다.
//
// **세무 처리(과세·비과세)는 계약서가 단정하지 않는다**(2026-11 — 회사가 복리후생비 성격의 비과세 처리를
// 하기로 했다). 계약서의 공제 문장·명세서 각주·화면 도움말에 '보상금은 과세' 라고 적지 않는다 — 적으면
// 세무대리인의 처리와 어긋난 문서가 된다.
//
// **과세·비과세는 회사 설정 스위치가 정한다**(v1.59 — `Company.nonCompeteNonTax`, 설정 → 회사 정보. 기본 꺼짐).
//  · 꺼짐(기본): 급여 엔진의 자동 공제 계산(AUTO)이 보상금을 과세 급여에 넣는다 — 소득세법 §12 3호의 비과세
//    근로소득은 열거된 항목뿐이라, 근거 없이 덜 떼는 쪽으로 틀리지 않게.
//  · 켜짐: 근로계약(4대보험)의 보상금을 식대처럼 비과세로 보고 4대보험·근로소득세 기준에서 뺀다
//    (`rates.nonCompeteNonTax` → `PayrollResult.nonCompeteNonTaxP`). 그 달 기록에 `breakdown.nonCompeteNonTax`
//    로 남아 명세서가 「경업금지 보상금(비과세)」, 세무 시트 비고가 「비과세 처리」라고 적는다.
//  · 위탁(3.3%)에는 닿지 않는다 — 지급총액에 3.3% 가 걸리는 사업소득이라 비과세 근로소득이 설 자리가 없다.
//  · 수동 공제(MANUAL — 4대보험 직원의 기본값)는 세무대리인 지정값을 그대로 쓰므로 금액은 안 바뀌고 표기만 바뀐다.
//  · 통상시급·퇴직급여 산정기준·지급액 계는 그대로다 — 달라지는 것은 세무 처리뿐이다.
// ⚠ 스위치가 있다고 비과세가 되는 것은 아니다. '복리후생비' 는 회계 계정일 뿐 비과세 사유가 아니고, 계약서는
// 보상금을 '경업금지 의무의 **대가**' 로 적는다 — 과세로 판정되면 소득세·4대보험 추징과 가산세가 생긴다.
// 설정 화면이 같은 말을 한다(`NON_COMPETE_NONTAX_RISK_NOTE`). 세무대리인 확인이 먼저다.
//
// 범위(퇴직 후 6개월 · 반경 2km)는 보안서약서의 경업금지 항목과 **같은 값**을 쓴다 —
// 한 사람이 서명한 두 문서의 범위가 갈리면 어느 쪽이 맞는지 다툼이 된다.
//
// **완전비율제(강의위탁계약 · 비율제 근로계약)는 갈래가 다르다** — 아래 '완전비율제' 절. 금액이 아니라
// 매출에 곱하는 비율이고, 수수료·비율급과 별도로 더해 준다(총액에서 떼지 않는다). 위탁의 경업금지 범위는
// 위탁계약서 제7조 원문 그대로, 비율제 근로계약은 월급제와 같은 근로계약서 제8조다.

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
  /** 비율제 근로계약 — 위탁 판정(isContractorContract)에 함께 넘긴다 */
  ratioEmployee?: boolean | null;
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

/* ───────────── 완전비율제 — 매출 × 보상금 비율 ───────────── */
//
// 완전비율제는 월 지급 총액이 없고 **매출(수강료 입금액) × 비율**이 보수의 전부다. 그래서 보상금도
// 금액이 아니라 **비율**로 정하고, 수수료·비율급(ratioPercent)과 같은 매출에 곱해 **그것과 별도로**
// 지급한다(예: 40% + 보상금 3% → 매출의 43%). 월급제처럼 총액 안에서 떼는 구조가 아니다
// (2026-11 결정 — 비율은 계약마다 정한다). 계약 형태에 따라 갈래가 둘이다.
//  · **위탁**(강의위탁계약서 제5조·제7조) — 사업소득 3.3% 원천징수가 보상금에도 함께 걸린다.
//  · **비율제 근로계약**(근로계약서 제4조·제8조, lib/ratio-employee.ts) — 세무 처리는 위(계약서는 단정하지
//    않고 회사 설정 스위치가 정한다). 보상금 자체는 **언제나 이 회사가 지급한다** — 경업금지 약정의 당사자가 이 회사라 별도 사업장이 줄 돈이
//    아니다. 다만 **근로소득 상한은 비율급과 보상금을 합친 금액에 걸린다**(2026-11 결정 — 보상금까지 합쳐
//    500만원으로 묶는다). 넘는 만큼은 비율급에서 빠져 별도 사업장으로 간다(`splitRatioPay` 의 sharedWithin).
//    통상시급의 분자에도 넣는다(월급제 보상금과 같은 원칙 — 임금으로 판단될 때 덜 준 것이 되지 않게).

/**
 * 보상금 비율을 둘 수 있는 계약인가 — **완전비율제 전부**(강의위탁계약서와 비율급 근로계약서).
 * 2026-11 까지는 위탁만이었다. 비율제 근로계약이 생기며(v1.57) 그쪽도 같은 비율로 넣게 열었다(v1.58).
 */
export function nonCompeteRatioApplies(c: { payScheme?: string | null }): boolean {
  return c.payScheme === "RATIO";
}

/**
 * 새 계약에 보상금 비율이 **반드시** 있어야 하는가.
 *  · 위탁 — 언제나(부서 무관). 강의위탁계약서에는 경업금지 조항(제7조)이 원래 들어 있어서다.
 *  · 비율제 근로계약 — **교수부만**. 월급제 근로계약서와 같은 규칙(`nonCompeteRequired`)이다 —
 *    근로계약서에는 보상금이 있을 때만 경업금지 조항(제8조)이 들어가고, 그것을 반드시 넣는 부서가 교수부다.
 */
export function nonCompeteRatioRequired(
  c: { payScheme?: string | null; ratioEmployee?: boolean | null },
  department?: string | null
): boolean {
  if (!nonCompeteRatioApplies(c)) return false;
  if (c.ratioEmployee !== true) return true;
  return (department ?? "").includes(NON_COMPETE_REQUIRED_DEPT);
}

/** 0.03 → "3%", 0.025 → "2.5%" — 계약서·명세서·화면이 같은 표기를 쓴다 */
export function ratioPctLabel(r: number): string {
  return `${(r * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/**
 * 입력 검사 — 0% 이상 100% 미만, 그리고 **위탁·임금 비율과 합쳐 100% 이하**(매출보다 많이 줄 수는 없다).
 * 값은 비율(0.03)로 받는다 — 화면은 %로 받아 100 으로 나눠 보낸다(위탁 비율과 같다).
 * `worker` 는 문구만 가른다(비율제 근로계약의 비율은 '임금 비율').
 */
export function nonCompeteRatioError(
  ratio: unknown,
  ratioPercent?: number | null,
  worker = false
): string | null {
  if (ratio === "" || ratio == null) return null;
  const r = Number(ratio);
  if (!Number.isFinite(r) || r < 0 || r >= 1)
    return "경업금지 보상금 비율은 0% 이상 100% 미만으로 넣어 주세요.";
  if (r === 0) return null;
  const fee = Number(ratioPercent) || 0;
  if (fee + r > 1 + 1e-9)
    return `${worker ? "임금" : "위탁"} 비율(${ratioPctLabel(fee)})과 경업금지 보상금 비율(${ratioPctLabel(r)})을 합치면 매출의 100%를 넘습니다.`;
  return null;
}

/** 저장값으로 다듬기 — 대상이 아닌 계약이면 null, 빈칸·0 도 null(보상금 없음). 0.01% 단위로 자른다 */
export function normalizeNonCompeteRatio(v: unknown, applies: boolean): number | null {
  if (!applies || v === "" || v == null) return null;
  const r = Number(v);
  if (!Number.isFinite(r) || r <= 0) return null;
  return Math.round(r * 10000) / 10000;
}

/**
 * 계약 저장(API) 때 보상금 비율을 정하고 검사한다 — 신규 계약·조건 수정·직원 등록이 같은 규칙.
 * 완전비율제가 아니면 남은 값을 지운다(급여형태를 바꾸면 사라진다). 위탁 ↔ 근로를 바꿔도 값은 살아 있다 —
 * 두 갈래 모두 같은 '매출 × 비율' 이고 서식(조항 번호·과세)만 다르다.
 */
export function resolveNonCompeteRatio(args: {
  raw: unknown;
  fallback: number | null | undefined;
  payScheme: string;
  ratioPercent: number | null | undefined;
  /** 비율제 근로계약 — 오류 문구만 가른다('임금 비율') */
  ratioEmployee?: boolean | null;
}): { value: number | null; error: string | null } {
  const applies = nonCompeteRatioApplies({ payScheme: args.payScheme });
  if (!applies) return { value: null, error: null };
  const candidate = args.raw === undefined ? args.fallback : args.raw;
  const error = nonCompeteRatioError(candidate, args.ratioPercent, args.ratioEmployee === true);
  if (error) return { value: null, error };
  return { value: normalizeNonCompeteRatio(candidate, true), error: null };
}

/** 화면 미리보기 — 매출 예시에 수수료·보상금·합계를 붙여 '얼마가 나가는지' 를 보여 준다 */
export function nonCompeteRatioPreview(ratioPercent: number, ncr: number, revenue = 10_000_000) {
  const fee = Math.round(revenue * (ratioPercent || 0));
  const comp = Math.round(revenue * (ncr || 0));
  return { revenue, fee, comp, total: fee + comp, totalRatio: (ratioPercent || 0) + (ncr || 0) };
}

/** 위탁계약인데 보상금 비율이 없을 때의 안내 — API 400 과 화면이 같은 문구를 쓴다 */
export const NON_COMPETE_RATIO_REQUIRED_MESSAGE =
  `강의위탁계약서에는 「경업금지 보상금」 비율을 적어야 합니다 — 수강료 입금액(매출) 중 보상금으로 지급할 비율(%)을 넣어 주세요. ` +
  `(이미 서명한 옛 계약을 옮겨 적는 경우처럼 보상금을 두지 않을 때는 「이번 계약에는 경업금지 보상금을 두지 않음」을 체크하세요.)`;

/** 교수부 비율제 근로계약인데 보상금 비율이 없을 때의 안내 */
export const NON_COMPETE_RATIO_WORKER_REQUIRED_MESSAGE =
  `교수부 근로계약서(비율급)에는 경업금지 조항과 함께 「경업금지 보상금」 비율을 적어야 합니다 — 수강료 입금액(매출) 중 보상금으로 지급할 비율(%)을 넣어 주세요. ` +
  `(이미 서명한 옛 계약을 옮겨 적는 경우처럼 보상금을 두지 않을 때는 「이번 계약에는 경업금지 보상금을 두지 않음」을 체크하세요.)`;

/** 보상금 비율이 빠졌을 때 띄울 안내 — 위탁·비율제 근로계약이 갈린다 */
export function nonCompeteRatioRequiredMessage(ratioEmployee?: boolean | null): string {
  return ratioEmployee === true ? NON_COMPETE_RATIO_WORKER_REQUIRED_MESSAGE : NON_COMPETE_RATIO_REQUIRED_MESSAGE;
}

/** 교수부인데 보상금이 없을 때의 안내 — API 400 과 화면이 같은 문구를 쓴다 */
export const NON_COMPETE_REQUIRED_MESSAGE =
  `교수부 근로계약서에는 경업금지 조항과 함께 「경업금지 보상금」을 적어야 합니다 — 월 급여 총액 중 보상금으로 구분할 금액을 넣어 주세요. ` +
  `(이미 서명한 옛 계약을 옮겨 적는 경우처럼 조항을 넣지 않을 때는 「이번 계약에는 경업금지 조항을 넣지 않음」을 체크하세요.)`;

/* ───────────── 세무 처리 — 비과세 처리 스위치(v1.59) ───────────── */

/** 설정 화면이 스위치 옆에 띄우는 경고 — 켜는 사람이 무엇을 떠안는지 알고 켜게 한다 */
export const NON_COMPETE_NONTAX_RISK_NOTE =
  "소득세법상 비과세 근로소득은 법에 열거된 항목(식대 월 20만원 등)뿐이고, '복리후생비' 는 회계 계정일 뿐 " +
  "비과세 사유가 아닙니다. 계약서도 이 보상금을 '경업금지 의무의 대가' 로 적고 있어, 세무조사·4대보험 지도점검에서 " +
  "과세로 판정되면 소득세·4대보험료 추징과 가산세가 생길 수 있습니다 — 세무대리인과 확인한 뒤 켜세요.";

/**
 * 급여 기록의 산출 근거(breakdown JSON)에서 **'이 달 보상금을 비과세로 처리해 산정했는가'** 를 읽는다.
 * 명세서 라벨과 세무 시트 비고가 지금 설정이 아니라 **그 달 실제로 산정한 방식**을 적게 한다 — 설정을 나중에
 * 바꿔도 이미 산정한 달의 문서가 따라 바뀌지 않는다(다시 산정하면 그때 설정을 따른다).
 */
export function nonCompeteNonTaxOf(breakdown: string | null | undefined): boolean {
  if (!breakdown) return false;
  try {
    return JSON.parse(breakdown)?.nonCompeteNonTax === true;
  } catch {
    return false;
  }
}

/**
 * 산출 근거의 비과세 처리 표시를 맞춘다 — **공제를 자동 계산으로 다시 낸 자리**(`updateDeductions`)에서 쓴다.
 * 일괄 산정 뒤에 스위치를 바꾸고 그 행만 자동 계산으로 돌리면 공제는 새 방식으로 나오는데 표시는 옛 방식으로
 * 남아, 명세서 라벨과 공제액이 어긋난다. 다른 근거는 건드리지 않고, 못 읽는 값은 그대로 돌려준다.
 */
export function withNonCompeteNonTax(breakdown: string | null | undefined, on: boolean): string | null {
  const raw = breakdown ?? null;
  let bd: any;
  try {
    bd = raw ? JSON.parse(raw) : {};
  } catch {
    return raw;
  }
  if (!bd || typeof bd !== "object" || Array.isArray(bd)) return raw;
  if ((bd.nonCompeteNonTax === true) === on) return raw;
  if (on) bd.nonCompeteNonTax = true;
  else delete bd.nonCompeteNonTax;
  return JSON.stringify(bd);
}
