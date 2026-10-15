import { describe, it, expect } from "vitest";
import {
  summarizeUserAgent,
  clientAgent,
  loginDeniedSummary,
  denialText,
  toLoginRow,
  summarizeLogins,
  kstLabel,
  isLoginAction,
  type LoginAuditInput,
} from "./login-log";

const UA = {
  chromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  edgeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  kakaoAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 KAKAOTALK/10.4.5",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1",
};

describe("접속 기기 요약", () => {
  it("브라우저 · 운영체제 로 읽힌다", () => {
    expect(summarizeUserAgent(UA.chromeWin)).toBe("Chrome · Windows");
    expect(summarizeUserAgent(UA.safariIphone)).toBe("Safari · iPhone");
    expect(summarizeUserAgent(UA.chromeIphone)).toBe("Chrome · iPhone");
  });

  it("Chrome/ · Safari/ 가 함께 적힌 UA 에서 특수한 쪽(Edge·삼성·인앱)을 먼저 집는다", () => {
    expect(summarizeUserAgent(UA.edgeMac)).toBe("Edge · macOS");
    expect(summarizeUserAgent(UA.samsungAndroid)).toBe("Samsung Internet · Android");
    expect(summarizeUserAgent(UA.kakaoAndroid)).toBe("카카오톡 인앱 · Android");
  });

  it("비면 null, 못 알아보면 '기타' — 빈칸과 모름을 가른다", () => {
    expect(summarizeUserAgent("")).toBeNull();
    expect(summarizeUserAgent(null)).toBeNull();
    expect(summarizeUserAgent("curl/8.4.0")).toBe("기타");
  });

  it("clientAgent 는 원문을 300자에서 자른다", () => {
    const long = "x".repeat(1000);
    const out = clientAgent({ get: (n) => (n === "user-agent" ? long : null) });
    expect(out.ua).toHaveLength(300);
    expect(out.device).toBe("기타");
    expect(clientAgent({ get: () => null })).toEqual({ ua: null, device: null });
  });
});

describe("거부 사유 문구", () => {
  it("원장 대조 실패는 어느 항목이 어긋났는지 함께 적는다", () => {
    expect(loginDeniedSummary("employee_mismatch", ["active", "resign_date"])).toBe(
      "포털 로그인 거부 — 직원 원장과 대조 실패 (재직 상태 아님, 퇴사일이 입력됨)"
    );
  });

  it("만료된 토큰은 '다시 누르라' 는 안내가 된다 — 거부의 대부분이 이 경우다", () => {
    expect(denialText("invalid_token", [], { expired: true })).toContain("유효기간(1분)");
    expect(denialText("invalid_token")).toBe("포털 서명이 맞지 않음");
  });

  it("모르는 점검 항목은 코드 그대로 남긴다(조용히 빠뜨리지 않는다)", () => {
    expect(denialText("employee_mismatch", ["new_check"])).toContain("new_check");
  });
});

describe("표시 행", () => {
  const audit = (o: Partial<LoginAuditInput> = {}): LoginAuditInput => ({
    id: 1,
    action: "LOGIN",
    actorName: "유은정",
    employeeId: 3,
    summary: "포털을 통한 경영지원 로그인",
    detail: JSON.stringify({ slackUserId: "U1", ua: UA.chromeWin, device: "Chrome · Windows" }),
    ip: "1.2.3.4",
    createdAt: new Date("2026-10-15T05:02:11Z"),
    ...o,
  });
  const emp = { id: 3, name: "유은정", empNo: "E001", department: "경영지원" };

  it("원장 직원이 있으면 그쪽 이름·사번·부서를 쓴다", () => {
    const r = toLoginRow(audit(), emp)!;
    expect(r).toMatchObject({
      action: "LOGIN",
      name: "유은정",
      empNo: "E001",
      department: "경영지원",
      verified: true,
      ip: "1.2.3.4",
      device: "Chrome · Windows",
      slackUserId: "U1",
    });
  });

  it("옛 LOGIN 기록(기기 없음)도 깨지지 않는다 — 기기만 비고 검증된 것으로 본다", () => {
    const r = toLoginRow(audit({ detail: JSON.stringify({ slackUserId: "U1" }), employeeId: null }), null)!;
    expect(r.name).toBe("유은정");
    expect(r.device).toBeNull();
    expect(r.verified).toBe(true);
  });

  it("거부 기록은 검증 여부를 detail 에서 읽는다 — 서명이 안 맞는 토큰은 미검증", () => {
    const r = toLoginRow(
      audit({
        action: "LOGIN_FAILED",
        actorName: "홍길동",
        employeeId: null,
        detail: JSON.stringify({
          reason: "invalid_token",
          verified: false,
          expired: true,
          claimedEmpNo: "E999",
          failedChecks: [],
          device: "Safari · iPhone",
        }),
      }),
      null
    )!;
    expect(r).toMatchObject({
      action: "LOGIN_FAILED",
      name: "홍길동",
      empNo: "E999",
      verified: false,
      reason: "invalid_token",
      expired: true,
      device: "Safari · iPhone",
    });
  });

  it("로그인 종류가 아니면 null", () => {
    expect(toLoginRow(audit({ action: "PAYROLL_RUN" }), emp)).toBeNull();
    expect(isLoginAction("LOGOUT")).toBe(true);
    expect(isLoginAction("PAYROLL_RUN")).toBe(false);
  });

  it("detail 이 깨진 JSON 이어도 행은 나온다", () => {
    const r = toLoginRow(audit({ detail: "{not json" }), emp)!;
    expect(r.name).toBe("유은정");
    expect(r.device).toBeNull();
  });
});

describe("머리줄 요약", () => {
  it("계정 수는 성공한 로그인의 서로 다른 사람 수다", () => {
    const s = summarizeLogins([
      { action: "LOGIN", actorName: "A", employeeId: 3 },
      { action: "LOGIN", actorName: "A", employeeId: 3 },
      { action: "LOGIN", actorName: "B", employeeId: 4 },
      { action: "LOGIN_FAILED", actorName: "C", employeeId: null },
      { action: "LOGOUT", actorName: "A", employeeId: 3 },
    ]);
    expect(s).toEqual({ logins: 3, accounts: 2, denied: 1, logouts: 1 });
  });

  it("직원 카드가 없는 기록은 이름으로 가른다", () => {
    const s = summarizeLogins([
      { action: "LOGIN", actorName: "A", employeeId: null },
      { action: "LOGIN", actorName: "A", employeeId: null },
      { action: "LOGIN", actorName: "B", employeeId: null },
    ]);
    expect(s.accounts).toBe(2);
  });
});

describe("KST 표기", () => {
  it("UTC 05:02 → 14:02, 요일도 KST 기준", () => {
    expect(kstLabel(new Date("2026-10-15T05:02:11Z"))).toBe("2026-10-15 (목) 14:02");
    // UTC 로는 아직 14일 저녁이지만 KST 로는 15일 새벽
    expect(kstLabel(new Date("2026-10-14T16:30:00Z"))).toBe("2026-10-15 (목) 01:30");
  });
});
