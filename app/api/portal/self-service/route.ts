import { waitUntil } from "@vercel/functions";
import { overdraftNoticeText, OVERDRAFT_CONSENT_LABEL } from "@/lib/leave-overdraft";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import {
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  MAKEUP_CATEGORY_LABEL,
  MAKEUP_STATUS_LABEL,
} from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createLeaveEvent, deleteLeaveEvent, gcalConfigured } from "@/lib/gcal";
import { refreshHomeTab } from "@/lib/home-tab";
import {
  approveLeaveCancel,
  approveLeaveRequest,
  deductsLeave,
  rejectLeaveCancel,
  rejectLeaveRequest,
  requestLeaveCancel,
  withdrawLeaveRequest,
} from "@/lib/leave-service";
import {
  leaveBalanceOf,
  postLeaveApprovalCard,
  rangeLabel,
  submitLeaveRequest,
} from "@/lib/leave-slack";
import {
  canSelfCancel,
  canSelfConfirm,
  confirmDeadlineLabel,
  NOT_PAYABLE_HINT,
} from "@/lib/makeup-confirm";
import {
  cancelMakeupSession,
  confirmMakeupActuals,
  createMakeupSession,
  getOvertimePolicy,
  holidayYmds,
  syncMakeupCalendar,
} from "@/lib/makeup-service";
import {
  confirmInitials,
  makeupDateLabel,
  parseConfirmInput,
  parseMakeupInput,
} from "@/lib/makeup-slack";
import { isPayEligible, isPremiumDay } from "@/lib/overtime";
import {
  canPortalLeaveAction,
  isPortalFinalApprover,
  type PortalLeaveAction,
} from "@/lib/portal-approval";
import { authenticatedPortalStaff } from "@/lib/portal-staff-request";
import {
  cancelApprovalBlocks,
  postMessage,
  slackCall,
  updateMessage,
} from "@/lib/slack";

export const dynamic = "force-dynamic";

const leaveKinds = new Set(["ANNUAL", "HALF", "COMP", "SICK", "SPECIAL"]);
const makeupKinds = new Set(["IMMEDIATE", "MANDATORY", "ABSENCE", "OTHER"]);
const leaveActions = new Set<PortalLeaveAction>([
  "leave-withdraw",
  "leave-cancel-request",
  "leave-pre-approve",
  "leave-pre-reject",
  "leave-approve",
  "leave-reject",
  "leave-cancel-approve",
  "leave-cancel-reject",
]);

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numericId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function ymdDate(value: unknown) {
  const input = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const date = new Date(`${input}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input
    ? null
    : date;
}

function dateValue(date: Date | null | undefined) {
  return date ? date.toISOString() : null;
}

function todayKstWallClock() {
  return new Date(new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10));
}

function settledSlackMessage(
  row: { slackChannel: string | null; slackTs: string | null },
  message: string,
) {
  if (!row.slackChannel || !row.slackTs) return Promise.resolve(null);
  return updateMessage(row.slackChannel, row.slackTs, message, [
    { type: "section", text: { type: "mrkdwn", text: message } },
  ]).catch(() => null);
}

function dm(slackUserId: string | null, message: string) {
  if (!slackUserId) return Promise.resolve(null);
  return slackCall("chat.postMessage", { channel: slackUserId, text: message }).catch(() => null);
}

function approvalItem(row: any, role: "INTERMEDIATE" | "FINAL") {
  return {
    id: row.id,
    role,
    kind: row.status === "CANCEL_PENDING" ? "CANCEL" : "LEAVE",
    status: row.status,
    statusLabel: LEAVE_STATUS_LABEL[row.status] || row.status,
    employee: {
      name: row.employee.name,
      department: row.employee.department || "소속 없음",
      position: row.employee.position,
    },
    start: dateValue(row.startDate),
    end: dateValue(row.endDate),
    days: row.days,
    typeLabel: LEAVE_TYPE_LABEL[row.leaveType] || row.leaveType,
    reason: row.reason,
    workPlan: row.workPlan,
    cancelReason: row.cancelReason,
    createdAt: dateValue(row.createdAt),
  };
}

export async function GET(req: Request) {
  const auth = await authenticatedPortalStaff(req, "hr:self-service");
  if (!auth) return noStoreJson({ error: "직원 권한을 확인할 수 없습니다." }, { status: 401 });
  const { employee } = auth;
  const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const finalApprover = isPortalFinalApprover(employee);
  const [approverDepartments, policy, holidays] = await Promise.all([
    prisma.department.findMany({
      where: { leaveApproverId: employee.id },
      select: { name: true },
    }),
    getOvertimePolicy(),
    holidayYmds(),
  ]);
  const departmentNames = approverDepartments.map((item) => item.name);
  const [balance, leaveRequests, makeupRequests, intermediateRequests, finalRequests] =
    await Promise.all([
      leaveBalanceOf(employee),
      prisma.leaveRequest.findMany({
        where: { employeeId: employee.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.makeupSession.findMany({
        where: { employeeId: employee.id, planStart: { gte: from } },
        orderBy: { planStart: "desc" },
        take: 20,
      }),
      departmentNames.length
        ? prisma.leaveRequest.findMany({
            where: {
              status: "PRE_PENDING",
              employeeId: { not: employee.id },
              employee: { department: { in: departmentNames } },
            },
            include: { employee: true },
            orderBy: { createdAt: "asc" },
            take: 50,
          })
        : Promise.resolve([]),
      finalApprover
        ? prisma.leaveRequest.findMany({
            where: { status: { in: ["PENDING", "CANCEL_PENDING"] } },
            include: { employee: true },
            orderBy: { createdAt: "asc" },
            take: 100,
          })
        : Promise.resolve([]),
    ]);
  const { summary, comp, eligibility } = balance;
  const now = new Date();
  const today = todayKstWallClock();

  return noStoreJson({
    staff: {
      name: employee.name,
      department: employee.department,
      position: employee.position,
    },
    leave: {
      eligible: eligibility.eligible,
      weeklyHours: eligibility.weeklyHours,
      period: {
        start: dateValue(summary.period.start),
        end: dateValue(summary.period.end),
        label: summary.period.label,
        granted: summary.period.granted + summary.period.carriedOver,
        used: summary.period.used,
        remaining: summary.remaining,
        scheduled: summary.period.scheduled,
      },
      comp: {
        granted: comp.granted,
        used: comp.used,
        remaining: comp.remaining,
      },
      requests: leaveRequests.map((row) => ({
        id: row.id,
        start: dateValue(row.startDate),
        end: dateValue(row.endDate),
        days: row.days,
        type: row.leaveType,
        typeLabel: LEAVE_TYPE_LABEL[row.leaveType] || row.leaveType,
        status: row.status,
        statusLabel: LEAVE_STATUS_LABEL[row.status] || row.status,
        reason: row.reason,
        createdAt: dateValue(row.createdAt),
        canWithdraw: row.status === "PRE_PENDING" || row.status === "PENDING",
        canRequestCancel: row.status === "APPROVED" && row.endDate >= today,
      })),
    },
    makeups: makeupRequests.map((row) => {
      const confirm = canSelfConfirm(row, now);
      const cancel = canSelfCancel(row, now);
      const payable = isPayEligible(row, policy, holidays);
      return {
        id: row.id,
        start: dateValue(row.planStart),
        end: dateValue(row.planEnd),
        dateLabel: makeupDateLabel(row.planStart, row.planEnd),
        category: row.category,
        categoryLabel: MAKEUP_CATEGORY_LABEL[row.category] || row.category,
        status: row.status,
        statusLabel: MAKEUP_STATUS_LABEL[row.status] || row.status,
        targetClass: row.targetClass,
        detail: row.detail,
        createdAt: dateValue(row.createdAt),
        canConfirm: payable && confirm.ok,
        confirmHint: payable
          ? confirm.reason || `${confirmDeadlineLabel(row)} 수정 가능`
          : NOT_PAYABLE_HINT,
        canCancel: cancel.ok,
        cancelHint: cancel.reason || null,
        confirmDefaults: confirmInitials(row),
      };
    }),
    approvals: {
      canReview: finalApprover || departmentNames.length > 0,
      canFinalApprove: finalApprover,
      intermediate: intermediateRequests.map((row) => approvalItem(row, "INTERMEDIATE")),
      final: finalRequests.map((row) => approvalItem(row, "FINAL")),
      count: intermediateRequests.length + finalRequests.length,
    },
  });
}

export async function POST(req: Request) {
  const auth = await authenticatedPortalStaff(req, "hr:self-service");
  if (!auth) return noStoreJson({ error: "직원 권한을 확인할 수 없습니다." }, { status: 401 });
  const { employee, claims } = auth;
  const size = Number(req.headers.get("content-length") || 0);
  if (size > 32_768) return noStoreJson({ error: "입력 내용이 너무 깁니다." }, { status: 413 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return noStoreJson({ error: "입력 내용을 확인해 주세요." }, { status: 400 });
  const action = text(body.action, 40);

  if (leaveActions.has(action as PortalLeaveAction)) {
    const requestId = numericId(body.id);
    if (!requestId) return noStoreJson({ error: "결재 문서를 확인해 주세요." }, { status: 400 });
    const row = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });
    if (!row) return noStoreJson({ error: "결재 문서를 찾을 수 없습니다." }, { status: 404 });
    const department = row.employee.department
      ? await prisma.department.findUnique({
          where: { name: row.employee.department },
          select: { leaveApproverId: true },
        })
      : null;
    const portalAction = action as PortalLeaveAction;
    if (
      !canPortalLeaveAction(
        employee,
        {
          employeeId: row.employeeId,
          status: row.status,
          requesterDepartment: row.employee.department,
          leaveApproverId: department?.leaveApproverId ?? null,
        },
        portalAction,
      )
    ) {
      return noStoreJson({ error: "이 결재를 처리할 권한이 없습니다." }, { status: 403 });
    }

    const typeLabel = LEAVE_TYPE_LABEL[row.leaveType] || row.leaveType;
    const range = rangeLabel(row.startDate, row.endDate, row.days);
    const reason = text(body.reason, 300);
    const actor = claims.slackUserId;

    try {
      if (portalAction === "leave-withdraw") {
        await withdrawLeaveRequest(requestId, employee.id, employee.name);
        waitUntil(
          Promise.all([
            settledSlackMessage(row, `🚫 *신청자 철회* — ${row.employee.name} · ${range}`),
            refreshHomeTab(actor).catch(() => null),
          ]),
        );
        return noStoreJson({ ok: true, message: "승인 전 신청을 철회했습니다." });
      }

      if (portalAction === "leave-cancel-request") {
        if (row.endDate < todayKstWallClock())
          return noStoreJson(
            { error: "이미 종료된 휴가는 포털에서 취소할 수 없습니다." },
            { status: 400 },
          );
        await requestLeaveCancel(requestId, reason || "신청자 요청");
        waitUntil(
          (async () => {
            const approvalChannel = process.env.SLACK_APPROVAL_CHANNEL;
            if (approvalChannel) {
              const posted: any = await postMessage(
                approvalChannel,
                `휴가 취소 신청: ${employee.name} ${range}`,
                cancelApprovalBlocks({
                  requestId,
                  name: employee.name,
                  dept: employee.department || "",
                  range,
                  days: row.days,
                  typeLabel,
                  cancelReason: reason || "신청자 요청",
                }),
              ).catch(() => null);
              if (posted?.ok)
                await prisma.leaveRequest.update({
                  where: { id: requestId },
                  data: { slackChannel: posted.channel, slackTs: posted.ts },
                });
            }
            await refreshHomeTab(actor).catch(() => null);
          })(),
        );
        return noStoreJson({ ok: true, message: "휴가 취소 결재를 상신했습니다." });
      }

      if (portalAction === "leave-pre-approve") {
        await prisma.leaveRequest.update({
          where: { id: requestId },
          data: { status: "PENDING", preApproverId: actor, preDecidedAt: new Date() },
        });
        waitUntil(
          (async () => {
            const { summary, comp } = await leaveBalanceOf(row.employee);
            await postLeaveApprovalCard({
              requestId,
              name: row.employee.name,
              dept: row.employee.department || "",
              start: row.startDate,
              end: row.endDate,
              days: row.days,
              typeLabel,
              reason: `[${typeLabel}] ${row.reason || "개인사유"}`,
              remaining: row.leaveType === "COMP" ? comp.remaining : summary.remaining,
              workPlan: row.workPlan,
              preApprovedBy: employee.name,
              overdraftAfter: row.overdraftConsentAt ? row.overdraftAfter : null,
            });
            await settledSlackMessage(
              row,
              `☑️ *중간 승인* — ${row.employee.name} · ${range}\n최종 결재로 넘어갔습니다.`,
            );
            await dm(
              row.employee.slackUserId,
              `☑️ ${typeLabel} 신청(${range})이 중간 승인되어 최종 결재로 넘어갔습니다.`,
            );
            if (row.employee.slackUserId)
              await refreshHomeTab(row.employee.slackUserId).catch(() => null);
          })(),
        );
        return noStoreJson({ ok: true, message: "중간 승인했습니다. 최종 결재로 전달되었습니다." });
      }

      if (portalAction === "leave-pre-reject" || portalAction === "leave-reject") {
        await rejectLeaveRequest(
          requestId,
          actor,
          reason ||
            (portalAction === "leave-pre-reject" ? "중간 결재 반려" : "최종 결재 반려"),
        );
        waitUntil(
          Promise.all([
            settledSlackMessage(row, `❌ *반려* — ${row.employee.name} · ${range}`),
            dm(
              row.employee.slackUserId,
              `❌ ${typeLabel} 신청(${range}, ${row.days}일)이 반려되었습니다.${reason ? ` 사유: ${reason}` : ""}`,
            ),
            row.employee.slackUserId
              ? refreshHomeTab(row.employee.slackUserId).catch(() => null)
              : Promise.resolve(null),
          ]),
        );
        return noStoreJson({ ok: true, message: "신청을 반려했습니다." });
      }

      if (portalAction === "leave-approve") {
        const { summary, comp } = await approveLeaveRequest(requestId, actor);
        let eventId: string | null = null;
        if (gcalConfigured()) {
          eventId = await createLeaveEvent({
            name: row.employee.name,
            typeLabel,
            start: row.startDate,
            end: row.endDate,
            reason: row.reason,
            department: row.employee.department,
            days: row.days,
            workPlan: row.workPlan,
          });
          if (eventId)
            await prisma.leaveRequest.update({
              where: { id: requestId },
              data: { calendarEventId: eventId },
            });
        }
        const remaining = row.leaveType === "COMP" ? comp.remaining : summary.remaining;
        waitUntil(
          Promise.all([
            settledSlackMessage(row, `✅ *최종 승인* — ${row.employee.name} · ${range}`),
            dm(
              row.employee.slackUserId,
              `✅ ${typeLabel} 신청(${range}, ${row.days}일)이 최종 승인되었습니다.${deductsLeave(row.leaveType) ? ` 잔여 ${remaining}일.` : ""}`,
            ),
            process.env.SLACK_RECORD_CHANNEL
              ? postMessage(
                  process.env.SLACK_RECORD_CHANNEL,
                  `휴가 승인: ${row.employee.name} · ${range} · ${typeLabel} ${row.days}일`,
                ).catch(() => null)
              : Promise.resolve(null),
            row.employee.slackUserId
              ? refreshHomeTab(row.employee.slackUserId).catch(() => null)
              : Promise.resolve(null),
          ]),
        );
        return noStoreJson({ ok: true, message: "최종 승인했습니다." });
      }

      if (portalAction === "leave-cancel-approve") {
        await approveLeaveCancel(requestId, actor);
        if (row.calendarEventId && gcalConfigured()) {
          const deleted = await deleteLeaveEvent(row.calendarEventId);
          if (deleted)
            await prisma.leaveRequest.update({
              where: { id: requestId },
              data: { calendarEventId: null },
            });
        }
        waitUntil(
          Promise.all([
            settledSlackMessage(row, `🚫 *취소 승인* — ${row.employee.name} · ${range}`),
            dm(
              row.employee.slackUserId,
              `🚫 휴가 취소(${range}, ${typeLabel} ${row.days}일)가 승인되었습니다.`,
            ),
            row.employee.slackUserId
              ? refreshHomeTab(row.employee.slackUserId).catch(() => null)
              : Promise.resolve(null),
          ]),
        );
        return noStoreJson({ ok: true, message: "취소를 승인했습니다." });
      }

      await rejectLeaveCancel(requestId, actor);
      waitUntil(
        Promise.all([
          settledSlackMessage(row, `↩️ *취소 반려* — ${row.employee.name} · ${range}`),
          dm(
            row.employee.slackUserId,
            `❌ 휴가 취소 요청(${range})이 반려되었습니다. 기존 휴가는 유지됩니다.${reason ? ` 사유: ${reason}` : ""}`,
          ),
          row.employee.slackUserId
            ? refreshHomeTab(row.employee.slackUserId).catch(() => null)
            : Promise.resolve(null),
        ]),
      );
      return noStoreJson({ ok: true, message: "취소 요청을 반려했습니다." });
    } catch (error) {
      return noStoreJson(
        { error: error instanceof Error ? error.message : "결재를 처리하지 못했습니다." },
        { status: 400 },
      );
    }
  }

  if (action === "makeup-confirm" || action === "makeup-cancel") {
    const id = numericId(body.id);
    if (!id) return noStoreJson({ error: "근무 신청을 확인해 주세요." }, { status: 400 });
    const row = await prisma.makeupSession.findUnique({ where: { id } });
    if (!row || row.employeeId !== employee.id)
      return noStoreJson(
        { error: "본인이 신청한 내역만 처리할 수 있습니다." },
        { status: 403 },
      );
    try {
      if (action === "makeup-cancel") {
        await cancelMakeupSession(id, {
          by: "EMPLOYEE",
          reason: text(body.reason, 300),
        });
        return noStoreJson({ ok: true, message: "근무 신청을 취소·미실시 처리했습니다." });
      }
      const parsed = parseConfirmInput({
        startDate: text(body.startDate, 10) || null,
        startTime: text(body.startTime, 5) || null,
        endDate: text(body.endDate, 10) || null,
        endTime: text(body.endTime, 5) || null,
      });
      if (!parsed.ok)
        return noStoreJson(
          { error: parsed.error || "실제 근무 시간을 확인해 주세요." },
          { status: 400 },
        );
      const result = await confirmMakeupActuals(id, {
        actualStart: parsed.start!,
        actualEnd: parsed.end!,
        by: "EMPLOYEE",
        note: text(body.note, 300),
      });
      await logActivity({
        action: "MAKEUP_CONFIRM",
        actor: "PORTAL",
        actorName: employee.name,
        employeeId: employee.id,
        target: employee.name,
        summary: `${employee.name}님이 포털에서 ${MAKEUP_CATEGORY_LABEL[row.category] || row.category} 실근무 시간을 확정했습니다 — ${makeupDateLabel(parsed.start!, parsed.end!)}.`,
        meta: {
          makeupId: id,
          capExceeded: Boolean(result.capNotice),
          slackUserId: claims.slackUserId,
        },
      });
      return noStoreJson({
        ok: true,
        message: result.capNotice
          ? `실근무 시간을 확정했습니다. ${result.capNotice.replaceAll("*", "")}`
          : "실근무 시간을 확정했습니다.",
      });
    } catch (error) {
      return noStoreJson(
        { error: error instanceof Error ? error.message : "근무 신청을 처리하지 못했습니다." },
        { status: 400 },
      );
    }
  }

  if (action === "leave") {
    const leaveType = text(body.leaveType, 20);
    const start = ymdDate(body.start);
    const endInput = text(body.end, 10);
    const end = endInput ? ymdDate(endInput) : start;
    if (!leaveKinds.has(leaveType))
      return noStoreJson({ error: "휴가 종류를 확인해 주세요." }, { status: 400 });
    if (!start || !end)
      return noStoreJson(
        { error: "휴가 시작일과 종료일을 확인해 주세요." },
        { status: 400 },
      );
    const result = await submitLeaveRequest(employee, {
      leaveType,
      start,
      end,
      reason: text(body.reason, 300) || "개인사유",
      halfTimeNote: leaveType === "HALF" ? text(body.halfTimeNote, 80) : "",
      workPlan: text(body.workPlan, 500),
      source: "PORTAL",
      overdraftConsent: body.overdraftConsent === true,
    });
    // 잔여 초과인데 동의가 없다 — 만들지 않고 안내·동의 문구를 돌려준다. 포털이 확인창을 띄워
    // 체크받은 뒤 overdraftConsent: true 로 다시 보내면 접수된다(슬랙 모달과 같은 문구·같은 판정).
    if (!result.ok && result.overdraft)
      return noStoreJson(
        {
          error: result.error,
          code: "LEAVE_OVERDRAFT_CONSENT_REQUIRED",
          overdraft: result.overdraft,
          notice: overdraftNoticeText(result.overdraft).replaceAll("*", ""),
          consentLabel: OVERDRAFT_CONSENT_LABEL,
        },
        { status: 409 },
      );
    if (!result.ok)
      return noStoreJson(
        { error: result.error || "휴가 신청을 처리하지 못했습니다." },
        { status: 400 },
      );
    if (!result.duplicate && result.notify)
      waitUntil(result.notify().catch((error) => console.error("포털 휴가 알림 실패:", error)));
    if (!result.duplicate)
      await logActivity({
        action: "LEAVE_REQUEST",
        actor: "PORTAL",
        actorName: employee.name,
        employeeId: employee.id,
        target: employee.name,
        summary: `${employee.name}님이 포털에서 ${LEAVE_TYPE_LABEL[leaveType] || leaveType} ${result.days}일을 신청했습니다.`,
        meta: {
          requestId: result.requestId,
          slackUserId: claims.slackUserId,
          ...(result.overdrawn ? { overdraftConsent: true, overdraftAfter: result.overdraft?.after } : {}),
        },
      });
    return noStoreJson({
      ok: true,
      duplicate: Boolean(result.duplicate),
      message: result.duplicate
        ? "같은 기간의 신청이 이미 접수되어 있습니다."
        : `${LEAVE_TYPE_LABEL[leaveType] || "휴가"} ${result.days}일 신청이 접수되었습니다.`,
    });
  }

  if (action === "makeup") {
    const mode = body.mode === "work" ? "work" : "makeup";
    const parsed = parseMakeupInput({
      startDate: text(body.startDate, 10) || null,
      startTime: text(body.startTime, 5) || null,
      endDate: text(body.endDate, 10) || null,
      endTime: text(body.endTime, 5) || null,
      category: text(body.category, 20),
      targetClass: text(body.targetClass, 120),
      headcount:
        body.headcount === "" || body.headcount == null ? null : Number(body.headcount),
      detail: text(body.detail, 500),
      note: text(body.note, 500),
    });
    if (!parsed.ok)
      return noStoreJson(
        { error: parsed.error || "근무 시간을 확인해 주세요." },
        { status: 400 },
      );
    if (mode === "makeup" && !makeupKinds.has(text(body.category, 20)))
      return noStoreJson({ error: "보강 종류를 확인해 주세요." }, { status: 400 });
    const headcount =
      body.headcount === "" || body.headcount == null ? null : Number(body.headcount);
    if (
      headcount !== null &&
      (!Number.isInteger(headcount) || headcount < 0 || headcount > 500)
    )
      return noStoreJson(
        { error: "예상 인원은 0~500명 사이로 입력해 주세요." },
        { status: 400 },
      );

    let category = text(body.category, 20);
    if (mode === "work") {
      const holidays = await holidayYmds();
      category = isPremiumDay(parsed.start!.toISOString().slice(0, 10), holidays)
        ? "WEEKEND"
        : "OVERTIME";
    }
    const { row, duplicate } = await createMakeupSession(
      {
        employeeId: employee.id,
        planStart: parsed.start!,
        planEnd: parsed.end!,
        category,
        targetClass: text(body.targetClass, 120),
        headcount: mode === "makeup" ? headcount : null,
        detail: text(body.detail, 500),
        note: text(body.note, 500),
        source: "PORTAL",
        slackUserId: claims.slackUserId,
      },
      { sync: false },
    );
    if (duplicate)
      return noStoreJson(
        {
          error: `같은 시간대의 신청이 이미 있습니다 (${makeupDateLabel(row.planStart, row.planEnd)}).`,
        },
        { status: 409 },
      );
    waitUntil(syncMakeupCalendar(row.id).catch(() => null));
    await logActivity({
      action: "MAKEUP_CREATE",
      actor: "PORTAL",
      actorName: employee.name,
      employeeId: employee.id,
      target: employee.name,
      summary: `${employee.name}님이 포털에서 ${MAKEUP_CATEGORY_LABEL[category] || category}을 등록했습니다 — ${makeupDateLabel(parsed.start!, parsed.end!)}.`,
      meta: { makeupId: row.id, category, slackUserId: claims.slackUserId },
    });
    return noStoreJson({
      ok: true,
      message: `${MAKEUP_CATEGORY_LABEL[category] || "근무"} 신청이 등록되었습니다.`,
    });
  }

  return noStoreJson({ error: "지원하지 않는 요청입니다." }, { status: 400 });
}
