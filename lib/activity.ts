// 작업 이력 기록.
//
// 관리자 로그인이 비밀번호 공유 방식이라 '누가' 는 특정되지 않는다(actor=ADMIN).
// 슬랙에서 온 작업(휴가 승인·반려 등)은 슬랙 사용자까지 남고,
// 예약 발송은 CRON 으로 남아 사람이 한 일과 구분된다.

import { prisma } from "./db";
import { headers } from "next/headers";

export const ACTION_LABEL: Record<string, string> = {
  LOGIN: "로그인",
  LOGIN_FAILED: "로그인 실패",
  LOGOUT: "로그아웃",
  PAYROLL_RUN: "급여 일괄 산정",
  PAYROLL_EDIT: "급여 개별 수정",
  PAYROLL_DELETE: "급여 기록 삭제",
  PAYROLL_UNLOCK: "발송 잠금 해제",
  PAYROLL_TIMESHEET: "시간기록표 반영",
  PAYROLL_INCENTIVE: "인센티브 명단 반영",
  PAYROLL_EXPORT: "세무사무소 제출자료 내려받기",
  PAYSLIP_SEND: "명세서 발송",
  PAYSLIP_SEND_SCHEDULED: "명세서 예약 발송",
  DOC_ISSUE: "문서 발급",
  EMPLOYEE_CREATE: "직원 등록",
  EMPLOYEE_UPDATE: "직원 정보 수정",
  EMPLOYEE_DELETE: "직원 삭제",
  CONTRACT_CREATE: "계약 작성",
  CONTRACT_UPDATE: "계약 수정",
  CONTRACT_DELETE: "계약 삭제",
  LEAVE_REQUEST: "휴가 신청",
  LEAVE_APPROVE: "휴가 승인",
  LEAVE_REJECT: "휴가 반려",
  LEAVE_CANCEL: "휴가 취소 확정",
  LEAVE_ADJUST: "연차 수동 조정",
  LEAVE_IMPORT: "연차 사용내역 일괄 등록",
  LEAVE_COMP_GRANT: "대휴 부여",
  MAKEUP_CREATE: "보강계획 사전신청",
  MAKEUP_UPDATE: "보강 실근무 확인",
  MAKEUP_DELETE: "보강 신청 삭제",
  SETTINGS_UPDATE: "설정 변경",
};

/** 되돌리기 어렵거나 돈·개인정보가 오가는 작업 (이력 화면 기본 필터) */
export const SENSITIVE_ACTIONS = [
  "PAYROLL_RUN",
  "PAYROLL_EDIT",
  "PAYROLL_DELETE",
  "PAYROLL_UNLOCK",
  "PAYSLIP_SEND",
  "PAYSLIP_SEND_SCHEDULED",
  "DOC_ISSUE",
  "CONTRACT_CREATE",
  "CONTRACT_UPDATE",
  "CONTRACT_DELETE",
  "EMPLOYEE_DELETE",
];

export interface LogInput {
  action: keyof typeof ACTION_LABEL | string;
  summary: string;
  actor?: string; // ADMIN | SLACK | CRON | SYSTEM
  actorName?: string | null;
  target?: string | null;
  employeeId?: number | null;
  meta?: unknown;
}

/** 요청 IP (공유 비밀번호라 최소한의 구분 단서로 남긴다) */
async function requestIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    return fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip");
  } catch {
    return null; // 요청 컨텍스트 밖(크론 등)
  }
}

/**
 * 이력 한 줄 기록.
 * 기록 실패가 본 작업을 막으면 안 되므로 어떤 경우에도 예외를 던지지 않는다.
 */
export async function logActivity(input: LogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: String(input.action),
        actor: input.actor ?? "ADMIN",
        actorName: input.actorName ?? null,
        target: input.target ?? null,
        employeeId: input.employeeId ?? null,
        summary: input.summary,
        detail: input.meta === undefined ? "{}" : JSON.stringify(input.meta),
        ip: input.actor === "CRON" ? null : await requestIp(),
      },
    });
  } catch (e: any) {
    console.error("[activity] 기록 실패:", e?.message);
  }
}
