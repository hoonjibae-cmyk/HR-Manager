import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { checkPassword, makeSessionCookie, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!checkPassword(password || "")) {
    await logActivity({ action: "LOGIN_FAILED", summary: "관리자 로그인 실패" });
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  await logActivity({ action: "LOGIN", summary: "관리자 로그인" });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, makeSessionCookie(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
