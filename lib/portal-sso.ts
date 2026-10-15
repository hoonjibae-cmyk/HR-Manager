import { createHmac, timingSafeEqual } from "crypto";
import type { HrIdentity } from "./hr-access";

export interface PortalSsoClaims extends HrIdentity {
  kind: "hr-sso";
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export function verifyPortalSsoToken(
  token: string,
  secret: string,
  expected: { portalOrigin: string; hrOrigin: string; now?: number },
): PortalSsoClaims | null {
  if (!token || token.length > 8192 || secret.length < 32) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const wanted = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(wanted);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as PortalSsoClaims;
    const now = expected.now ?? Date.now();
    if (
      p.kind !== "hr-sso" ||
      p.iss !== expected.portalOrigin ||
      p.aud !== expected.hrOrigin ||
      p.department !== "경영지원" ||
      !p.empNo ||
      !p.name ||
      !p.email ||
      !p.slackUserId ||
      typeof p.iat !== "number" ||
      typeof p.exp !== "number" ||
      p.iat > now + 30_000 ||
      p.iat < now - 120_000 ||
      p.exp <= now ||
      p.exp - p.iat > 60_000
    ) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * 서명을 **검증하지 않고** 토큰 본문만 읽는다 — 거부 기록에 '누구 이름으로 온 시도였나' 를
 * 붙이기 위한 것이지 접근 판단에는 절대 쓰지 않는다. 위조할 수 있는 값이므로 받는 쪽은
 * 「미검증」으로 표시한다. 모양부터 다른 입력(스캐너가 던진 아무 문자열)은 null — 그런 건
 * 기록도 하지 않는다(공개 주소라 아무 POST 나 DB 에 남기면 표가 쓰레기로 찬다).
 */
export function peekPortalSsoClaims(token: unknown): Partial<PortalSsoClaims> | null {
  if (typeof token !== "string" || !token || token.length > 8192) return null;
  const body = token.split(".")[0];
  if (!body) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p || typeof p !== "object" || p.kind !== "hr-sso" || typeof p.empNo !== "string" || !p.empNo)
      return null;
    return p as Partial<PortalSsoClaims>;
  } catch {
    return null;
  }
}
