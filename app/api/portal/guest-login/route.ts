import { NextResponse } from "next/server";
import { authenticatedPortalStaff } from "@/lib/portal-staff-request";
import { slackCall } from "@/lib/slack";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Send a portal sign-in code only to the HR-verified assistant's Slack ID. */
export async function POST(req: Request) {
  const auth = await authenticatedPortalStaff(req, "hr:guest-login");
  if (!auth || auth.employee.department !== "조교팀")
    return noStore({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noStore({ error: "invalid_request" }, 400);
  }
  const code =
    body && typeof body === "object" && "code" in body
      ? (body as { code?: unknown }).code
      : null;
  if (typeof code !== "string" || !/^\d{8}$/.test(code))
    return noStore({ error: "invalid_request" }, 400);
  if (!process.env.SLACK_BOT_TOKEN)
    return noStore({ error: "slack_unavailable" }, 503);

  try {
    const result = (await slackCall("chat.postMessage", {
      channel: auth.employee.slackUserId,
      text: `유쌤 워크스페이스 로그인 인증번호: ${code}\n5분 안에 포털에 입력하세요. 요청하지 않았다면 이 메시지를 무시하세요.`,
    })) as { ok?: boolean };
    if (!result.ok) return noStore({ error: "delivery_failed" }, 502);
    return noStore({ delivered: true });
  } catch {
    return noStore({ error: "delivery_failed" }, 502);
  }
}
