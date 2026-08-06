import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import {
  listHolidays,
  holidayStatus,
  holidayApiConfigured,
  upsertHoliday,
  deleteHoliday,
} from "@/lib/holiday-service";

export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 표 보기 — `?year=2026` 이면 그해만. 함께 채움 상태(경고)도 돌려준다 */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const y = new URL(req.url).searchParams.get("year");
  const year = y ? Number(y) : undefined;
  const [items, coverage] = await Promise.all([
    listHolidays(Number.isFinite(year) ? year : undefined),
    holidayStatus(),
  ]);
  return NextResponse.json({ items, coverage, apiConfigured: holidayApiConfigured() });
}

/** 직접 넣기 — 학원 자체 휴무일이나 API 가 아직 안 실은 임시공휴일 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  const date = String(b?.date ?? "").trim();
  const name = String(b?.name ?? "").trim();
  if (!YMD.test(date)) return NextResponse.json({ error: "날짜를 YYYY-MM-DD 로 넣어 주세요." }, { status: 400 });
  if (!name) return NextResponse.json({ error: "휴일 이름을 넣어 주세요." }, { status: 400 });
  return NextResponse.json(await upsertHoliday(date, name));
}

export async function DELETE(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const date = String(new URL(req.url).searchParams.get("date") ?? "").trim();
  if (!YMD.test(date)) return NextResponse.json({ error: "날짜가 올바르지 않습니다." }, { status: 400 });
  await deleteHoliday(date).catch(() => {});
  return NextResponse.json({ ok: true });
}
