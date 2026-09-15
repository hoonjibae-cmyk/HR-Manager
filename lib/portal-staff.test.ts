import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import {
  matchesActivePortalEmployee,
  verifyPortalStaffToken,
} from "./portal-staff";

const secret = "portal-hr-shared-test-secret-at-least-32-chars";
const now = 1_800_000_000_000;
const claims = {
  kind: "hr-staff-api",
  scope: "hr:self-service",
  iss: "https://portal.yussam.com",
  aud: "https://hr.yussam.com",
  empNo: "E021",
  name: "직원",
  email: "staff@yussam.com",
  slackUserId: "U_STAFF",
  department: "교육운영팀",
  nonce: "nonce-1",
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
  scope: "hr:self-service" as const,
  now,
};

describe("portal staff API token", () => {
  it("accepts a fresh signed identity from an allowed department", () => {
    expect(verifyPortalStaffToken(token(), secret, expected)?.empNo).toBe("E021");
  });

  it("separates staff API and certificate scopes", () => {
    expect(
      verifyPortalStaffToken(token(), secret, {
        ...expected,
        scope: "hr:certificate",
      }),
    ).toBeNull();
  });

  it("rejects tampering, unknown departments, another audience and expiry", () => {
    expect(verifyPortalStaffToken(token() + "x", secret, expected)).toBeNull();
    expect(
      verifyPortalStaffToken(token({ ...claims, department: "외부" }), secret, expected),
    ).toBeNull();
    expect(
      verifyPortalStaffToken(token({ ...claims, aud: "https://other.example" }), secret, expected),
    ).toBeNull();
    expect(verifyPortalStaffToken(token({ ...claims, exp: now }), secret, expected)).toBeNull();
  });
});

describe("portal staff employee match", () => {
  const identity = {
    empNo: claims.empNo,
    name: claims.name,
    email: claims.email,
    slackUserId: claims.slackUserId,
    department: claims.department,
  };
  const employee = {
    ...identity,
    email: "personal@example.com",
    workEmail: "STAFF@yussam.com",
    active: true,
    resignDate: null,
  };

  it("allows only the matching active employee", () => {
    expect(matchesActivePortalEmployee(identity, employee)).toBe(true);
  });

  it.each([
    { ...employee, department: "교수부" },
    { ...employee, active: false },
    { ...employee, resignDate: new Date("2025-01-01T00:00:00Z") },
    { ...employee, slackUserId: "U_OTHER" },
    { ...employee, workEmail: "other@yussam.com" },
    { ...employee, empNo: "E999" },
    { ...employee, name: "다른 이름" },
  ])("rejects a mismatched or inactive employee", (changed) => {
    expect(matchesActivePortalEmployee(identity, changed, new Date("2026-09-15T00:00:00Z"))).toBe(
      false,
    );
  });
});
