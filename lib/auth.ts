import { cookies } from "next/headers";
import { prisma } from "./db";
import { matchesHrManagementEmployee, type HrIdentity } from "./hr-access";
import { signHrSession, verifyHrSession } from "./hr-session";

export const SESSION_COOKIE = "yh_session";

function sessionSecret() {
  const secret = process.env.SESSION_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function makeSessionCookie(identity: HrIdentity): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not configured securely");
  return signHrSession(identity, secret);
}

/**
 * 서명된 사람 정보와 현재 HR 원장을 매 요청마다 대조한다.
 * 세션이 남아 있어도 퇴사·부서 변경·Slack 연결 해제 뒤에는 즉시 false가 된다.
 */
export async function currentHrUser(): Promise<HrIdentity | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = verifyHrSession(token, secret);
  if (!claims) return null;
  try {
    const employee = await prisma.employee.findUnique({
      where: { empNo: claims.empNo },
      select: {
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
    if (!employee || !matchesHrManagementEmployee(claims, employee)) return null;
    return {
      empNo: employee.empNo,
      name: employee.name,
      email: (employee.workEmail || employee.email || "").trim().toLowerCase(),
      slackUserId: employee.slackUserId!,
      department: employee.department!,
    };
  } catch (e: any) {
    // 원장을 못 읽은 것(DB 연결 문제)도 화면엔 401 로 보인다 — 로그에는 남겨 '세션 만료' 와 가려낸다
    console.error("[auth] HR 원장 대조 실패:", e?.message ?? e);
    return null;
  }
}

export async function isAuthed(): Promise<boolean> {
  return Boolean(await currentHrUser());
}
