import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { runCalendarAlerts } from "@/lib/calendar-alert-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET || "";
  const provided = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  // The x-vercel-cron header is not authentication; it can be forged.
  if (!expected || expected.length !== provided.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(provided)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await runCalendarAlerts();
  return NextResponse.json({ results }, { status: results.some((r) => !!r.error) ? 503 : 200 });
}
