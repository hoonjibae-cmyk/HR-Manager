import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json(
    { error: "password_login_disabled" },
    { status: 410 },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
