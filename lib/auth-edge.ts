// 엣지(미들웨어)용 세션 검증·갱신 — lib/hr-session.ts(node)와 **같은 토큰 모양**이다:
// base64url(JSON) + "." + HMAC-SHA256(hex). 엣지 런타임엔 node `crypto` 가 없어 Web Crypto 로
// 한 벌 더 적었고, 두 구현이 서로의 토큰을 받는지 lib/auth-edge.test.ts 가 못박는다
// (한쪽만 바뀌면 갱신하는 순간 전원이 로그아웃된다).
import { HR_SESSION_RENEW_AFTER_MS, HR_SESSION_TTL_SECONDS } from "./hr-session-config";

const DEFAULT_SECRET = process.env.SESSION_SECRET;

export const SESSION_COOKIE_NAME = "yh_session";

export async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function decodeBody(body: string) {
  const base64 = body.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

/** node `Buffer.toString("base64url")` 와 같은 모양 — UTF-8(한글 이름) · 패딩 없음 */
function encodeBody(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function verifySessionEdge(
  signed: string | undefined,
  secret = DEFAULT_SECRET,
  now = Date.now(),
): Promise<Record<string, unknown> | null> {
  if (!signed || !secret || secret.length < 32 || signed.length > 8192) return null;
  const [body, mac, extra] = signed.split(".");
  if (!body || !mac || extra) return null;
  const expected = await hmacHex(body, secret);
  if (mac.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = decodeBody(body);
    if (
      p.kind !== "hr-management" ||
      p.department !== "경영지원" ||
      typeof p.empNo !== "string" || !p.empNo ||
      typeof p.email !== "string" || !p.email ||
      typeof p.slackUserId !== "string" || !p.slackUserId ||
      typeof p.iat !== "number" ||
      typeof p.exp !== "number" ||
      p.iat > now + 30_000 ||
      p.exp <= now
    ) return null;
    return p;
  } catch {
    return null;
  }
}

/** 발급 후 갱신 간격을 넘긴 (검증된) 세션인가 */
export function shouldRenewSession(claims: Record<string, unknown>, now = Date.now()): boolean {
  return typeof claims.iat === "number" && now - claims.iat > HR_SESSION_RENEW_AFTER_MS;
}

/**
 * 검증된 세션을 **같은 사람으로** 새 12시간짜리로 다시 서명한다 — 쓰는 동안 로그인이 끊기지 않게.
 *
 * 신원 다섯 가지만 옮겨 싣는다(다른 필드는 버린다). 신원 확인은 갱신과 무관하게 **매 요청마다**
 * `isAuthed()` 가 HR 원장과 다시 대조하므로, 퇴사·부서 변경·Slack 연결 해제는 갱신된 쿠키로도
 * 곧바로 막힌다. node 의 `verifyHrSession` 이 요구하는 `exp − iat = 12시간` 을 그대로 지킨다.
 */
export async function renewSessionEdge(
  claims: Record<string, unknown>,
  secret = DEFAULT_SECRET,
  now = Date.now(),
): Promise<string | null> {
  if (!secret || secret.length < 32) return null;
  const { empNo, name, email, slackUserId, department } = claims;
  if (![empNo, name, email, slackUserId, department].every((v) => typeof v === "string" && v)) return null;
  const body = encodeBody({
    kind: "hr-management",
    empNo,
    name,
    email,
    slackUserId,
    department,
    iat: now,
    exp: now + HR_SESSION_TTL_SECONDS * 1000,
  });
  return `${body}.${await hmacHex(body, secret)}`;
}
