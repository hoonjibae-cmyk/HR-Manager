import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { driveDiagnose } from "@/lib/gdrive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 구글 드라이브 연결 진단.
 *
 * **시험 업로드까지 실제로 해 본다** — 개인 드라이브 폴더는 조회까지 성공하고 업로드에서만
 * 막히므로, 조회만 보고 '연결됨' 이라 적으면 정작 첨부할 때 처음 실패한다.
 */
export async function POST() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await driveDiagnose());
  } catch (e: any) {
    return NextResponse.json({ ok: false, steps: [], hint: e.message }, { status: 500 });
  }
}
