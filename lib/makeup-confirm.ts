// 실근무 확정 — 언제부터 누가 할 수 있는지, 확정할 때 무엇을 알려야 하는지 (순수 함수, 테스트 있음)
//
// **확정은 신청자가 직접 한다.** 관리자가 뒤늦게 모아서 처리하면 실제로 몇 시에 시작해
// 몇 시에 끝났는지 아는 사람이 정작 입력하지 않게 된다. 대신 관리자가 최종적으로
// 다시 고칠 수 있다(`confirmedBy` 가 ADMIN 으로 덮인다).
//
// 시각 표기: 이 모듈이 받는 Date 는 **KST 벽시계 값이 UTC 필드에 담긴 것**이다
// (앱 전체가 같은 규칙 — ymd()·달력·공휴일 모두 getUTC* 를 쓴다).

import { workWindow, type OtSession } from "./overtime";
import { MAKEUP_CATEGORY, makeupKindLabel } from "./constants";

/** 확정 판정에 필요한 최소 필드 */
export interface ConfirmableSession {
  category: string;
  status: string;
  planStart: Date;
  planEnd: Date;
  actualStart?: Date | null;
  actualEnd?: Date | null;
}

const DAY_MS = 86400000;

const utcMidnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * 신청자가 확정할 수 있게 되는 시각 — **근무가 끝난 날의 다음날 00:00**.
 *
 * 근무 중에 미리 확정하면 '예정' 을 그대로 베끼게 되고, 실제로 일찍 끝났거나 늦게까지
 * 남았던 사실이 사라진다. 자정을 넘긴 근무는 종료일 기준이라 하루 더 뒤에 열린다.
 */
export function confirmOpensAt(s: ConfirmableSession): Date {
  const w = workWindow(s as unknown as OtSession);
  return new Date(utcMidnight(w.end).getTime() + DAY_MS);
}

/**
 * 신청자 확정이 닫히는 시각 — **근무한 달의 다음 달 말일 23:59:59**.
 *
 * 그 달 급여는 익월에 지급되므로 이 시점을 넘기면 이미 명세서가 나간 뒤다.
 * 발송(SENT)된 달은 재산정하지 않으므로 뒤늦게 확정해도 수당에 닿지 않는다 —
 * 조용히 받아 두면 '확정했는데 왜 수당이 없냐' 가 된다. 그때부터는 관리자만 손댈 수 있고,
 * 관리자는 급여 잠금 해제까지 함께 판단해야 한다.
 */
export function confirmClosesAt(s: ConfirmableSession): Date {
  const w = workWindow(s as unknown as OtSession);
  // 다음 달 말일의 마지막 순간 = 두 달 뒤 1일의 1초 전
  return new Date(Date.UTC(w.start.getUTCFullYear(), w.start.getUTCMonth() + 2, 1) - 1000);
}

export interface SelfConfirmVerdict {
  ok: boolean;
  /** 막힌 이유 — 슬랙에 그대로 보여준다 */
  reason?: string;
  opensAt: Date;
  closesAt: Date;
}

const dateLabel = (d: Date) =>
  `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;

/**
 * 신청자가 지금 이 건을 확정할 수 있는가.
 * **관리자에게는 적용되지 않는다** — 관리자는 언제든 고칠 수 있다(최종 권한).
 */
export function canSelfConfirm(s: ConfirmableSession, now: Date): SelfConfirmVerdict {
  const opensAt = confirmOpensAt(s);
  const closesAt = confirmClosesAt(s);
  const what = makeupKindLabel(s.category);
  const base = { opensAt, closesAt };

  if (s.status === "CANCELED")
    return { ...base, ok: false, reason: `취소된 ${what} 신청은 확정할 수 없습니다.` };
  if (s.status === "NOSHOW")
    return {
      ...base,
      ok: false,
      reason: `미실시로 처리된 건입니다. 실제로 근무했다면 관리자에게 알려 주세요.`,
    };
  if (now < opensAt)
    return {
      ...base,
      ok: false,
      reason: `실근무 확정은 ${what}이 끝난 다음날(${dateLabel(opensAt)})부터 가능합니다.`,
    };
  if (now > closesAt)
    return {
      ...base,
      ok: false,
      reason:
        `확정 기간이 지났습니다(${dateLabel(closesAt)}까지). ` +
        `해당 월 급여명세서가 이미 나갔을 수 있어 관리자 확인이 필요합니다.`,
    };
  return { ...base, ok: true };
}

/**
 * 확정 화면에 항상 띄우는 안내 — **입력한 시간이 곧 수당이다**.
 *
 * 예정 시각을 그대로 확정 버튼만 누르는 일을 막으려는 문구다. 늘리라는 것도
 * 줄이라는 것도 아니고, 실제 시각을 적으라는 뜻이다.
 */
export function honestyNotice(category?: string | null): string {
  const what = makeupKindLabel(category);
  return (
    `여기에 적는 시간이 그대로 수당으로 산정됩니다. ` +
    `예정 시간이 아니라 **실제로 근무한(강의한) 시간**을 있는 그대로 적어 주세요. ` +
    `일찍 끝났으면 끝난 시각을, 늦게까지 했으면 늦은 시각을 적으면 됩니다. ` +
    `확정한 내용은 ${what} · 오버타임 화면에 그대로 반영되고, 관리자가 확인합니다.`
  );
}

export interface CapNoticeInput {
  /** 이 내신 기간에 인정되는 상한 시간 */
  capHours: number;
  /** 같은 내신 기간의 다른 내신의무보강이 이미 차지한 시간 */
  otherHours: number;
  /** 지금 확정하려는 시간 */
  thisHours: number;
  /** 내신 기간 이름 (없으면 분기로 묶인다) */
  periodName?: string | null;
}

const hrs = (h: number) => `${Math.round(h * 100) / 100}시간`;

/**
 * 내신의무보강 상한 초과 안내 — 넘겨도 **막지 않고 알려 준다**.
 *
 * 상한은 '이 시간까지만 인정한다' 는 것이지 '더 일하면 안 된다' 가 아니다.
 * 넘긴 분은 엔진(`computeOvertime`)이 **수당이 큰 근무부터** 채워 상한을 배분하므로
 * (일요일 ×1.5 → 토요일 ×1.0 순), 같은 상한이라도 근로자에게 가장 유리한 조합이 남는다.
 * 그 사실을 그대로 적는다 — 넘긴 시간이 통째로 사라지는 줄 알면 신고를 줄여 적게 된다.
 *
 * 상한을 넘지 않으면 null (붙일 말이 없다).
 */
export function mandatoryCapNotice(a: CapNoticeInput): string | null {
  const total = a.otherHours + a.thisHours;
  if (!(total > a.capHours)) return null;
  const where = a.periodName ? `${a.periodName} 기준 ` : "";
  const already = a.otherHours > 0 ? `이미 확정된 ${hrs(a.otherHours)}과 합해 ` : "";
  return (
    `⚠️ 내신의무보강 인정 상한(${where}${hrs(a.capHours)})을 넘습니다 — ` +
    `${already}${hrs(total)}가 됩니다.\n` +
    `초과분이 없어지는 것은 아니고, 상한 ${hrs(a.capHours)} 범위 안에서 ` +
    `**근로자에게 가장 유리한 기준**(수당 배수가 큰 근무부터)으로 수당이 산정됩니다. ` +
    `실제 근무한 시간 그대로 적어 주세요.`
  );
}

/** 이 건이 내신 상한의 적용을 받는가 */
export function underMandatoryCap(category: string): boolean {
  return category === MAKEUP_CATEGORY.MANDATORY;
}

/**
 * 수당 대상이 아닌 건에서 확정 자리에 대신 놓는 안내 (목록의 한 줄 밑에 작게).
 *
 * 확정 화면은 '적은 시간이 곧 수당' 이라는 전제로 쓰여 있어서, 수당 대상이 아닌 건에
 * 확정을 열어 두면 직전보강과 똑같이 읽혀 **지급되는 줄 알고 시간을 적게 된다**.
 * 그래서 닫아 두되, 왜 닫혔는지와 무엇을 하면 되는지를 함께 적는다 —
 * 버튼만 사라져 있으면 시스템이 고장 난 줄 안다.
 */
export const NOT_PAYABLE_HINT =
  "수당 반영 대상이 아니어서 실근무 확정이 열려 있지 않습니다. 반영이 필요하면 관리자에게 문의해 주세요.";

/** 신청자가 그래도 확정을 시도했을 때 돌려주는 문구 (옛 메시지에 남은 버튼 등) */
export const NOT_PAYABLE_NOTICE = `이 건은 ${NOT_PAYABLE_HINT}`;
