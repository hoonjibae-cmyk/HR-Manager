import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { hmacHex, verifySessionEdge, renewSessionEdge, shouldRenewSession } from "./auth-edge";
import { verifyHrSession, HR_SESSION_TTL_SECONDS } from "./hr-session";
import { HR_SESSION_RENEW_AFTER_MS } from "./hr-session-config";

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

describe("세션 슬라이딩 갱신 — 쓰는 동안 로그인이 끊기지 않게 (middleware.ts)", () => {
  // 로그인 12시간째에 열린 화면의 버튼이 전부 'unauthorized' 로 떨어졌다(2026-11 학생 명단 업로드).
  // 미들웨어가 갱신해 준 쿠키를 **node 쪽 검증(isAuthed)이 받아야** 한다 — 아니면 갱신 순간 전원이 끊긴다.
  const HOUR = 3_600_000;
  const issued = NOW - 11 * HOUR; // 로그인한 지 11시간 — 1시간 뒤면 끊길 세션
  const old = () => verifySessionEdge(nodeSign({ iat: issued, exp: issued + HR_SESSION_TTL_SECONDS * 1000 }), SECRET, NOW);

  it("갱신한 토큰을 node 의 verifyHrSession 이 받는다 — 같은 사람, 지금부터 12시간", async () => {
    const claims = (await old())!;
    const token = (await renewSessionEdge(claims, SECRET, NOW))!;
    const p = verifyHrSession(token, SECRET, NOW)!;
    expect(p).not.toBeNull();
    expect(p.empNo).toBe("E001");
    expect(p.name).toBe("관리자"); // 한글 이름이 UTF-8 로 그대로 오간다
    expect(p.email).toBe("manager@yussam.com");
    expect(p.slackUserId).toBe("U_MANAGER");
    expect(p.department).toBe("경영지원");
    expect(p.iat).toBe(NOW);
    expect(p.exp - p.iat).toBe(HR_SESSION_TTL_SECONDS * 1000);
  });

  it("원래 만료 시각(1시간 뒤)이 지나도 갱신한 토큰은 살아 있고, 새 12시간이 지나면 끊긴다", async () => {
    const token = (await renewSessionEdge((await old())!, SECRET, NOW))!;
    expect(verifyHrSession(token, SECRET, NOW + 2 * HOUR)).not.toBeNull();
    expect(await verifySessionEdge(token, SECRET, NOW + 2 * HOUR)).not.toBeNull();
    expect(verifyHrSession(token, SECRET, NOW + HR_SESSION_TTL_SECONDS * 1000)).toBeNull();
  });

  it("node 와 같은 base64url — 패딩·+·/ 가 없다", async () => {
    const token = (await renewSessionEdge((await old())!, SECRET, NOW))!;
    const body = token.split(".")[0];
    expect(body).not.toMatch(/[+/=]/);
  });

  it("신원 다섯 가지만 옮긴다 — 끼워 넣은 다른 필드는 버린다", async () => {
    const claims = { ...(await old())!, role: "superadmin" };
    const token = (await renewSessionEdge(claims, SECRET, NOW))!;
    const body = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
    expect(body.role).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(
      ["department", "email", "empNo", "exp", "iat", "kind", "name", "slackUserId"].sort()
    );
  });

  it("발급 후 10분이 지난 세션만 갱신한다 (매 요청마다 Set-Cookie 를 늘리지 않는다)", () => {
    expect(shouldRenewSession({ iat: NOW - HR_SESSION_RENEW_AFTER_MS + 1000 }, NOW)).toBe(false);
    expect(shouldRenewSession({ iat: NOW - HR_SESSION_RENEW_AFTER_MS - 1000 }, NOW)).toBe(true);
    expect(shouldRenewSession({}, NOW)).toBe(false);
  });

  it("비밀값이 약하거나 신원이 비면 갱신하지 않는다", async () => {
    const claims = (await old())!;
    expect(await renewSessionEdge(claims, "short", NOW)).toBeNull();
    expect(await renewSessionEdge({ ...claims, email: "" }, SECRET, NOW)).toBeNull();
  });
});
