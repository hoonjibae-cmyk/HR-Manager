import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { hmacHex, verifySessionEdge } from "./auth-edge";

const SECRET = "test-secret-at-least-thirty-two-characters";
const NOW = 1_800_000_000_000;
function nodeSign(over: Record<string, unknown> = {}) {
  const body = Buffer.from(JSON.stringify({
    kind: "hr-management",
    empNo: "E001",
    name: "관리자",
    email: "manager@yussam.com",
    slackUserId: "U_MANAGER",
    department: "경영지원",
    iat: NOW,
    exp: NOW + 60_000,
    ...over,
  })).toString("base64url");
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

describe("auth-edge — node crypto와 서명 호환", () => {
  it("HMAC-SHA256/hex가 node createHmac과 같다", async () => {
    const value = "payload";
    expect(await hmacHex(value, SECRET)).toBe(
      createHmac("sha256", SECRET).update(value).digest("hex"),
    );
  });
  it("유효한 경영지원 개인 세션을 확인한다", async () => {
    expect((await verifySessionEdge(nodeSign(), SECRET, NOW))?.empNo).toBe("E001");
  });
  it("공용 관리자 세션, 다른 부서, 만료·변조 토큰을 거부한다", async () => {
    expect(await verifySessionEdge("admin:1725400000000.deadbeef", SECRET, NOW)).toBeNull();
    expect(await verifySessionEdge(nodeSign({ department: "교수부" }), SECRET, NOW)).toBeNull();
    expect(await verifySessionEdge(nodeSign({ exp: NOW }), SECRET, NOW)).toBeNull();
    expect(await verifySessionEdge(nodeSign() + "x", SECRET, NOW)).toBeNull();
    expect(await verifySessionEdge(undefined, SECRET, NOW)).toBeNull();
  });
});
