// 방학 근무·연차 — 슬랙 요청 처리(모달 제출·버튼). app/api/slack/interactivity 가 부른다.
//
// ⚠ 인터랙티비티 라우트는 모르는 버튼을 연차 신청 id 로 해석하는 뒤쪽 분기가 있다 —
// 이 처리기를 반드시 그보다 **앞에서** 불러야 한다(null 이면 이 기능의 요청이 아니다).
//
// 누가 눌렀는지는 요청 서명으로 확인된 `payload.user.id` 만 믿는다. 직원 화면은 그 사람이
// 배정의 주인일 때만 열리고, 관리자 웹에는 직원 대신 제출하는 경로 자체가 없다.
import { waitUntil } from "@vercel/functions";
import { prisma } from "./db";
import { approverAllowed, openView, slackCall, updateMessage } from "./slack";
import { canPreDecide } from "./leave-approval";
import { refreshHomeTab } from "./home-tab";
import { dayLabel, leaveDates, sanitizeChoices, unselectedDates } from "./vacation";
import {
  choiceModalView,
  inquiryModalView,
  missingChoiceErrors,
  readChoiceValues,
  readSignValues,
  rejectReasonModal,
  resultView,
  signModalView,
  allChecked,
} from "./vacation-slack";
import {
  ForbiddenError,
  approveGroup,
  balanceFor,
  createInquiry,
  dispatchAfterSubmit,
  employeeView,
  markOpened,
  preApproveGroup,
  rejectGroup,
  resultRows,
  saveChoiceDraft,
  signPreview,
  submitChoices,
  type SubmitOutcome,
} from "./vacation-service";
import { signDocToken } from "./vacation-token";

const ok = () => new Response("", { status: 200 });
const json = (b: any) => Response.json(b);

function messageView(title: string, text: string) {
  return {
    type: "modal",
    title: { type: "plain_text", text: title.slice(0, 24) },
    close: { type: "plain_text", text: "닫기" },
    blocks: [{ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } }],
  };
}

async function choiceView(assignmentId: number, userId: string, banner?: string | null, choices?: Record<string, string>) {
  const v = await employeeView(assignmentId, userId);
  return choiceModalView({
    assignmentId,
    versionId: v.version.id,
    head: v.head,
    employeeName: v.employee.name,
    condition: v.condition,
    infos: v.infos,
    choices: choices ? sanitizeChoices(choices, v.infos) : v.initialChoices,
    balance: v.balance,
    ownStatus: v.ownStatus,
    banner:
      banner ??
      (v.notice.status === "ARCHIVED"
        ? "보관된 공고입니다. 내용을 볼 수만 있습니다 — 연차는 평소 신청 경로로 낼 수 있습니다."
        : v.assignment.removed
          ? "이 공고의 대상에서 빠졌습니다. 기존 신청은 그대로 보관됩니다. 문의는 담당자에게 해 주세요."
          : v.assignment.needsReconfirm
            ? "공고의 중요한 조건이 바뀌었습니다. 바뀐 내용을 확인하고 다시 제출해 주세요 — 이전 서명은 새 조건에 적용되지 않습니다."
            : v.notice.status === "CLOSED"
              ? "응답 요청 기한이 지나 공고가 마감되었습니다. 변경·문의는 계속 받습니다(마감 후 제출로 기록됩니다)."
              : null),
    archived: v.notice.status === "ARCHIVED" || v.assignment.removed,
  });
}

function outcomeMessage(o: SubmitOutcome): string | null {
  switch (o.status) {
    case "VERSION_CHANGED":
      return "그사이 공고가 변경되었습니다. 안내 DM 의 버튼으로 다시 열어 바뀐 내용을 확인해 주세요. 아무것도 제출되지 않았습니다.";
    case "MISSING":
      return `아직 선택하지 않은 날짜가 있습니다: ${o.dates.map(dayLabel).join(", ")}. 아무것도 제출되지 않았습니다.`;
    case "NOT_SELECTABLE":
      return `선택할 수 없게 된 날짜가 있습니다:\n${o.dates.map((d) => `• ${d.date} — ${d.reason}`).join("\n")}\n다시 열어 확인해 주세요. 아무것도 제출되지 않았습니다.`;
    case "SHORTAGE":
      return shortageText(o.balance);
    case "FORBIDDEN":
      return o.reason;
    default:
      return null;
  }
}

function shortageText(b: { remaining: number; pending: number; adding: number; after: number }): string {
  return (
    `연차 잔여가 부족합니다 — 현재 확정 잔여 ${b.remaining}일, 승인 대기 ${b.pending}일, 새로 고른 연차 ${b.adding}일.\n` +
    "일부 날짜를 정상근무로 바꾸거나 문의 담당자에게 확인해 주세요. 부족분을 마이너스 연차·선사용·무급·급여 공제로 처리하지 않습니다."
  );
}

/* ============================== 모달 제출 ============================== */

export async function handleVacationSubmission(payload: any): Promise<Response | null> {
  if (payload.type !== "view_submission") return null;
  const cb = payload.view?.callback_id;
  if (!["vac_choice", "vac_sign", "vac_inquiry_submit", "vac_reject_submit"].includes(cb)) return null;
  const userId = payload.user?.id as string;
  const view = payload.view;
  let meta: any = {};
  try {
    meta = JSON.parse(view.private_metadata || "{}");
  } catch {}

  try {
    if (cb === "vac_choice") {
      const aid = Number(meta.aid);
      const v = await employeeView(aid, userId);
      if (v.version.id !== Number(meta.vid))
        return json({
          response_action: "update",
          view: await choiceView(aid, userId, `공고가 제${v.version.version}판으로 변경되었습니다. 바뀐 내용을 확인하고 다시 골라 주세요.`),
        });
      const raw = readChoiceValues(view);
      await saveChoiceDraft(aid, userId, v.version.id, raw);
      const clean = sanitizeChoices(raw, v.infos);
      const missing = unselectedDates(clean, v.infos);
      if (missing.length) return json({ response_action: "errors", errors: missingChoiceErrors(missing) });

      if (!leaveDates(clean).length) {
        // 정상근무만 — 서명 없이 선택 결과만 남긴다
        const out = await submitChoices({ assignmentId: aid, slackUserId: userId, versionId: v.version.id, choices: clean, idempotencyKey: `choice:${view.id}:${view.hash}` });
        return respondOutcome(out);
      }
      const { balance } = balanceFor(v, clean);
      if (balance.shortage > 0) {
        const first = leaveDates(clean)[0];
        return json({ response_action: "errors", errors: { [`d_${first}`]: shortageText(balance).slice(0, 300) } });
      }
      const { preview } = await signPreview(v, clean);
      return json({ response_action: "push", view: signModalView({ assignmentId: aid, versionId: v.version.id, choices: clean, preview }) });
    }

    if (cb === "vac_sign") {
      const { checks, signedName } = readSignValues(view);
      const errors: Record<string, string> = {};
      if (!allChecked(checks)) errors.checks = "확인 항목 세 가지를 모두 직접 확인해 주세요.";
      if (!signedName) errors.signed_name = "성명을 직접 입력해 주세요.";
      if (Object.keys(errors).length) return json({ response_action: "errors", errors });
      const out = await submitChoices({
        assignmentId: Number(meta.aid),
        slackUserId: userId,
        versionId: Number(meta.vid),
        choices: meta.c ?? {},
        idempotencyKey: `sign:${view.id}`,
        signature: { typedName: signedName, checks },
        shown: Array.isArray(meta.s) ? meta.s.map(Number) : null,
      });
      if (out.status === "SIGNATURE_INVALID") return json({ response_action: "errors", errors: { signed_name: out.reason } });
      if (out.status === "BALANCE_CHANGED") {
        const v = await employeeView(Number(meta.aid), userId);
        const clean = sanitizeChoices(meta.c ?? {}, v.infos);
        const { preview } = await signPreview(v, clean);
        return json({
          response_action: "update",
          view: signModalView({
            assignmentId: v.assignment.id,
            versionId: v.version.id,
            choices: clean,
            preview,
            banner: `화면을 연 뒤 연차 잔여·승인 대기가 바뀌었습니다(현재 확정 잔여 ${out.balance.remaining}일, 승인 대기 ${out.balance.pending}일). 바뀐 숫자를 확인하고 다시 서명해 주세요. 아직 제출되지 않았습니다.`,
          }),
        });
      }
      return respondOutcome(out);
    }

    if (cb === "vac_inquiry_submit") {
      const msg = String(view.state?.values?.msg?.v?.value ?? "");
      await createInquiry(Number(meta.aid), userId, msg);
      return json({ response_action: "update", view: messageView("확인 요청 전달", "✅ 담당자에게 전달했습니다. 답변은 DM 으로 드립니다.\n문의는 연차 신청이나 동의로 처리되지 않습니다.") });
    }

    if (cb === "vac_reject_submit") {
      const reason = String(view.state?.values?.reason?.v?.value ?? "").trim();
      if (!reason) return json({ response_action: "errors", errors: { reason: "반려 사유를 적어 주세요." } });
      const sid = Number(meta.sid);
      const allowed = await canDecide(sid, userId, !!meta.pre);
      if (!allowed.ok) return json({ response_action: "update", view: messageView("권한 없음", allowed.reason) });
      const r = await rejectGroup(sid, userId, reason, !!meta.pre);
      waitUntil(
        (async () => {
          if (meta.ch && meta.ts)
            await updateMessage(meta.ch, meta.ts, `반려: ${r.sub.employee?.name}`, [
              { type: "section", text: { type: "mrkdwn", text: `❌ *${meta.pre ? "중간결재 반려" : "반려"}* — ${r.sub.employee?.name} · ${r.rejected.map(dayLabel).join(", ") || "처리할 신청 없음"}\n사유: ${reason}` } },
            ]).catch(() => {});
          const su = r.sub.employee?.slackUserId;
          if (su && r.rejected.length) {
            await slackCall("chat.postMessage", {
              channel: su,
              text: `❌ 방학 근무·연차 공고로 낸 연차 신청(${r.rejected.map(dayLabel).join(", ")})이 반려되었습니다.\n사유: ${reason}\n안내 DM 의 버튼으로 다시 열어 날짜를 고르거나 담당자에게 문의해 주세요.`,
            }).catch(() => {});
            await refreshHomeTab(su).catch(() => {});
          }
        })().catch((e) => console.error("방학 연차 반려 후처리 실패:", e))
      );
      return json({});
    }
  } catch (e: any) {
    if (e instanceof ForbiddenError)
      return json({ response_action: "update", view: messageView("열 수 없음", e.message) });
    console.error("방학 근무·연차 처리 실패:", e);
    return json({ response_action: "update", view: messageView("처리하지 못했습니다", `처리 중 오류가 났습니다. 아무것도 바뀌지 않았을 수 있으니 안내 DM 의 버튼으로 다시 열어 확인해 주세요.\n(${String(e?.message ?? e).slice(0, 200)})`) });
  }
  return null;
}

function respondOutcome(out: SubmitOutcome): Response {
  if (out.status === "OK" || out.status === "DUPLICATE" || out.status === "UNCHANGED") {
    if (out.status === "OK" && out.dispatch) waitUntil(dispatchAfterSubmit(out.dispatch).catch((e) => console.error("방학 근무·연차 알림 실패:", e)));
    return json({
      response_action: "update",
      view: resultView({
        kind: out.submission.kind,
        docNo: out.submission.docNo,
        rows: resultRows(out.submission),
        submissionId: out.submission.id,
        note: out.status === "UNCHANGED" ? "이전 제출과 내용이 같아 새로 제출하지 않았습니다." : out.status === "DUPLICATE" ? "이미 접수된 제출입니다(다시 보낸 요청은 한 번으로 처리했습니다)." : null,
      }),
    });
  }
  return json({ response_action: "update", view: messageView("제출되지 않았습니다", outcomeMessage(out) ?? "제출하지 못했습니다.") });
}

/** 결재 권한 — 운영진(SLACK_APPROVERS), 중간결재는 그 부서 지정 결재자 또는 운영진 대행 */
async function canDecide(submissionId: number, userId: string, pre: boolean): Promise<{ ok: boolean; reason: string; deciderName: string }> {
  if (!pre) return approverAllowed(userId) ? { ok: true, reason: "", deciderName: userId } : { ok: false, reason: "연차를 승인·반려할 권한이 없습니다.", deciderName: "" };
  const sub = await prisma.vacationSubmission.findUnique({ where: { id: submissionId }, include: { employee: true } });
  const dept = sub?.employee?.department
    ? await prisma.department.findUnique({ where: { name: sub.employee.department }, include: { leaveApprover: { select: { name: true, slackUserId: true } } } })
    : null;
  const allowed = canPreDecide(userId, dept?.leaveApprover?.slackUserId, approverAllowed(userId));
  return allowed
    ? { ok: true, reason: "", deciderName: dept?.leaveApprover?.slackUserId === userId ? dept!.leaveApprover!.name : "운영진(대행)" }
    : { ok: false, reason: "이 신청의 중간결재 권한이 없습니다.", deciderName: "" };
}

/* ============================== 버튼 ============================== */

const VAC_ACTIONS = ["vac_open", "vac_pick", "vac_inquiry_open", "vac_doc", "vac_approve", "vac_reject", "vac_pre_approve", "vac_pre_reject"];

export async function handleVacationAction(payload: any, origin: string): Promise<Response | null> {
  const action = payload.actions?.[0];
  if (!action || !VAC_ACTIONS.includes(action.action_id)) return null;
  const userId = payload.user?.id as string;
  const channel = payload.container?.channel_id || payload.channel?.id;
  const msgTs = payload.container?.message_ts || payload.message?.ts;
  const say = (text: string) =>
    channel ? slackCall("chat.postEphemeral", { channel, user: userId, text }) : slackCall("chat.postMessage", { channel: userId, text });

  try {
    if (action.action_id === "vac_open") {
      const aid = Number(action.value);
      const view = await choiceView(aid, userId);
      await markOpened(aid);
      await openView(payload.trigger_id, view);
      return ok();
    }

    if (action.action_id === "vac_pick") {
      // 고르는 즉시 임시저장 — 최종 제출과는 따로 둔다
      let meta: any = {};
      try {
        meta = JSON.parse(payload.view?.private_metadata || "{}");
      } catch {}
      await saveChoiceDraft(Number(meta.aid), userId, Number(meta.vid), readChoiceValues(payload.view)).catch(() => {});
      return ok();
    }

    if (action.action_id === "vac_inquiry_open") {
      await slackCall("views.push", { trigger_id: payload.trigger_id, view: inquiryModalView(Number(action.value)) });
      return ok();
    }

    if (action.action_id === "vac_doc") {
      const sid = Number(action.value);
      const sub = await prisma.vacationSubmission.findUnique({ where: { id: sid }, include: { employee: true } });
      if (!sub || sub.employee?.slackUserId !== userId) {
        await say("본인 문서만 받을 수 있습니다.");
        return ok();
      }
      const secret = process.env.SESSION_SECRET?.trim();
      if (!secret || secret.length < 32) {
        await say("문서 링크를 만들 수 없습니다(서버 설정 필요). 담당자에게 문의해 주세요.");
        return ok();
      }
      const url = `${origin}/api/vacation/doc?t=${encodeURIComponent(signDocToken({ sid, u: userId }, secret))}`;
      await slackCall("chat.postMessage", {
        channel: userId,
        text: `📄 ${sub.kind === "LEAVE" ? "연차유급휴가 신청서" : "근무 선택 확인 내역"} (${sub.docNo})\n<${url}|PDF 열기> — 본인 전용 링크이며 15분 뒤 만료됩니다. 다시 받으려면 버튼을 한 번 더 누르세요.`,
        unfurl_links: false,
        unfurl_media: false,
      });
      return ok();
    }

    const sid = Number(action.value);
    const pre = action.action_id === "vac_pre_approve" || action.action_id === "vac_pre_reject";
    const perm = await canDecide(sid, userId, pre);
    if (!perm.ok) {
      await say(perm.reason);
      return ok();
    }

    if (action.action_id === "vac_reject" || action.action_id === "vac_pre_reject") {
      await openView(payload.trigger_id, rejectReasonModal({ submissionId: sid, pre, channel, ts: msgTs }));
      return ok();
    }

    if (action.action_id === "vac_pre_approve") {
      const r = await preApproveGroup(sid, userId, perm.deciderName);
      if (channel && msgTs)
        await updateMessage(channel, msgTs, "중간결재 확인", [
          { type: "section", text: { type: "mrkdwn", text: r.count ? `☑️ *중간결재 확인* — ${r.sub.employee?.name} (${r.count}일). 운영진 승인으로 넘어갔습니다.` : "이미 처리된 신청입니다." } },
        ]).catch(() => {});
      if (r.count && r.sub.employee?.slackUserId)
        await slackCall("chat.postMessage", { channel: r.sub.employee.slackUserId, text: `☑️ 방학 근무·연차 공고로 낸 연차 신청의 중간결재가 확인되었습니다. 운영진 승인 후 반영됩니다.` }).catch(() => {});
      return ok();
    }

    if (action.action_id === "vac_approve") {
      const r = await approveGroup(sid, userId);
      const su = r.sub.employee?.slackUserId;
      if (channel && msgTs)
        await updateMessage(channel, msgTs, `승인: ${r.sub.employee?.name}`, [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: r.approved.length
                ? `✅ *승인* — ${r.sub.employee?.name} · ${r.approved.map(dayLabel).join(", ")} (${r.approved.length}일) · <@${userId}>` +
                  (r.skipped.length ? `\n이미 처리돼 건너뜀: ${r.skipped.map(dayLabel).join(", ")}` : "")
                : "이미 처리된 신청입니다.",
            },
          },
        ]).catch(() => {});
      if (su && r.approved.length) {
        const { leaveBalanceOf } = await import("./leave-slack");
        const emp = await prisma.employee.findUnique({ where: { id: r.sub.employeeId! } });
        const { summary } = await leaveBalanceOf(emp as any);
        await slackCall("chat.postMessage", {
          channel: su,
          text: `✅ 방학 근무·연차 공고로 낸 연차 신청(${r.approved.map(dayLabel).join(", ")})이 승인되었습니다. 연차 잔여 ${summary.remaining}일.`,
        }).catch(() => {});
        await refreshHomeTab(su).catch(() => {});
      }
      return ok();
    }
  } catch (e: any) {
    if (e instanceof ForbiddenError) {
      await say(e.message);
      return ok();
    }
    console.error("방학 근무·연차 버튼 처리 실패:", e);
    await say(`처리하지 못했습니다: ${String(e?.message ?? e).slice(0, 200)}`);
    return ok();
  }
  return ok();
}
