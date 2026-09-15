import { createHmac, timingSafeEqual } from "crypto";
import type { HrEmployeeRecord, HrIdentity } from "./hr-access";

export const PORTAL_STAFF_DEPARTMENTS = [
  "경영지원",
  "교육운영팀",
  "교수부",
  "조교팀",
] as const;

export type PortalStaffScope =
  | "hr:self-service"
  | "hr:certificate"
  | "hr:monthly-operations";

export interface PortalStaffClaims extends HrIdentity {
  kind: "hr-staff-api";
  scope: PortalStaffScope;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  nonce: string;
}

function normalizedEmail(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function normalizedSlackUserId(value: string | null | undefined) {
  return String(value || "").trim();
}

function dateAtKstMidnight(now: Date) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()),
  );
}

/**
 * 포털 직원 셀프서비스용 짧은 서명을 검증한다.
 * HR 관리자 로그인 토큰과 kind·scope를 분리해 이 토큰으로 관리자 세션을 만들 수 없게 한다.
 */
export function verifyPortalStaffToken(
  token: string,
  secret: string,
  expected: {
    portalOrigin: string;
    hrOrigin: string;
    scope: PortalStaffScope;
    now?: number;
  },
): PortalStaffClaims | null {
  if (!token || token.length > 8192 || secret.length < 32) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const wanted = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(wanted);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as PortalStaffClaims;
    const now = expected.now ?? Date.now();
    if (
      p.kind !== "hr-staff-api" ||
      p.scope !== expected.scope ||
      p.iss !== expected.portalOrigin ||
      p.aud !== expected.hrOrigin ||
      !PORTAL_STAFF_DEPARTMENTS.includes(p.department as (typeof PORTAL_STAFF_DEPARTMENTS)[number]) ||
      !p.empNo ||
      !p.name ||
      !p.email ||
      !p.slackUserId ||
      !p.nonce ||
      p.nonce.length > 100 ||
      typeof p.iat !== "number" ||
      typeof p.exp !== "number" ||
      p.iat > now + 30_000 ||
      p.iat < now - 120_000 ||
      p.exp <= now ||
      p.exp - p.iat > 60_000
    )
      return null;
    return p;
  } catch {
    return null;
  }
}

/** 포털 신원을 HR 직원 원장의 같은 재직자와 다시 대조한다. */
export function matchesActivePortalEmployee(
  identity: HrIdentity,
  employee: HrEmployeeRecord | null,
  now = new Date(),
) {
  if (!employee) return false;
  const employeeEmail = normalizedEmail(employee.workEmail || employee.email);
  const activeThrough = dateAtKstMidnight(now);
  return (
    PORTAL_STAFF_DEPARTMENTS.includes(
      identity.department as (typeof PORTAL_STAFF_DEPARTMENTS)[number],
    ) &&
    employee.department === identity.department &&
    employee.active === true &&
    (employee.resignDate === null || employee.resignDate >= activeThrough) &&
    employee.empNo === identity.empNo &&
    employee.name === identity.name &&
    Boolean(normalizedSlackUserId(employee.slackUserId)) &&
    normalizedSlackUserId(employee.slackUserId) ===
      normalizedSlackUserId(identity.slackUserId) &&
    Boolean(employeeEmail) &&
    employeeEmail === normalizedEmail(identity.email)
  );
}
