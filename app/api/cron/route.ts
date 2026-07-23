import { NextResponse } from "next/server";
import { runDueSchedules } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 외부 크론(예: GitHub Actions, Vercel Cron, cron-job.org)에서 주기 호출.
 * 인증: Authorization: Bearer <CRON_SECRET> 또는 ?secret=<CRON_SECRET>
 */
async function handle(req: Request) {
  const { searchParams } = new URL(req.url);
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  const provided = auth.replace(/^Bearer\s+/i, "") || searchParams.get("secret") || "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = searchParams.get("force") === "1";
  const result = await runDueSchedules(new Date(), force);
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
