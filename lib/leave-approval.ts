// 연차 중간결재 — 어느 신청이 중간결재를 거치는지 한 곳에서 정한다.
//
// 부서(Department.leaveApprover)에 중간결재자가 지정된 부서의 연차 신청은
// 운영진 승인 채널로 바로 가지 않고 그 사람의 슬랙 DM 확인(PRE_PENDING)을 먼저 거친다.
// 지정이 없는 부서는 예전 그대로 한 단계다 — 부서마다 켜고 끄는 스위치인 셈이다.

export interface PreApproverCandidate {
  id: number;
  name: string;
  active: boolean;
  slackUserId: string | null;
}

/**
 * 이 신청이 거칠 중간결재자 — 없으면 null(운영진 승인으로 직행).
 *
 * - **본인 신청은 건너뛴다** — 자기 신청을 자기가 결재하는 모양이 되고,
 *   최종 승인(운영진)은 어차피 거치므로 결재 공백도 없다.
 * - 퇴사(비활성)했거나 슬랙 연동이 없는 결재자는 없는 것으로 본다 —
 *   DM 을 보낼 수 없는 사람에게 걸어 두면 신청이 아무도 모르게 멈춘다.
 */
export function preApproverFor(
  approver: PreApproverCandidate | null | undefined,
  requesterEmployeeId: number
): PreApproverCandidate | null {
  if (!approver) return null;
  if (!approver.active) return null;
  if (!approver.slackUserId) return null;
  if (approver.id === requesterEmployeeId) return null;
  return approver;
}

/**
 * 중간결재 확인·반려를 누를 수 있는 사람인가.
 * 지정된 결재자 본인, 또는 운영진(SLACK_APPROVERS — `adminAllowed`)이 대행할 수 있다 —
 * 결재자가 부재중일 때 신청이 멈춰 있으면 모레 시작인 휴가가 결재에 묶인다.
 */
export function canPreDecide(
  pressUserId: string,
  approverSlackId: string | null | undefined,
  adminAllowed: boolean
): boolean {
  if (approverSlackId && pressUserId === approverSlackId) return true;
  return adminAllowed;
}

/** 승인 대기로 묶어 보는 상태들 — 화면·대시보드·일일 안내가 같은 묶음을 쓴다 */
export const PENDING_STATUSES = ["PRE_PENDING", "PENDING"] as const;
