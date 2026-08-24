import {
  verifySlackSignature,
  slackConfigured,
  findEmployeeBySlack,
  autoLinkEmployeeBySlack,
  parseLeaveText,
  openView,
  leaveModalView,
  makeupModalView,
} from "@/lib/slack";
import { makeupListBlocks } from "@/lib/makeup-slack";
import {
  leaveBalanceOf,
  leaveBalanceText,
  leaveBlockNotice,
  modalPeriod,
  RATIO_LEAVE_NOTICE,
  submitLeaveRequest,
  rangeLabel,
} from "@/lib/leave-slack";
import { isContractorContract } from "@/lib/constants";

export const dynamic = "force-dynamic";

function ephemeral(text: string, blocks?: any[]) {
  return Response.json({ response_type: "ephemeral", text, ...(blocks ? { blocks } : {}) });
}

export async function POST(req: Request) {
  if (!slackConfigured()) return ephemeral("슬랙 연동이 설정되지 않았습니다. 관리자에게 문의하세요.");

  const raw = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!verifySlackSignature(raw, ts, sig)) {
    return new Response("invalid signature", { status: 401 });
  }

  const form = new URLSearchParams(raw);
  const userId = form.get("user_id") || "";
  const text = (form.get("text") || "").trim();

  // 슬랙 ID 미등록이면 이메일(또는 이름)로 직원 카드와 자동 연결 시도
  let emp = await findEmployeeBySlack(userId);
  if (!emp) {
    const linked = await autoLinkEmployeeBySlack(userId);
    emp = linked.emp;
    if (!emp) {
      const found: string[] = [];
      if (linked.realName) found.push(`슬랙 이름: ${linked.realName}`);
      if (linked.email) found.push(`슬랙 이메일: ${linked.email}`);
      return ephemeral(
        `등록된 직원 정보를 찾을 수 없습니다.${found.length ? `\n(${found.join(" · ")})` : ""}\n` +
          `관리자에게 *직원 관리 → 슬랙 계정 일괄 연결* 실행 또는 슬랙 User ID 등록을 요청하세요.`
      );
    }
  }
  /* ── /보강 — 보강·주말근무 사전신청 (완전비율제도 일정 공유용으로 등록한다) ── */
  const cmd = (form.get("command") || "").replace(/^\//, "");
  const isMakeup = /보강|주말|makeup|weekend/i.test(cmd);
  if (isMakeup) {
    if (/^(내역|목록|조회|list)$/i.test(text)) {
      const { text: t, blocks } = await makeupListBlocks(emp.id, emp.name);
      return ephemeral(t, blocks);
    }
    if (/도움|help/i.test(text))
      return ephemeral(
        "*보강 · 주말·초과근무 신청*\n" +
          "• 보강 신청: `/보강`\n• 주말·평일 초과근무 신청: `/보강 주말`\n" +
          "• 내 신청 내역 · 실근무 확정: `/보강 내역`\n\n" +
          "_승인 절차 없이 바로 등록되며, 보강은 보강캘린더에도 함께 올라갑니다(직원 근무는 올라가지 않습니다)._\n" +
          "_보강은 끝난 **다음날부터** 본인이 실근무 시간을 확정하면 그 시간으로 오버타임 수당이 산정됩니다._\n" +
          "_주말·평일 초과근무는 **끝난 뒤에 등록해도 됩니다** — 이미 끝난 근무를 등록하면 적은 시간이 그대로 실근무로 확정됩니다._"
      );
    // 주말근무는 대상반·수강인원을 묻지 않는 별도 양식이다 (`/보강 주말` 또는 `/주말근무`)
    const weekend = /주말|weekend/i.test(text) || /주말|weekend/i.test(cmd);
    await openView(
      form.get("trigger_id") || "",
      makeupModalView({
        empName: emp.name,
        channel: form.get("channel_id") || undefined,
        ratio: isContractorContract(emp),
        kind: weekend ? "WEEKEND" : "MAKEUP",
      })
    );
    return new Response("", { status: 200 });
  }

  if (isContractorContract(emp)) return ephemeral(RATIO_LEAVE_NOTICE);

  // 잔여연차 조회 (직원 셀프 조회) — 이번 연차기간 기준 + 대휴보상연차
  if (!text || /^(조회|잔여|현황|내연차|status|balance)$/i.test(text)) {
    const { summary, comp, eligibility, txns } = await leaveBalanceOf(emp);
    return ephemeral(
      leaveBalanceText(emp.name, summary, comp, eligibility, txns) +
        "\n\n_신청: `/연차 신청` · 빠른 신청: `/연차 8/14 사유` · 도움말: `/연차 help`_"
    );
  }

  // `/연차 신청` → 휴가신청서 양식(모달) 열기
  if (/^(신청|양식|신청서|form)$/i.test(text)) {
    const triggerId = form.get("trigger_id") || "";
    const { summary: s2, comp: c2, eligibility: e2 } = await leaveBalanceOf(emp);
    const blocked = leaveBlockNotice(s2, c2, e2);
    if (blocked) return ephemeral(blocked);
    await openView(
      triggerId,
      leaveModalView({
        empName: emp.name,
        remaining: s2.remaining,
        compRemaining: c2.remaining,
        serviceLabel: s2.serviceLabel,
        period: modalPeriod(s2),
        channel: form.get("channel_id") || undefined,
      })
    );
    return new Response("", { status: 200 });
  }

  if (/도움|help/i.test(text)) {
    return ephemeral(
      "*휴가 사용법*\n• 신청서 양식 열기: `/연차 신청`\n• 잔여 조회: `/연차` 또는 `/연차 조회`\n• 빠른 신청: `/연차 8/14 개인사유`\n• 기간: `/연차 8/14~8/16 가족여행`\n• 반차(0.5일): `/연차 반차 8/14 병원`\n• 대휴(보상연차) 사용: `/연차 대휴 8/14`"
    );
  }

  const parsed = parseLeaveText(text);
  if (!parsed) return ephemeral("날짜를 인식하지 못했습니다. 예: `/연차 8/14 개인사유`");

  // 신청 생성·승인카드 게시는 모달과 동일한 경로를 탄다
  const res = await submitLeaveRequest(emp, {
    leaveType: parsed.leaveType,
    start: parsed.start,
    end: parsed.end,
    reason: parsed.reason,
    channel: form.get("channel_id") || undefined,
  });
  if (!res.ok) return ephemeral(`❌ ${res.error}`);

  return ephemeral(
    `✅ ${res.poolLabel} 신청이 접수되었습니다.\n• 기간: ${rangeLabel(
      parsed.start,
      parsed.end,
      res.days!
    )} (${res.days}일)\n• 현재 ${res.poolLabel} 잔여: ${res.remaining}일\n관리자 승인 후 반영됩니다.` +
      `\n\n_업무조치사항까지 함께 적으려면 \`/연차 신청\` 으로 양식을 열어 주세요._`
  );
}
