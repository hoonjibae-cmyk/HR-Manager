import { createHmac, timingSafeEqual } from "crypto";
import type { HrIdentity } from "./hr-access";

export const HR_SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface HrSessionClaims extends HrIdentity {
  kind: "hr-management";
  iat: number;
  exp: number;
}

export function signHrSession(identity: HrIdentity, secret: string, now = Date.now()) {
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  const body = Buffer.from(JSON.stringify({
    kind: "hr-management",
    ...identity,
    iat: now,
    exp: now + HR_SESSION_TTL_SECONDS * 1000,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${signature}`;
}

export function verifyHrSession(
  token: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): HrSessionClaims | null {
  if (!token || !secret || secret.length < 32 || token.length > 8192) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const wanted = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(wanted);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as HrSessionClaims;
    if (
      p.kind !== "hr-management" ||
      p.department !== "경영지원" ||
      !p.empNo || !p.name || !p.email || !p.slackUserId ||
      typeof p.iat !== "number" || typeof p.exp !== "number" ||
      p.iat > now + 30_000 || p.exp <= now ||
      p.exp - p.iat !== HR_SESSION_TTL_SECONDS * 1000
    ) return null;
    return p;
  } catch {
    return null;
  }
}
