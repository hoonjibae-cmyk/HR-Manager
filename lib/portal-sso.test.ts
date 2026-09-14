import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyPortalSsoToken } from "./portal-sso";

const secret = "portal-hr-shared-test-secret-at-least-32-chars";
const now = 1_800_000_000_000;
const claims = {
  kind: "hr-sso",
  iss: "https://portal.yussam.com",
  aud: "https://hr.yussam.com",
  empNo: "E001",
  name: "관리자",
  email: "manager@yussam.com",
  slackUserId: "U_MANAGER",
  department: "경영지원",
  iat: now,
  exp: now + 60_000,
} as const;
function token(value: Record<string, unknown> = claims) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
const expected = {
  portalOrigin: "https://portal.yussam.com",
  hrOrigin: "https://hr.yussam.com",
  now,
};

describe("portal HR SSO token", () => {
  it("accepts a fresh signed management identity", () => {
    expect(verifyPortalSsoToken(token(), secret, expected)?.empNo).toBe("E001");
  });
  it("rejects tampering, another department, another audience and expiry", () => {
    expect(verifyPortalSsoToken(token() + "x", secret, expected)).toBeNull();
    expect(verifyPortalSsoToken(token({ ...claims, department: "교수부" }), secret, expected)).toBeNull();
    expect(verifyPortalSsoToken(token({ ...claims, aud: "https://other.example" }), secret, expected)).toBeNull();
    expect(verifyPortalSsoToken(token({ ...claims, exp: now }), secret, expected)).toBeNull();
  });
});
