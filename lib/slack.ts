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

export interface LeaveModalContext {
  empName: string;
  remaining: number;
  compRemaining: number;
  serviceLabel: string;
  channel?: string;
}

/** 기존 워크플로 '휴가신청서' 양식을 그대로 재현한 모달 */
export function leaveModalView(ctx: LeaveModalContext) {
  const compLine =
    ctx.compRemaining > 0 ? ` · 대휴보상연차 *${ctx.compRemaining}일*` : "";
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
          text: `*${ctx.empName}* 님 (근속 ${ctx.serviceLabel})\n잔여 연차 *${ctx.remaining}일*${compLine}`,
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
            { text: { type: "plain_text", text: "연차" }, value: "ANNUAL" },
            { text: { type: "plain_text", text: "오전반차" }, value: "HALF_AM" },
            { text: { type: "plain_text", text: "오후반차" }, value: "HALF_PM" },
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
        hint: { type: "plain_text", text: "ex. 3시~5시30분" },
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
} {
  const v = view?.state?.values ?? {};
  return {
    kind: v.kind?.v?.selected_option?.value ?? "ANNUAL",
    start: v.start?.v?.selected_date ?? null,
    end: v.end?.v?.selected_date ?? null,
    halftime: (v.halftime?.v?.value ?? "").trim(),
    reason: (v.reason?.v?.value ?? "").trim(),
  };
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
    { type: "context", elements: [{ type: "mrkdwn", text: notes.join(" · ") }] },
  ];
}
