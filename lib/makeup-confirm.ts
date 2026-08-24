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
 * 신청자 확정이 닫히는 시각 — **근무한 달의 다음 달 1일 23:59:59**.
 *
 * 그 달 급여 산정이 월초에 시작되므로 그 전에 확정분이 다 들어와 있어야 한다.
 * 늦게 받아 봐야 이미 산정·발송(SENT)된 달은 재산정하지 않아 수당에 닿지 않는다 —
 * 조용히 받아 두면 '확정했는데 왜 수당이 없냐' 가 된다. 그때부터는 관리자만 손댈 수 있고,
 * 관리자는 급여 잠금 해제까지 함께 판단해야 한다.
 *
 * ⚠ **월말 근무는 창이 매우 좁다** — 8월 31일 근무면 9월 1일 하루뿐이다
 * (확정은 근무 다음날 열린다). 확정 요청 DM 이 그날 오전에 나가므로 그날 안에 처리해야 하고,
 * 놓친 건은 관리자가 `/makeup` 에서 대신 확정한다.
 */
export function confirmClosesAt(s: ConfirmableSession): Date {
  const w = workWindow(s as unknown as OtSession);
  // 다음 달 1일의 마지막 순간 = 다음 달 2일의 1초 전
  return new Date(Date.UTC(w.start.getUTCFullYear(), w.start.getUTCMonth() + 1, 2) - 1000);
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
 * 확정 마감일 한 줄 — "9월 1일까지".
 *
 * 창이 좁아졌으므로(다음 달 1일) **재촉하는 자리마다 날짜를 박아 준다** —
 * '언젠가 하면 되겠지' 로 읽히면 월말 근무는 그대로 놓친다.
 */
export function confirmDeadlineLabel(s: ConfirmableSession): string {
  const d = confirmClosesAt(s);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일까지`;
}

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
 * **사후 등록 즉시 확정** — 이미 끝난 근무를 등록하는 순간 그 시간을 실근무로 확정할 수 있는가.
 *
 * 평일 초과근무는 미리 예측해 사전신청하기 어렵다 — 늦게까지 남을지는 그날 일이 정한다.
 * 그래서 직원 근무(주말·초과근무)는 **근무가 끝난 뒤에 등록하는 것을 정상 경로로** 두고,
 * 그때 적은 시간이 곧 실근무 시간이므로 다음날 확정 모달을 또 열게 하지 않는다
 * (같은 숫자를 두 번 적게 하는 것은 순수한 헛걸음이고, 그 사이에 놓치면 수당이 사라진다).
 *
 * `confirmOpensAt`(다음날 00:00)을 따르지 않는 이유: 그 규칙은 **미리 잡아 둔 신청**이
 * 근무 중에 '예정' 을 베껴 확정하는 것을 막는 자리다. 사후 등록은 이미 끝난 근무를
 * 그때 적는 것이라 베낄 '예정' 자체가 없다.
 *
 * ⚠ `now` 는 **KST 벽시계 값**이어야 한다(저장된 planEnd 와 같은 표기). 진짜 UTC 를 넘기면
 * 근무가 끝나고도 9시간 동안 '아직 안 끝났다' 로 읽혀 당일 밤 사후 등록이 막힌다.
 */
export function canPostHocConfirm(s: ConfirmableSession, kstNow: Date): SelfCancelVerdict {
  if (s.status !== "PLANNED") return { ok: false, reason: "이미 처리된 건입니다." };
  const w = workWindow(s as unknown as OtSession);
  if (kstNow < w.end) return { ok: false, reason: "근무가 아직 끝나지 않았습니다." };
  const closesAt = confirmClosesAt(s);
  if (kstNow > closesAt)
    return {
      ok: false,
      reason:
        `그 달 급여 마감(${dateLabel(closesAt)})이 지나 바로 확정할 수 없습니다. ` +
        `등록은 되었으니 관리자에게 알려 주세요 — 해당 월 명세서가 이미 나갔으면 정정 절차가 필요합니다.`,
    };
  return { ok: true };
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

/* ───────────── 미실시 처리 (근무를 하지 않은 경우) ───────────── */

export interface SelfCancelVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * 신청자가 **"근무하지 않았다"** 고 스스로 내릴 수 있는가.
 *
 * 확정(`canSelfConfirm`)보다 **넓게 연다** — 성질이 다르기 때문이다.
 *  - 확정은 '몇 시간 일했나' 라서 근무가 끝난 뒤에만 뜻이 있다. 그래서 다음날부터 열린다.
 *  - 미실시는 **미리 알수록 좋다**. 다음 주 보강이 취소된 걸 아는데 그날이 지나기를 기다려
 *    내리게 하면, 그 사이 보강캘린더에 없는 수업이 남아 있고 확정 요청 DM 까지 나간다.
 *    그래서 **아직 확정하지 않은 건은 언제든** 내릴 수 있다.
 *  - **수당 대상 여부와 무관하다.** 결시보강처럼 반영이 정해지지 않은 건도 취소는 할 수 있어야
 *    한다 — 취소는 돈 이야기가 아니라 '그 일이 있었나' 의 문제다.
 *
 * 이미 확정한 건은 **되돌리는 것**이라 확정과 같은 창(마감 전)에서만 연다. 마감이 지난 뒤의
 * 정정은 급여에 이미 실렸을 수 있어 관리자가 봐야 한다.
 */
export function canSelfCancel(s: ConfirmableSession, now: Date): SelfCancelVerdict {
  const what = makeupKindLabel(s.category);
  if (s.status === "CANCELED" || s.status === "NOSHOW")
    return { ok: false, reason: "이미 취소·미실시로 처리된 건입니다." };
  if (s.status === "CONFIRMED") {
    // **마감이 지났을 때만** 막는다. `canSelfConfirm` 을 그대로 쓰면 '아직 근무 전이라 이르다' 로도
    // 막히는데, 취소에는 맞지 않는 이유다 — 내일 할 일을 오늘 안 하기로 정할 수 있어야 한다.
    const closesAt = confirmClosesAt(s);
    if (now > closesAt)
      return {
        ok: false,
        reason:
          `이미 확정한 ${what}이고 정정 기간(${dateLabel(closesAt)}까지)이 지났습니다. ` +
          `급여에 이미 실렸을 수 있어 관리자가 확인해야 합니다.`,
      };
  }
  return { ok: true };
}

/** 미실시 처리 전에 보여 줄 안내 — 되돌릴 수 있다는 점을 함께 적는다 */
export function cancelNotice(s: { category: string }): string {
  const what = makeupKindLabel(s.category);
  return (
    `이 ${what}을(를) **미실시**로 내립니다. 수당은 발생하지 않고, 보강캘린더에 올라가 있었다면 ` +
    `일정도 내려갑니다.\n실제로는 근무하셨다면 이 버튼을 누르지 마시고 «실근무 확정» 으로 시간을 ` +
    `적어 주세요. 잘못 눌렀다면 관리자가 되돌릴 수 있습니다.`
  );
}
