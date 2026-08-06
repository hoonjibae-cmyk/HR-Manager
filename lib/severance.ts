// 퇴직급여(DC형 퇴직연금 부담금 · 퇴직급여충당금) 엔진 — 순수 함수, DB 무관, 테스트 있음
//
// **유쌤에듀의 제도**: 근속 1년이 지나면 DC형(확정기여형) 퇴직연금에 가입한다.
// 그 전 기간은 아직 납입할 계정이 없으므로 회사가 **충당금으로 쌓아 둔다**.
//
// 용어:
//  · **퇴직급여충당금** — 근속 1년 미만 구간에 쌓는 회계상 적립분(정식 계정명은 '퇴직급여충당부채').
//    아직 나가는 돈이 아니라 **나중에 낼 몫을 미리 잡아 두는 것**이다.
//  · **부담금(負擔金)** — DC 가입 후 사용자가 근로자 계정에 실제로 납입하는 돈.
//    근로자퇴직급여보장법 §20① 이 쓰는 용어다("연간 임금총액의 12분의 1 이상에 해당하는 부담금").
//
// **1년 미만 적립분은 없어지지 않는다.** 계속근로가 1년을 넘기면 퇴직급여는 **입사일부터**
// 전체 기간에 대해 지급 의무가 생긴다(근로자퇴직급여보장법 §8①). 그래서 여기서 쌓는 충당금은
// 'DC 가입 시 소급해서 넣어야 할 금액' 이고, 화면도 그렇게 읽히도록 누계를 함께 보여준다.
//
// ⚠️ **법정 하한과의 관계**: §20① 의 하한은 '연간 **임금총액**의 1/12' 이다. 임금총액에는
// 연장·야간·휴일수당처럼 근로의 대가로 정기 지급되는 것이 원칙적으로 들어간다.
// 그래서 산입 범위를 좁히면 하한에 미달할 수 있다 — 그 판단은 회사(노무 자문)의 몫이라
// **엔진은 정책(SeverancePolicy)이 시키는 대로 계산하고, 무엇을 뺐는지 근거로 남긴다.**

import { addMonths, isBefore } from "date-fns";
import { fixedOvertimeOf, variableOvertimeOf } from "./payroll";

/* ───────────── 정책 ───────────── */

export interface SeverancePolicy {
  /** 근속 몇 개월이 지나면 DC 부담금으로 넘어가는가 (유쌤에듀 = 12개월) */
  dcAfterMonths: number;
  /** 연간 임금총액을 나누는 수 — 법정 하한이 1/12 이다 */
  divisor: number;
  /** 이 시간 미만이면 퇴직급여 대상에서 뺀다 (근로자퇴직급여보장법 §4① 단서 = 주 15시간) */
  minWeeklyHours: number;

  // --- 산입 범위 (기본값은 유쌤에듀가 정한 기준) ---
  /** 상여 — 비정기 특별상여라 평균임금에 안 들어가는 경우가 많다 */
  includeBonus: boolean;
  /** 인센티브 — **이미 '퇴직유보금' 으로 따로 1/12 을 떼고 있다**(확인서 제6조). 겹쳐 쌓지 않는다 */
  includeIncentive: boolean;
  /**
   * **포괄임금 약정 시간외·야간** — 계약서 제4조에 이미 들어 있는 고정분.
   * 켜면 산정기준 임금이 **계약서에 합의된 월 급여총액**과 맞는다(기본 켜짐).
   * 이건 매달 같은 금액으로 정기·일률 지급되는 임금이라 빼면 계약 총액보다 적게 쌓인다.
   */
  includeFixedOvertime: boolean;
  /**
   * **그 달 실제로 발생한** 연장·야간·휴일수당(보강 확정분·수기 입력분).
   * 약정분과 달리 달마다 다르다. 끄면 법정 하한에 미달할 수 있다(위 ⚠️).
   */
  includeOvertime: boolean;
  /** 연차미사용수당 */
  includeUnusedLeave: boolean;
  /** 식대·차량유지비 — 비과세지만 정기·일률 지급이면 임금이다 */
  includeMealCar: boolean;
}

export const DEFAULT_SEVERANCE_POLICY: SeverancePolicy = {
  dcAfterMonths: 12,
  divisor: 12,
  minWeeklyHours: 15,
  includeBonus: false,
  includeIncentive: false,
  // 계약서에 합의된 월 급여를 그대로 산정기준으로 삼는다
  includeFixedOvertime: true,
  includeOvertime: false,
  includeUnusedLeave: true,
  includeMealCar: true,
};

/* ───────────── 대상 판정 ───────────── */

/**
 * · `DC` — 근속 1년 경과. 실제로 납입하는 부담금.
 * · `PROVISION` — 근속 1년 미만. 아직 계정이 없어 충당금으로 쌓는다.
 * · `EXCLUDED` — 퇴직급여 대상이 아니다(위탁계약·초단시간).
 * · `UNKNOWN` — 판정에 필요한 정보(근로시간표)가 없다. **제외가 아니라 보류**다.
 */
export type SeveranceStatus = "DC" | "PROVISION" | "EXCLUDED" | "UNKNOWN";

export interface SeveranceSubject {
  hireDate: Date;
  /** 위탁계약(프리랜서) — `isContractorContract()` 판정 결과를 그대로 넘긴다 */
  contractor: boolean;
  /** 1주 소정근로시간 (근로시간표에서 뽑은 값) */
  weeklyContractual: number;
  /** 근로시간표가 등록돼 있는가 — 없으면 0시간이 '초단시간' 인지 '미입력' 인지 가릴 수 없다 */
  hasSchedule: boolean;
}

export interface SeveranceVerdict {
  status: SeveranceStatus;
  /** 제외·보류 사유, 또는 단계 설명 — 화면에 그대로 띄운다 */
  reason: string;
  /** DC 부담금으로 넘어가는 날 (= 입사일 + dcAfterMonths) */
  dcStartsAt: Date;
}

/** DC 부담금이 시작되는 날 — 근속 1년이 되는 날 */
export function dcStartsAt(hireDate: Date, policy: SeverancePolicy = DEFAULT_SEVERANCE_POLICY): Date {
  return addMonths(hireDate, policy.dcAfterMonths);
}

const ymdLabel = (d: Date) =>
  `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;

/**
 * 이 사람이 이 시점에 어느 단계인가.
 *
 * **제외와 보류를 가른다** — 근로시간표가 비어 있으면 주 소정근로가 0으로 잡혀 전원이
 * 초단시간으로 빠져 버린다. 조용히 빠지면 퇴직급여를 통째로 안 쌓게 되므로 보류로 남기고
 * 화면이 경고한다(보강 화면의 '근로시간표 없음' 과 같은 원칙).
 */
export function severanceVerdict(
  s: SeveranceSubject,
  asOf: Date,
  policy: SeverancePolicy = DEFAULT_SEVERANCE_POLICY
): SeveranceVerdict {
  const starts = dcStartsAt(s.hireDate, policy);

  // 위탁계약은 근로자가 아니라 퇴직급여제도 자체가 적용되지 않는다
  if (s.contractor)
    return { status: "EXCLUDED", reason: "위탁계약(프리랜서) — 퇴직급여 대상 아님", dcStartsAt: starts };

  if (!s.hasSchedule)
    return {
      status: "UNKNOWN",
      reason: "근로시간표 없음 — 주 소정근로시간을 알 수 없어 판정을 보류합니다",
      dcStartsAt: starts,
    };

  // 근로자퇴직급여보장법 §4① 단서 — 4주 평균 1주 소정근로 15시간 미만은 적용 제외
  if (s.weeklyContractual < policy.minWeeklyHours)
    return {
      status: "EXCLUDED",
      reason: `주 소정근로 ${round1(s.weeklyContractual)}시간 — ${policy.minWeeklyHours}시간 미만(초단시간)이라 대상 아님`,
      dcStartsAt: starts,
    };

  if (isBefore(asOf, starts))
    return {
      status: "PROVISION",
      reason: `근속 1년 미만 — ${ymdLabel(starts)} DC 가입 예정, 그때까지 충당금으로 적립`,
      dcStartsAt: starts,
    };

  return { status: "DC", reason: `근속 1년 경과 (${ymdLabel(starts)}~) — DC 부담금 납입 대상`, dcStartsAt: starts };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ───────────── 산정기준 임금 ───────────── */

/**
 * 급여 레코드에서 이 엔진이 보는 값.
 *
 * **시간과 통상시급이 함께 필요하다** — `overtimeP`·`nightP` 에는 포괄임금 약정분(계약서에
 * 이미 들어 있는 고정 시간외·야간)과 그 달 실제 발생분이 섞여 있어, 금액만으로는 가를 수 없다.
 * 그 달 입력·확정된 시간에서 변동분을 다시 세우고 나머지를 약정분으로 본다(`fixedOvertimeOf`).
 */
export interface SeverancePayItems {
  baseP: number; // 기본급
  weeklyHolidayP: number; // 주휴수당(시급제)
  positionP: number; // 직책수당
  mealP: number; // 식대
  carP: number; // 차량유지비
  unusedLeaveP: number; // 연차미사용수당
  incentiveP: number; // 인센티브
  bonusP: number; // 상여
  extraP: number; // 법내연장
  overtimeP: number; // 연장
  nightP: number; // 야간
  holidayP: number; // 휴일

  // --- 약정분 ↔ 변동분을 가르는 재료 ---
  extraHours: number;
  overtimeHours: number;
  nightHours: number;
  holidayHours: number;
  holidayOverHours: number;
  hourlyWage: number;
}

export interface SeveranceBase {
  /** 산정기준 임금 (이 달) */
  base: number;
  /** 산입한 항목 [이름, 금액] — 화면·근거에 그대로 쓴다 */
  included: Array<[string, number]>;
  /** 뺀 항목 [이름, 금액, 사유] */
  excluded: Array<[string, number, string]>;
}

/**
 * 이 달 산정기준 임금 — 지급 항목 중 정책이 산입하기로 한 것만 더한다.
 *
 * **무엇을 뺐는지 함께 돌려주는 것이 핵심**이다. 금액만 보면 왜 그 값인지 알 수 없고,
 * 나중에 노무 자문에서 산입 범위를 바꿀 때 무엇이 달라지는지 대조할 수가 없다.
 */
export function severanceBase(
  p: SeverancePayItems,
  policy: SeverancePolicy = DEFAULT_SEVERANCE_POLICY
): SeveranceBase {
  const included: Array<[string, number]> = [];
  const excluded: Array<[string, number, string]> = [];
  const take = (label: string, amount: number) => {
    if (amount) included.push([label, amount]);
  };
  const drop = (label: string, amount: number, why: string) => {
    if (amount) excluded.push([label, amount, why]);
  };

  // 언제나 들어가는 것 — 기본급과 정기 수당
  take("기본급", p.baseP);
  take("주휴수당", p.weeklyHolidayP);
  take("직책수당", p.positionP);

  if (policy.includeMealCar) {
    take("식대", p.mealP);
    take("차량유지비", p.carP);
  } else {
    drop("식대", p.mealP, "산입 제외 설정");
    drop("차량유지비", p.carP, "산입 제외 설정");
  }

  if (policy.includeUnusedLeave) take("연차미사용수당", p.unusedLeaveP);
  else drop("연차미사용수당", p.unusedLeaveP, "산입 제외 설정");

  if (policy.includeIncentive) take("인센티브", p.incentiveP);
  else drop("인센티브", p.incentiveP, "퇴직유보금으로 별도 적립 중");

  if (policy.includeBonus) take("상여", p.bonusP);
  else drop("상여", p.bonusP, "비정기 특별상여");

  // 오버타임은 **두 갈래**다 — 계약서에 이미 들어 있는 약정분과, 그 달 새로 생긴 변동분.
  // 약정분은 매달 같은 금액으로 정기·일률 지급되는 계약 월 급여의 일부라 기본으로 산입한다
  // (켜 두면 산정기준 임금 = 계약서에 합의된 월 급여총액).
  const fixed = fixedOvertimeOf(p);
  const variable = variableOvertimeOf(p);

  if (policy.includeFixedOvertime) take("포괄임금 약정 시간외·야간", fixed);
  else drop("포괄임금 약정 시간외·야간", fixed, "산입 제외 설정");

  if (policy.includeOvertime) take("오버타임 수당(그 달 발생분)", variable);
  else drop("오버타임 수당(그 달 발생분)", variable, "산입 제외 설정");

  return { base: included.reduce((a, [, v]) => a + v, 0), included, excluded };
}

/** 이 달 오버타임 지급액을 약정분·변동분으로 가른 값 (화면 설명용) */
export function overtimeSplit(p: SeverancePayItems) {
  return { fixed: fixedOvertimeOf(p), variable: variableOvertimeOf(p) };
}

/**
 * 월 적립액 = 산정기준 임금 ÷ 12.
 *
 * **원 단위로 반올림한다**(10원 절사를 하지 않는다) — 퇴직급여는 공제가 아니라 근로자 몫으로
 * 떼어 두는 돈이라 깎는 쪽이 맞지 않고, 기존 퇴직유보금(`RETENTION_RATE`)도 같은 방식이다.
 */
export function monthlyAccrual(
  base: number,
  policy: SeverancePolicy = DEFAULT_SEVERANCE_POLICY
): number {
  if (!base || policy.divisor <= 0) return 0;
  return Math.round(base / policy.divisor);
}

/* ───────────── 근거 문구 ───────────── */

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/** 한 사람·한 달의 산정 근거 한 줄 — 화면 툴팁과 내보내기가 함께 쓴다 */
export function accrualNote(
  b: SeveranceBase,
  amount: number,
  status: SeveranceStatus,
  policy: SeverancePolicy = DEFAULT_SEVERANCE_POLICY
): string {
  const what = status === "DC" ? "DC 부담금" : "퇴직급여충당금";
  const head = `${what}: 산정기준 임금 ${won(b.base)} ÷ ${policy.divisor} = ${won(amount)}`;
  if (!b.excluded.length) return head;
  const off = b.excluded.map(([label, v, why]) => `${label} ${won(v)}(${why})`).join(" · ");
  return `${head}\n제외: ${off}`;
}

/**
 * 산입 범위가 법정 하한(연간 임금총액의 1/12)에 못 미칠 소지를 경고한다.
 *
 * 상여는 비정기라 평균임금에서 빠지는 경우가 많지만, **연장·야간·휴일수당은 근로의 대가**라
 * 원칙적으로 임금총액에 들어간다. 실제로 그 수당이 발생한 달에만 경고한다 —
 * 발생하지도 않은 항목으로 매달 경고하면 경고가 무뎌진다.
 *
 * **포괄임금 약정분은 별도로 본다** — 약정분을 빼면 산정기준이 계약서에 합의된 월 급여보다
 * 적어지므로, 그쪽이 더 무겁게 어긋난다(매달 일어난다).
 */
export function underMinimumWarning(
  b: SeveranceBase,
  policy: SeverancePolicy = DEFAULT_SEVERANCE_POLICY
): string | null {
  const off = (label: string) => b.excluded.find(([l]) => l === label);

  if (!policy.includeFixedOvertime) {
    const fixed = off("포괄임금 약정 시간외·야간");
    if (fixed)
      return (
        `포괄임금 약정 시간외·야간 ${won(fixed[1])} 을 뺐습니다 — 계약서에 합의된 월 급여의 ` +
        `일부라 매달 일률적으로 지급되는 임금입니다. 산정기준이 계약 월 급여총액보다 적어지므로 ` +
        `법정 하한(연간 임금총액의 1/12, 근로자퇴직급여보장법 §20①)에 미달할 소지가 큽니다.`
      );
  }

  if (policy.includeOvertime) return null;
  const ot = off("오버타임 수당(그 달 발생분)");
  if (!ot) return null;
  return (
    `그 달 발생한 연장·야간·휴일수당 ${won(ot[1])} 을 산정기준에서 뺐습니다. ` +
    `근로자퇴직급여보장법 §20① 의 하한은 '연간 임금총액의 1/12' 이고 이들 수당도 임금에 들어가므로, ` +
    `이 기준으로는 하한에 미달할 수 있습니다 — 노무 자문으로 확인해 주세요.`
  );
}
