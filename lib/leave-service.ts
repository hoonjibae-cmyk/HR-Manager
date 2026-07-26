import { prisma } from "./db";
import { leaveSummaryFor } from "./repo";

/** 연차에서 차감하지 않는 휴가 종류 (병가·경조사는 별도 관리) */
export const NON_DEDUCTIBLE_TYPES = ["SICK", "SPECIAL"];

export function deductsLeave(leaveType: string): boolean {
  return !NON_DEDUCTIBLE_TYPES.includes(leaveType);
}

/** 연차 신청 승인 → 사용 트랜잭션 생성 + 상태 변경 */
export async function approveLeaveRequest(requestId: number, approver = "admin") {
  const reqRow = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!reqRow) throw new Error("신청 없음");
  if (reqRow.status !== "PENDING") throw new Error("이미 처리된 신청입니다");

  const isComp = reqRow.leaveType === "COMP";
  const ops: any[] = [];
  // 병가·경조사는 연차 잔여에서 차감하지 않고 기록만 남긴다
  if (deductsLeave(reqRow.leaveType)) {
    ops.push(
      prisma.leaveTransaction.create({
        data: {
          employeeId: reqRow.employeeId,
          date: reqRow.startDate,
          days: -Math.abs(reqRow.days),
          type: "USE",
          category: isComp ? "COMP" : "STATUTORY",
          note: `${isComp ? "대휴사용" : "연차사용"} (${reqRow.reason ?? ""})`,
          requestId: reqRow.id,
        },
      })
    );
  }
  ops.push(
    prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", approverId: approver, decidedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: { actor: approver, action: "LEAVE_APPROVE", target: `req:${requestId}` },
    })
  );
  await prisma.$transaction(ops);
  return leaveSummaryFor(reqRow.employeeId);
}

/**
 * 승인된 휴가의 취소를 신청 (직원) — 운영진 승인 대기 상태로 전환.
 */
export async function requestLeaveCancel(requestId: number, reason: string) {
  const reqRow = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!reqRow) throw new Error("신청 없음");
  if (reqRow.status !== "APPROVED")
    throw new Error("승인된 휴가만 취소 신청할 수 있습니다.");
  return prisma.leaveRequest.update({
    where: { id: requestId },
    data: {
      status: "CANCEL_PENDING",
      cancelReason: reason || "사유 미기재",
      cancelRequestedAt: new Date(),
    },
  });
}

/**
 * 휴가 취소 승인 (운영진) → 사용 트랜잭션 삭제(연차 복원) + 상태 CANCELED.
 * 캘린더 일정 삭제는 호출부에서 처리한다.
 */
export async function approveLeaveCancel(requestId: number, approver = "admin") {
  const reqRow = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!reqRow) throw new Error("신청 없음");
  if (reqRow.status !== "CANCEL_PENDING")
    throw new Error("취소 승인 대기 상태가 아닙니다.");

  await prisma.$transaction([
    // 승인 시 생성된 사용 트랜잭션 제거 → 잔여 연차 복원
    prisma.leaveTransaction.deleteMany({ where: { requestId } }),
    prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: "CANCELED", cancelDecidedAt: new Date(), approverId: approver },
    }),
    prisma.auditLog.create({
      data: { actor: approver, action: "LEAVE_CANCEL_APPROVE", target: `req:${requestId}` },
    }),
  ]);
  return leaveSummaryFor(reqRow.employeeId);
}

/** 휴가 취소 반려 (운영진) → 원래 승인 상태로 복귀 */
export async function rejectLeaveCancel(requestId: number, approver = "admin") {
  const reqRow = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!reqRow) throw new Error("신청 없음");
  if (reqRow.status !== "CANCEL_PENDING")
    throw new Error("취소 승인 대기 상태가 아닙니다.");
  await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status: "APPROVED", cancelDecidedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: { actor: approver, action: "LEAVE_CANCEL_REJECT", target: `req:${requestId}` },
  });
}

export async function rejectLeaveRequest(
  requestId: number,
  approver = "admin",
  note = ""
) {
  const reqRow = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!reqRow) throw new Error("신청 없음");
  if (reqRow.status !== "PENDING") throw new Error("이미 처리된 신청입니다");
  await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", approverId: approver, decidedAt: new Date(), decidedNote: note },
  });
  await prisma.auditLog.create({
    data: { actor: approver, action: "LEAVE_REJECT", target: `req:${requestId}` },
  });
}

/** 수동 연차 조정 (부여+ / 사용-). category: STATUTORY(본래연차) | COMP(대휴보상연차) */
export async function adjustLeave(
  employeeId: number,
  days: number,
  type: "ADJUST" | "USE" | "PAYOUT" | "GRANT",
  date: Date,
  note?: string,
  category: "STATUTORY" | "COMP" = "STATUTORY"
) {
  await prisma.leaveTransaction.create({
    data: { employeeId, days, type, date, note, category },
  });
  return leaveSummaryFor(employeeId);
}
