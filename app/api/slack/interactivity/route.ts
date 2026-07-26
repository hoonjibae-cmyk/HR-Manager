import { prisma } from "@/lib/db";
import {
  verifySlackSignature,
  approverAllowed,
  updateMessage,
  decidedBlocks,
  slackCall,
  findEmployeeBySlack,
  autoLinkEmployeeBySlack,
  openView,
  leaveModalView,
  readLeaveModal,
  leaveCancelModalView,
  readCancelModal,
  cancelApprovalBlocks,
  recordBlocks,
  postMessage,
} from "@/lib/slack";
import {
  approveLeaveRequest,
  rejectLeaveRequest,
  requestLeaveCancel,
  approveLeaveCancel,
  rejectLeaveCancel,
  deductsLeave,
} from "@/lib/leave-service";
import {
  leaveBalanceOf,
  submitLeaveRequest,
  cancelableLeaves,
  rangeLabel,
} from "@/lib/leave-slack";
import { createLeaveEvent, deleteLeaveEvent, gcalConfigured } from "@/lib/gcal";
import { LEAVE_TYPE_LABEL } from "@/lib/constants";
import { ymd } from "@/lib/format";

export const dynamic = "force-dynamic";

/** 슬랙 사용자 → 직원 카드 (미등록이면 이메일로 자동 연결) */
async function resolveEmployee(userId: string) {
  const found = await findEmployeeBySlack(userId);
  if (found) return { emp: found, email: undefined as string | undefined };
  const linked = await autoLinkEmployeeBySlack(userId);
  return { emp: linked.emp, email: linked.email };
}

function notLinkedText(email?: string) {
  return (
    `등록된 직원 정보를 찾을 수 없습니다.${email ? ` (슬랙 이메일: ${email})` : ""}\n` +
    `관리자에게 직원 카드의 *이메일* 을 슬랙 계정과 동일하게 맞추도록 요청해 주세요.`
  );
}

export async function POST(req: Request) {
  const raw = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!verifySlackSignature(raw, ts, sig)) {
    return new Response("invalid signature", { status: 401 });
  }

  const form = new URLSearchParams(raw);
  const payload = JSON.parse(form.get("payload") || "{}");

  /* ---------- 휴가신청서 모달 제출 ---------- */
  if (payload.type === "view_submission" && payload.view?.callback_id === "leave_request_submit") {
    const userId = payload.user?.id as string;
    const { emp, email } = await resolveEmployee(userId);
    if (!emp) {
      return Response.json({
        response_action: "errors",
        errors: { kind: notLinkedText(email).replace(/\n/g, " ") },
      });
    }
    const f = readLeaveModal(payload.view);
    if (!f.start) {
      return Response.json({
        response_action: "errors",
        errors: { start: "휴가시작일을 선택하세요." },
      });
    }
    const start = new Date(`${f.start}T00:00:00Z`);
    const end = f.end ? new Date(`${f.end}T00:00:00Z`) : start;

    let meta: any = {};
    try {
      meta = JSON.parse(payload.view.private_metadata || "{}");
    } catch {}

    const res = await submitLeaveRequest(emp, {
      leaveType: f.kind,
      start,
      end,
      reason: f.reason,
      halfTimeNote: f.halftime,
      channel: meta.channel,
    });

    if (!res.ok) {
      return Response.json({
        response_action: "errors",
        errors: { [res.field ?? "start"]: res.error ?? "신청을 처리하지 못했습니다." },
      });
    }

    // 신청자에게 DM 확인
    await slackCall("chat.postMessage", {
      channel: userId,
      text:
        `✅ 휴가신청서가 접수되었습니다.\n` +
        `• 기간: ${ymd(start)}${res.days! > 1 ? ` ~ ${ymd(end)}` : ""} (${res.days}일)\n` +
        `• 현재 ${res.poolLabel} 잔여: ${res.remaining}일\n` +
        `관리자 승인 후 반영됩니다.`,
    }).catch(() => {});

    return Response.json({ response_action: "clear" });
  }

  /* ---------- 휴가 취소 신청 모달 제출 ---------- */
  if (payload.type === "view_submission" && payload.view?.callback_id === "leave_cancel_submit") {
    const userId = payload.user?.id as string;
    const { emp } = await resolveEmployee(userId);
    if (!emp) {
      return Response.json({
        response_action: "errors",
        errors: { target: "직원 정보를 찾을 수 없습니다." },
      });
    }
    const { requestId, reason } = readCancelModal(payload.view);
    const target = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!target || target.employeeId !== emp.id || target.status !== "APPROVED") {
      return Response.json({
        response_action: "errors",
        errors: { target: "취소할 수 없는 휴가입니다. 목록을 다시 확인하세요." },
      });
    }

    await requestLeaveCancel(requestId, reason);

    const typeLabel = LEAVE_TYPE_LABEL[target.leaveType] ?? "연차";
    const range = rangeLabel(target.startDate, target.endDate, target.days);
    let meta: any = {};
    try {
      meta = JSON.parse(payload.view.private_metadata || "{}");
    } catch {}
    const approvalChannel = process.env.SLACK_APPROVAL_CHANNEL || meta.channel;
    if (approvalChannel) {
      const posted: any = await postMessage(
        approvalChannel,
        `휴가 취소 신청: ${emp.name} ${range}`,
        cancelApprovalBlocks({
          requestId,
          name: emp.name,
          dept: emp.department ?? "",
          range,
          days: target.days,
          typeLabel,
          cancelReason: reason || "사유 미기재",
        })
      );
      if (posted?.ok) {
        await prisma.leaveRequest.update({
          where: { id: requestId },
          data: { slackChannel: posted.channel, slackTs: posted.ts },
        });
      }
    }
    await slackCall("chat.postMessage", {
      channel: userId,
      text: `🚫 휴가 취소를 신청했습니다.\n• 대상: ${range} · ${typeLabel} ${target.days}일\n운영진 승인 후 취소가 확정됩니다.`,
    }).catch(() => {});

    return Response.json({ response_action: "clear" });
  }

  const action = payload.actions?.[0];
  if (!action) return new Response("", { status: 200 });

  /* ---------- 채널의 '휴가신청서 작성' 버튼 ---------- */
  if (action.action_id === "open_leave_modal") {
    const userId = payload.user?.id as string;
    const channelId = payload.container?.channel_id || payload.channel?.id;
    const { emp, email } = await resolveEmployee(userId);
    if (!emp) {
      await slackCall("chat.postEphemeral", {
        channel: channelId,
        user: userId,
        text: notLinkedText(email),
      });
      return new Response("", { status: 200 });
    }
    if (emp.payScheme === "RATIO") {
      await slackCall("chat.postEphemeral", {
        channel: channelId,
        user: userId,
        text: "완전비율제(위탁) 계약은 연차휴가 적용 대상이 아닙니다. 문의는 관리자에게 부탁드립니다.",
      });
      return new Response("", { status: 200 });
    }
    const { summary, comp } = await leaveBalanceOf(emp);
    await openView(
      payload.trigger_id,
      leaveModalView({
        empName: emp.name,
        remaining: summary.remaining,
        compRemaining: comp.remaining,
        serviceLabel: summary.serviceLabel,
        channel: channelId,
      })
    );
    return new Response("", { status: 200 });
  }

  /* ---------- 채널의 '내 잔여 연차 확인' 버튼 ---------- */
  if (action.action_id === "check_leave_balance") {
    const userId = payload.user?.id as string;
    const channelId = payload.container?.channel_id || payload.channel?.id;
    const { emp, email } = await resolveEmployee(userId);
    if (!emp) {
      await slackCall("chat.postEphemeral", { channel: channelId, user: userId, text: notLinkedText(email) });
      return new Response("", { status: 200 });
    }
    const { summary, comp } = await leaveBalanceOf(emp);
    const compLine =
      comp.granted > 0
        ? `\n• 대휴보상연차: 발생 ${comp.granted} · 사용 ${comp.used} · *잔여 ${comp.remaining}일*`
        : "";
    const next = summary.nextGrantDate
      ? `\n• 다음 발생: ${ymd(summary.nextGrantDate)} (${summary.nextGrantDays}일)`
      : "";
    await slackCall("chat.postEphemeral", {
      channel: channelId,
      user: userId,
      text: `*${emp.name}님의 연차 현황* (근속 ${summary.serviceLabel})\n• 본래 연차: 발생 ${summary.granted} · 사용 ${summary.used} · *잔여 ${summary.remaining}일*${compLine}${next}`,
    });
    return new Response("", { status: 200 });
  }

  const userId = payload.user?.id as string;

  /* ---------- 채널의 '휴가 취소 신청' 버튼 ---------- */
  if (action.action_id === "open_cancel_modal") {
    const channelId = payload.container?.channel_id || payload.channel?.id;
    const { emp, email } = await resolveEmployee(userId);
    if (!emp) {
      await slackCall("chat.postEphemeral", { channel: channelId, user: userId, text: notLinkedText(email) });
      return new Response("", { status: 200 });
    }
    const items = await cancelableLeaves(emp.id);
    if (!items.length) {
      await slackCall("chat.postEphemeral", {
        channel: channelId,
        user: userId,
        text: "취소할 수 있는 휴가가 없습니다. (승인 완료 + 종료일이 오늘 이후인 휴가만 취소 신청할 수 있습니다)",
      });
      return new Response("", { status: 200 });
    }
    await openView(payload.trigger_id, leaveCancelModalView(items, channelId));
    return new Response("", { status: 200 });
  }

  const requestId = Number(action.value);
  const channel = payload.container?.channel_id || payload.channel?.id;
  const msgTs = payload.container?.message_ts || payload.message?.ts;

  const reqRow = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { employee: true },
  });
  if (!reqRow) return new Response("", { status: 200 });

  const range =
    reqRow.days > 1 ? `${ymd(reqRow.startDate)} ~ ${ymd(reqRow.endDate)}` : ymd(reqRow.startDate);
  const typeLabel = LEAVE_TYPE_LABEL[reqRow.leaveType] ?? "연차";
  const recordChannel = process.env.SLACK_RECORD_CHANNEL;

  if (!approverAllowed(userId)) {
    await slackCall("chat.postEphemeral", {
      channel,
      user: userId,
      text: "휴가를 승인/반려할 권한이 없습니다.",
    });
    return new Response("", { status: 200 });
  }

  const isCancelAction =
    action.action_id === "approve_cancel" || action.action_id === "reject_cancel";
  const expected = isCancelAction ? "CANCEL_PENDING" : "PENDING";
  if (reqRow.status !== expected) {
    await slackCall("chat.postEphemeral", {
      channel,
      user: userId,
      text: `이미 처리된 신청입니다 (${reqRow.status}).`,
    });
    return new Response("", { status: 200 });
  }

  try {
    /* ---------- 휴가 취소 승인 / 반려 ---------- */
    if (action.action_id === "approve_cancel") {
      await approveLeaveCancel(requestId, userId);
      // 구글 캘린더 일정 삭제
      let calDeleted = false;
      if (reqRow.calendarEventId && gcalConfigured()) {
        calDeleted = await deleteLeaveEvent(reqRow.calendarEventId);
        if (calDeleted) {
          await prisma.leaveRequest.update({
            where: { id: requestId },
            data: { calendarEventId: null },
          });
        }
      }
      if (channel && msgTs) {
        await updateMessage(
          channel,
          msgTs,
          `취소 승인: ${reqRow.employee.name}`,
          recordBlocks({
            name: reqRow.employee.name,
            dept: reqRow.employee.department ?? "",
            range,
            days: reqRow.days,
            typeLabel,
            reason: reqRow.cancelReason ?? "",
            canceled: true,
            by: userId,
            calendarSynced: calDeleted,
          })
        );
      }
      if (reqRow.employee.slackUserId) {
        await slackCall("chat.postMessage", {
          channel: reqRow.employee.slackUserId,
          text: `🚫 휴가 취소(${range}, ${typeLabel} ${reqRow.days}일)가 승인되었습니다.${
            deductsLeave(reqRow.leaveType) ? " 사용한 연차가 복원되었습니다." : ""
          }`,
        });
      }
      if (recordChannel) {
        await postMessage(
          recordChannel,
          `휴가 취소 확정: ${reqRow.employee.name} ${range}`,
          recordBlocks({
            name: reqRow.employee.name,
            dept: reqRow.employee.department ?? "",
            range,
            days: reqRow.days,
            typeLabel,
            reason: reqRow.cancelReason ?? "",
            canceled: true,
            by: userId,
            calendarSynced: calDeleted,
          })
        );
      }
      return new Response("", { status: 200 });
    }

    if (action.action_id === "reject_cancel") {
      await rejectLeaveCancel(requestId, userId);
      if (channel && msgTs) {
        await updateMessage(
          channel,
          msgTs,
          `취소 반려: ${reqRow.employee.name}`,
          decidedBlocks({
            name: `${reqRow.employee.name} (휴가 취소 요청)`,
            range,
            days: reqRow.days,
            approved: false,
            by: userId,
          })
        );
      }
      if (reqRow.employee.slackUserId) {
        await slackCall("chat.postMessage", {
          channel: reqRow.employee.slackUserId,
          text: `❌ 휴가 취소 요청(${range})이 반려되었습니다. 기존 휴가는 그대로 유지됩니다.`,
        });
      }
      return new Response("", { status: 200 });
    }

    if (action.action_id === "approve_leave") {
      const { summary, comp } = await approveLeaveRequest(requestId, userId);
      const isComp = reqRow.leaveType === "COMP";
      const deducted = deductsLeave(reqRow.leaveType);
      const remaining = isComp ? comp.remaining : summary.remaining;
      const poolLabel = isComp ? "대휴보상연차" : "연차";

      // 구글 캘린더 등록
      let eventId: string | null = null;
      if (gcalConfigured()) {
        eventId = await createLeaveEvent({
          name: reqRow.employee.name,
          typeLabel,
          start: reqRow.startDate,
          end: reqRow.endDate,
          reason: reqRow.reason,
          department: reqRow.employee.department,
          days: reqRow.days,
        });
        if (eventId) {
          await prisma.leaveRequest.update({
            where: { id: requestId },
            data: { calendarEventId: eventId },
          });
        }
      }

      if (channel && msgTs) {
        await updateMessage(
          channel,
          msgTs,
          `승인됨: ${reqRow.employee.name}`,
          decidedBlocks({ name: reqRow.employee.name, range, days: reqRow.days, approved: true, by: userId, remaining })
        );
      }
      // 신청자에게 DM
      if (reqRow.employee.slackUserId) {
        await slackCall("chat.postMessage", {
          channel: reqRow.employee.slackUserId,
          text:
            `✅ ${typeLabel} 신청(${range}, ${reqRow.days}일)이 승인되었습니다.` +
            (deducted ? ` ${poolLabel} 잔여 ${remaining}일.` : " (연차에서 차감되지 않는 휴가입니다.)") +
            (eventId ? "\n구글 캘린더에 일정이 등록되었습니다." : ""),
        });
      }
      // 휴가-기록 채널 게시
      if (recordChannel) {
        await postMessage(
          recordChannel,
          `휴가 승인: ${reqRow.employee.name} ${range}`,
          recordBlocks({
            name: reqRow.employee.name,
            dept: reqRow.employee.department ?? "",
            range,
            days: reqRow.days,
            typeLabel,
            reason: reqRow.reason ?? "",
            by: userId,
            calendarSynced: !!eventId,
            deducted,
            remaining: deducted ? remaining : undefined,
          })
        );
      }
    } else if (action.action_id === "reject_leave") {
      await rejectLeaveRequest(requestId, userId);
      if (channel && msgTs) {
        await updateMessage(
          channel,
          msgTs,
          `반려됨: ${reqRow.employee.name}`,
          decidedBlocks({ name: reqRow.employee.name, range, days: reqRow.days, approved: false, by: userId })
        );
      }
      if (reqRow.employee.slackUserId) {
        await slackCall("chat.postMessage", {
          channel: reqRow.employee.slackUserId,
          text: `❌ 연차 신청(${range}, ${reqRow.days}일)이 반려되었습니다. 관리자에게 문의하세요.`,
        });
      }
    }
  } catch (e: any) {
    await slackCall("chat.postEphemeral", { channel, user: userId, text: `처리 실패: ${e.message}` });
  }

  return new Response("", { status: 200 });
}
