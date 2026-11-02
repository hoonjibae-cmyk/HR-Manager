// 세션 슬라이딩 갱신 — **쓰는 동안에는 로그인이 끊기지 않게** 한다.
//
// HR 세션은 12시간짜리인데 갱신이 없으면 로그인 12시간째에 **열려 있던 화면은 그대로인 채
// 버튼만 전부 'unauthorized' 로 떨어진다**(2026-11 학생 명단 업로드에서 실제로 겪었다 — 월초
// 급여 작업을 아침부터 밤까지 이어 하다 업로드가 막혔다. v1.35.1 에서 같은 증상을 갱신으로
// 고쳤는데, 포털 로그인으로 바꾸면서 갱신이 빠졌다). 그래서 검증된 세션이 발급 후 10분을
// 넘겼으면 새 12시간짜리로 갈아 끼운다 — **12시간 동안 아무 요청이 없을 때만** 끊긴다.
//
// 신원 확인은 여기서 하지 않는다 — 페이지(레이아웃)와 API(각 라우트)가 매 요청마다 `isAuthed()`
// 로 HR 원장과 다시 대조하므로, 갱신된 쿠키를 가진 퇴사자·타 부서도 곧바로 막힌다.
//
// 페이지 요청이 미인증이면 여기서 /login 으로 보낸다. **API 는 자르지 않는다** — 각 라우트가
// 스스로 401 을 내고, Slack·cron·포털 SSO 는 쿠키가 아니라 전용 서명으로 인증한다.
import { NextResponse, type NextRequest } from "next/server";
import {
  verifySessionEdge,
  renewSessionEdge,
  shouldRenewSession,
  SESSION_COOKIE_NAME as SESSION_COOKIE,
} from "@/lib/auth-edge";
import { HR_SESSION_TTL_SECONDS } from "@/lib/hr-session-config";

export async function middleware(req: NextRequest) {
  const session = await verifySessionEdge(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = req.nextUrl.pathname.startsWith("/api");

  if (!session) {
    // Slack·cron·포털 SSO API는 각 라우트의 전용 인증을 사용한다.
    if (isApi) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (shouldRenewSession(session)) {
    const token = await renewSessionEdge(session);
    if (token) {
      const res = NextResponse.next();
      // 로그인(app/api/auth/portal)과 같은 속성 — 하나라도 다르면 쿠키가 두 벌이 된다
      res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: HR_SESSION_TTL_SECONDS,
        priority: "high",
      });
      return res;
    }
  }
  return NextResponse.next();
}

export const config = {
  // 로그인 화면·정적 파일·아이콘·매니페스트·로그인/로그아웃 API 는 뺀다
  // (로그인 페이지를 막으면 무한 리다이렉트, 로그아웃 응답에 갱신 쿠키가 붙으면 로그아웃이 안 된다)
  matcher: [
    "/((?!login|_next/|favicon\\.ico|icon\\.svg|apple-icon\\.png|manifest\\.webmanifest|icon-.*\\.png|api/auth/).*)",
  ],
};
