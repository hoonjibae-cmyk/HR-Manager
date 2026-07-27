// 구글 캘린더 연동 — 승인된 휴가를 '유쌤에듀-직원휴가일정' 캘린더에 자동 등록/삭제
//
// 인증: 서비스 계정(JWT → OAuth2 access token). googleapis 패키지 없이
//       node:crypto 로 RS256 서명만 하므로 서버리스 번들이 가벼움.
//
// 준비 (docs/SETUP.md 참고)
//  1) Google Cloud 콘솔에서 서비스 계정 생성 → JSON 키 발급
//  2) 구글 캘린더에서 대상 캘린더 → 설정 → '특정 사용자와 공유'에
//     서비스 계정 이메일을 추가하고 **변경 및 공유 관리 권한** 부여
//  3) 환경변수: GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_CALENDAR_ID

import { createSign } from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar";

export function gcalConfigured(): boolean {
  return (
    !!process.env.GOOGLE_CLIENT_EMAIL &&
    !!process.env.GOOGLE_PRIVATE_KEY &&
    !!process.env.GOOGLE_CALENDAR_ID
  );
}

function privateKey(): string {
  // 환경변수에 저장할 때 줄바꿈이 \n 문자열로 들어가는 경우가 많다
  return (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string | null> {
  if (!gcalConfigured()) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: process.env.GOOGLE_CLIENT_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(privateKey()));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const j: any = await res.json();
  if (!j?.access_token) {
    console.error("[gcal] 토큰 발급 실패:", j?.error_description || j?.error);
    return null;
  }
  cachedToken = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

/* ==================== 연결 진단 (설정 화면 '연결 테스트') ==================== */

export interface GcalStep {
  name: string;
  ok: boolean;
  detail?: string;
}

/** 구글이 돌려준 오류 코드/메시지 → 관리자가 바로 조치할 수 있는 안내 */
function gcalHint(status: number, reason: string, message: string): string {
  const m = `${reason} ${message}`.toLowerCase();
  if (m.includes("accessnotconfigured") || m.includes("has not been used"))
    return "Google Cloud 프로젝트에서 **Google Calendar API** 가 사용 설정되지 않았습니다.\n콘솔 → API 및 서비스 → 라이브러리 → Google Calendar API → 사용.";
  if (m.includes("invalid_grant"))
    return "서비스 계정 인증에 실패했습니다. GOOGLE_CLIENT_EMAIL 이 JSON 의 client_email 과 같은지,\nGOOGLE_PRIVATE_KEY 가 -----BEGIN PRIVATE KEY----- 부터 끝까지 잘리지 않고 들어갔는지 확인하세요.";
  if (status === 404)
    return "캘린더를 찾지 못했습니다. GOOGLE_CALENDAR_ID 가 정확한지, 그리고 그 캘린더를\n서비스 계정 이메일과 **공유** 했는지 확인하세요 (공유하지 않으면 존재해도 404 가 납니다).";
  if (status === 403)
    return "권한이 부족합니다. 캘린더 → 설정 및 공유 → 특정 사용자와 공유에서\n서비스 계정 이메일의 권한을 **일정 변경** 이상으로 올려 주세요.";
  if (status === 401)
    return "인증이 거부되었습니다. 서비스 계정 키가 삭제되었거나 잘못된 값입니다.";
  return message || "알 수 없는 오류";
}

/**
 * 토큰 발급 → 캘린더 조회 → 테스트 일정 생성/삭제까지 실제로 해 보고
 * 어디서 막혔는지 단계별로 알려준다.
 */
export async function gcalDiagnose(): Promise<{
  ok: boolean;
  steps: GcalStep[];
  hint?: string;
  calendarName?: string;
}> {
  const steps: GcalStep[] = [];
  const missing = [
    !process.env.GOOGLE_CLIENT_EMAIL && "GOOGLE_CLIENT_EMAIL",
    !process.env.GOOGLE_PRIVATE_KEY && "GOOGLE_PRIVATE_KEY",
    !process.env.GOOGLE_CALENDAR_ID && "GOOGLE_CALENDAR_ID",
  ].filter(Boolean) as string[];
  if (missing.length) {
    steps.push({ name: "환경변수", ok: false, detail: `누락: ${missing.join(", ")}` });
    return { ok: false, steps, hint: "환경변수를 넣고 재배포한 뒤 다시 시도하세요." };
  }
  steps.push({ name: "환경변수", ok: true, detail: process.env.GOOGLE_CLIENT_EMAIL });

  const key = privateKey();
  const keyOk = key.includes("BEGIN PRIVATE KEY") && key.includes("END PRIVATE KEY");
  steps.push({
    name: "비밀키 형식",
    ok: keyOk,
    detail: keyOk ? "정상" : "-----BEGIN PRIVATE KEY----- ~ -----END PRIVATE KEY----- 가 온전하지 않습니다",
  });
  if (!keyOk)
    return {
      ok: false,
      steps,
      hint: "JSON 의 private_key 값을 따옴표 안 내용 그대로(\\n 포함) 붙여넣으세요.",
    };

  // 1) 토큰
  cachedToken = null; // 진단은 항상 새 토큰으로
  let token: string | null = null;
  try {
    token = await accessToken();
  } catch (e: any) {
    steps.push({ name: "토큰 발급", ok: false, detail: e.message });
    return { ok: false, steps, hint: gcalHint(0, "invalid_grant", e.message) };
  }
  if (!token) {
    steps.push({ name: "토큰 발급", ok: false, detail: "access_token 을 받지 못했습니다" });
    return { ok: false, steps, hint: gcalHint(0, "invalid_grant", "") };
  }
  steps.push({ name: "토큰 발급", ok: true });

  const calId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "");
  const auth = { Authorization: `Bearer ${token}` };

  // 2) 캘린더 접근
  const metaRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}`, {
    headers: auth,
  });
  const meta: any = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok) {
    const reason = meta?.error?.errors?.[0]?.reason ?? "";
    const message = meta?.error?.message ?? `HTTP ${metaRes.status}`;
    steps.push({ name: "캘린더 접근", ok: false, detail: message });
    return { ok: false, steps, hint: gcalHint(metaRes.status, reason, message) };
  }
  steps.push({ name: "캘린더 접근", ok: true, detail: meta.summary });

  // 3) 쓰기 권한 — 실제로 만들었다가 지운다
  const probe = {
    summary: "[연결 테스트] 유쌤에듀 HR",
    description: "연결 확인용 임시 일정입니다. 자동으로 삭제됩니다.",
    start: { date: "2000-01-01" },
    end: { date: "2000-01-02" },
    transparency: "transparent",
  };
  const createRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
    { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(probe) }
  );
  const created: any = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created?.id) {
    const reason = created?.error?.errors?.[0]?.reason ?? "";
    const message = created?.error?.message ?? `HTTP ${createRes.status}`;
    steps.push({ name: "일정 생성 권한", ok: false, detail: message });
    return { ok: false, steps, hint: gcalHint(createRes.status, reason, message), calendarName: meta.summary };
  }
  const deleted = await deleteLeaveEvent(created.id);
  steps.push({ name: "일정 생성 권한", ok: true, detail: deleted ? "생성·삭제 확인" : "생성 성공 (테스트 일정 삭제 실패 — 수동 삭제 필요)" });

  return { ok: true, steps, calendarName: meta.summary };
}

/** YYYY-MM-DD (UTC 기준 저장된 날짜를 그대로 사용) */
function dateStr(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** 종료일 다음 날 (구글 종일 일정의 end.date 는 배타적) */
export function exclusiveEnd(end: Date): string {
  const d = new Date(new Date(end).getTime() + 86400000);
  return d.toISOString().slice(0, 10);
}

export interface LeaveEventInput {
  name: string;
  typeLabel: string; // 연차 / 반차 / 병가 ...
  start: Date;
  end: Date;
  reason?: string | null;
  department?: string | null;
  days?: number;
  workPlan?: string | null; // 업무조치사항
}

/** 캘린더 일정 본문 (테스트를 위해 분리) */
export function buildLeaveEvent(input: LeaveEventInput) {
  const summary = `${input.name} ${input.typeLabel}`;
  const lines = [
    `직원: ${input.name}${input.department ? ` (${input.department})` : ""}`,
    `종류: ${input.typeLabel}${input.days ? ` · ${input.days}일` : ""}`,
    input.reason ? `사유: ${input.reason}` : "",
    input.workPlan ? `업무조치사항: ${input.workPlan}` : "",
    "",
    "※ 유쌤에듀 HR 프로그램에서 자동 등록된 일정입니다.",
  ].filter(Boolean);
  return {
    summary,
    description: lines.join("\n"),
    start: { date: dateStr(input.start) },
    end: { date: exclusiveEnd(input.end) },
    transparency: "transparent",
  };
}

/** 휴가 일정 생성 → eventId (실패 시 null, 예외를 던지지 않음) */
export async function createLeaveEvent(input: LeaveEventInput): Promise<string | null> {
  const token = await accessToken();
  if (!token) return null;
  try {
    const calId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "");
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildLeaveEvent(input)),
      }
    );
    const j: any = await res.json();
    if (!j?.id) {
      console.error("[gcal] 일정 생성 실패:", j?.error?.message);
      return null;
    }
    return j.id as string;
  } catch (e: any) {
    console.error("[gcal] 일정 생성 예외:", e.message);
    return null;
  }
}

/** 휴가 일정 삭제 (취소 승인 시) */
export async function deleteLeaveEvent(eventId: string): Promise<boolean> {
  const token = await accessToken();
  if (!token || !eventId) return false;
  try {
    const calId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "");
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    // 204 삭제 성공, 410 이미 삭제됨
    return res.status === 204 || res.status === 410;
  } catch (e: any) {
    console.error("[gcal] 일정 삭제 예외:", e.message);
    return false;
  }
}
