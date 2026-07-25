import { prisma } from "./db";
import { leaveSummaryFor } from "./repo";

/** 연차 신청 승인 → 사용 트랜잭션 생성 + 상태 변경 */
export async function approveLeaveRequest(requestId: number, approver = "admin") {
  const reqRow = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!reqRow) throw new Error("신청 없음");
  if (reqRow.status !== "PENDING") throw new Error("이미 처리된 신청입니다");

  const isComp = reqRow.leaveType === "COMP";
  await prisma.$transaction([
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
    }),
    prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", approverId: approver, decidedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: { actor: approver, action: "LEAVE_APPROVE", target: `req:${requestId}` },
    }),
  ]);
  return leaveSummaryFor(reqRow.employeeId);
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
