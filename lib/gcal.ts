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
