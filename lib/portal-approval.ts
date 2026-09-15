export type PortalLeaveAction =
  | "leave-withdraw"
  | "leave-cancel-request"
  | "leave-pre-approve"
  | "leave-pre-reject"
  | "leave-approve"
  | "leave-reject"
  | "leave-cancel-approve"
  | "leave-cancel-reject";

export interface PortalApprovalActor {
  id: number;
  department: string | null;
}

export interface PortalApprovalTarget {
  employeeId: number;
  status: string;
  requesterDepartment: string | null;
  leaveApproverId: number | null;
}

/** 포털의 최종 결재는 급여·휴가 원장을 관리하는 경영지원 재직자에게만 연다. */
export function isPortalFinalApprover(actor: PortalApprovalActor): boolean {
  return actor.department === "경영지원";
}

/**
 * 포털 결재 버튼의 서버 권한 판정.
 *
 * UI가 버튼을 숨겨도 POST를 직접 보낼 수 있으므로 소유자·지정 중간결재자·경영지원을
 * 상태별로 다시 검사한다. 중간결재 대기 건을 경영지원이 곧바로 최종 승인하는 우회도
 * 포털에서는 열지 않는다.
 */
export function canPortalLeaveAction(
  actor: PortalApprovalActor,
  target: PortalApprovalTarget,
  action: PortalLeaveAction,
): boolean {
  if (action === "leave-withdraw") {
    return (
      target.employeeId === actor.id &&
      (target.status === "PRE_PENDING" || target.status === "PENDING")
    );
  }
  if (action === "leave-cancel-request") {
    return target.employeeId === actor.id && target.status === "APPROVED";
  }
  if (action === "leave-pre-approve" || action === "leave-pre-reject") {
    return (
      target.status === "PRE_PENDING" &&
      target.employeeId !== actor.id &&
      target.leaveApproverId === actor.id
    );
  }
  if (!isPortalFinalApprover(actor)) return false;
  if (action === "leave-approve" || action === "leave-reject") {
    return target.status === "PENDING";
  }
  return target.status === "CANCEL_PENDING";
}
