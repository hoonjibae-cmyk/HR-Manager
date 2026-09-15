import { describe, expect, it } from "vitest";
import { canPortalLeaveAction, isPortalFinalApprover } from "./portal-approval";

const actor = (id: number, department: string | null) => ({ id, department });
const target = (
  employeeId: number,
  status: string,
  leaveApproverId: number | null = null,
) => ({
  employeeId,
  status,
  requesterDepartment: "교육운영팀",
  leaveApproverId,
});

describe("portal leave approval authorization", () => {
  it("opens final approval only to management support", () => {
    expect(isPortalFinalApprover(actor(1, "경영지원"))).toBe(true);
    expect(isPortalFinalApprover(actor(2, "교육운영팀"))).toBe(false);
    expect(canPortalLeaveAction(actor(1, "경영지원"), target(9, "PENDING"), "leave-approve")).toBe(true);
    expect(canPortalLeaveAction(actor(2, "교육운영팀"), target(9, "PENDING"), "leave-approve")).toBe(false);
  });

  it("allows only the department's assigned intermediate approver", () => {
    expect(canPortalLeaveAction(actor(4, "교수부"), target(9, "PRE_PENDING", 4), "leave-pre-approve")).toBe(true);
    expect(canPortalLeaveAction(actor(5, "교수부"), target(9, "PRE_PENDING", 4), "leave-pre-approve")).toBe(false);
    expect(canPortalLeaveAction(actor(4, "교수부"), target(4, "PRE_PENDING", 4), "leave-pre-approve")).toBe(false);
  });

  it("limits withdrawal and cancellation requests to the requester and valid state", () => {
    expect(canPortalLeaveAction(actor(9, "교수부"), target(9, "PRE_PENDING"), "leave-withdraw")).toBe(true);
    expect(canPortalLeaveAction(actor(8, "교수부"), target(9, "PENDING"), "leave-withdraw")).toBe(false);
    expect(canPortalLeaveAction(actor(9, "교수부"), target(9, "APPROVED"), "leave-cancel-request")).toBe(true);
    expect(canPortalLeaveAction(actor(9, "교수부"), target(9, "CANCEL_PENDING"), "leave-cancel-request")).toBe(false);
  });

  it("does not let final approvers bypass an unfinished intermediate decision", () => {
    expect(canPortalLeaveAction(actor(1, "경영지원"), target(9, "PRE_PENDING", 4), "leave-approve")).toBe(false);
  });
});
