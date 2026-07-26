import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "./db";
import { ymd } from "./format";

const API = "https://slack.com/api";

export function slackConfigured(): boolean {
  return !!process.env.SLACK_BOT_TOKEN && !!process.env.SLACK_SIGNING_SECRET;
}

/** Slack 요청 서명 검증 (v0) */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;
  // 5분 초과 요청 거부 (재전송 공격 방지)
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (isNaN(age) || age > 60 * 5) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const mac = "v0=" + createHmac("sha256", secret).update(base).digest("hex");
  try {
    return (
      mac.length === signature.length &&
      timingSafeEqual(Buffer.from(mac), Buffer.from(signature))
    );
  } catch {
    return false;
  }
}

export async function slackCall(method: string, payload: any) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function postMessage(channel: string, text: string, blocks?: any[]) {
  return slackCall("chat.postMessage", { channel, text, blocks });
}

export async function updateMessage(channel: string, ts: string, text: string, blocks?: any[]) {
  return slackCall("chat.update", { channel, ts, text, blocks });
}

/** slack user id 로 직원 조회 */
export async function findEmployeeBySlack(slackUserId: string) {
  return prisma.employee.findFirst({ where: { slackUserId } });
}

/** 슬랙 사용자 프로필 조회 (users:read.email 권한 필요) */
export async function slackUserProfile(
  userId: string
): Promise<{ email?: string; realName?: string } | null> {
  if (!process.env.SLACK_BOT_TOKEN || !userId) return null;
  try {
    const res = await fetch(`${API}/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
    const j: any = await res.json();
    if (!j?.ok) return null;
    return {
      email: j.user?.profile?.email || undefined,
      realName: j.user?.profile?.real_name || j.user?.real_name || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 슬랙 ID 가 등록되지 않은 사용자를 이메일(또는 실명)로 직원 카드와 자동 연결.
 * 최초 `/연차` 사용 시 한 번만 수행되며, 이후에는 slackUserId 로 바로 조회된다.
 * → 직원 24명의 슬랙 ID를 관리자가 일일이 입력할 필요가 없다.
 */
export async function autoLinkEmployeeBySlack(slackUserId: string): Promise<{
  emp: Awaited<ReturnType<typeof findEmployeeBySlack>>;
  email?: string;
  realName?: string;
}> {
  const profile = await slackUserProfile(slackUserId);
  if (!profile) return { emp: null };

  let emp = null;
  if (profile.email) {
    // 이메일은 대소문자 무시하고 매칭
    emp = await prisma.employee.findFirst({
      where: { email: { equals: profile.email, mode: "insensitive" }, slackUserId: null },
    });
  }
  // 이메일이 없거나 매칭 실패 시 실명으로 보조 매칭 (동명이인이면 연결하지 않음)
  if (!emp && profile.realName) {
    const name = profile.realName.replace(/\s+/g, "");
    const candidates = await prisma.employee.findMany({
      where: { slackUserId: null, active: true },
    });
    const hits = candidates.filter((c) => c.name.replace(/\s+/g, "") === name);
    if (hits.length === 1) emp = hits[0];
  }
  if (!emp) return { emp: null, email: profile.email, realName: profile.realName };

  await prisma.employee.update({
    where: { id: emp.id },
    data: { slackUserId },
  });
  return { emp: { ...emp, slackUserId }, email: profile.email, realName: profile.realName };
}

export function approverAllowed(userId: string): boolean {
  const list = (process.env.SLACK_APPROVERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true; // 미설정 시 누구나 승인 가능
  return list.includes(userId);
}

/**
 * 연차 신청 텍스트 파싱.
 * 지원: "8/14", "2026-08-14", "8/14~8/16", "8/14 개인사유", "반차 8/14 병원"
 */
export function parseLeaveText(text: string): {
  start: Date;
  end: Date;
  half: boolean;
  leaveType: string;
  reason: string;
} | null {
  const now = new Date();
  const year = now.getFullYear();
  let leaveType = "ANNUAL";
  let half = false;
  let t = text.trim();

  // 대휴(대체휴일 보상연차) 사용 신청
  if (/대휴|보상휴가|보상연차/i.test(t)) {
    leaveType = "COMP";
    t = t.replace(/대휴보상연차|보상휴가|보상연차|대휴/gi, " ");
  }

  if (/반차|반가|half/i.test(t)) {
    half = true;
    if (leaveType !== "COMP") leaveType = /오전|am/i.test(t) ? "HALF_AM" : "HALF_PM";
    t = t.replace(/오전반차|오후반차|반차|반가|half\s*(am|pm)?/gi, " ");
  }

  // 날짜 추출 (YYYY-MM-DD 또는 M/D)
  const dateRe = /(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})|(\d{1,2})[\/.](\d{1,2})/g;
  const dates: Date[] = [];
  let m: RegExpExecArray | null;
  let lastIdx = 0;
  while ((m = dateRe.exec(t)) !== null) {
    lastIdx = m.index + m[0].length;
    if (m[1]) {
      dates.push(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
    } else {
      dates.push(new Date(Date.UTC(year, Number(m[4]) - 1, Number(m[5]))));
    }
  }
  if (dates.length === 0) return null;
  const start = dates[0];
  const end = dates[1] ?? dates[0];
  const reason = t.slice(lastIdx).replace(/[~\-]/g, " ").trim() || "개인사유";
  return { start, end, half, leaveType, reason };
}

export function approvalBlocks(args: {
  requestId: number;
  name: string;
  dept: string;
  start: Date;
  end: Date;
  days: number;
  reason: string;
  remaining: number;
}) {
  const range =
    args.days > 1 ? `${ymd(args.start)} ~ ${ymd(args.end)}` : ymd(args.start);
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "🏖️ 연차 신청", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*신청자*\n${args.name} (${args.dept})` },
        { type: "mrkdwn", text: `*기간*\n${range} · ${args.days}일` },
        { type: "mrkdwn", text: `*사유*\n${args.reason}` },
        { type: "mrkdwn", text: `*현재 잔여연차*\n${args.remaining}일` },
      ],
    },
    {
      type: "actions",
      block_id: `leave_${args.requestId}`,
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "승인", emoji: true },
          action_id: "approve_leave",
          value: String(args.requestId),
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "반려", emoji: true },
          action_id: "reject_leave",
          value: String(args.requestId),
        },
      ],
    },
  ];
}

export function decidedBlocks(args: {
  name: string;
  range: string;
  days: number;
  approved: boolean;
  by: string;
  remaining?: number;
}) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${args.approved ? "✅ *승인됨*" : "❌ *반려됨*"} — *${args.name}* 연차 (${args.range}, ${args.days}일)`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: args.approved
            ? `처리자 <@${args.by}> · 반영 후 잔여연차 ${args.remaining}일`
            : `처리자 <@${args.by}>`,
        },
      ],
    },
  ];
}
