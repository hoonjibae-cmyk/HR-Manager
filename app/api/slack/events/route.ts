import { verifySlackSignature, slackConfigured } from "@/lib/slack";
import { refreshHomeTab } from "@/lib/home-tab";

export const dynamic = "force-dynamic";

/**
 * 슬랙 Events API 수신.
 * - url_verification: 앱 설정에서 요청 URL 확인용 challenge 응답
 * - app_home_opened: 앱 홈 탭을 열 때마다 최신 연차 현황으로 다시 그린다
 */
export async function POST(req: Request) {
  if (!slackConfigured()) return new Response("", { status: 200 });

  const raw = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!verifySlackSignature(raw, ts, sig)) {
    return new Response("invalid signature", { status: 401 });
  }

  const body = JSON.parse(raw || "{}");

  if (body.type === "url_verification") {
    return Response.json({ challenge: body.challenge });
  }

  const event = body.event;
  if (event?.type === "app_home_opened" && event.tab === "home" && event.user) {
    // 슬랙은 3초 내 200 을 기대한다 — 실패해도 재시도 폭주를 막기 위해 삼킨다
    await refreshHomeTab(event.user).catch((e) =>
      console.error("[slack] 홈 탭 갱신 실패:", e)
    );
  }

  return new Response("", { status: 200 });
}
