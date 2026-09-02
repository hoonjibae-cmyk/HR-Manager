// 슬랙 휴가 신청 공통 처리 (모달 제출 · 슬래시 명령이 함께 사용)
import { prisma } from "./db";
import {
  countLeaveDays,
  summarizeLeave,
  summarizeComp,
  isLeaveEligible,
  type LeaveTxn,
  type LeaveSummary,
  type CompSummary,
} from "./leave";
import { computeWeeklyHours } from "./payroll";
import { postMessage, approvalBlocks, preApprovalBlocks } from "./slack";
import { ymd } from "./format";
import { LEAVE_TYPE_LABEL, isHalfDayLeave, parseSchedule, isContractorContract } from "./constants";
import { preApproverFor } from "./leave-approval";

/** 연차 미적용 판정 근거 — 안내 문구에 사유를 정확히 쓰기 위해 함께 들고 다닌다 */
export interface LeaveEligibility {
  eligible: boolean;
  weeklyHours: number;
  /** 계약에서 미적용으로 못박은 경우 (근로시간 자동 판정과 구분) */
  forcedOff: boolean;
}

export async function leaveBalanceOf(emp: {
  id: number;
  hireDate: Date;
  schedule?: string | null;
  leaveEligible?: boolean | null;
}) {
  const txns = await prisma.leaveTransaction.findMany({ where: { employeeId: emp.id } });
  const mapped = txns.map((t) => ({
    date: t.date,
    days: t.days,
    type: t.type as any,
    category: (t as any).category ?? "STATUTORY",
  })) as LeaveTxn[];

  // 화면과 같은 규칙으로 판정한다 — 여기서 빠뜨리면 슬랙만 연차가 있는 것처럼 보인다
  const { weeklyContractual } = computeWeeklyHours(parseSchedule(emp.schedule ?? "[]"));
  const eligibility: LeaveEligibility = {
    eligible: isLeaveEligible(weeklyContractual, emp.leaveEligible),
    weeklyHours: weeklyContractual,
    forcedOff: emp.leaveEligible === false,
  };

  return {
    summary: summarizeLeave(emp.hireDate, new Date(), mapped, { eligible: eligibility.eligible }),
    comp: summarizeComp(mapped),
    eligibility,
    /** 사용 내역 표시용 원본 — leaveBalanceText 에 그대로 넘긴다 */
    txns: mapped,
  };
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 2026-07-29 → "2026.07.29 (수)".
 * 연차기간은 입사일 기준이라 두 해에 걸치는 게 보통(2025.11 ~ 2026.11)이라
 * 월/일만 쓰면 어느 해인지 알 수 없다. 앱의 다른 날짜 표기와도 같은 형식.
 */
function dayLine(d: Date): string {
  return `${ymd(d)} (${WEEK[d.getUTCDay()]})`;
}

/** 슬랙 사용 내역에 한 번에 보여줄 최대 줄 수 — 넘치면 오래된 쪽을 접는다 */
const MAX_USE_LINES = 12;

/**
 * 이번 연차기간에 쓴 내역을 날짜순으로 늘어놓는다.
 * 잔여 일수만 보면 "내가 언제 썼더라" 를 알 수 없어 직원 문의가 관리자에게 몰린다.
 * 줄 수가 넘치면 **최근 것을 남기고 오래된 쪽을 접는다** — 궁금한 건 방금 쓴 연차다.
 */
export function leaveUseLines(txns: LeaveTxn[], from: Date, to: Date): string[] {
  // 부호는 보지 않는다 — 집계(usedInPeriod)와 같은 기준으로 절댓값을 쓴다
  const uses = txns
    .filter((t) => t.type === "USE" || t.type === "PAYOUT")
    .filter((t) => t.date >= from && t.date <= to)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const shown = uses.slice(-MAX_USE_LINES);
  const hidden = uses.length - shown.length;
  const lines = shown.map(
    (t) =>
      `• ${dayLine(t.date)} ${
        (t.category ?? "STATUTORY") === "COMP" ? "대휴" : "연차"
      } ${Math.abs(t.days)}일`
  );
  if (hidden > 0) lines.unshift(`• …이전 ${hidden}건 생략`);
  return lines;
}

/**
 * 위탁(완전비율제) 계약자 안내 — 슬래시 명령·채널 버튼·홈탭·신청 제출 네 곳이 같은 문구를 쓴다.
 * 초단시간 미적용과는 사유가 다르다: 그쪽은 근로자인데 연차만 안 생기는 것이고,
 * 이쪽은 애초에 근로기준법이 적용되지 않는 계약이다.
 */
export const RATIO_LEAVE_NOTICE =
  "📌 위탁계약(프리랜서·완전비율제)은 근로기준법상 연차휴가 적용 대상이 아닙니다.\n일정 조정은 관리자에게 문의해 주세요.";

/** 모달 오류칸처럼 한 줄로 보여야 하는 자리용 */
export const RATIO_LEAVE_NOTICE_INLINE =
  "위탁계약(프리랜서·완전비율제)은 근로기준법상 연차휴가 적용 대상이 아닙니다. 일정 조정은 관리자에게 문의해 주세요.";

/** 미적용 사유 한 줄 */
export function ineligibleReason(e: LeaveEligibility): string {
  return e.forcedOff
    ? "계약상 연차휴가가 적용되지 않는 근무형태입니다."
    : `1주 소정근로시간이 ${e.weeklyHours.toFixed(1)}시간(15시간 미만)이라 근로기준법 제18조 제3항에 따라 연차가 발생하지 않습니다.`;
}

/**
 * 미적용 직원이 신청을 시도할 때 돌려줄 안내. 신청할 수 있으면 null.
 * 관리자가 따로 부여한 연차나 대휴가 남아 있으면 그건 쓸 수 있으므로 막지 않는다.
 */
export function leaveBlockNotice(
  summary: LeaveSummary,
  comp: CompSummary,
  e: LeaveEligibility
): string | null {
  if (e.eligible) return null;
  if (summary.remaining > 0 || comp.remaining > 0) return null;
  return (
    `${ineligibleReason(e)}\n\n` +
    "신청할 수 있는 연차·대휴가 없습니다. 휴무가 필요하시면 관리자에게 문의해 주세요."
  );
}

/**
 * 직원에게 보여줄 연차 현황 문구.
 * 입사 후 누계는 체감이 안 되므로 '이번 연차기간(입사일 기준 1년)' 을 기준으로 보여주고,
 * 누계는 맨 아래 참고용 한 줄로만 남긴다.
 */
export function leaveBalanceText(
  name: string,
  summary: LeaveSummary,
  comp: CompSummary,
  eligibility?: LeaveEligibility,
  txns?: LeaveTxn[]
): string {
  const p = summary.period;
  const useLines = txns ? leaveUseLines(txns, p.start, p.end) : [];
  if (!summary.eligible) {
    // 주 15시간 미만 초단시간근로자·계약상 연차 미적용 (근로기준법 §18③)
    const reason = eligibility
      ? ineligibleReason(eligibility)
      : "현재 계약 기준으로는 법정 연차가 발생하지 않습니다.";
    const lines = [
      `*${name}님의 연차 현황* (근속 ${summary.serviceLabel})`,
      ``,
      `📌 ${reason}`,
    ];
    if (p.remaining > 0) lines.push(`• 관리자가 따로 부여한 연차 잔여 *${p.remaining}일*`);
    if (comp.remaining > 0) lines.push(`• 대휴보상연차 잔여 *${comp.remaining}일*`);
    if (useLines.length) lines.push(``, `*사용 내역* (${ymd(p.start)} ~ ${ymd(p.end)})`, ...useLines);
    lines.push(
      ``,
      p.remaining > 0 || comp.remaining > 0
        ? "위 잔여분은 `/연차 신청` 으로 사용할 수 있습니다."
        : "휴무가 필요하시면 관리자에게 문의해 주세요."
    );
    return lines.join("\n");
  }
  const lines = [
    `*${name}님의 연차 현황* (근속 ${summary.serviceLabel})`,
    ``,
    `*이번 연차기간* ${ymd(p.start)} ~ ${ymd(p.end)} · ${p.label}`,
    `• 발생 ${p.granted}${p.carriedOver ? ` (+이월 ${p.carriedOver})` : ""} · 사용 ${p.used} · *잔여 ${p.remaining}일*`,
  ];
  if (p.scheduled > 0) lines.push(`• 앞으로 ${p.scheduled}일 더 발생 예정 (매월 개근 시 1일씩)`);
  lines.push(`• 사용기한 ${ymd(p.end)} — 이 날짜까지 쓰지 않은 연차는 소멸됩니다.`);
  if (summary.nextGrantDate)
    lines.push(`• 다음 발생 ${ymd(summary.nextGrantDate)} (${summary.nextGrantDays}일)`);
  if (comp.granted > 0)
    lines.push(
      `• 대휴보상연차: 발생 ${comp.granted} · 사용 ${comp.used} · *잔여 ${comp.remaining}일* (기한 없음)`
    );
  // 언제 썼는지를 함께 보여준다 — 잔여 숫자만으로는 확인이 안 돼 관리자에게 되묻게 된다
  if (useLines.length) lines.push(``, `*사용 내역*`, ...useLines);
  else lines.push(``, `_이번 기간에 사용한 연차가 없습니다._`);
  // 입사 후 누계는 직원 화면에 넣지 않는다 — 지금 쓸 수 있는 일수와 무관해 혼선만 준다.
  // (누계·소멸 이력은 관리자 화면 '직원 상세 → 연차 현황' 에서 확인)
  return lines.join("\n");
}

/** 모달 헤더에 넣을 이번 기간 요약 */
export function modalPeriod(summary: LeaveSummary) {
  return {
    start: ymd(summary.period.start),
    end: ymd(summary.period.end),
    granted: summary.period.granted + summary.period.carriedOver,
    used: summary.period.used,
  };
}

export interface LeaveSubmitInput {
  leaveType: string; // ANNUAL | HALF | COMP | SICK | SPECIAL
  start: Date;
  end: Date;
  reason: string;
  halfTimeNote?: string;
  /** 업무조치사항 — 부재 중 수업·업무 처리 계획 */
  workPlan?: string;
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
  /** 중간결재를 거치는 신청이면 결재자 이름 — 신청자 DM 문구가 갈린다 */
  preApproverName?: string;
}

/**
 * 운영진 승인 카드 게시 — 신규 신청(직행)과 중간결재 확인 뒤, 두 경로가 같은 카드를 쓴다.
 * 따로 만들면 한쪽만 문구를 고쳐 '같은 신청서' 로 안 읽힌다.
 */
export async function postLeaveApprovalCard(args: {
  requestId: number;
  name: string;
  dept: string;
  start: Date;
  end: Date;
  days: number;
  typeLabel: string;
  reason: string;
  remaining: number;
  workPlan?: string | null;
  preApprovedBy?: string | null;
  fallbackChannel?: string | null;
}): Promise<boolean> {
  const channel = process.env.SLACK_APPROVAL_CHANNEL || args.fallbackChannel;
  if (!channel) return false;
  const posted: any = await postMessage(
    channel,
    `${args.typeLabel} 신청: ${args.name} ${args.days}일`,
    approvalBlocks({
      requestId: args.requestId,
      name: args.name,
      dept: args.dept,
      start: args.start,
      end: args.end,
      days: args.days,
      reason: args.reason,
      remaining: args.remaining,
      workPlan: args.workPlan ?? undefined,
      preApprovedBy: args.preApprovedBy ?? undefined,
    })
  ).catch(() => null);
  if (posted?.ok) {
    await prisma.leaveRequest.update({
      where: { id: args.requestId },
      data: { slackChannel: posted.channel, slackTs: posted.ts },
    });
    return true;
  }
  return false;
}

/**
 * 휴가 신청 생성 + 관리자 승인 카드 게시.
 * 잔여 검증(대휴), 근무일 산정, 완전비율제 제외를 여기서 일괄 처리한다.
 */
export async function submitLeaveRequest(
  emp: {
    id: number;
    name: string;
    hireDate: Date;
    department: string | null;
    payScheme: string;
    schedule?: string | null;
    leaveEligible?: boolean | null;
  },
  input: LeaveSubmitInput
): Promise<LeaveSubmitResult> {
  if (isContractorContract(emp)) {
    return { ok: false, error: RATIO_LEAVE_NOTICE_INLINE };
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

  const { summary, comp, eligibility } = await leaveBalanceOf(emp);
  const isComp = input.leaveType === "COMP";
  const poolRemaining = isComp ? comp.remaining : summary.remaining;
  const poolLabel = isComp ? "대휴보상연차" : "연차";

  // 연차 미적용인데 쓸 수 있는 잔여도 없으면 신청 자체를 만들지 않는다
  const blocked = leaveBlockNotice(summary, comp, eligibility);
  if (blocked) return { ok: false, error: blocked, field: "kind" };

  // 미적용 직원이 연차를 신청하면 관리자 부여분 안에서만 허용한다
  if (!eligibility.eligible && !isComp && summary.remaining < days) {
    return {
      ok: false,
      error:
        `${ineligibleReason(eligibility)}\n` +
        `관리자가 따로 부여한 연차 잔여 ${summary.remaining}일 안에서만 신청할 수 있습니다 (신청 ${days}일).`,
      field: "kind",
    };
  }

  if (isComp && comp.remaining < days) {
    return {
      ok: false,
      error: `대휴보상연차 잔여(${comp.remaining}일)가 신청일수(${days}일)보다 부족합니다.`,
      field: "kind",
    };
  }

  const reasonFull =
    input.reason + (input.halfTimeNote ? ` (사용시간 ${input.halfTimeNote})` : "");

  // 부서에 중간결재자가 지정돼 있으면 운영진 승인 전에 그 사람의 확인을 먼저 거친다.
  // 본인 신청·퇴사자·슬랙 미연동 결재자는 preApproverFor 가 걸러 직행시킨다.
  const dept = emp.department
    ? await prisma.department
        .findUnique({
          where: { name: emp.department },
          include: {
            leaveApprover: {
              select: { id: true, name: true, active: true, slackUserId: true },
            },
          },
        })
        .catch(() => null)
    : null;
  const preApprover = preApproverFor(dept?.leaveApprover ?? null, emp.id);

  const typeLabel = LEAVE_TYPE_LABEL[input.leaveType] ?? "연차";
  const reqRow = await prisma.leaveRequest.create({
    data: {
      employeeId: emp.id,
      startDate: input.start,
      endDate: input.end,
      days,
      leaveType: input.leaveType,
      reason: reasonFull || "개인사유",
      workPlan: input.workPlan?.trim() || null,
      status: preApprover ? "PRE_PENDING" : "PENDING",
      source: input.source ?? "SLACK",
    },
  });

  if (preApprover) {
    // 중간결재자 DM — 확인·반려 버튼. slackChannel/slackTs 에는 이 DM 을 담아 두고,
    // 확인되면 승인 채널 카드로 갈아 끼운다(단계마다 '지금 버튼이 살아 있는 메시지' 하나만 가리킨다).
    const posted: any = await postMessage(
      preApprover.slackUserId!,
      `연차 중간결재 요청: ${emp.name} ${days}일`,
      preApprovalBlocks({
        requestId: reqRow.id,
        name: emp.name,
        dept: emp.department ?? "",
        start: input.start,
        end: input.end,
        days,
        reason: `[${typeLabel}] ${reasonFull || "개인사유"}`,
        remaining: poolRemaining,
        workPlan: input.workPlan,
      })
    ).catch(() => null);
    if (posted?.ok) {
      await prisma.leaveRequest.update({
        where: { id: reqRow.id },
        data: { slackChannel: posted.channel, slackTs: posted.ts },
      });
      return {
        ok: true,
        days,
        remaining: poolRemaining,
        poolLabel,
        requestId: reqRow.id,
        preApproverName: preApprover.name,
      };
    }
    // DM 을 못 보냈으면(연동 계정 삭제 등) 중간결재에 걸어 두지 않고 직행으로 되돌린다 —
    // 아무도 못 받는 결재함에 넣어 두면 신청이 조용히 멈춘다.
    await prisma.leaveRequest.update({ where: { id: reqRow.id }, data: { status: "PENDING" } });
  }

  await postLeaveApprovalCard({
    requestId: reqRow.id,
    name: emp.name,
    dept: emp.department ?? "",
    start: input.start,
    end: input.end,
    days,
    typeLabel,
    reason: `[${typeLabel}] ${reasonFull || "개인사유"}`,
    remaining: poolRemaining,
    workPlan: input.workPlan,
    fallbackChannel: input.channel,
  });

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
