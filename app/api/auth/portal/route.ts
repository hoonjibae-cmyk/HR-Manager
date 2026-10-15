import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { makeSessionCookie, SESSION_COOKIE } from "@/lib/auth";
import { HR_SESSION_TTL_SECONDS } from "@/lib/hr-session";
import { matchesHrManagementEmployee } from "@/lib/hr-access";
import { verifyPortalSsoToken, peekPortalSsoClaims } from "@/lib/portal-sso";
import { clientAgent, loginDeniedSummary, type LoginDenialReason } from "@/lib/login-log";

function portalOrigin() {
  return new URL(process.env.PORTAL_ORIGIN || "https://portal.yussam.com").origin;
}

/** 거부 기록에 붙일 신원 — `verified` 가 false 면 토큰에 적혀 있었을 뿐 서명이 확인되지 않은 값 */
interface DeniedWho {
  name: string | null;
  empNo: string | null;
  employeeId?: number | null;
  verified: boolean;
  expired?: boolean;
}

/**
 * 거부 — 로그인 화면으로 돌려보내고, **누구의 시도였는지 알 수 있을 때만** 기록을 남긴다
 * (설정 → 최근 로그인에 뜬다). 퇴사자·타 부서가 HR 카드를 누른 것, 1분 지난 토큰이 그렇다.
 * 토큰이 아예 없거나 모양부터 다른 POST 는 콘솔에만 남긴다 — 이 주소는 공개돼 있어
 * 스캐너가 던지는 요청까지 DB 에 쌓으면 표가 쓰레기로 찬다.
 */
async function denied(
  req: Request,
  reason: LoginDenialReason,
  failedChecks: string[] = [],
  who?: DeniedWho
) {
  console.warn("[HR_PORTAL_SSO_DENIED]", { reason, failedChecks });
  if (who) {
    await logActivity({
      action: "LOGIN_FAILED",
      actor: "PORTAL",
      actorName: who.name,
      employeeId: who.employeeId ?? null,
      summary: loginDeniedSummary(reason, failedChecks, { expired: who.expired }),
      meta: {
        reason,
        failedChecks,
        verified: who.verified,
        expired: who.expired ?? false,
        claimedEmpNo: who.empNo,
        ...clientAgent(req.headers),
      },
    });
  }
  const response = NextResponse.redirect(new URL("/login?error=access_denied", req.url), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(req: Request) {
  const secret = process.env.HR_SSO_SECRET?.trim();
  if (!secret || secret.length < 32) return denied(req, "missing_secret");
  const origin = req.headers.get("origin");
  // 모바일 PWA와 일부 인앱 브라우저는 교차 출처 폼 전송 시 Origin을
  // 배포 별칭이나 null로 보낼 수 있다. Origin은 진단에만 쓰고, 접근 권한은
  // 1분짜리 HMAC 토큰과 아래 HR 원장 대조로 결정한다.
  if (origin && origin !== portalOrigin()) {
    console.warn("[HR_PORTAL_SSO_ORIGIN_VARIATION]", {
      expectedHost: new URL(portalOrigin()).host,
      receivedHost: (() => {
        try {
          return new URL(origin).host;
        } catch {
          return "opaque";
        }
      })(),
    });
  }

  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token !== "string") return denied(req, "missing_token");
  const claims = verifyPortalSsoToken(token, secret, {
    portalOrigin: portalOrigin(),
    hrOrigin: new URL(req.url).origin,
  });
  if (!claims) {
    // 서명은 안 맞지만 본문이 읽히면 '누구 이름으로 온 시도였나' 는 남긴다(미검증 표시).
    // 대부분은 HR 카드를 눌러 두고 1분이 지난 뒤 들어간 경우라, 기록이 있어야 "왜 안 되냐" 에 답한다.
    const peek = peekPortalSsoClaims(token);
    return denied(
      req,
      "invalid_token",
      [],
      peek
        ? {
            name: typeof peek.name === "string" ? peek.name : null,
            empNo: peek.empNo ?? null,
            verified: false,
            expired: typeof peek.exp === "number" && peek.exp <= Date.now(),
          }
        : undefined
    );
  }

  const employee = await prisma.employee.findUnique({
    where: { empNo: claims.empNo },
    select: {
      id: true,
      empNo: true,
      name: true,
      email: true,
      workEmail: true,
      slackUserId: true,
      department: true,
      active: true,
      resignDate: true,
    },
  });
  if (!employee)
    return denied(req, "employee_not_found", [], {
      name: claims.name,
      empNo: claims.empNo,
      verified: true,
    });
  if (!matchesHrManagementEmployee(claims, employee)) {
    const employeeEmail = (employee.workEmail || employee.email || "").trim().toLowerCase();
    const failedChecks = [
      claims.department === "경영지원" ? null : "claim_department",
      employee.department === "경영지원" ? null : "employee_department",
      employee.active === true ? null : "active",
      employee.resignDate === null ? null : "resign_date",
      employee.empNo === claims.empNo ? null : "employee_number",
      employee.slackUserId?.trim() === claims.slackUserId.trim() ? null : "slack_user",
      employeeEmail && employeeEmail === claims.email.trim().toLowerCase() ? null : "email",
    ].filter((check): check is string => Boolean(check));
    return denied(req, "employee_mismatch", failedChecks, {
      name: employee.name,
      empNo: employee.empNo,
      employeeId: employee.id,
      verified: true,
    });
  }

  const identity = {
    empNo: employee.empNo,
    name: employee.name,
    email: (employee.workEmail || employee.email || "").trim().toLowerCase(),
    slackUserId: employee.slackUserId!,
    department: employee.department!,
  };
  await logActivity({
    action: "LOGIN",
    summary: "포털을 통한 경영지원 로그인",
    actor: "PORTAL",
    actorName: identity.name,
    employeeId: employee.id,
    meta: { slackUserId: identity.slackUserId, ...clientAgent(req.headers) },
  });
  const response = NextResponse.redirect(new URL("/dashboard", req.url), 303);
  response.cookies.set(SESSION_COOKIE, makeSessionCookie(identity), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: HR_SESSION_TTL_SECONDS,
    priority: "high",
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
