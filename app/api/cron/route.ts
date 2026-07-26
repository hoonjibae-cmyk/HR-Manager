import { NextResponse } from "next/server";
import { runDueSchedules } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
// Vercel Pro: 함수 최대 실행시간 300초 (인원이 많아도 한 번에 발송 가능)
export const maxDuration = 300;

/**
 * 외부 크론(Vercel Cron, cron-job.org, GitHub Actions 등)에서 주기 호출.
 * 인증: Authorization: Bearer <CRON_SECRET> 또는 ?secret=<CRON_SECRET>
 *   (Vercel Cron 은 x-vercel-cron 헤더를 붙여 호출하므로 시크릿 없이도 통과)
 *
 * 기본 동작(strict): 앱 `설정`에 저장된 시:분(KST)까지 확인해 그 시각에 발송한다.
 * vercel.json 의 크론이 매시 정각에 호출하므로, 설정 시각을 정시(예: 09:00)로
 * 두면 지연 없이 그 시각에 나간다.
 *
 * 쿼리
 *  - loose=1  : 시각 검사를 생략하고 날짜·요일만 확인
 *               (크론을 하루 1회만 호출하는 환경에서 사용)
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

  // 기본은 시:분까지 확인(strict). loose=1 이면 날짜·요일만 확인.
  const loose = searchParams.get("loose") === "1" || searchParams.get("strict") === "0";
  const result = await runDueSchedules(new Date(), {
    force: searchParams.get("force") === "1",
    dryRun: searchParams.get("dry") === "1",
    ignoreClock: loose,
  });
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
