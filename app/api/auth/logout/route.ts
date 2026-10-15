import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, currentHrUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { clientAgent } from "@/lib/login-log";

export async function POST(req: Request) {
  // 누가 나갔는지도 남긴다 — 설정 → 최근 로그인이 로그인·거부와 함께 보여 준다.
  // 세션이 이미 끝난 뒤의 로그아웃(쿠키만 남은 상태)은 신원이 없어 남기지 않는다.
  const user = await currentHrUser().catch(() => null);
  if (user) {
    const emp = await prisma.employee
      .findUnique({ where: { empNo: user.empNo }, select: { id: true } })
      .catch(() => null);
    await logActivity({
      action: "LOGOUT",
      actor: "PORTAL",
      actorName: user.name,
      employeeId: emp?.id ?? null,
      summary: `로그아웃 — ${user.name}`,
      meta: { empNo: user.empNo, slackUserId: user.slackUserId, ...clientAgent(req.headers) },
    });
  }
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
