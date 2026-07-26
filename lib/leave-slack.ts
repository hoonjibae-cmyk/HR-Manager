// 슬랙 휴가 신청 공통 처리 (모달 제출 · 슬래시 명령이 함께 사용)
import { prisma } from "./db";
import { countLeaveDays, summarizeLeave, summarizeComp, type LeaveTxn } from "./leave";
import { postMessage, approvalBlocks } from "./slack";
import { ymd } from "./format";
import { LEAVE_TYPE_LABEL, isHalfDayLeave } from "./constants";

export async function leaveBalanceOf(emp: { id: number; hireDate: Date }) {
  const txns = await prisma.leaveTransaction.findMany({ where: { employeeId: emp.id } });
  const mapped = txns.map((t) => ({
    date: t.date,
    days: t.days,
    type: t.type as any,
    category: (t as any).category ?? "STATUTORY",
  })) as LeaveTxn[];
  return {
    summary: summarizeLeave(emp.hireDate, new Date(), mapped),
    comp: summarizeComp(mapped),
  };
}

export interface LeaveSubmitInput {
  leaveType: string; // ANNUAL | HALF | COMP | SICK | SPECIAL
  start: Date;
  end: Date;
  reason: string;
  halfTimeNote?: string;
  channel?: string; // 승인 카드를 게시할 채널 (미지정 시 SLACK_APPROVAL_CHANNEL)
  source?: string;
}

export interface LeaveSubmitResult {
  ok: boolean;
  /** 실패 시 사용자에게 보여줄 사유 (모달 필드 오류로도 사용) */
  error?: string;
  field?: "start" | "end" | "kind";
  days?: number;
  remaining?: number;
  poolLabel?: string;
  requestId?: number;
}

/**
 * 휴가 신청 생성 + 관리자 승인 카드 게시.
 * 잔여 검증(대휴), 근무일 산정, 완전비율제 제외를 여기서 일괄 처리한다.
 */
export async function submitLeaveRequest(
  emp: { id: number; name: string; hireDate: Date; department: string | null; payScheme: string },
  input: LeaveSubmitInput
): Promise<LeaveSubmitResult> {
  if (emp.payScheme === "RATIO") {
    return { ok: false, error: "완전비율제(위탁) 계약은 연차휴가 적용 대상이 아닙니다." };
  }
  if (input.end < input.start) {
    return { ok: false, error: "종료일이 시작일보다 빠릅니다.", field: "end" };
  }

  const isHalf = isHalfDayLeave(input.leaveType);
  const holidays = (await prisma.holiday.findMany()).map((h) => h.date);
  const days = countLeaveDays(input.start, input.end, { half: isHalf, holidays });
  if (days <= 0) {
    return {
      ok: false,
      error: "신청 기간에 근무일이 없습니다 (주말·공휴일 제외). 날짜를 확인하세요.",
      field: "start",
    };
  }

  const { summary, comp } = await leaveBalanceOf(emp);
  const isComp = input.leaveType === "COMP";
  const poolRemaining = isComp ? comp.remaining : summary.remaining;
  const poolLabel = isComp ? "대휴보상연차" : "연차";

  if (isComp && comp.remaining < days) {
    return {
      ok: false,
      error: `대휴보상연차 잔여(${comp.remaining}일)가 신청일수(${days}일)보다 부족합니다.`,
      field: "kind",
    };
  }

  const reasonFull =
    input.reason + (input.halfTimeNote ? ` (사용시간 ${input.halfTimeNote})` : "");

  const reqRow = await prisma.leaveRequest.create({
    data: {
      employeeId: emp.id,
      startDate: input.start,
      endDate: input.end,
      days,
      leaveType: input.leaveType,
      reason: reasonFull || "개인사유",
      status: "PENDING",
      source: input.source ?? "SLACK",
    },
  });

  const channel = process.env.SLACK_APPROVAL_CHANNEL || input.channel;
  if (channel) {
    const typeLabel = LEAVE_TYPE_LABEL[input.leaveType] ?? "연차";
    const posted: any = await postMessage(
      channel,
      `${typeLabel} 신청: ${emp.name} ${days}일`,
      approvalBlocks({
        requestId: reqRow.id,
        name: emp.name,
        dept: emp.department ?? "",
        start: input.start,
        end: input.end,
        days,
        reason: `[${typeLabel}] ${reasonFull || "개인사유"}`,
        remaining: poolRemaining,
      })
    );
    if (posted?.ok) {
      await prisma.leaveRequest.update({
        where: { id: reqRow.id },
        data: { slackChannel: posted.channel, slackTs: posted.ts },
      });
    }
  }

  return { ok: true, days, remaining: poolRemaining, poolLabel, requestId: reqRow.id };
}

/** 표시용 기간 라벨 */
export function rangeLabel(start: Date, end: Date, days: number): string {
  return days > 1 ? `${ymd(start)} ~ ${ymd(end)}` : ymd(start);
}

/**
 * 직원이 취소 신청할 수 있는 휴가 목록.
 * 승인 완료(APPROVED) + 종료일이 오늘(KST) 이후인 건만.
 */
export async function cancelableLeaves(employeeId: number) {
  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = new Date(
    Date.UTC(todayKst.getUTCFullYear(), todayKst.getUTCMonth(), todayKst.getUTCDate())
  );
  const rows = await prisma.leaveRequest.findMany({
    where: { employeeId, status: "APPROVED", endDate: { gte: today } },
    orderBy: { startDate: "asc" },
    take: 50,
  });
  return rows.map((r) => ({
    row: r,
    id: r.id,
    label: `${rangeLabel(r.startDate, r.endDate, r.days)} · ${
      LEAVE_TYPE_LABEL[r.leaveType] ?? "연차"
    } ${r.days}일`,
  }));
}
