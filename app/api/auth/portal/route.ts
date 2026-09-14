import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { makeSessionCookie, SESSION_COOKIE } from "@/lib/auth";
import { HR_SESSION_TTL_SECONDS } from "@/lib/hr-session";
import { matchesHrManagementEmployee } from "@/lib/hr-access";
import { verifyPortalSsoToken } from "@/lib/portal-sso";

function portalOrigin() {
  return new URL(process.env.PORTAL_ORIGIN || "https://portal.yussam.com").origin;
}

type DenialReason =
  | "missing_secret"
  | "missing_token"
  | "invalid_token"
  | "employee_not_found"
  | "employee_mismatch";

function denied(req: Request, reason: DenialReason, failedChecks: string[] = []) {
  console.warn("[HR_PORTAL_SSO_DENIED]", { reason, failedChecks });
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
  if (!claims) return denied(req, "invalid_token");

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
  if (!employee) return denied(req, "employee_not_found");
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
    return denied(req, "employee_mismatch", failedChecks);
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
    meta: { slackUserId: identity.slackUserId },
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


