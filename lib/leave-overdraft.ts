// 연차 초과 사용(잔여 마이너스) 신청 — 판정과 안내 문구.
//
// 연차는 **발생한 범위 안에서만** 쓸 수 있는 권리다(근로기준법 §60). 잔여가 0 이하인데 더 쓰면
// 앞으로 발생할 연차를 미리 당겨 쓰는 셈이고, 그대로 퇴직하면 초과분은 회사가 준 적 없는
// 유급휴가가 된다. 그래서 초과분을 **퇴직월 급여에서 공제한다는 동의**를 신청 시점에 받는다.
// 임금 공제는 §43(전액불) 때문에 근로자의 **명시적 동의**가 근거여야 하므로, 신청마다 체크를
// 받고 그 시각을 신청서에 새긴다(임금공제 동의서의 연차 초과사용 정산 조항과 같은 내용이다).

/** 연차 잔여에서 차감되는 종류 — 대휴(COMP)는 별도 잔여, 병가·경조사는 차감하지 않는다 */
export const OVERDRAFT_TYPES = ["ANNUAL", "HALF", "HALF_AM", "HALF_PM"] as const;

export function affectsAnnualBalance(leaveType: string): boolean {
  return (OVERDRAFT_TYPES as readonly string[]).includes(leaveType);
}

export interface OverdraftCheck {
  /** 이번 신청으로 잔여가 0 밑으로 내려가는가 (이미 마이너스인 경우 포함) */
  overdrawn: boolean;
  /** 지금 잔여 (승인된 사용분만 반영) */
  remaining: number;
  /** 아직 승인되지 않은 연차 신청 일수 — 승인되면 잔여에서 빠진다 */
  pending: number;
  /** 이번 신청 일수 */
  days: number;
  /** 모두 승인되면 남는 잔여 (음수면 초과 사용) */
  after: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 이번 신청이 잔여를 넘는지 판정한다.
 *
 * **승인 대기 중인 신청도 함께 뺀다** — 잔여 1일인 사람이 1일짜리를 두 번 연달아 내면 각각은
 * 잔여 안이지만 둘 다 승인되면 −1일이 된다. 승인 전 잔여만 보면 두 번째 신청에서 동의를
 * 받을 기회가 사라진다.
 */
export function checkOverdraft(input: {
  leaveType: string;
  remaining: number;
  pending: number;
  days: number;
}): OverdraftCheck {
  const remaining = r2(input.remaining);
  const pending = r2(Math.max(0, input.pending));
  const days = r2(input.days);
  const after = r2(remaining - pending - days);
  return {
    overdrawn: affectsAnnualBalance(input.leaveType) && days > 0 && after < 0,
    remaining,
    pending,
    days,
    after,
  };
}

/**
 * 양식을 열 때부터 동의란을 보여 줄지 — 쓸 수 있는 연차가 이미 없으면(0 이하) 어떤 연차
 * 신청이든 초과가 되므로 처음부터 띄운다. 잔여가 남아 있으면 제출 때 판정해 필요할 때만 띄운다.
 */
export function showConsentUpfront(remaining: number, pending: number): boolean {
  return r2(remaining - Math.max(0, pending)) <= 0;
}

const d = (n: number) => `${n}일`;

/** 모달·포털에 띄울 안내 (mrkdwn — `*굵게*`) */
export function overdraftNoticeText(c: Pick<OverdraftCheck, "remaining" | "pending" | "days" | "after">, opts?: { upfront?: boolean }): string {
  const figures = opts?.upfront
    ? `현재 잔여 연차 *${d(c.remaining)}*${c.pending > 0 ? ` (승인 대기 ${d(c.pending)} 반영 시 *${d(r2(c.remaining - c.pending))}*)` : ""}`
    : `현재 잔여 *${d(c.remaining)}*${c.pending > 0 ? ` − 승인 대기 ${d(c.pending)}` : ""} − 이번 신청 ${d(c.days)} → *신청 후 ${d(c.after)}*`;
  return (
    `⚠️ *사용할 수 있는 연차를 초과한 신청입니다*\n${figures}\n\n` +
    `근로기준법상 연차휴가는 이미 발생한 일수 안에서 사용하는 것이 원칙이라, 잔여가 마이너스(−)가 되는 ` +
    `연차는 그대로는 사용할 수 없습니다. 다만 아래 내용에 동의하시면 *앞으로 발생할 연차를 미리 당겨 쓰는 것*으로 처리해 신청할 수 있습니다.\n` +
    `• 이후 발생하는 연차로 초과분이 먼저 채워집니다.\n` +
    `• 퇴직 시점까지 다 채워지지 않은 초과분은 *초과 일수 × 1일 통상임금*으로 계산해 *퇴직월 급여에서 공제*합니다.`
  );
}

/** 동의 체크박스 문구 (plain_text — 슬랙 체크박스 라벨은 150자 이내) */
export const OVERDRAFT_CONSENT_LABEL =
  "위 내용을 확인했으며, 퇴직 시 남은 연차 초과분을 퇴직월 급여에서 공제하는 데 동의합니다.";

/** 동의 없이 제출했을 때 모달 오류칸 한 줄 */
export const OVERDRAFT_CONSENT_REQUIRED =
  "잔여 연차를 초과하는 신청입니다. 안내를 확인하고 동의란에 체크해야 제출할 수 있습니다.";

/** 승인 카드·결재 DM 에 붙는 한 줄 — 승인자가 초과 신청임을 모르고 누르지 않게 */
export function overdraftApprovalLine(after: number): string {
  return `⚠️ *잔여 초과 신청* — 승인 시 잔여 ${d(after)} · 신청자가 퇴직 시 초과분 급여 공제에 동의함`;
}
