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
