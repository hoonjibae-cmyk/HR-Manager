// 세션 슬라이딩 갱신 — **쓰는 동안에는 로그인이 만료되지 않게** 한다.
//
// 로그인 쿠키는 7일짜리인데 갱신 없이 고정이라, 로그인 7일째가 되면 **열려 있던 화면은
// 그대로인 채 버튼만 전부 'unauthorized' 로 떨어졌다**(신규입사 패키지 발급에서 실제로 겪었다 —
// 페이지는 이미 렌더돼 있으니 멀쩡해 보이고, API 호출만 401 이 나 영문을 알 수 없다).
// 그래서 유효한 세션으로 하루 이상 지난 요청이 오면 쿠키를 새 7일짜리로 갈아 끼운다 —
// 매주 들어와 쓰는 한 로그인이 끊기지 않고, 7일을 통째로 안 쓴 경우에만 다시 로그인한다.
//
// 페이지 요청이 미인증이면 여기서 /login 으로 보낸다(레이아웃 가드와 이중이지만 더 빠르다).
// **API 는 건드리지 않는다** — 각 라우트가 isAuthed() 로 스스로 401 을 내고, 슬랙·크론은
// 쿠키가 아니라 자체 서명으로 인증하므로 여기서 자르면 안 된다.
import { NextResponse, type NextRequest } from "next/server";
import { verifySessionEdge, makeSessionEdge, SESSION_COOKIE_NAME as SESSION_COOKIE } from "@/lib/auth-edge";

/** 이보다 오래된 세션으로 들어오면 새 쿠키로 갈아 끼운다 (매 요청마다 갈면 Set-Cookie 만 늘어난다) */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_S = 60 * 60 * 24 * 7;

export async function middleware(req: NextRequest) {
  const ts = await verifySessionEdge(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = req.nextUrl.pathname.startsWith("/api");

  if (ts == null) {
    // API 는 통과 — 라우트가 스스로 401 을 낸다 (슬랙/크론의 자체 인증도 그대로 살아야 한다)
    if (isApi) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (Date.now() - ts > RENEW_AFTER_MS) {
    const res = NextResponse.next();
    res.cookies.set(SESSION_COOKIE, await makeSessionEdge(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_S,
    });
    return res;
  }
  return NextResponse.next();
}

export const config = {
  // 로그인 화면·정적 파일·아이콘·매니페스트는 뺀다 (로그인 페이지를 막으면 무한 리다이렉트)
  matcher: [
    "/((?!login|_next/|favicon\\.ico|icon\\.svg|apple-icon\\.png|manifest\\.webmanifest|icon-.*\\.png|api/auth/).*)",
  ],
};
