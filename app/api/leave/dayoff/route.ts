import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { listDayOffs, syncDayOffs } from "@/lib/dayoff-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 지금 표에 든 휴무 (기간을 주면 그 안만) */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const from = q.get("from") ?? undefined;
  const to = q.get("to") ?? undefined;
  return NextResponse.json({ items: await listDayOffs(from, to) });
}

/**
 * 구글 연차 캘린더의 `(휴무)홍길동` 일정을 끌어온다.
 *
 * **연차가 아니다** — 연차 원장(`LeaveTransaction`)은 건드리지 않는다.
 * `dry=1` 이면 무엇이 들어오고 빠질지만 돌려주고 쓰지 않는다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  const out = await syncDayOffs(new Date(), { dryRun: !!b?.dry });
  return NextResponse.json(out, { status: out.error ? 400 : 200 });
}
