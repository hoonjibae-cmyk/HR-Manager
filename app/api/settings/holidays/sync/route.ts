import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { syncHolidays, applyBuiltinHolidays } from "@/lib/holiday-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 연도만으로 못 받으면 달별로 12번 부른다

/**
 * 한국천문연구원 「특일 정보」에서 관공서 공휴일을 받아 표에 반영한다.
 *
 * 넣기만 하고 **지우지 않는다** — 표에는 학원이 직접 넣은 휴무일이 섞여 있을 수 있어
 * 동기화가 조용히 지우면 그날 근무가 휴일근로에서 빠져 수당이 준다.
 * 목록에 없는 날은 응답의 `extra` 로 돌려주고 사람이 보고 지운다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  // 인증키가 없을 때 — 코드에 든 초기 표(2025~2027)로 빠진 날만 채운다
  if (b?.builtin) {
    const out = await applyBuiltinHolidays();
    return NextResponse.json({ ...out, ok: true, builtin: true });
  }
  const years = Array.isArray(b?.years)
    ? b.years.map(Number).filter((y: number) => Number.isFinite(y) && y >= 2000 && y <= 2100)
    : undefined;
  const out = await syncHolidays(years);
  const failed = out.results.filter((r) => r.error);
  return NextResponse.json({ ...out, ok: failed.length === 0 }, { status: failed.length ? 207 : 200 });
}
