import { prisma } from "@/lib/db";
import { countLeaveDays, summarizeLeave, type LeaveTxn } from "@/lib/leave";
import {
  verifySlackSignature,
  slackConfigured,
  findEmployeeBySlack,
  parseLeaveText,
  postMessage,
  approvalBlocks,
} from "@/lib/slack";

export const dynamic = "force-dynamic";

function ephemeral(text: string) {
  return Response.json({ response_type: "ephemeral", text });
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

  const emp = await findEmployeeBySlack(userId);
  if (!emp) {
    return ephemeral(
      "등록된 직원 정보를 찾을 수 없습니다. 관리자에게 슬랙 ID 등록을 요청하세요."
    );
  }
  if (emp.payScheme === "RATIO") {
    return ephemeral(
      "완전비율제(위탁) 계약은 연차휴가 적용 대상이 아닙니다. 문의는 관리자에게 부탁드립니다."
    );
  }

  // 잔여연차 조회 (직원 셀프 조회)
  if (!text || /^(조회|잔여|현황|내연차|status|balance)$/i.test(text)) {
    const txns = await prisma.leaveTransaction.findMany({ where: { employeeId: emp.id } });
    const s = summarizeLeave(
      emp.hireDate,
      new Date(),
      txns.map((t) => ({ date: t.date, days: t.days, type: t.type as any })) as LeaveTxn[]
    );
    const next = s.nextGrantDate
      ? `\n• 다음 발생: ${s.nextGrantDate.toISOString().slice(0, 10)} (${s.nextGrantDays}일)`
      : "";
    return ephemeral(
      `*${emp.name}님의 연차 현황* (근속 ${s.serviceLabel})\n• 올해 발생: ${s.granted}일\n• 사용: ${s.used}일\n• *잔여: ${s.remaining}일*${next}\n\n_신청: \`/연차 8/14 사유\` · 도움말: \`/연차 help\`_`
    );
  }

  if (/도움|help/i.test(text)) {
    return ephemeral(
      "*연차 사용법*\n• 잔여 조회: `/연차` 또는 `/연차 조회`\n• 신청: `/연차 8/14 개인사유`\n• 기간: `/연차 8/14~8/16 가족여행`\n• 반차: `/연차 오후반차 8/14 병원`"
    );
  }

  const parsed = parseLeaveText(text);
  if (!parsed) return ephemeral("날짜를 인식하지 못했습니다. 예: `/연차 8/14 개인사유`");

  const holidays = (await prisma.holiday.findMany()).map((h) => h.date);
  const days = countLeaveDays(parsed.start, parsed.end, { half: parsed.half, holidays });
  if (days <= 0) return ephemeral("신청 가능한 근무일이 없습니다. 날짜를 확인하세요.");

  // 현재 잔여연차
  const txns = await prisma.leaveTransaction.findMany({ where: { employeeId: emp.id } });
  const summary = summarizeLeave(
    emp.hireDate,
    new Date(),
    txns.map((t) => ({ date: t.date, days: t.days, type: t.type as any })) as LeaveTxn[]
  );

  const reqRow = await prisma.leaveRequest.create({
    data: {
      employeeId: emp.id,
      startDate: parsed.start,
      endDate: parsed.end,
      days,
      leaveType: parsed.leaveType,
      reason: parsed.reason,
      status: "PENDING",
      source: "SLACK",
    },
  });

  // 관리자 채널에 승인 요청 게시
  const channel = process.env.SLACK_APPROVAL_CHANNEL;
  if (channel) {
    const posted: any = await postMessage(
      channel,
      `연차 신청: ${emp.name} ${days}일`,
      approvalBlocks({
        requestId: reqRow.id,
        name: emp.name,
        dept: emp.department ?? "",
        start: parsed.start,
        end: parsed.end,
        days,
        reason: parsed.reason,
        remaining: summary.remaining,
      })
    );
    if (posted?.ok) {
      await prisma.leaveRequest.update({
        where: { id: reqRow.id },
        data: { slackChannel: posted.channel, slackTs: posted.ts },
      });
    }
  }

  return ephemeral(
    `✅ 연차 신청이 접수되었습니다.\n• 기간: ${parsed.start.toISOString().slice(0, 10)}${
      days > 1 ? " ~ " + parsed.end.toISOString().slice(0, 10) : ""
    } (${days}일)\n• 현재 잔여연차: ${summary.remaining}일\n관리자 승인 후 반영됩니다.`
  );
}
