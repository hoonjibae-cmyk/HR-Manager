// 로그인 기록 — 어떤 계정이 언제 어디서 들어왔는지(또는 거부됐는지).
//
// **저장소를 따로 두지 않고 AuditLog 를 그대로 쓴다**(action LOGIN / LOGIN_FAILED / LOGOUT).
// 포털 SSO 가 처음부터 LOGIN 을 거기 남겨 와서 기록이 이미 쌓여 있고, 개인정보 안전성 확보조치
// 기준 §8 이 말하는 '접속기록'(계정·접속일시·접속지·수행업무)도 작업 이력과 한 표에 있어야
// 한 번에 점검된다. 설정 화면의 「최근 로그인」이 이 기록을 읽는다.
// 이 파일은 순수 함수뿐이다(DB 는 login-log-service.ts, 기록하는 쪽은 app/api/auth/*).

export const LOGIN_ACTIONS = ["LOGIN", "LOGIN_FAILED", "LOGOUT"] as const;
export type LoginAction = (typeof LOGIN_ACTIONS)[number];

export function isLoginAction(a: string): a is LoginAction {
  return (LOGIN_ACTIONS as readonly string[]).includes(a);
}

export const LOGIN_ACTION_LABEL: Record<LoginAction, string> = {
  LOGIN: "로그인",
  LOGIN_FAILED: "거부",
  LOGOUT: "로그아웃",
};

/** 포털 SSO 가 세션을 내주지 않은 이유 (app/api/auth/portal) */
export type LoginDenialReason =
  | "missing_secret"
  | "missing_token"
  | "invalid_token"
  | "employee_not_found"
  | "employee_mismatch";

export const DENIAL_LABEL: Record<LoginDenialReason, string> = {
  missing_secret: "서버에 HR_SSO_SECRET 이 설정되지 않음",
  missing_token: "포털 토큰 없이 접근",
  invalid_token: "포털 서명이 맞지 않음",
  employee_not_found: "사번에 해당하는 직원 카드가 없음",
  employee_mismatch: "직원 원장과 대조 실패",
};

/** 원장 대조에서 어긋난 항목(app/api/auth/portal 의 failedChecks) → 사람이 읽는 말 */
export const CHECK_LABEL: Record<string, string> = {
  claim_department: "포털 쪽 소속이 경영지원 아님",
  employee_department: "직원 카드 부서가 경영지원 아님",
  active: "재직 상태 아님",
  resign_date: "퇴사일이 입력됨",
  employee_number: "사번 불일치",
  slack_user: "Slack 계정 불일치",
  email: "이메일 불일치",
};

/**
 * 거부 사유 한 줄. 만료는 따로 적는다 — 포털 토큰은 1분짜리라 "HR 카드를 눌러 놓고 한참 뒤에
 * 들어갔다" 가 거부의 대부분이고, 그때 담당자가 해야 할 일은 '다시 누르기' 뿐이다.
 */
export function denialText(
  reason: LoginDenialReason,
  failedChecks: string[] = [],
  opts: { expired?: boolean } = {}
): string {
  const why =
    reason === "invalid_token" && opts.expired
      ? "포털 토큰의 유효기간(1분)이 지남 — 포털에서 HR 카드를 다시 눌러야 합니다"
      : DENIAL_LABEL[reason] ?? reason;
  const checks = failedChecks.map((c) => CHECK_LABEL[c] ?? c);
  return checks.length ? `${why} (${checks.join(", ")})` : why;
}

export function loginDeniedSummary(
  reason: LoginDenialReason,
  failedChecks: string[] = [],
  opts: { expired?: boolean } = {}
): string {
  return `포털 로그인 거부 — ${denialText(reason, failedChecks, opts)}`;
}

/**
 * User-Agent → 「Chrome · Windows」 처럼 한 눈에 읽히는 요약.
 * 정밀한 판별이 목적이 아니다 — "평소 쓰던 PC 인가, 처음 보는 폰인가" 만 가리면 된다.
 * 순서가 뜻을 가진다: Edge·Samsung·Whale UA 에도 "Chrome/" 이 들어 있고, 모든 WebKit UA 에
 * "Safari/" 가 들어 있으며, iPhone UA 에도 "Mac OS X" 가 들어 있다 — 특수한 쪽을 먼저 본다.
 * 아이패드는 iPadOS 13+ 에서 스스로를 Macintosh 라 하므로 macOS 로 잡힌다(구분할 방법이 없다).
 */
export function summarizeUserAgent(ua: string | null | undefined): string | null {
  const s = (ua ?? "").trim();
  if (!s) return null;
  const os = /iPhone/i.test(s)
    ? "iPhone"
    : /iPad/i.test(s)
      ? "iPad"
      : /Android/i.test(s)
        ? "Android"
        : /Windows/i.test(s)
          ? "Windows"
          : /Mac OS X|Macintosh/i.test(s)
            ? "macOS"
            : /CrOS/.test(s)
              ? "ChromeOS"
              : /Linux/i.test(s)
                ? "Linux"
                : null;
  const browser = /Edg(e|A|iOS)?\//.test(s)
    ? "Edge"
    : /SamsungBrowser\//.test(s)
      ? "Samsung Internet"
      : /Whale\//.test(s)
        ? "Whale"
        : /KAKAOTALK/i.test(s)
          ? "카카오톡 인앱"
          : /\bSlack\b/i.test(s)
            ? "Slack 앱"
            : /OPR\/|Opera/.test(s)
              ? "Opera"
              : /Firefox\/|FxiOS\//.test(s)
                ? "Firefox"
                : /Chrome\/|CriOS\//.test(s)
                  ? "Chrome"
                  : /Safari\//.test(s)
                    ? "Safari"
                    : null;
  if (!browser && !os) return "기타";
  return [browser, os].filter(Boolean).join(" · ");
}

/** 기록에 붙일 접속 기기 — 원문은 300자에서 자른다(헤더를 통째로 저장할 이유가 없다) */
export function clientAgent(h: { get(name: string): string | null }): {
  ua: string | null;
  device: string | null;
} {
  const ua = (h.get("user-agent") ?? "").slice(0, 300) || null;
  return { ua, device: summarizeUserAgent(ua) };
}

/* ───────────── 화면에 낼 행 ───────────── */

export interface LoginAuditInput {
  id: number;
  action: string;
  actorName: string | null;
  employeeId: number | null;
  summary: string | null;
  detail: string;
  ip: string | null;
  createdAt: Date;
}

export interface LoginEmployee {
  id: number;
  name: string;
  empNo: string;
  department: string | null;
}

export interface LoginLogRow {
  id: number;
  at: Date;
  action: LoginAction;
  /** 원장에서 찾은 직원이 있으면 그 이름, 없으면 기록 당시 적힌 이름(거부라면 토큰에 적힌 이름) */
  name: string | null;
  empNo: string | null;
  department: string | null;
  employeeId: number | null;
  /** 포털 서명을 검증한 신원인가 — false 면 토큰에 적혀 있었을 뿐 믿을 수 없는 값 */
  verified: boolean;
  reason: LoginDenialReason | null;
  failedChecks: string[];
  expired: boolean;
  ip: string | null;
  device: string | null;
  ua: string | null;
  slackUserId: string | null;
}

function parseDetail(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/**
 * AuditLog 한 줄 → 화면 행. 로그인 종류가 아니면 null.
 * 옛 LOGIN 기록(기기 없음)도 그대로 읽힌다 — 성공한 로그인은 언제나 검증된 신원이다.
 */
export function toLoginRow(audit: LoginAuditInput, employee: LoginEmployee | null): LoginLogRow | null {
  if (!isLoginAction(audit.action)) return null;
  const d = parseDetail(audit.detail);
  const failedChecks = Array.isArray(d.failedChecks)
    ? d.failedChecks.filter((c): c is string => typeof c === "string")
    : [];
  return {
    id: audit.id,
    at: audit.createdAt,
    action: audit.action,
    name: employee?.name ?? str(audit.actorName),
    empNo: employee?.empNo ?? str(d.empNo) ?? str(d.claimedEmpNo),
    department: employee?.department ?? null,
    employeeId: employee?.id ?? audit.employeeId ?? null,
    verified: audit.action === "LOGIN_FAILED" ? d.verified === true : true,
    reason: audit.action === "LOGIN_FAILED" ? ((str(d.reason) as LoginDenialReason | null) ?? null) : null,
    failedChecks,
    expired: d.expired === true,
    ip: audit.ip,
    device: str(d.device) ?? summarizeUserAgent(str(d.ua)),
    ua: str(d.ua),
    slackUserId: str(d.slackUserId),
  };
}

/* ───────────── 머리줄 요약 ───────────── */

export interface LoginStats {
  logins: number;
  /** 성공한 로그인의 서로 다른 사람 수 */
  accounts: number;
  denied: number;
  logouts: number;
}

export function summarizeLogins(
  rows: Array<{ action: string; actorName: string | null; employeeId: number | null }>
): LoginStats {
  const people = new Set<string>();
  let logins = 0;
  let denied = 0;
  let logouts = 0;
  for (const r of rows) {
    if (r.action === "LOGIN") {
      logins++;
      people.add(r.employeeId != null ? `id:${r.employeeId}` : `name:${r.actorName ?? "?"}`);
    } else if (r.action === "LOGIN_FAILED") denied++;
    else if (r.action === "LOGOUT") logouts++;
  }
  return { logins, accounts: people.size, denied, logouts };
}

/* ───────────── 표기 ───────────── */

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** 저장된 UTC 시각 → `2026-10-15 (목) 14:02` (KST) */
export function kstLabel(d: Date): string {
  const t = new Date(d.getTime() + 9 * 3600000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} (${WEEK[t.getUTCDay()]}) ${p(
    t.getUTCHours()
  )}:${p(t.getUTCMinutes())}`;
}
