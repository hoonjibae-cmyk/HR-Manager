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
  noticeView,
  resultView,
  selectableDatesInView,
  signModalView,
  waitingView,
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
      // ⚠ 슬랙은 제출 응답을 **3초** 안에 못 받으면 제출을 버리고 이 화면에 오류만 남긴다
      // (직원에게는 '다음을 눌렀는데 그대로' 로 보인다 — 실제로 겪었다). 여기서는 DB 를 거치지
      // 않는 검사만 하고, 조회·서명 화면 준비는 '처리 중' 화면을 먼저 띄운 뒤 뒤에서 끝낸다.
      const aid = Number(meta.aid);
      const vid = Number(meta.vid);
      const raw = readChoiceValues(view);
      const missing = selectableDatesInView(view).filter((d) => !raw[d]);
      if (missing.length) {
        waitUntil(saveChoiceDraft(aid, userId, vid, raw).catch(() => {}));
        return json({ response_action: "errors", errors: missingChoiceErrors(missing) });
      }
      const externalId = newExternalId(aid);
      if (!Object.values(raw).includes("LEAVE")) {
        // 정상근무만 — 서명 없이 선택 결과만 남긴다. 이 화면 자리에서 결과로 바뀐다
        waitUntil(
          finishInView({ view_id: view.id }, userId, async () =>
            viewForOutcome(
              await submitChoices({ assignmentId: aid, slackUserId: userId, versionId: vid, choices: raw, idempotencyKey: `choice:${view.id}:${view.hash}` })
            )
          )
        );
        return json({ response_action: "update", view: waitingView("근무 선택 기록 중", "선택을 기록하고 있습니다. 잠시만 기다려 주세요 — 창을 닫아도 기록은 계속됩니다.", externalId) });
      }
      waitUntil(
        finishInView({ external_id: externalId }, userId, async () => {
          const v = await employeeView(aid, userId);
          if (v.version.id !== vid) {
            // 뒤에 깔린 선택 화면도 새 판으로 갈아 둔다 — '뒤로' 를 누르면 바로 바뀐 내용이 보인다
            await slackCall("views.update", {
              view_id: view.id,
              view: await choiceView(aid, userId, `공고가 제${v.version.version}판으로 변경되었습니다. 바뀐 내용을 확인하고 다시 골라 주세요.`),
            }).catch(() => {});
            return noticeView("공고 변경", `공고가 제${v.version.version}판으로 변경되었습니다. *뒤로* 를 눌러 바뀐 내용을 확인하고 다시 골라 주세요. 아무것도 제출되지 않았습니다.`, { close: "뒤로" });
          }
          await saveChoiceDraft(aid, userId, vid, raw, v);
          const clean = sanitizeChoices(raw, v.infos);
          const left = unselectedDates(clean, v.infos);
          if (left.length)
            return noticeView("선택 확인", `선택할 수 있는 날짜가 바뀌었습니다: ${left.map(dayLabel).join(", ")}. *뒤로* 를 눌러 다시 확인해 주세요. 아무것도 제출되지 않았습니다.`, { close: "뒤로" });
          const { balance } = balanceFor(v, clean);
          if (balance.shortage > 0) return noticeView("연차 잔여 부족", `${shortageText(balance)}\n\n*뒤로* 를 눌러 선택을 바꿔 주세요. 아무것도 제출되지 않았습니다.`, { close: "뒤로" });
          const { preview } = await signPreview(v, clean);
          return signModalView({ assignmentId: aid, versionId: v.version.id, choices: clean, preview });
        })
      );
      return json({ response_action: "push", view: waitingView("연차 신청서 확인·서명", "신청서 미리보기를 준비하고 있습니다. 잠시만 기다려 주세요.", externalId) });
    }

    if (cb === "vac_sign") {
      const { checks, signedName } = readSignValues(view);
      const errors: Record<string, string> = {};
      if (!allChecked(checks)) errors.checks = "확인 항목 세 가지를 모두 직접 확인해 주세요.";
      if (!signedName) errors.signed_name = "성명을 직접 입력해 주세요.";
      if (Object.keys(errors).length) return json({ response_action: "errors", errors });
      const aid = Number(meta.aid);
      // 제출(잠금·재검증·원문 생성)은 3초를 넘길 수 있다 — 처리 중 화면으로 먼저 답하고 뒤에서 끝낸다.
      // 이 화면 자리(view_id 는 update 해도 그대로다)에서 결과·재서명 화면으로 바뀐다.
      waitUntil(
        finishInView({ view_id: view.id }, userId, async () => {
          const out = await submitChoices({
            assignmentId: aid,
            slackUserId: userId,
            versionId: Number(meta.vid),
            choices: meta.c ?? {},
            idempotencyKey: `sign:${view.id}`,
            signature: { typedName: signedName, checks },
            shown: Array.isArray(meta.s) ? meta.s.map(Number) : null,
          });
          if (out.status === "SIGNATURE_INVALID" || out.status === "BALANCE_CHANGED") {
            const v = await employeeView(aid, userId);
            const clean = sanitizeChoices(meta.c ?? {}, v.infos);
            const { preview } = await signPreview(v, clean);
            return signModalView({
              assignmentId: v.assignment.id,
              versionId: v.version.id,
              choices: clean,
              preview,
              banner:
                out.status === "SIGNATURE_INVALID"
                  ? `${out.reason} 확인 항목과 성명을 다시 입력해 주세요. 아직 제출되지 않았습니다.`
                  : `화면을 연 뒤 연차 잔여·승인 대기가 바뀌었습니다(현재 확정 잔여 ${out.balance.remaining}일, 승인 대기 ${out.balance.pending}일). 바뀐 숫자를 확인하고 다시 서명해 주세요. 아직 제출되지 않았습니다.`,
            });
          }
          return viewForOutcome(out);
        })
      );
      return json({ response_action: "update", view: waitingView("신청서 제출 중", "신청서를 제출하고 있습니다. 잠시만 기다려 주세요 — 창을 닫아도 제출은 계속되고, 결과는 DM 으로도 드립니다.", newExternalId(aid)) });
    }

    if (cb === "vac_inquiry_submit") {
      const msg = String(view.state?.values?.msg?.v?.value ?? "");
      waitUntil(
        finishInView({ view_id: view.id }, userId, async () => {
          await createInquiry(Number(meta.aid), userId, msg);
          return messageView("확인 요청 전달", "✅ 담당자에게 전달했습니다. 답변은 DM 으로 드립니다.\n문의는 연차 신청이나 동의로 처리되지 않습니다.");
        })
      );
      return json({ response_action: "update", view: waitingView("확인 요청 전달 중", "담당자에게 전달하고 있습니다. 잠시만 기다려 주세요.", newExternalId(Number(meta.aid))) });
    }

    if (cb === "vac_reject_submit") {
      const reason = String(view.state?.values?.reason?.v?.value ?? "").trim();
      if (!reason) return json({ response_action: "errors", errors: { reason: "반려 사유를 적어 주세요." } });
      const sid = Number(meta.sid);
      waitUntil(
        finishInView({ view_id: view.id }, userId, async () => {
          const allowed = await canDecide(sid, userId, !!meta.pre);
          if (!allowed.ok) return messageView("권한 없음", allowed.reason);
          const r = await rejectGroup(sid, userId, reason, !!meta.pre);
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
          return messageView(
            "반려 처리",
            r.rejected.length ? `❌ ${r.sub.employee?.name} · ${r.rejected.map(dayLabel).join(", ")} 반려했습니다.` : "이미 처리된 신청입니다."
          );
        })
      );
      return json({ response_action: "update", view: waitingView("반려 처리 중", "반려를 처리하고 있습니다. 잠시만 기다려 주세요.", newExternalId(sid)) });
    }
  } catch (e: any) {
    if (e instanceof ForbiddenError)
      return json({ response_action: "update", view: messageView("열 수 없음", e.message) });
    console.error("방학 근무·연차 처리 실패:", e);
    return json({ response_action: "update", view: messageView("처리하지 못했습니다", `처리 중 오류가 났습니다. 아무것도 바뀌지 않았을 수 있으니 안내 DM 의 버튼으로 다시 열어 확인해 주세요.\n(${String(e?.message ?? e).slice(0, 200)})`) });
  }
  return null;
}

function viewForOutcome(out: SubmitOutcome): any {
  if (out.status === "OK" || out.status === "DUPLICATE" || out.status === "UNCHANGED") {
    if (out.status === "OK" && out.dispatch) waitUntil(dispatchAfterSubmit(out.dispatch).catch((e) => console.error("방학 근무·연차 알림 실패:", e)));
    return resultView({
      kind: out.submission.kind,
      docNo: out.submission.docNo,
      rows: resultRows(out.submission),
      submissionId: out.submission.id,
      note: out.status === "UNCHANGED" ? "이전 제출과 내용이 같아 새로 제출하지 않았습니다." : out.status === "DUPLICATE" ? "이미 접수된 제출입니다(다시 보낸 요청은 한 번으로 처리했습니다)." : null,
    });
  }
  return messageView("제출되지 않았습니다", outcomeMessage(out) ?? "제출하지 못했습니다.");
}

function newExternalId(aid: number): string {
  return `vac-${aid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 처리 중 화면을 결과 화면으로 갈아 끼운다. 직원이 그새 창을 닫아 갈아 끼울 화면이 없으면
 * 결과를 DM 으로 알린다 — 제출은 이미 끝났는데 아무 흔적이 없으면 다시 제출하게 된다
 * (정상 접수는 영수 DM 이 따로 가므로 그때는 겹쳐 보내지 않는다).
 */
async function finishInView(target: { view_id?: string; external_id?: string }, userId: string, build: () => Promise<any>) {
  let next: any;
  try {
    next = await build();
  } catch (e: any) {
    console.error("방학 근무·연차 처리 실패:", e);
    next =
      e instanceof ForbiddenError
        ? messageView("열 수 없음", e.message)
        : messageView("처리하지 못했습니다", `처리 중 오류가 났습니다. 아무것도 바뀌지 않았을 수 있으니 안내 DM 의 버튼으로 다시 열어 확인해 주세요.\n(${String(e?.message ?? e).slice(0, 200)})`);
  }
  const res: any = await slackCall("views.update", { ...target, view: next }).catch((e) => ({ ok: false, error: String(e) }));
  if (res?.ok) return;
  console.error("방학 근무·연차 화면 갱신 실패:", res?.error);
  const receipt = next?.title?.text === "신청 접수 완료" || next?.title?.text === "근무 선택 기록 완료";
  if (receipt) return;
  const text = (next?.blocks ?? [])
    .map((b: any) => b?.text?.text ?? b?.elements?.[0]?.text ?? "")
    .filter(Boolean)
    .join("\n")
    .slice(0, 2900);
  if (text) await slackCall("chat.postMessage", { channel: userId, text: `방학 근무·연차: ${text}` }).catch(() => {});
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
      // trigger_id 는 3초면 만료된다 — 조회보다 창 열기를 먼저 하고 내용은 뒤에서 채운다
      // (콜드 스타트에 조회까지 얹으면 버튼을 눌러도 아무 창이 안 뜬다).
      const aid = Number(action.value);
      const opened: any = await openView(payload.trigger_id, waitingView("근무 선택 및 연차 신청", "공고와 연차 잔여를 불러오고 있습니다. 잠시만 기다려 주세요.", newExternalId(aid)));
      if (!opened?.ok) {
        console.error("방학 근무·연차 창 열기 실패:", opened?.error);
        await say("창을 열지 못했습니다. 버튼을 한 번 더 눌러 주세요.");
        return ok();
      }
      waitUntil(
        finishInView({ view_id: opened.view.id }, userId, async () => {
          const view = await choiceView(aid, userId);
          await markOpened(aid).catch(() => {});
          return view;
        })
      );
      return ok();
    }

    if (action.action_id === "vac_pick") {
      // 고르는 즉시 임시저장 — 최종 제출과는 따로 둔다
      let meta: any = {};
      try {
        meta = JSON.parse(payload.view?.private_metadata || "{}");
      } catch {}
      waitUntil(saveChoiceDraft(Number(meta.aid), userId, Number(meta.vid), readChoiceValues(payload.view)).catch(() => {}));
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
