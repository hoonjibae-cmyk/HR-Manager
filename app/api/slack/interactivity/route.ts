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
} from "@/lib/slack";
import { approveLeaveRequest, rejectLeaveRequest } from "@/lib/leave-service";
import { leaveBalanceOf, submitLeaveRequest } from "@/lib/leave-slack";
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

  if (!approverAllowed(userId)) {
    await slackCall("chat.postEphemeral", {
      channel,
      user: userId,
      text: "연차를 승인/반려할 권한이 없습니다.",
    });
    return new Response("", { status: 200 });
  }

  if (reqRow.status !== "PENDING") {
    await slackCall("chat.postEphemeral", {
      channel,
      user: userId,
      text: `이미 처리된 신청입니다 (${reqRow.status}).`,
    });
    return new Response("", { status: 200 });
  }

  try {
    if (action.action_id === "approve_leave") {
      const { summary, comp } = await approveLeaveRequest(requestId, userId);
      const isComp = reqRow.leaveType === "COMP";
      const remaining = isComp ? comp.remaining : summary.remaining;
      const poolLabel = isComp ? "대휴보상연차" : "연차";
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
          text: `✅ ${poolLabel} 신청(${range}, ${reqRow.days}일)이 승인되었습니다. ${poolLabel} 잔여 ${remaining}일.`,
        });
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
