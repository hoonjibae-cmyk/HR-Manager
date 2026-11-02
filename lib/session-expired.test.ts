// 로그인 만료(401) 안내 — 어떤 응답을 잡고, 화면 알림에 무엇이 뜨는가
import { describe, it, expect } from "vitest";
import { SESSION_EXPIRED_MESSAGE, isSessionApi, isSessionExpiry, sessionExpiredBody } from "./session-expired";

const PAGE = "https://hr.yussam.com/payroll";

describe("isSessionExpiry — 같은 출처 /api/ 의 401 만 잡는다", () => {
  it("학생 명단 업로드(상대 주소)의 401 은 세션 만료다", () => {
    expect(isSessionExpiry("/api/payroll/incentive", 401, PAGE)).toBe(true);
    expect(isSessionExpiry("https://hr.yussam.com/api/payroll?year=2026&month=10", 401, PAGE)).toBe(true);
  });

  it("401 이 아니면 아니다 (400·403·500 은 각 화면이 원래대로 알린다)", () => {
    for (const s of [200, 400, 403, 409, 500]) expect(isSessionExpiry("/api/payroll/incentive", s, PAGE)).toBe(false);
  });

  it("로그인·로그아웃 API, 다른 출처, API 가 아닌 주소는 건드리지 않는다", () => {
    expect(isSessionExpiry("/api/auth/portal", 401, PAGE)).toBe(false);
    expect(isSessionExpiry("https://portal.yussam.com/api/x", 401, PAGE)).toBe(false);
    expect(isSessionExpiry("/payroll?_rsc=abc", 401, PAGE)).toBe(false);
    expect(isSessionExpiry("/apix/payroll", 401, PAGE)).toBe(false);
  });

  it("읽을 수 없는 주소는 아니다", () => {
    expect(isSessionExpiry("http://[bad", 401, PAGE)).toBe(false);
    expect(isSessionApi("/api/x", "not a url")).toBe(false);
  });
});

describe("sessionExpiredBody — 화면 알림에 뜨는 문구", () => {
  it("JSON 이면 error 만 갈아 끼우고 code 를 붙인다 — 「업로드 실패: 로그인이 만료…」 로 읽힌다", () => {
    const { body, contentType } = sessionExpiredBody('{"error":"unauthorized"}', "application/json");
    expect(contentType).toBe("application/json");
    const j = JSON.parse(body);
    expect(j.error).toBe(SESSION_EXPIRED_MESSAGE);
    expect(j.code).toBe("SESSION_EXPIRED");
    expect(j.error).not.toContain("unauthorized");
  });

  it("원래 JSON 의 다른 필드는 살린다", () => {
    const j = JSON.parse(sessionExpiredBody('{"error":"unauthorized","hint":1}', "application/json; charset=utf-8").body);
    expect(j.hint).toBe(1);
  });

  it("깨진 JSON 이어도 문구는 나간다", () => {
    expect(JSON.parse(sessionExpiredBody("{oops", "application/json").body).error).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("text 로 오면(명세서 PDF 등) 문구만 보낸다", () => {
    const r = sessionExpiredBody("unauthorized", "text/plain");
    expect(r.body).toBe(SESSION_EXPIRED_MESSAGE);
    expect(r.contentType).toContain("text/plain");
    expect(sessionExpiredBody("unauthorized", null).body).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it("문구가 할 일을 적는다 — 다시 로그인하고 같은 화면에서 다시 시도", () => {
    expect(SESSION_EXPIRED_MESSAGE).toContain("로그인이 만료");
    expect(SESSION_EXPIRED_MESSAGE).toContain("다시 로그인");
    expect(SESSION_EXPIRED_MESSAGE).toContain("다시 시도");
  });
});
