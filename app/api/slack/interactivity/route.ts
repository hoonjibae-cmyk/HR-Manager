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
  makeupModalView,
  readMakeupModal,
  makeupRecordBlocks,
  makeupConfirmModalView,
  readMakeupConfirmModal,
  makeupCancelModalView,
  readMakeupCancelModal,
} from "@/lib/slack";
import {
  parseMakeupInput,
  parseConfirmInput,
  confirmInitials,
  makeupDateLabel,
  makeupListBlocks,
} from "@/lib/makeup-slack";
import {
  createMakeupSession,
  confirmMakeupActuals,
  cancelMakeupSession,
  mandatoryCapContext,
  getOvertimePolicy,
  holidayYmds,
} from "@/lib/makeup-service";
import {
  canSelfConfirm,
  confirmOpensAt,
  honestyNotice,
  mandatoryCapNotice,
  underMandatoryCap,
  confirmDeadlineLabel,
  canSelfCancel,
  cancelNotice,
  NOT_PAYABLE_NOTICE,
} from "@/lib/makeup-confirm";
import { sessionHours, workWindow, isPayEligible, isPremiumDay } from "@/lib/overtime";
import { makeupCalendarConfigured } from "@/lib/gcal";
import {
  MAKEUP_CATEGORY_LABEL,
  isContractorContract,
  isStaffWork,
  makeupKindLabel,
} from "@/lib/constants";
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
  postLeaveApprovalCard,
  cancelableLeaves,
  rangeLabel,
  leaveBalanceText,
  leaveBlockNotice,
  modalPeriod,
  RATIO_LEAVE_NOTICE,
} from "@/lib/leave-slack";
import { canPreDecide } from "@/lib/leave-approval";
import { refreshHomeTab } from "@/lib/home-tab";
import { createLeaveEvent, deleteLeaveEvent, gcalConfigured } from "@/lib/gcal";
import { LEAVE_TYPE_LABEL } from "@/lib/constants";
import { DEFAULT_DAILY_CHANNEL } from "@/lib/daily-brief";
import { logActivity } from "@/lib/activity";
import { ymd } from "@/lib/format";

export const dynamic = "force-dynamic";

/** 슬랙 사용자 → 직원 카드 (미등록이면 이메일·이름으로 자동 연결) */
async function resolveEmployee(userId: string) {
  const found = await findEmployeeBySlack(userId);
  if (found) return { emp: found, info: {} as any };
  const linked = await autoLinkEmployeeBySlack(userId);
  return { emp: linked.emp, info: linked };
}

/**
 * 사용자에게 짧은 안내를 보낸다.
 * 채널 안이면 그 자리에만 보이는 임시 메시지, 앱 홈·단축키처럼 채널이 없으면 DM.
 */
async function tellUser(
  channelId: string | undefined,
  userId: string,
  text: string,
  blocks?: any[]
) {
  const body: any = { text, ...(blocks ? { blocks } : {}) };
  if (channelId) return slackCall("chat.postEphemeral", { channel: channelId, user: userId, ...body });
  return slackCall("chat.postMessage", { channel: userId, ...body });
}

/** 연결 실패 사유를 구체적으로 안내 (관리자가 바로 조치할 수 있도록) */
function notLinkedText(info: { email?: string; realName?: string; profileFailed?: boolean } = {}) {
  const found: string[] = [];
  if (info.realName) found.push(`슬랙 이름: ${info.realName}`);
  if (info.email) found.push(`슬랙 이메일: ${info.email}`);
  const detail = found.length ? `\n(${found.join(" · ")})` : "";
  const hint = info.profileFailed
    ? "\n관리자: 슬랙 앱 권한(users:read, users:read.email)을 확인해 주세요."
    : !info.email
    ? "\n관리자: 직원 관리 화면의 *슬랙 계정 일괄 연결* 을 실행하거나, 직원 카드에 슬랙 User ID 를 입력해 주세요."
    : "\n관리자: 직원 카드의 *이메일* 을 위 슬랙 이메일과 동일하게 맞춰 주세요.";
  return `등록된 직원 정보를 찾을 수 없습니다.${detail}${hint}`;
}

/** 휴가신청서 모달 열기 — 채널 버튼·앱 홈·전역 단축키가 공유한다 */
async function openLeaveForm(triggerId: string, userId: string, channelId?: string) {
  const { emp, info } = await resolveEmployee(userId);
  if (!emp) {
    await tellUser(channelId, userId, notLinkedText(info));
    return;
  }
  if (isContractorContract(emp)) {
    await tellUser(channelId, userId, RATIO_LEAVE_NOTICE);
    return;
  }
  const { summary, comp, eligibility } = await leaveBalanceOf(emp);
  // 연차 미적용이고 쓸 잔여도 없으면 양식을 열지 않고 이유를 알려준다
  const blocked = leaveBlockNotice(summary, comp, eligibility);
  if (blocked) {
    await tellUser(channelId, userId, blocked);
    return;
  }
  await openView(
    triggerId,
    leaveModalView({
      empName: emp.name,
      remaining: summary.remaining,
      compRemaining: comp.remaining,
      serviceLabel: summary.serviceLabel,
      period: modalPeriod(summary),
      channel: channelId,
    })
  );
}

/**
 * 보강계획 사전신청 모달 열기 — 채널 버튼·앱 홈·슬래시 명령이 공유한다.
 * 휴가와 달리 완전비율제도 막지 않는다 — 수당은 안 붙지만 일정 공유는 필요하다.
 */
async function openMakeupForm(
  triggerId: string,
  userId: string,
  channelId?: string,
  kind: "MAKEUP" | "WEEKEND" = "MAKEUP"
) {
  const { emp, info } = await resolveEmployee(userId);
  if (!emp) {
    await tellUser(channelId, userId, notLinkedText(info));
    return;
  }
  await openView(
    triggerId,
    makeupModalView({
      empName: emp.name,
      channel: channelId,
      ratio: isContractorContract(emp),
      kind,
    })
  );
}

/**
 * 실근무 확정 모달 열기 — **신청자 본인만**, 근무 다음날부터.
 * 남의 신청을 열 수 없게 신청자 본인인지 확인한다(버튼 value 로 id 가 넘어오므로).
 */
async function openConfirmForm(
  triggerId: string,
  userId: string,
  sessionId: number,
  channelId?: string
) {
  const { emp, info } = await resolveEmployee(userId);
  if (!emp) {
    await tellUser(channelId, userId, notLinkedText(info));
    return;
  }
  const row = await prisma.makeupSession.findUnique({ where: { id: sessionId } });
  if (!row || row.employeeId !== emp.id) {
    await tellUser(channelId, userId, "본인이 신청한 내역만 확정할 수 있습니다.");
    return;
  }
  // 수당 대상이 아니면 확정을 열지 않는다 — 목록이 버튼을 안 그려도 옛 DM 에 남은 버튼은 눌린다
  const [otPolicy, otHolidays] = await Promise.all([getOvertimePolicy(), holidayYmds()]);
  if (!isPayEligible(row, otPolicy, otHolidays)) {
    await tellUser(channelId, userId, NOT_PAYABLE_NOTICE);
    return;
  }
  const v = canSelfConfirm(row as any, new Date());
  if (!v.ok) {
    await tellUser(channelId, userId, v.reason ?? "지금은 확정할 수 없습니다.");
    return;
  }

  // 내신의무보강이면 이미 상한을 넘겼는지 미리 보여준다 (넘겨도 막지는 않는다)
  let capNotice: string | null = null;
  if (underMandatoryCap(row.category)) {
    const ctx = await mandatoryCapContext(emp.id, row.id, workWindow(row as any).start);
    capNotice = mandatoryCapNotice({
      capHours: ctx.capHours,
      otherHours: ctx.otherHours,
      thisHours: sessionHours(row as any),
      periodName: ctx.periodName,
    });
  }

  await openView(
    triggerId,
    makeupConfirmModalView({
      id: row.id,
      kindLabel: makeupKindLabel(row.category),
      dateLabel: makeupDateLabel(row.planStart, row.planEnd),
      categoryLabel: MAKEUP_CATEGORY_LABEL[row.category] ?? row.category,
      targetClass: row.targetClass,
      ...confirmInitials(row),
      note: row.reviewNote,
      honesty: honestyNotice(row.category),
      capNotice,
      deadlineLabel: confirmDeadlineLabel(row as any),
    })
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
    const { emp, info } = await resolveEmployee(userId);
    if (!emp) {
      return Response.json({
        response_action: "errors",
        errors: { kind: notLinkedText(info).replace(/\n/g, " ").slice(0, 150) },
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
      workPlan: f.workplan,
      channel: meta.channel,
    });

    if (!res.ok) {
      return Response.json({
        response_action: "errors",
        errors: { [res.field ?? "start"]: res.error ?? "신청을 처리하지 못했습니다." },
      });
    }

    // 신청자에게 DM 확인 — 중간결재를 거치는 신청은 그 사실을 알린다
    // (누가 들고 있는지 모르면 결재가 늦어질 때 물어볼 곳이 없다)
    await slackCall("chat.postMessage", {
      channel: userId,
      text:
        `✅ 휴가신청서가 접수되었습니다.\n` +
        `• 기간: ${ymd(start)}${res.days! > 1 ? ` ~ ${ymd(end)}` : ""} (${res.days}일)\n` +
        `• 현재 ${res.poolLabel} 잔여: ${res.remaining}일\n` +
        (res.preApproverName
          ? `${res.preApproverName} 님의 중간결재 확인 후 운영진 승인으로 넘어갑니다.`
          : `관리자 승인 후 반영됩니다.`),
    }).catch(() => {});
    await refreshHomeTab(userId).catch(() => {});

    return Response.json({ response_action: "clear" });
  }

  /* ---------- 보강 · 주말근무 사전신청 모달 제출 ---------- */
  if (payload.type === "view_submission" && payload.view?.callback_id === "makeup_plan_submit") {
    const userId = payload.user?.id as string;
    const { emp, info } = await resolveEmployee(userId);
    if (!emp) {
      return Response.json({
        response_action: "errors",
        errors: { target: notLinkedText(info).replace(/\n/g, " ").slice(0, 150) },
      });
    }
    const f = readMakeupModal(payload.view);
    const parsed = parseMakeupInput(f);
    if (!parsed.ok) {
      return Response.json({
        response_action: "errors",
        errors: { [parsed.field ?? "sdate"]: parsed.error ?? "입력을 확인해 주세요." },
      });
    }

    // 직원 입구(주말·초과근무)는 카테고리를 **근무 날짜로 자동 판정**한다 — 토·일·공휴일이면
    // 주말근무, 평일이면 평일 초과근무. 신청자가 고르게 하면 틀리고, 날짜에서 유도되는 값이다.
    // 자정을 넘긴 근무는 시작한 날 기준(엔진의 workDateOf 와 같은 규칙).
    let category = f.category;
    if (isStaffWork(category)) {
      const hol = await holidayYmds();
      category = isPremiumDay(parsed.start!.toISOString().slice(0, 10), hol)
        ? "WEEKEND"
        : "OVERTIME";
    }

    const row = await createMakeupSession({
      employeeId: emp.id,
      planStart: parsed.start!,
      planEnd: parsed.end!,
      category,
      targetClass: f.targetClass,
      headcount: f.headcount,
      detail: f.detail,
      note: f.note,
      source: "SLACK",
      slackUserId: userId,
    });

    const staff = isStaffWork(category);
    const what = makeupKindLabel(category);
    const icon = staff ? "🗓" : "📚";
    const dateLabel = makeupDateLabel(parsed.start!, parsed.end!);

    // **직원 근무의 사후 등록은 등록 즉시 확정한다** — 이미 끝난 근무를 적는 것이라 그 시간이
    // 곧 실근무 시간이고, 다음날 확정 모달에 같은 숫자를 또 적게 할 이유가 없다.
    // 저장 시각은 KST 벽시계라 비교용 now 도 KST 벽시계로 만든다.
    // 마감(다음 달 1일)이 지났거나 수당 대상이 아니면 확정하지 않고 신청으로만 남긴다 —
    // 그쪽은 관리자 판단 흐름 그대로다(canPostHocConfirm / isPayEligible 이 가른다).
    let confirmedNow = false;
    let postHocFailNote: string | null = null;
    if (staff) {
      const kstNow = new Date(Date.now() + 9 * 3600_000);
      if (parsed.end! <= kstNow) {
        try {
          await confirmMakeupActuals(row.id, {
            actualStart: parsed.start!,
            actualEnd: parsed.end!,
            by: "EMPLOYEE",
            postHoc: true,
            now: kstNow,
          });
          confirmedNow = true;
        } catch (e: any) {
          // 마감 지남 등 — 등록은 그대로 두고 왜 확정이 안 됐는지 알린다.
          // 조용히 넘어가면 '등록했는데 왜 수당이 없냐' 가 된다.
          postHocFailNote = String(e?.message ?? e);
        }
      }
    }

    const opensAt = confirmOpensAt(row as any);
    const blocks = makeupRecordBlocks({
      name: emp.name,
      dept: emp.department,
      categoryLabel: MAKEUP_CATEGORY_LABEL[category] ?? category,
      dateLabel,
      targetClass: f.targetClass,
      headcount: f.headcount,
      detail: f.detail,
      note: f.note,
      calendarSynced: makeupCalendarConfigured(),
      weekend: staff,
      kindLabel: what,
      confirmedNow,
      confirmOpensLabel: `${opensAt.getUTCFullYear()}.${String(opensAt.getUTCMonth() + 1).padStart(
        2,
        "0"
      )}.${String(opensAt.getUTCDate()).padStart(2, "0")}`,
    });
    if (postHocFailNote)
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `⚠️ ${postHocFailNote}` }],
      });

    // 신청자 확인 DM
    await postMessage(
      userId,
      confirmedNow
        ? `${icon} ${what}가(이) 등록·확정되었습니다 — ${dateLabel}`
        : `${icon} ${what} 신청이 등록되었습니다 — ${dateLabel}`,
      blocks
    ).catch(() => {});
    // 공유 채널 게시 (승인 버튼 없음 — 기록용). **어느 채널이냐가 갈래로 갈린다**:
    //  - 보강(교수부) → 보강계획 채널(SLACK_MAKEUP_CHANNEL). 수업 이야기라 그 채널이 맞다.
    //  - 직원 근무(주말·평일 초과) → **운영진 채널**. 보강계획 채널은 교수부가 보는 곳이라
    //    직원 근무가 섞이면 보강이 안 읽히고, 정작 챙겨야 할 운영진은 못 본다.
    //    채널은 '운영진 일일 안내' 와 같은 설정(HrNotifySetting.dailyChannel)을 쓴다 —
    //    받는 사람이 같은데 채널 설정을 둘로 두면 언젠가 한쪽만 옮기고 갈라진다.
    if (staff) {
      const setting = await prisma.hrNotifySetting
        .findUnique({ where: { id: 1 }, select: { dailyChannel: true } })
        .catch(() => null);
      const ops = (setting ? setting.dailyChannel : DEFAULT_DAILY_CHANNEL)?.trim();
      if (ops)
        await postMessage(ops, `${icon} ${what} 등록: ${emp.name} · ${dateLabel}`, blocks).catch(
          () => {}
        );
    } else {
      let meta: any = {};
      try {
        meta = JSON.parse(payload.view.private_metadata || "{}");
      } catch {}
      const channel = process.env.SLACK_MAKEUP_CHANNEL || meta.channel;
      if (channel)
        await postMessage(channel, `${icon} ${what} 신청: ${emp.name} · ${dateLabel}`, blocks).catch(
          () => {}
        );
    }

    await logActivity({
      action: "MAKEUP_CREATE",
      actor: "SLACK",
      actorName: userId,
      employeeId: emp.id,
      target: emp.name,
      summary: confirmedNow
        ? `${emp.name}님이 ${what}를 사후 등록했습니다(즉시 확정) — ${dateLabel} · ${
            MAKEUP_CATEGORY_LABEL[category] ?? category
          } (${f.targetClass}).`
        : `${emp.name}님이 ${what}을 사전신청했습니다 — ${dateLabel} · ${
            MAKEUP_CATEGORY_LABEL[category] ?? category
          } (${f.targetClass}).`,
      meta: { makeupId: row.id, category, confirmedNow, targetClass: f.targetClass },
    }).catch(() => {});

    await refreshHomeTab(userId).catch(() => {});
    return Response.json({ response_action: "clear" });
  }

  /* ---------- 실근무 확정 모달 제출 (신청자 본인) ---------- */
  if (payload.type === "view_submission" && payload.view?.callback_id === "makeup_confirm_submit") {
    const userId = payload.user?.id as string;
    const { emp, info } = await resolveEmployee(userId);
    if (!emp)
      return Response.json({
        response_action: "errors",
        errors: { sdate: notLinkedText(info).replace(/\n/g, " ").slice(0, 150) },
      });

    const f = readMakeupConfirmModal(payload.view);
    if (!f.id)
      return Response.json({
        response_action: "errors",
        errors: { sdate: "어느 신청인지 알 수 없습니다. 목록에서 다시 눌러 주세요." },
      });
    const target = await prisma.makeupSession.findUnique({ where: { id: f.id } });
    if (!target || target.employeeId !== emp.id)
      return Response.json({
        response_action: "errors",
        errors: { sdate: "본인이 신청한 내역만 확정할 수 있습니다." },
      });

    // **'근무하지 않았다' 를 고른 경우** — 시간은 보지 않고 미실시로 내린다.
    // 여기서 갈라 주지 않으면 취소하려던 사람이 예정 시간을 그대로 제출하게 된다.
    if (!f.didWork) {
      try {
        const row = await cancelMakeupSession(f.id, { by: "EMPLOYEE", reason: f.note });
        await postMessage(
          userId,
          `🚫 *${makeupKindLabel(row.category)}을(를) 미실시로 처리했습니다.*\n` +
            `• ${makeupDateLabel(row.planStart, row.planEnd)} · ${row.targetClass}\n` +
            `• 수당은 발생하지 않습니다. 실제로는 근무하셨다면 관리자에게 알려 주세요.`
        );
      } catch (e: any) {
        return Response.json({
          response_action: "errors",
          errors: { did: String(e.message).slice(0, 150) },
        });
      }
      return Response.json({ response_action: "clear" });
    }

    const parsed = parseConfirmInput(f);
    if (!parsed.ok)
      return Response.json({
        response_action: "errors",
        errors: { [parsed.field ?? "sdate"]: parsed.error ?? "입력을 확인해 주세요." },
      });

    let res;
    try {
      res = await confirmMakeupActuals(f.id, {
        actualStart: parsed.start!,
        actualEnd: parsed.end!,
        by: "EMPLOYEE",
        note: f.note,
      });
    } catch (e: any) {
      return Response.json({
        response_action: "errors",
        errors: { sdate: String(e.message).slice(0, 150) },
      });
    }

    const what = makeupKindLabel(res.row.category);
    const label = makeupDateLabel(parsed.start!, parsed.end!);
    await postMessage(
      userId,
      [
        `✅ *${what} 실근무 시간이 확정되었습니다.*`,
        "",
        `• 확정 시간: ${label}`,
        `• ${MAKEUP_CATEGORY_LABEL[res.row.category] ?? res.row.category} · ${res.row.targetClass}`,
        ...(f.note ? [`• 특이사항: ${f.note}`] : []),
        ...(res.capNotice ? ["", res.capNotice] : []),
        "",
        `_확정 내용은 HR 시스템의 보강·오버타임 화면에 반영되었습니다. ${confirmDeadlineLabel(
          res.row as any
        )}는 다시 고칠 수 있습니다._`,
      ].join("\n")
    ).catch(() => {});

    await logActivity({
      action: "MAKEUP_CONFIRM",
      actor: "SLACK",
      actorName: userId,
      employeeId: emp.id,
      target: emp.name,
      summary: `${emp.name}님이 ${what} 실근무 시간을 직접 확정했습니다 — ${label}.`,
      meta: { makeupId: f.id, confirmedBy: "EMPLOYEE", capExceeded: !!res.capNotice },
    }).catch(() => {});

    await refreshHomeTab(userId).catch(() => {});
    return Response.json({ response_action: "clear" });
  }

  /* ---------- 휴가 취소 신청 모달 제출 ---------- */
  if (payload.type === "view_submission" && payload.view?.callback_id === "makeup_cancel_submit") {
    const userId = payload.user?.id as string;
    const { emp, info } = await resolveEmployee(userId);
    if (!emp)
      return Response.json({
        response_action: "errors",
        errors: { reason: notLinkedText(info).replace(/\n/g, " ").slice(0, 150) },
      });
    const { id, reason } = readMakeupCancelModal(payload.view);
    if (!id)
      return Response.json({
        response_action: "errors",
        errors: { reason: "어느 신청인지 알 수 없습니다. 목록에서 다시 눌러 주세요." },
      });
    const target = await prisma.makeupSession.findUnique({ where: { id } });
    if (!target || target.employeeId !== emp.id)
      return Response.json({
        response_action: "errors",
        errors: { reason: "본인이 신청한 내역만 처리할 수 있습니다." },
      });

    try {
      const row = await cancelMakeupSession(id, { by: "EMPLOYEE", reason });
      await postMessage(
        userId,
        `🚫 *${makeupKindLabel(row.category)}을(를) 미실시로 처리했습니다.*\n` +
          `• ${makeupDateLabel(row.planStart, row.planEnd)} · ${row.targetClass}\n` +
          `• 수당은 발생하지 않습니다. 되돌리려면 관리자에게 알려 주세요.`
      );
    } catch (e: any) {
      return Response.json({
        response_action: "errors",
        errors: { reason: String(e.message).slice(0, 150) },
      });
    }
    return Response.json({ response_action: "clear" });
  }

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
    await refreshHomeTab(userId).catch(() => {});

    return Response.json({ response_action: "clear" });
  }

  /* ---------- 전역 단축키(⚡) → 휴가신청서 ---------- */
  if (payload.type === "shortcut" && payload.callback_id === "leave_request_shortcut") {
    await openLeaveForm(payload.trigger_id, payload.user?.id);
    return new Response("", { status: 200 });
  }

  const action = payload.actions?.[0];
  if (!action) return new Response("", { status: 200 });

  /* ---------- '휴가신청서 작성' 버튼 (채널 · 앱 홈) ---------- */
  if (action.action_id === "open_leave_modal") {
    await openLeaveForm(
      payload.trigger_id,
      payload.user?.id,
      payload.container?.channel_id || payload.channel?.id
    );
    return new Response("", { status: 200 });
  }

  /* ---------- '보강계획 신청' 버튼 (채널 · 앱 홈) ---------- */
  if (action.action_id === "open_makeup_modal") {
    await openMakeupForm(
      payload.trigger_id,
      payload.user?.id,
      payload.container?.channel_id || payload.channel?.id
    );
    return new Response("", { status: 200 });
  }

  /* ---------- '주말근무 신청' 버튼 — 교수부가 아닌 직원의 주말 근무 ---------- */
  if (action.action_id === "open_weekend_modal") {
    await openMakeupForm(
      payload.trigger_id,
      payload.user?.id,
      payload.container?.channel_id || payload.channel?.id,
      "WEEKEND"
    );
    return new Response("", { status: 200 });
  }

  /* ---------- '실근무 확정' 버튼 (목록 · 확정 요청 DM) ---------- */
  if (action.action_id === "open_makeup_confirm") {
    await openConfirmForm(
      payload.trigger_id,
      payload.user?.id,
      Number(action.value),
      payload.container?.channel_id || payload.channel?.id
    );
    return new Response("", { status: 200 });
  }

  /* ---------- '미실시' 버튼 (근무를 하지 않은 경우) ---------- */
  if (action.action_id === "open_makeup_cancel") {
    const uid = payload.user?.id as string;
    const channelId = payload.container?.channel_id || payload.channel?.id;
    const { emp, info } = await resolveEmployee(uid);
    if (!emp) {
      await tellUser(channelId, uid, notLinkedText(info));
      return new Response("", { status: 200 });
    }
    const row = await prisma.makeupSession.findUnique({ where: { id: Number(action.value) } });
    if (!row || row.employeeId !== emp.id) {
      await tellUser(channelId, uid, "본인이 신청한 내역만 처리할 수 있습니다.");
      return new Response("", { status: 200 });
    }
    // 옛 메시지에 남은 버튼은 목록을 거치지 않고 바로 눌린다 — 여는 시점에도 다시 본다
    const v = canSelfCancel(row as any, new Date());
    if (!v.ok) {
      await tellUser(channelId, uid, v.reason ?? "지금은 미실시로 내릴 수 없습니다.");
      return new Response("", { status: 200 });
    }
    const w = workWindow(row as any);
    await slackCall("views.open", {
      trigger_id: payload.trigger_id,
      view: makeupCancelModalView({
        id: row.id,
        kindLabel: makeupKindLabel(row.category),
        dateLabel: makeupDateLabel(w.start, w.end),
        categoryLabel: MAKEUP_CATEGORY_LABEL[row.category] ?? row.category,
        targetClass: row.targetClass,
        notice: cancelNotice(row),
      }),
    });
    return new Response("", { status: 200 });
  }

  /* ---------- '내 신청 내역 · 실근무 확정' 버튼 ---------- */
  if (action.action_id === "check_makeup_list") {
    const uid = payload.user?.id as string;
    const channelId = payload.container?.channel_id || payload.channel?.id;
    const { emp, info } = await resolveEmployee(uid);
    if (!emp) {
      await tellUser(channelId, uid, notLinkedText(info));
      return new Response("", { status: 200 });
    }
    const { text, blocks } = await makeupListBlocks(emp.id, emp.name);
    await tellUser(channelId, uid, text, blocks);
    return new Response("", { status: 200 });
  }

  /* ---------- 앱 홈 '새로고침' ---------- */
  if (action.action_id === "refresh_home") {
    await refreshHomeTab(payload.user?.id).catch(() => {});
    return new Response("", { status: 200 });
  }

  /* ---------- 채널의 '내 잔여 연차 확인' 버튼 ---------- */
  if (action.action_id === "check_leave_balance") {
    const userId = payload.user?.id as string;
    const channelId = payload.container?.channel_id || payload.channel?.id;
    const { emp, info } = await resolveEmployee(userId);
    if (!emp) {
      await tellUser(channelId, userId, notLinkedText(info));
      return new Response("", { status: 200 });
    }
    const { summary, comp, eligibility, txns } = await leaveBalanceOf(emp);
    await tellUser(
      channelId,
      userId,
      leaveBalanceText(emp.name, summary, comp, eligibility, txns)
    );
    return new Response("", { status: 200 });
  }

  const userId = payload.user?.id as string;

  /* ---------- 채널의 '휴가 취소 신청' 버튼 ---------- */
  if (action.action_id === "open_cancel_modal") {
    const channelId = payload.container?.channel_id || payload.channel?.id;
    const { emp, info } = await resolveEmployee(userId);
    if (!emp) {
      await tellUser(channelId, userId, notLinkedText(info));
      return new Response("", { status: 200 });
    }
    const items = await cancelableLeaves(emp.id);
    if (!items.length) {
      await tellUser(
        channelId,
        userId,
        "취소할 수 있는 휴가가 없습니다. (승인 완료 + 종료일이 오늘 이후인 휴가만 취소 신청할 수 있습니다)"
      );
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

  /* ---------- 중간결재 확인 / 반려 (부서 지정 결재자의 DM 버튼) ---------- */
  // 운영진 권한 검사(approverAllowed)보다 **앞**에 있어야 한다 — 중간결재자는
  // SLACK_APPROVERS 에 들어 있지 않은 사람이고, 권한 판정도 다르다(지정 결재자 또는 운영진 대행).
  if (action.action_id === "pre_approve_leave" || action.action_id === "pre_reject_leave") {
    const dept = reqRow.employee.department
      ? await prisma.department
          .findUnique({
            where: { name: reqRow.employee.department },
            include: { leaveApprover: { select: { name: true, slackUserId: true } } },
          })
          .catch(() => null)
      : null;
    if (!canPreDecide(userId, dept?.leaveApprover?.slackUserId, approverAllowed(userId))) {
      await slackCall("chat.postEphemeral", {
        channel,
        user: userId,
        text: "이 신청의 중간결재 권한이 없습니다.",
      });
      return new Response("", { status: 200 });
    }
    if (reqRow.status !== "PRE_PENDING") {
      await slackCall("chat.postEphemeral", {
        channel,
        user: userId,
        text: `이미 처리된 신청입니다 (${reqRow.status}).`,
      });
      return new Response("", { status: 200 });
    }
    const deciderName =
      dept?.leaveApprover?.slackUserId === userId ? dept!.leaveApprover!.name : "운영진(대행)";

    try {
      if (action.action_id === "pre_approve_leave") {
        await prisma.leaveRequest.update({
          where: { id: requestId },
          data: { status: "PENDING", preApproverId: userId, preDecidedAt: new Date() },
        });
        const { summary, comp } = await leaveBalanceOf(reqRow.employee as any);
        const remaining = reqRow.leaveType === "COMP" ? comp.remaining : summary.remaining;
        // 승인 채널 카드 게시 — slackChannel/slackTs 가 이 카드로 갈아 끼워진다
        await postLeaveApprovalCard({
          requestId,
          name: reqRow.employee.name,
          dept: reqRow.employee.department ?? "",
          start: reqRow.startDate,
          end: reqRow.endDate,
          days: reqRow.days,
          typeLabel,
          reason: `[${typeLabel}] ${reqRow.reason ?? "개인사유"}`,
          remaining,
          workPlan: reqRow.workPlan,
          preApprovedBy: deciderName,
        });
        // 결재자 DM 의 버튼을 결과 표시로 갈아 끼운다 (남겨 두면 두 번 눌린다)
        if (channel && msgTs) {
          await updateMessage(channel, msgTs, `중간결재 확인: ${reqRow.employee.name}`, [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `☑️ *중간결재 확인* — ${reqRow.employee.name} · ${range} (${reqRow.days}일)\n운영진 승인으로 넘어갔습니다.`,
              },
            },
          ]).catch(() => {});
        }
        if (reqRow.employee.slackUserId) {
          await slackCall("chat.postMessage", {
            channel: reqRow.employee.slackUserId,
            text: `☑️ ${typeLabel} 신청(${range})의 중간결재가 확인되었습니다. 운영진 승인 후 반영됩니다.`,
          }).catch(() => {});
        }
      } else {
        await rejectLeaveRequest(requestId, userId, `중간결재 반려 (${deciderName})`);
        if (channel && msgTs) {
          await updateMessage(channel, msgTs, `중간결재 반려: ${reqRow.employee.name}`, [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `❌ *중간결재 반려* — ${reqRow.employee.name} · ${range} (${reqRow.days}일)`,
              },
            },
          ]).catch(() => {});
        }
        if (reqRow.employee.slackUserId) {
          await slackCall("chat.postMessage", {
            channel: reqRow.employee.slackUserId,
            text: `❌ ${typeLabel} 신청(${range}, ${reqRow.days}일)이 중간결재에서 반려되었습니다. ${deciderName} 님에게 문의하세요.`,
          }).catch(() => {});
        }
      }
      if (reqRow.employee.slackUserId)
        await refreshHomeTab(reqRow.employee.slackUserId).catch(() => {});
    } catch (e: any) {
      await slackCall("chat.postEphemeral", { channel, user: userId, text: `처리 실패: ${e.message}` });
    }
    return new Response("", { status: 200 });
  }

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
          workPlan: reqRow.workPlan,
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
            workPlan: reqRow.workPlan,
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
    // 신청자의 앱 홈(잔여 연차·예정된 휴가)도 최신 상태로
    if (reqRow.employee.slackUserId)
      await refreshHomeTab(reqRow.employee.slackUserId).catch(() => {});
  } catch (e: any) {
    await slackCall("chat.postEphemeral", { channel, user: userId, text: `처리 실패: ${e.message}` });
  }

  return new Response("", { status: 200 });
}
