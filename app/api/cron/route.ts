import { NextResponse } from "next/server";
import { runDueSchedules } from "@/lib/scheduler";
import { runMakeupConfirmReminders } from "@/lib/makeup-service";
import { holidayStatus, holidayApiConfigured, syncHolidays } from "@/lib/holiday-service";
import { runHrNotices } from "@/lib/hr-notify-service";

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
  const dryRun = searchParams.get("dry") === "1";
  const result = await runDueSchedules(new Date(), {
    force: searchParams.get("force") === "1",
    dryRun,
    ignoreClock: loose,
  });

  // 근무가 끝난 보강·주말근무에 '실근무 시간을 확정해 주세요' 알림.
  // 이미 보낸 건은 `confirmNotifiedAt` 로 걸러지므로 매시 호출돼도 하루 한 번만 나간다.
  // **발송 실패가 급여 예약발송을 되돌리지 않는다** — 다음 호출에서 다시 시도된다.
  let makeupReminders: any = null;
  if (!dryRun) {
    makeupReminders = await runMakeupConfirmReminders().catch((e) => ({ error: String(e?.message ?? e) }));
  }
  // 공휴일 표가 얇으면 채운다. **모자랄 때만** 부르므로 매시 호출돼도 API 를 두드리지 않는다 —
  // 한 번 채워지면 경고가 사라져 다음 호출부터는 조회 한 번으로 끝난다.
  // 해가 바뀌거나 하반기에 들어서면 다음 해가 모자란 것으로 잡혀 저절로 다시 받는다.
  let holidaySync: any = null;
  if (!dryRun && holidayApiConfigured()) {
    holidaySync = await (async () => {
      const before = await holidayStatus();
      if (!before.warning) return null;
      const out = await syncHolidays();
      return { added: out.added, renamed: out.renamed, warning: out.coverage.warning };
    })().catch((e) => ({ error: String(e?.message ?? e) }));
  }

  // 경영지원 알림 — 계약 종료 예고 · 생일. 설정한 시각(기본 12:00 KST)을 지나야 나가고,
  // 같은 날 두 번 나가지 않게 `*LastRunAt` 로 막는다. `loose` 와 무관하게 자체 시각을 본다 —
  // 급여 발송과 시각이 다르기 때문이다.
  let hrNotices: any = null;
  if (!dryRun) {
    hrNotices = await runHrNotices(new Date()).catch((e) => ({ error: String(e?.message ?? e) }));
  }

  return NextResponse.json({ ...result, makeupReminders, holidaySync, hrNotices });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
