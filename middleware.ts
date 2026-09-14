import { NextResponse, type NextRequest } from "next/server";
import { verifySessionEdge, SESSION_COOKIE_NAME as SESSION_COOKIE } from "@/lib/auth-edge";

export async function middleware(req: NextRequest) {
  const session = await verifySessionEdge(req.cookies.get(SESSION_COOKIE)?.value);
  const isApi = req.nextUrl.pathname.startsWith("/api");

  if (!session) {
    // Slack·cron·포털 SSO API는 각 라우트의 전용 인증을 사용한다.
    if (isApi) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|_next/|favicon\\.ico|icon\\.svg|apple-icon\\.png|manifest\\.webmanifest|icon-.*\\.png|api/auth/).*)",
  ],
};
