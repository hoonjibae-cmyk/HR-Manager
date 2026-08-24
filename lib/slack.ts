import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "./db";
import { ymd } from "./format";
import { matchEmployee } from "./timesheet";

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
  /** 진단용: 프로필 조회 자체가 실패(권한 부족 등) */
  profileFailed?: boolean;
}> {
  const profile = await slackUserProfile(slackUserId);
  if (!profile) return { emp: null, profileFailed: true };

  let emp = null;
  if (profile.email) {
    // 이메일은 대소문자 무시하고 매칭 (가장 확실한 식별자)
    emp = await prisma.employee.findFirst({
      where: { email: { equals: profile.email, mode: "insensitive" } },
    });
  }
  // 이메일이 없거나(권한 미부여) 매칭 실패 시 이름으로 보조 매칭.
  // 슬랙 표시명에 '_부원장', '조교' 등이 붙어도 인식하도록 시간기록표와 같은 규칙 사용.
  if (!emp && profile.realName) {
    const candidates = await prisma.employee.findMany({
      where: { slackUserId: null, active: true },
    });
    const matched = matchEmployee(profile.realName, candidates);
    if (matched.emp) emp = matched.emp;
  }
  if (!emp) return { emp: null, email: profile.email, realName: profile.realName };

  await prisma.employee.update({
    where: { id: emp.id },
    data: { slackUserId },
  });
  return { emp: { ...emp, slackUserId }, email: profile.email, realName: profile.realName };
}

export interface SlackUserRow {
  id: string;
  realName: string;
  displayName: string;
  email?: string;
}

/**
 * 토큰 점검 — 워크스페이스·봇 이름과 **실제 부여된 권한 목록**을 확인한다.
 * 권한은 응답 헤더 x-oauth-scopes 로 내려온다.
 */
export async function slackAuthTest(): Promise<{
  ok: boolean;
  team?: string;
  botName?: string;
  scopes: string[];
  error?: string;
}> {
  if (!process.env.SLACK_BOT_TOKEN) return { ok: false, scopes: [], error: "no_token" };
  try {
    const res = await fetch(`${API}/auth.test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
    const scopes = (res.headers.get("x-oauth-scopes") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const j: any = await res.json();
    return {
      ok: !!j?.ok,
      team: j?.team,
      botName: j?.user,
      scopes,
      error: j?.ok ? undefined : j?.error || "unknown",
    };
  } catch (e: any) {
    return { ok: false, scopes: [], error: e.message };
  }
}

/** 워크스페이스 사용자 목록 (봇·삭제된 계정 제외). 실패 시 error 로 사유 반환 */
export async function slackUserList(): Promise<{ users: SlackUserRow[]; error?: string }> {
  if (!process.env.SLACK_BOT_TOKEN) return { users: [], error: "no_token" };
  const out: SlackUserRow[] = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const url = `${API}/users.list?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
    const j: any = await res.json();
    if (!j?.ok) return { users: out, error: j?.error || "unknown" };
    for (const m of j.members ?? []) {
      if (m.is_bot || m.deleted || m.id === "USLACKBOT") continue;
      out.push({
        id: m.id,
        realName: m.profile?.real_name || m.real_name || "",
        displayName: m.profile?.display_name || "",
        email: m.profile?.email || undefined,
      });
    }
    cursor = j.response_metadata?.next_cursor || "";
    if (!cursor) break;
  }
  return { users: out };
}

/** 슬랙 API 오류코드 → 조치 안내 */
export function slackErrorHint(error?: string): string {
  switch (error) {
    case "missing_scope":
      return "앱에 필요한 권한이 없습니다. api.slack.com/apps → OAuth & Permissions → Bot Token Scopes 에 users:read, users:read.email 을 추가한 뒤 Reinstall to Workspace 하세요.";
    case "invalid_auth":
    case "not_authed":
      return "봇 토큰이 올바르지 않습니다. SLACK_BOT_TOKEN 이 xoxb- 로 시작하는 Bot User OAuth Token 인지 확인하세요.";
    case "token_revoked":
    case "account_inactive":
      return "토큰이 만료·해지되었습니다. 앱을 워크스페이스에 다시 설치(Reinstall)하고 새 토큰을 넣으세요.";
    case "no_token":
      return "SLACK_BOT_TOKEN 환경변수가 비어 있습니다. Vercel 환경변수 설정 후 Redeploy 하세요.";
    case "ratelimited":
      return "슬랙 API 호출 제한에 걸렸습니다. 잠시 후 다시 시도하세요.";
    default:
      return "슬랙 앱 설정(권한·설치 상태)을 확인하세요.";
  }
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

  // 반차는 오전/오후를 구분하지 않는다 (근무시간 14~22시 — 사용시간은 사유에 적는다)
  if (/반차|반가|half/i.test(t)) {
    half = true;
    if (leaveType !== "COMP") leaveType = "HALF";
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
  workPlan?: string | null;
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
    ...(args.workPlan
      ? [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*업무조치사항*\n${args.workPlan}` },
          },
        ]
      : []),
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

/* ==================== 휴가신청서 모달 (채널 버튼 → 양식) ==================== */

export async function openView(triggerId: string, view: any) {
  return slackCall("views.open", { trigger_id: triggerId, view });
}

/** 채널 상단에 고정할 '휴가 신청' 버튼 메시지 */
export function leaveLauncherBlocks(companyName = "유쌤에듀") {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🏖️ 휴가 신청*\n아래 버튼을 누르면 휴가신청서 양식이 열립니다.\n_이름과 잔여 연차는 자동으로 확인되며, 관리자 승인 시 ${companyName} HR 시스템에 바로 반영됩니다._`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "휴가신청서 작성", emoji: true },
          action_id: "open_leave_modal",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "내 잔여 연차 확인", emoji: true },
          action_id: "check_leave_balance",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "휴가 취소 신청", emoji: true },
          action_id: "open_cancel_modal",
        },
      ],
    },
  ];
}

/**
 * 채널 상단에 고정할 '보강 · 주말근무 사전신청' 버튼 메시지.
 *
 * **버튼을 둘로 나눈 이유**: 슬랙 모달은 선택값에 따라 스스로 다시 그려지지 않는다
 * (`views.update` 로 서버가 다시 밀어 넣어야 한다). 한 모달 안에서 '보강/주말근무' 를
 * 고르게 하면 대상반·수강인원처럼 보강에만 있는 칸이 주말근무 신청자에게도 그대로 보인다.
 * 입구에서 갈라 두면 각자 자기 양식만 본다.
 */
export function makeupLauncherBlocks(companyName = "유쌤에듀") {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*📚 보강 · 주말근무 사전신청*\n아래 버튼을 누르면 신청 양식이 열립니다.\n` +
          `_승인 절차 없이 바로 등록됩니다. 보강은 ${companyName} 보강캘린더에도 함께 올라갑니다._\n` +
          `_근무가 끝난 **다음날부터** 신청자가 직접 실근무 시간을 확정합니다._`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "보강계획 신청", emoji: true },
          action_id: "open_makeup_modal",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "주말·초과근무 신청", emoji: true },
          action_id: "open_weekend_modal",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "내 신청 내역 · 실근무 확정", emoji: true },
          action_id: "check_makeup_list",
        },
      ],
    },
  ];
}

/* ==================== 앱 홈 탭 (사이드바 → 앱 이름) ==================== */

export async function publishHomeView(userId: string, view: any) {
  return slackCall("views.publish", { user_id: userId, view });
}

/**
 * 앱 홈 화면. 채널 메시지와 달리 위로 밀려 올라가지 않는 상시 진입점이라
 * 잔여 연차와 예정된 휴가를 함께 보여준다.
 */
export function homeTabView(ctx: {
  balanceText?: string;
  notice?: string;
  upcoming?: Array<{ label: string; status: string }>;
  makeups?: Array<{ label: string; status: string }>;
  companyName?: string;
}) {
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "🏖️ 휴가 신청", emoji: true } },
  ];

  if (ctx.notice) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: ctx.notice } });
  } else {
    if (ctx.balanceText)
      blocks.push({ type: "section", text: { type: "mrkdwn", text: ctx.balanceText } });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "휴가신청서 작성", emoji: true },
          action_id: "open_leave_modal",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "휴가 취소 신청", emoji: true },
          action_id: "open_cancel_modal",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "새로고침", emoji: true },
          action_id: "refresh_home",
        },
      ],
    });
    blocks.push({ type: "divider" });
    const list = ctx.upcoming ?? [];
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: list.length
          ? `*예정된 휴가*\n${list.map((u) => `• ${u.label} — ${u.status}`).join("\n")}`
          : "*예정된 휴가*\n_예정된 휴가가 없습니다._",
      },
    });
  }

  // 보강·주말근무 사전신청 — 휴가와 성격이 달라 아래에 따로 묶는다 (완전비율제도 일정 공유용으로 쓴다)
  blocks.push(
    { type: "divider" },
    { type: "header", text: { type: "plain_text", text: "📚 보강 · 주말근무 사전신청", emoji: true } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "보강계획 신청", emoji: true },
          action_id: "open_makeup_modal",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "주말·초과근무 신청", emoji: true },
          action_id: "open_weekend_modal",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "내 신청 내역 · 실근무 확정", emoji: true },
          action_id: "check_makeup_list",
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: (ctx.makeups ?? []).length
          ? `*예정된 근무*\n${(ctx.makeups ?? []).map((m) => `• ${m.label} — ${m.status}`).join("\n")}`
          : "*예정된 근무*\n_예정된 보강·주말근무가 없습니다._",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "근무가 끝난 *다음날부터* 「내 신청 내역」에서 실근무 시간을 직접 확정해 주세요 — 확정한 시간이 그대로 수당이 됩니다.",
        },
      ],
    }
  );

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `${ctx.companyName ?? "유쌤에듀"} HR · 승인 결과는 DM 으로 안내됩니다. 채널에서 신청하려면 *#휴가-신청* 의 고정 메시지를 이용하세요.`,
      },
    ],
  });

  return { type: "home", blocks };
}

export interface LeaveModalContext {
  empName: string;
  remaining: number;
  compRemaining: number;
  serviceLabel: string;
  channel?: string;
  /** 이번 연차기간 (있으면 누계 대신 이 기간 기준으로 안내) */
  period?: { start: string; end: string; granted: number; used: number };
}

/** 기존 워크플로 '휴가신청서' 양식을 그대로 재현한 모달 */
export function leaveModalView(ctx: LeaveModalContext) {
  const compLine =
    ctx.compRemaining > 0 ? ` · 대휴보상연차 *${ctx.compRemaining}일*` : "";
  const periodLine = ctx.period
    ? `이번 연차기간 ${ctx.period.start} ~ ${ctx.period.end}\n발생 ${ctx.period.granted} · 사용 ${ctx.period.used} · 잔여 *${ctx.remaining}일*${compLine}`
    : `잔여 연차 *${ctx.remaining}일*${compLine}`;
  return {
    type: "modal",
    callback_id: "leave_request_submit",
    private_metadata: JSON.stringify({ channel: ctx.channel ?? "" }),
    title: { type: "plain_text", text: "휴가신청서" },
    submit: { type: "plain_text", text: "제출" },
    close: { type: "plain_text", text: "닫기" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${ctx.empName}* 님 (근속 ${ctx.serviceLabel})\n${periodLine}`,
        },
      },
      { type: "divider" },
      {
        type: "input",
        block_id: "kind",
        label: { type: "plain_text", text: "휴가종류" },
        element: {
          type: "static_select",
          action_id: "v",
          placeholder: { type: "plain_text", text: "옵션을 선택하세요." },
          options: [
            { text: { type: "plain_text", text: "연차 (1일)" }, value: "ANNUAL" },
            { text: { type: "plain_text", text: "반차 (0.5일)" }, value: "HALF" },
            { text: { type: "plain_text", text: "대휴(보상연차)" }, value: "COMP" },
            { text: { type: "plain_text", text: "병가" }, value: "SICK" },
            { text: { type: "plain_text", text: "경조사" }, value: "SPECIAL" },
          ],
        },
      },
      {
        type: "input",
        block_id: "start",
        label: { type: "plain_text", text: "휴가시작일" },
        element: { type: "datepicker", action_id: "v" },
      },
      {
        type: "input",
        block_id: "end",
        optional: true,
        label: { type: "plain_text", text: "휴가종료일" },
        hint: { type: "plain_text", text: "하루 짜리 연차 또는 반차의 경우 종료일은 기입하지 마세요." },
        element: { type: "datepicker", action_id: "v" },
      },
      {
        type: "input",
        block_id: "halftime",
        optional: true,
        label: { type: "plain_text", text: "반차일 경우 사용시간" },
        hint: { type: "plain_text", text: "ex. 14시~18시 / 18시~22시" },
        element: {
          type: "plain_text_input",
          action_id: "v",
          placeholder: { type: "plain_text", text: "작성해 주세요." },
        },
      },
      {
        type: "input",
        block_id: "reason",
        label: { type: "plain_text", text: "휴가사유" },
        element: {
          type: "plain_text_input",
          action_id: "v",
          multiline: true,
          placeholder: { type: "plain_text", text: "작성해 주세요." },
        },
      },
      {
        type: "input",
        block_id: "workplan",
        optional: true,
        label: { type: "plain_text", text: "업무조치사항" },
        hint: {
          type: "plain_text",
          text: "부재 중 수업·업무를 어떻게 처리하는지 적어 주세요. ex. 8/14 A반 → 김OO 선생님 대강 / 상담 일정 조정 완료",
        },
        element: {
          type: "plain_text_input",
          action_id: "v",
          multiline: true,
          placeholder: { type: "plain_text", text: "작성해 주세요. (해당 없으면 '없음')" },
        },
      },
    ],
  };
}

/** 모달 제출 값 추출 */
export function readLeaveModal(view: any): {
  kind: string;
  start: string | null;
  end: string | null;
  halftime: string;
  reason: string;
  workplan: string;
} {
  const v = view?.state?.values ?? {};
  return {
    kind: v.kind?.v?.selected_option?.value ?? "ANNUAL",
    start: v.start?.v?.selected_date ?? null,
    end: v.end?.v?.selected_date ?? null,
    halftime: (v.halftime?.v?.value ?? "").trim(),
    reason: (v.reason?.v?.value ?? "").trim(),
    workplan: (v.workplan?.v?.value ?? "").trim(),
  };
}

/* ==================== 보강계획 사전신청 ==================== */

/**
 * 사전신청 모달 — 보강(기존 슬랙 워크플로 양식 그대로)과 주말근무 두 갈래.
 *
 * 관리자 승인 절차는 없다 — 제출 즉시 HR 시스템에 등록되고(보강은 보강캘린더에도),
 * **근무 다음날부터 신청자가 직접 실근무 시간을 확정**하면 오버타임 수당으로 산정된다.
 *
 * `kind:"WEEKEND"` 는 교수부가 아닌 직원의 주말 근무 신청이다 — 보강 종류를 묻지 않고
 * (카테고리가 WEEKEND 로 고정된다) 대상반·수강인원 대신 담당 업무를 묻는다.
 */
export function makeupModalView(ctx: {
  empName: string;
  channel?: string;
  ratio?: boolean;
  kind?: "MAKEUP" | "WEEKEND";
}) {
  const weekend = ctx.kind === "WEEKEND";
  const what = weekend ? "근무" : "보강";
  const notice = ctx.ratio
    ? "\n\n_※ 완전비율제(위탁) 계약은 오버타임 수당 대상이 아닙니다. 일정 공유 목적으로만 등록됩니다._"
    : "";
  // 직원 근무는 **사후 등록이 정상 경로**다 — 평일에 늦게까지 남을지는 그날 일이 정하는 것이라
  // 미리 신청할 수 없다. 이미 끝난 근무를 등록하면 적은 시간이 그대로 실근무로 확정된다.
  const guide = weekend
    ? `주말·공휴일 근무와 평일 초과근무 모두 여기서 등록합니다(날짜로 자동 구분됩니다). ` +
      `승인 절차 없이 바로 등록됩니다.\n` +
      `• *예정 근무*: 미리 등록해 두고, 근무가 끝난 다음날 실근무 시간을 확정해 주세요.\n` +
      `• *이미 끝난 근무*: 지금 등록하면 적어 주신 시간이 *그대로 실근무 시간으로 확정*됩니다 — ` +
      `실제로 근무한 시간을 있는 그대로 적어 주세요.`
    : `승인 절차 없이 바로 등록됩니다. ` +
      `*보강이 끝난 다음날부터* 실근무 시간을 직접 확정해 주시면 그 시간으로 수당이 산정됩니다.`;
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${ctx.empName}* 님\n` + guide + notice,
      },
    },
    { type: "divider" },
    {
      type: "input",
      block_id: "sdate",
      label: { type: "plain_text", text: weekend ? "근무 시작 날짜" : `${what} 시작 날짜(예정)` },
      ...(weekend
        ? { hint: { type: "plain_text", text: "지난 날짜를 고르면 사후 등록됩니다." } }
        : {}),
      element: { type: "datepicker", action_id: "v" },
    },
    {
      type: "input",
      block_id: "stime",
      label: { type: "plain_text", text: weekend ? "근무 시작 시간" : `${what} 시작 시간(예정)` },
      hint: { type: "plain_text", text: "시간대: 서울" },
      element: { type: "timepicker", action_id: "v" },
    },
    {
      type: "input",
      block_id: "edate",
      optional: true,
      label: { type: "plain_text", text: weekend ? "근무 종료 날짜" : `${what} 종료 날짜(예정)` },
      hint: { type: "plain_text", text: "같은 날 끝나면 비워 두세요." },
      element: { type: "datepicker", action_id: "v" },
    },
    {
      type: "input",
      block_id: "etime",
      label: { type: "plain_text", text: weekend ? "근무 종료 시간" : `${what} 종료 시간(예정)` },
      hint: {
        type: "plain_text",
        text: weekend
          ? "이미 끝난 근무면 실제로 끝난 시간을 적어 주세요."
          : "끝나는 시간이 미정인 경우에도 예상 시간은 기입해주세요.",
      },
      element: { type: "timepicker", action_id: "v" },
    },
  ];

  if (!weekend)
    blocks.push({
      type: "input",
      block_id: "category",
      label: { type: "plain_text", text: "어떤 보강인가요?" },
      element: {
        type: "static_select",
        action_id: "v",
        placeholder: { type: "plain_text", text: "옵션을 선택하세요." },
        options: [
          { text: { type: "plain_text", text: "직전보강" }, value: "IMMEDIATE" },
          { text: { type: "plain_text", text: "내신의무보강" }, value: "MANDATORY" },
          { text: { type: "plain_text", text: "결시보강" }, value: "ABSENCE" },
          { text: { type: "plain_text", text: "기타" }, value: "OTHER" },
        ],
      },
    });

  blocks.push({
    type: "input",
    block_id: "target",
    label: {
      type: "plain_text",
      text: weekend
        ? "어떤 업무인가요?"
        : "대상반을 써주세요(개별 보강일 경우 학생이름까지 써주세요)",
    },
    hint: {
      type: "plain_text",
      text: weekend ? "ex)입시설명회 운영, 상담, 시설 점검." : "ex)은가람중3 또는 홍길동, 김유쌤.",
    },
    element: {
      type: "plain_text_input",
      action_id: "v",
      placeholder: { type: "plain_text", text: "작성해 주세요." },
    },
  });

  if (!weekend)
    blocks.push({
      type: "input",
      block_id: "headcount",
      optional: true,
      label: { type: "plain_text", text: "수강 예상인원을 기입해주세요" },
      element: {
        type: "number_input",
        is_decimal_allowed: false,
        action_id: "v",
        placeholder: { type: "plain_text", text: "숫자를 입력하세요" },
      },
    });

  blocks.push(
    {
      type: "input",
      block_id: "detail",
      label: { type: "plain_text", text: `세부 ${weekend ? "근무" : "보강"}내역을 작성해주세요` },
      hint: {
        type: "plain_text",
        text: weekend ? "ex)설명회 자료 준비 및 현장 안내." : "ex)실전모의고사 응시 및 풀이.",
      },
      element: {
        type: "plain_text_input",
        action_id: "v",
        multiline: true,
        placeholder: { type: "plain_text", text: "작성해 주세요." },
      },
    },
    {
      type: "input",
      block_id: "note",
      optional: true,
      label: { type: "plain_text", text: "기타 특이사항이 있다면 작성해주세요" },
      element: {
        type: "plain_text_input",
        action_id: "v",
        multiline: true,
        placeholder: { type: "plain_text", text: "작성해 주세요." },
      },
    }
  );

  return {
    type: "modal",
    callback_id: "makeup_plan_submit",
    // 어떤 입구로 들어왔는지는 제출값이 아니라 여기에 담는다 (주말근무는 종류 선택칸이 없다)
    private_metadata: JSON.stringify({ channel: ctx.channel ?? "", kind: weekend ? "WEEKEND" : "MAKEUP" }),
    title: { type: "plain_text", text: weekend ? "주말·초과근무 신청" : "보강계획 사전신청" },
    submit: { type: "plain_text", text: "제출" },
    close: { type: "plain_text", text: "닫기" },
    blocks,
  };
}

export interface MakeupModalValues {
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  category: string;
  targetClass: string;
  headcount: number | null;
  detail: string;
  note: string;
}

export function readMakeupModal(view: any): MakeupModalValues {
  const v = view?.state?.values ?? {};
  const n = parseInt(v.headcount?.v?.value ?? "", 10);
  // 주말근무 모달에는 '어떤 보강인가요?' 칸이 아예 없다 — 어느 입구였는지는 여기서 읽는다
  let kind = "MAKEUP";
  try {
    kind = JSON.parse(view?.private_metadata || "{}").kind || "MAKEUP";
  } catch {}
  return {
    startDate: v.sdate?.v?.selected_date ?? null,
    startTime: v.stime?.v?.selected_time ?? null,
    endDate: v.edate?.v?.selected_date ?? null,
    endTime: v.etime?.v?.selected_time ?? null,
    category:
      kind === "WEEKEND" ? "WEEKEND" : v.category?.v?.selected_option?.value ?? "IMMEDIATE",
    targetClass: (v.target?.v?.value ?? "").trim(),
    headcount: Number.isFinite(n) ? n : null,
    detail: (v.detail?.v?.value ?? "").trim(),
    note: (v.note?.v?.value ?? "").trim(),
  };
}

/** 등록 결과를 알리는 카드 (신청자 DM · 공유 채널 공통) */
export function makeupRecordBlocks(args: {
  name: string;
  dept?: string | null;
  categoryLabel: string;
  dateLabel: string; // "2026-08-15(토) 09:00~16:00 (7시간)"
  targetClass: string;
  headcount?: number | null;
  detail?: string | null;
  note?: string | null;
  calendarSynced?: boolean;
  /** 직원 근무(주말·평일 초과)면 문구가 갈린다 (보강캘린더에 올라가지 않는다) */
  weekend?: boolean;
  /** 실근무 확정이 열리는 날 — "2026.08.16" */
  confirmOpensLabel?: string;
  /** 사후 등록으로 **이미 확정까지 끝난** 건 — 안내문이 갈린다 */
  confirmedNow?: boolean;
  /** 화면 명칭 — "주말근무"/"초과근무"/"보강". 없으면 weekend 플래그로 정한다 */
  kindLabel?: string;
}) {
  const what = args.kindLabel ?? (args.weekend ? "주말근무" : "보강");
  const fields = [
    `*${args.weekend ? "구분" : "보강종류"}*\n${args.categoryLabel}`,
    `*일시*\n${args.dateLabel}`,
    `*${args.weekend ? "담당 업무" : "대상반"}*\n${args.targetClass}`,
    args.headcount ? `*수강 예상인원*\n${args.headcount}명` : null,
  ].filter(Boolean) as string[];
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${args.weekend ? "🗓" : "📚"} *${what}${
          args.confirmedNow ? "가(이) 등록·확정되었습니다" : " 신청이 등록되었습니다"
        }* — ${args.name}${args.dept ? ` (${args.dept})` : ""}`,
      },
    },
    { type: "section", fields: fields.map((text) => ({ type: "mrkdwn", text })) },
  ];
  if (args.detail)
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*세부 ${args.weekend ? "근무" : "보강"}내역*\n${args.detail}` },
    });
  if (args.note)
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*기타 특이사항*\n${args.note}` } });
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: args.confirmedNow
          ? // 이미 끝난 근무의 사후 등록 — 적은 시간이 그대로 실근무로 확정됐다.
            // "다음날부터 확정해 주세요" 를 그대로 내보내면 없는 할 일을 시키는 셈이다.
            `이미 끝난 근무라 적어 주신 시간이 *실근무 시간으로 바로 확정*되었습니다. ` +
            `이 시간으로 수당이 산정됩니다. 잘못 적었다면 급여 마감 전까지 «내 신청 내역»에서 고칠 수 있습니다.`
          : (!args.weekend && args.calendarSynced ? "보강캘린더에 등록되었습니다. " : "") +
            `${what}이 끝난 다음날${
              args.confirmOpensLabel ? `(${args.confirmOpensLabel})` : ""
            }부터 실근무 시간을 직접 확정해 주세요. 확정한 시간으로 수당이 산정됩니다.`,
      },
    ],
  });
  return blocks;
}

/* ==================== 실근무 확정 (신청자 본인) ==================== */

/**
 * '실근무 시간을 확정해 주세요' 카드 — 근무 다음날 신청자에게 DM 으로 나간다.
 * 수당이 기본 반영되는 유형은 자동으로, 그 외(결시보강 등)는 관리자가 골라서 보낸다.
 */
export function makeupConfirmRequestBlocks(args: {
  id: number;
  name: string;
  kindLabel: string; // "보강" | "주말근무"
  categoryLabel: string;
  dateLabel: string;
  targetClass: string;
  alreadyConfirmed?: boolean;
  /** "9월 1일까지" — 창이 좁아 재촉하는 자리마다 날짜를 박아 준다 */
  deadlineLabel?: string;
}) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `⏱ *${args.name}님, ${args.kindLabel} 실근무 시간을 확정해 주세요.*\n` +
          `• 일시(예정): ${args.dateLabel}\n• ${args.categoryLabel} · ${args.targetClass}` +
          (args.deadlineLabel ? `\n• *${args.deadlineLabel}* 확정해 주세요` : ""),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            "확정한 시간이 그대로 수당으로 산정됩니다. 실제로 근무한 시간을 있는 그대로 적어 주세요." +
            (args.deadlineLabel ? " 기간이 지나면 관리자에게 문의해야 합니다." : ""),
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: {
            type: "plain_text",
            text: args.alreadyConfirmed ? "확정 시간 수정" : "실근무 시간 확정",
            emoji: true,
          },
          action_id: "open_makeup_confirm",
          value: String(args.id),
        },
      ],
    },
  ];
}

/**
 * 실근무 확정 모달.
 *
 * 예정 시각을 초기값으로 채워 두되(대부분 그대로다), **안내문을 눈에 띄게 앞에 둔다** —
 * 그냥 제출만 누르면 예정이 확정이 되어 실제와 어긋난다.
 */
export function makeupConfirmModalView(ctx: {
  id: number;
  kindLabel: string;
  dateLabel: string;
  categoryLabel: string;
  targetClass: string;
  /** 초기값 (YYYY-MM-DD / HH:MM) */
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  note?: string | null;
  /** 솔직 입력 안내 (lib/makeup-confirm 의 honestyNotice) */
  honesty: string;
  /** 내신 상한 안내 — 이미 상한을 넘겼을 때만 */
  capNotice?: string | null;
  /** "9월 1일까지" */
  deadlineLabel?: string;
}) {
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${ctx.kindLabel} 실근무 확정*\n• 신청: ${ctx.dateLabel}\n• ${ctx.categoryLabel} · ${ctx.targetClass}` +
          (ctx.deadlineLabel ? `\n• 확정 마감: *${ctx.deadlineLabel}*` : ""),
      },
    },
    { type: "section", text: { type: "mrkdwn", text: `⚠️ ${ctx.honesty}` } },
  ];
  if (ctx.capNotice) blocks.push({ type: "section", text: { type: "mrkdwn", text: ctx.capNotice } });
  blocks.push(
    { type: "divider" },
    // **근무를 안 한 경우도 여기서 끝낸다** — 이 칸이 없으면 취소하려고 들어온 사람이
    // 갈 곳이 없어 예정 시간을 그대로 제출해 버린다(하지도 않은 근무가 수당이 된다).
    {
      type: "input",
      block_id: "did",
      label: { type: "plain_text", text: "이 근무를 하셨나요?" },
      element: {
        type: "radio_buttons",
        action_id: "v",
        initial_option: {
          text: { type: "plain_text", text: "네, 근무했습니다 — 아래에 실제 시간을 적습니다" },
          value: "YES",
        },
        options: [
          {
            text: { type: "plain_text", text: "네, 근무했습니다 — 아래에 실제 시간을 적습니다" },
            value: "YES",
          },
          {
            text: { type: "plain_text", text: "아니요, 하지 않았습니다 (미실시 처리)" },
            value: "NO",
          },
        ],
      },
      hint: {
        type: "plain_text",
        text: "‘아니요’ 를 고르면 아래 시간은 무시되고 수당도 발생하지 않습니다.",
      },
    },
    {
      type: "input",
      block_id: "sdate",
      label: { type: "plain_text", text: "실제 시작 날짜" },
      element: { type: "datepicker", action_id: "v", initial_date: ctx.startDate },
    },
    {
      type: "input",
      block_id: "stime",
      label: { type: "plain_text", text: "실제 시작 시간" },
      hint: { type: "plain_text", text: "시간대: 서울" },
      element: { type: "timepicker", action_id: "v", initial_time: ctx.startTime },
    },
    {
      type: "input",
      block_id: "edate",
      optional: true,
      label: { type: "plain_text", text: "실제 종료 날짜" },
      hint: { type: "plain_text", text: "같은 날 끝났으면 비워 두세요." },
      element: { type: "datepicker", action_id: "v", initial_date: ctx.endDate },
    },
    {
      type: "input",
      block_id: "etime",
      label: { type: "plain_text", text: "실제 종료 시간" },
      element: { type: "timepicker", action_id: "v", initial_time: ctx.endTime },
    },
    {
      type: "input",
      block_id: "note",
      optional: true,
      label: { type: "plain_text", text: "특이사항이 있으면 적어 주세요" },
      hint: {
        type: "plain_text",
        text: "ex)학생 사정으로 30분 일찍 종료. / 미실시라면 그 사유를 적어 주세요.",
      },
      element: {
        type: "plain_text_input",
        action_id: "v",
        multiline: true,
        ...(ctx.note ? { initial_value: ctx.note } : {}),
      },
    }
  );
  return {
    type: "modal",
    callback_id: "makeup_confirm_submit",
    private_metadata: JSON.stringify({ id: ctx.id }),
    title: { type: "plain_text", text: "실근무 확정" },
    submit: { type: "plain_text", text: "확정" },
    close: { type: "plain_text", text: "닫기" },
    blocks,
  };
}

export interface MakeupConfirmValues {
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  note: string;
  /** 라디오 '이 근무를 하셨나요?' — false 면 미실시 처리로 간다 */
  didWork: boolean;
  id: number | null;
}

export function readMakeupConfirmModal(view: any): MakeupConfirmValues {
  const v = view?.state?.values ?? {};
  let id: number | null = null;
  try {
    const n = Number(JSON.parse(view?.private_metadata || "{}").id);
    id = Number.isFinite(n) && n > 0 ? n : null;
  } catch {}
  return {
    startDate: v.sdate?.v?.selected_date ?? null,
    startTime: v.stime?.v?.selected_time ?? null,
    endDate: v.edate?.v?.selected_date ?? null,
    endTime: v.etime?.v?.selected_time ?? null,
    note: (v.note?.v?.value ?? "").trim(),
    // 라디오가 없던 시절의 옛 모달이 열려 있을 수 있다 — 없으면 '근무했음' 으로 본다
    // (예전과 같은 동작이라 갑자기 미실시로 처리되는 일이 없다)
    didWork: (v.did?.v?.selected_option?.value ?? "YES") !== "NO",
    id,
  };
}

/**
 * 미실시 전용 모달 — 목록의 «미실시» 버튼에서 연다.
 *
 * 확정 모달과 따로 두는 이유: 확정 모달은 '몇 시부터 몇 시까지' 를 묻는 자리라 아직 하지도 않은
 * (또는 안 하기로 한) 근무에는 물음 자체가 맞지 않는다. 여기서는 **사유만** 받는다.
 */
export function makeupCancelModalView(ctx: {
  id: number;
  kindLabel: string;
  dateLabel: string;
  categoryLabel: string;
  targetClass: string;
  /** lib/makeup-confirm 의 cancelNotice */
  notice: string;
}) {
  return {
    type: "modal",
    callback_id: "makeup_cancel_submit",
    private_metadata: JSON.stringify({ id: ctx.id }),
    title: { type: "plain_text", text: "미실시 처리" },
    submit: { type: "plain_text", text: "미실시로 내리기" },
    close: { type: "plain_text", text: "닫기" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${ctx.kindLabel} 미실시 처리*\n• 신청: ${ctx.dateLabel}\n• ${ctx.categoryLabel} · ${ctx.targetClass}`,
        },
      },
      { type: "section", text: { type: "mrkdwn", text: `⚠️ ${ctx.notice}` } },
      { type: "divider" },
      {
        type: "input",
        block_id: "reason",
        label: { type: "plain_text", text: "하지 않게 된 사유" },
        hint: { type: "plain_text", text: "ex)학생 전원 결석으로 취소. / 일정이 다음 주로 옮겨짐." },
        element: { type: "plain_text_input", action_id: "v", multiline: true },
      },
    ],
  };
}

export function readMakeupCancelModal(view: any): { id: number | null; reason: string } {
  const v = view?.state?.values ?? {};
  let id: number | null = null;
  try {
    const n = Number(JSON.parse(view?.private_metadata || "{}").id);
    id = Number.isFinite(n) && n > 0 ? n : null;
  } catch {}
  return { id, reason: (v.reason?.v?.value ?? "").trim() };
}

/* ==================== 휴가 취소 신청 ==================== */

export interface CancelableLeave {
  id: number;
  label: string; // "2026-08-14 ~ 08-16 · 연차 3일"
}

/** 취소할 휴가 선택 + 사유 입력 모달 */
export function leaveCancelModalView(items: CancelableLeave[], channel?: string) {
  return {
    type: "modal",
    callback_id: "leave_cancel_submit",
    private_metadata: JSON.stringify({ channel: channel ?? "" }),
    title: { type: "plain_text", text: "휴가 취소 신청" },
    submit: { type: "plain_text", text: "취소 신청" },
    close: { type: "plain_text", text: "닫기" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "취소할 휴가를 선택하세요. *운영진 승인 후* 취소가 확정되며, 연차는 다시 복원됩니다.",
        },
      },
      {
        type: "input",
        block_id: "target",
        label: { type: "plain_text", text: "취소할 휴가" },
        element: {
          type: "static_select",
          action_id: "v",
          placeholder: { type: "plain_text", text: "옵션을 선택하세요." },
          options: items.slice(0, 100).map((it) => ({
            text: { type: "plain_text", text: it.label.slice(0, 75) },
            value: String(it.id),
          })),
        },
      },
      {
        type: "input",
        block_id: "reason",
        label: { type: "plain_text", text: "취소 사유" },
        element: {
          type: "plain_text_input",
          action_id: "v",
          multiline: true,
          placeholder: { type: "plain_text", text: "작성해 주세요." },
        },
      },
    ],
  };
}

export function readCancelModal(view: any): { requestId: number; reason: string } {
  const v = view?.state?.values ?? {};
  return {
    requestId: Number(v.target?.v?.selected_option?.value ?? 0),
    reason: (v.reason?.v?.value ?? "").trim(),
  };
}

/** 운영진 채널용 취소 승인 카드 */
export function cancelApprovalBlocks(args: {
  requestId: number;
  name: string;
  dept: string;
  range: string;
  days: number;
  typeLabel: string;
  cancelReason: string;
}) {
  return [
    { type: "header", text: { type: "plain_text", text: "🚫 휴가 취소 신청", emoji: true } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*신청자*\n${args.name} (${args.dept})` },
        { type: "mrkdwn", text: `*취소 대상*\n${args.range} · ${args.typeLabel} ${args.days}일` },
        { type: "mrkdwn", text: `*취소 사유*\n${args.cancelReason}` },
      ],
    },
    {
      type: "actions",
      block_id: `cancel_${args.requestId}`,
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "취소 승인", emoji: true },
          action_id: "approve_cancel",
          value: String(args.requestId),
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "취소 반려", emoji: true },
          action_id: "reject_cancel",
          value: String(args.requestId),
        },
      ],
    },
  ];
}

/** 휴가-기록 채널에 남길 확정 내역 */
export function recordBlocks(args: {
  name: string;
  dept: string;
  range: string;
  days: number;
  typeLabel: string;
  reason: string;
  canceled?: boolean;
  by: string;
  calendarSynced?: boolean;
  deducted?: boolean;
  remaining?: number;
  workPlan?: string | null;
}) {
  const head = args.canceled
    ? `🚫 *휴가 취소 확정* — ${args.name}`
    : `✅ *휴가 승인* — ${args.name}`;
  const notes: string[] = [`처리자 <@${args.by}>`];
  if (args.calendarSynced)
    notes.push(args.canceled ? "구글 캘린더에서 삭제됨" : "구글 캘린더에 등록됨");
  if (!args.canceled && args.deducted === false) notes.push("연차 미차감");
  if (!args.canceled && args.remaining != null) notes.push(`잔여 연차 ${args.remaining}일`);
  return [
    { type: "section", text: { type: "mrkdwn", text: head } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*소속*\n${args.dept || "-"}` },
        { type: "mrkdwn", text: `*기간*\n${args.range} · ${args.days}일` },
        { type: "mrkdwn", text: `*종류*\n${args.typeLabel}` },
        { type: "mrkdwn", text: `*사유*\n${args.reason || "-"}` },
      ],
    },
    ...(args.workPlan && !args.canceled
      ? [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*업무조치사항*\n${args.workPlan}` },
          },
        ]
      : []),
    { type: "context", elements: [{ type: "mrkdwn", text: notes.join(" · ") }] },
  ];
}
