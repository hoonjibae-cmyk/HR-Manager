import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { slackConfigured, postMessage, slackCall, leaveLauncherBlocks } from "@/lib/slack";

export const dynamic = "force-dynamic";

/**
 * 휴가 신청 채널에 '휴가신청서 작성' 버튼 메시지를 게시(+상단 고정).
 * body: { channel?: string }  — 미지정 시 SLACK_APPROVAL_CHANNEL 사용
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!slackConfigured())
    return NextResponse.json(
      { error: "슬랙이 설정되지 않았습니다 (SLACK_BOT_TOKEN · SLACK_SIGNING_SECRET)" },
      { status: 400 }
    );

  const body = await req.json().catch(() => ({}));
  const channel = (body.channel || process.env.SLACK_APPROVAL_CHANNEL || "").trim();
  if (!channel)
    return NextResponse.json(
      { error: "채널을 지정하거나 SLACK_APPROVAL_CHANNEL 을 설정하세요." },
      { status: 400 }
    );

  const company = await prisma.company.findFirst({ where: { id: 1 } });
  const posted: any = await postMessage(
    channel,
    "휴가 신청",
    leaveLauncherBlocks(company?.name ?? "유쌤에듀")
  );
  if (!posted?.ok) {
    return NextResponse.json(
      {
        error:
          posted?.error === "not_in_channel"
            ? "봇이 채널에 없습니다. 슬랙 채널에서 /invite 로 앱을 초대한 뒤 다시 시도하세요."
            : `슬랙 게시 실패: ${posted?.error ?? "unknown"}`,
      },
      { status: 400 }
    );
  }

  // 채널 상단 고정 (권한 없으면 무시)
  const pinned: any = await slackCall("pins.add", { channel: posted.channel, timestamp: posted.ts });

  return NextResponse.json({
    ok: true,
    channel: posted.channel,
    ts: posted.ts,
    pinned: !!pinned?.ok,
    pinError: pinned?.ok ? null : pinned?.error ?? null,
  });
}
