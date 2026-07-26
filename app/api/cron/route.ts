import { NextResponse } from "next/server";
import { runDueSchedules } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 외부 크론(Vercel Cron, cron-job.org, GitHub Actions 등)에서 주기 호출.
 * 인증: Authorization: Bearer <CRON_SECRET> 또는 ?secret=<CRON_SECRET>
 *   (Vercel Cron 은 x-vercel-cron 헤더를 붙여 호출하므로 시크릿 없이도 통과)
 *
 * 쿼리
 *  - strict=1 : 앱에 저장된 시:분(KST)까지 확인 — 분 단위로 호출하는 외부 크론용
 *               미지정 시 날짜·요일만 확인 — 하루 1회 호출하는 Vercel Cron용
 *  - force=1  : 모든 조건 무시하고 즉시 발송
 *  - dry=1    : 조건만 판단하고 실제 발송은 하지 않음 (점검용)
 */
async function handle(req: Request) {
  const { searchParams } = new URL(req.url);
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  const provided = auth.replace(/^Bearer\s+/i, "") || searchParams.get("secret") || "";
  const fromVercelCron = !!req.headers.get("x-vercel-cron");
  if (!fromVercelCron && (!secret || provided !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const strict = searchParams.get("strict") === "1";
  const result = await runDueSchedules(new Date(), {
    force: searchParams.get("force") === "1",
    dryRun: searchParams.get("dry") === "1",
    // strict 가 아니면 시각 검사를 생략한다 (크론 스케줄이 실행 시각을 결정)
    ignoreClock: !strict,
  });
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
