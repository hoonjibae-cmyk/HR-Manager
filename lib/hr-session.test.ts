import { describe, expect, it } from "vitest";
import { HR_SESSION_TTL_SECONDS, signHrSession, verifyHrSession } from "./hr-session";

const secret = "hr-session-test-secret-at-least-32-characters";
const now = 1_800_000_000_000;
const identity = {
  empNo: "E001",
  name: "관리자",
  email: "manager@yussam.com",
  slackUserId: "U_MANAGER",
  department: "경영지원",
};

describe("HR session", () => {
  it("contains the verified person and expires after 12 hours", () => {
    const token = signHrSession(identity, secret, now);
    const result = verifyHrSession(token, secret, now);
    expect(result?.empNo).toBe("E001");
    expect(result!.exp - result!.iat).toBe(HR_SESSION_TTL_SECONDS * 1000);
  });
  it("rejects tampering, expiry, weak secrets and non-management identities", () => {
    const token = signHrSession(identity, secret, now);
    expect(verifyHrSession(token + "x", secret, now)).toBeNull();
    expect(verifyHrSession(token, secret, now + HR_SESSION_TTL_SECONDS * 1000)).toBeNull();
    expect(verifyHrSession(token, "short", now)).toBeNull();
    const other = signHrSession({ ...identity, department: "교수부" }, secret, now);
    expect(verifyHrSession(other, secret, now)).toBeNull();
  });
});
