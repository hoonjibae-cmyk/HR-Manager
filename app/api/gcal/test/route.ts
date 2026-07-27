import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { gcalDiagnose } from "@/lib/gcal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 구글 캘린더 연결 진단 — 토큰·캘린더 접근·쓰기 권한을 실제로 확인 */
export async function POST() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await gcalDiagnose());
  } catch (e: any) {
    return NextResponse.json({ ok: false, steps: [], hint: e.message }, { status: 500 });
  }
}
