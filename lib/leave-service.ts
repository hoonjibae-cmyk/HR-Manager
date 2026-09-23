import { prisma } from "./db";
import { leaveSummaryFor } from "./repo";

/** 연차에서 차감하지 않는 휴가 종류 (병가·경조사는 별도 관리) */
export const NON_DEDUCTIBLE_TYPES = ["SICK", "SPECIAL"];

export function deductsLeave(leaveType: string): boolean {
  return !NON_DEDUCTIBLE_TYPES.includes(leaveType);
}

/** 연차 신청 승인 → 사용 트랜잭션 생성 + 상태 변경 */
export async function approveLeaveRequest(requestId: number, approver = "admin") {
  const reqRow = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { employee: { select: { name: true } } },
  });
  if (!reqRow) throw new Error("신청 없음");
  // PRE_PENDING(중간결재 대기)도 받는다 — 결재자가 부재중일 때 운영진이 웹 화면에서
  // 바로 승인해 넘길 수 있어야 한다(모레 시작인 휴가가 결재함에 묶이면 안 된다).
  // 슬랙 승인 버튼은 중간결재를 거친 뒤에만 채널에 올라오므로 이 완화가 우회로가 되지는 않는다.
  if (reqRow.status !== "PENDING" && reqRow.status !== "PRE_PENDING")
    throw new Error("이미 처리된 신청입니다");

  const isComp = reqRow.leaveType === "COMP";
  // **상태를 조건으로 건 갱신이 먼저다** — 읽고 나서 쓰면 두 승인자가 동시에 눌렀을 때 둘 다
  // PENDING 을 보고 차감을 두 번 만든다. 조건부 갱신이 한 건만 성공하므로 차감도 한 번뿐이다.
  await prisma.$transaction(async (tx: any) => {
    const upd = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: { in: ["PENDING", "PRE_PENDING"] } },
      data: { status: "APPROVED", approverId: approver, decidedAt: new Date() },
    });
    if (upd.count !== 1) throw new Error("이미 처리된 신청입니다");
    // 병가·경조사는 연차 잔여에서 차감하지 않고 기록만 남긴다
    if (deductsLeave(reqRow.leaveType)) {
      await tx.leaveTransaction.create({
        data: {
          employeeId: reqRow.employeeId,
          date: reqRow.startDate,
          days: -Math.abs(reqRow.days),
          type: "USE",
          category: isComp ? "COMP" : "STATUTORY",
          note: `${isComp ? "대휴사용" : "연차사용"} (${reqRow.reason ?? ""})`,
          requestId: reqRow.id,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actor: approver.startsWith("U") ? "SLACK" : approver,
        actorName: approver,
        action: "LEAVE_APPROVE",
        target: reqRow.employee?.name ?? `req:${requestId}`,
        employeeId: reqRow.employeeId,
        summary: `${reqRow.employee?.name ?? "직원"}의 휴가 ${reqRow.days}일을 승인했습니다.`,
        detail: JSON.stringify({ requestId, leaveType: reqRow.leaveType }),
      },
    });
  });
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
  const upd = await prisma.leaveRequest.updateMany({
    where: { id: requestId, status: "APPROVED" },
    data: {
      status: "CANCEL_PENDING",
      cancelReason: reason || "사유 미기재",
      cancelRequestedAt: new Date(),
    },
  });
  if (upd.count !== 1) throw new Error("승인된 휴가만 취소 신청할 수 있습니다.");
  return prisma.leaveRequest.findUnique({ where: { id: requestId } });
}

/** 최종 승인 전 신청 철회 — 차감 트랜잭션이 생기기 전이므로 상태만 취소로 남긴다. */
export async function withdrawLeaveRequest(
  requestId: number,
  employeeId: number,
  actorName: string,
  opts: { reason?: string; actor?: string } = {},
) {
  const reqRow = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!reqRow || reqRow.employeeId !== employeeId) throw new Error("신청 없음");
  if (reqRow.status !== "PRE_PENDING" && reqRow.status !== "PENDING")
    throw new Error("승인 대기 중인 신청만 철회할 수 있습니다.");
  await prisma.$transaction(async (tx: any) => {
    // 승인과 철회가 엇갈리면 한쪽만 성공해야 한다 — 상태 조건부 갱신
    const upd = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: { in: ["PRE_PENDING", "PENDING"] } },
      data: {
        status: "CANCELED",
        cancelReason: opts.reason ?? "신청자 철회",
        cancelRequestedAt: new Date(),
        cancelDecidedAt: new Date(),
      },
    });
    if (upd.count !== 1) throw new Error("승인 대기 중인 신청만 철회할 수 있습니다.");
    await tx.auditLog.create({
      data: {
        actor: opts.actor ?? "PORTAL",
        actorName,
        action: "LEAVE_WITHDRAW",
        target: `req:${requestId}`,
        employeeId,
        summary: `${actorName}님이 승인 전 휴가 신청(${reqRow.days}일)을 철회했습니다.`,
        detail: JSON.stringify({ requestId }),
      },
    });
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

  await prisma.$transaction(async (tx: any) => {
    // 상태 조건부 갱신이 한 건만 성공한다 — 취소 승인을 두 번 눌러도 복원은 한 번뿐이다
    const upd = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: "CANCEL_PENDING" },
      data: { status: "CANCELED", cancelDecidedAt: new Date(), approverId: approver },
    });
    if (upd.count !== 1) throw new Error("취소 승인 대기 상태가 아닙니다.");
    // 승인 시 생성된 사용 트랜잭션 제거 → 잔여 연차 복원
    await tx.leaveTransaction.deleteMany({ where: { requestId } });
    await tx.auditLog.create({
      data: {
        actor: approver.startsWith("U") ? "SLACK" : approver,
        actorName: approver,
        action: "LEAVE_CANCEL",
        target: `req:${requestId}`,
        employeeId: reqRow.employeeId,
        summary: `휴가 취소를 승인했습니다 (${reqRow.days}일 복원).`,
        detail: JSON.stringify({ requestId }),
      },
    });
  });
  return leaveSummaryFor(reqRow.employeeId);
}

/** 휴가 취소 반려 (운영진) → 원래 승인 상태로 복귀 */
export async function rejectLeaveCancel(requestId: number, approver = "admin") {
  const reqRow = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!reqRow) throw new Error("신청 없음");
  if (reqRow.status !== "CANCEL_PENDING")
    throw new Error("취소 승인 대기 상태가 아닙니다.");
  const upd = await prisma.leaveRequest.updateMany({
    where: { id: requestId, status: "CANCEL_PENDING" },
    data: { status: "APPROVED", cancelDecidedAt: new Date() },
  });
  if (upd.count !== 1) throw new Error("취소 승인 대기 상태가 아닙니다.");
  await prisma.auditLog.create({
    data: {
      actor: approver.startsWith("U") ? "SLACK" : approver,
      actorName: approver,
      action: "LEAVE_CANCEL_REJECT",
      target: `req:${requestId}`,
      summary: "휴가 취소 신청을 반려했습니다 (기존 휴가 유지).",
    },
  });
}

export async function rejectLeaveRequest(
  requestId: number,
  approver = "admin",
  note = ""
) {
  const reqRow = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
  if (!reqRow) throw new Error("신청 없음");
  // 중간결재 단계(PRE_PENDING)의 반려도 여기로 온다 (승인과 같은 이유)
  if (reqRow.status !== "PENDING" && reqRow.status !== "PRE_PENDING")
    throw new Error("이미 처리된 신청입니다");
  const upd = await prisma.leaveRequest.updateMany({
    where: { id: requestId, status: { in: ["PENDING", "PRE_PENDING"] } },
    data: { status: "REJECTED", approverId: approver, decidedAt: new Date(), decidedNote: note },
  });
  if (upd.count !== 1) throw new Error("이미 처리된 신청입니다");
  await prisma.auditLog.create({
    data: {
      actor: approver.startsWith("U") ? "SLACK" : approver,
      actorName: approver,
      action: "LEAVE_REJECT",
      target: `req:${requestId}`,
      employeeId: reqRow.employeeId,
      summary: `휴가 신청(${reqRow.days}일)을 반려했습니다.${note ? ` 사유: ${note}` : ""}`,
    },
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
