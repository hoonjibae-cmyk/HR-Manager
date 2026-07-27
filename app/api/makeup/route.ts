import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { createMakeupSession, makeupMonth } from "@/lib/makeup-service";
import { makeupDateLabel } from "@/lib/makeup-slack";
import { MAKEUP_CATEGORY_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** 한 달 보강 신청 + 산정 결과 */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const now = new Date();
  const year = Number(u.searchParams.get("year")) || now.getFullYear();
  const month = Number(u.searchParams.get("month")) || now.getMonth() + 1;
  return NextResponse.json(await makeupMonth(year, month));
}

/** 관리자가 화면에서 직접 등록 (슬랙을 못 쓰는 경우의 보조 경로) */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const employeeId = Number(b.employeeId);
  if (!employeeId) return NextResponse.json({ error: "직원을 선택해 주세요." }, { status: 400 });
  if (!b.planStart || !b.planEnd)
    return NextResponse.json({ error: "보강 시작·종료 시간을 입력해 주세요." }, { status: 400 });
  const start = new Date(b.planStart);
  const end = new Date(b.planEnd);
  if (!(end > start))
    return NextResponse.json({ error: "종료 시간이 시작 시간보다 빠릅니다." }, { status: 400 });
  if (!String(b.targetClass || "").trim())
    return NextResponse.json({ error: "대상반을 적어 주세요." }, { status: 400 });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });

  const row = await createMakeupSession({
    employeeId,
    planStart: start,
    planEnd: end,
    category: b.category || "IMMEDIATE",
    targetClass: String(b.targetClass),
    headcount: b.headcount != null && b.headcount !== "" ? Number(b.headcount) : null,
    detail: b.detail ?? "",
    note: b.note ?? null,
    source: "WEB",
  });

  await logActivity({
    action: "MAKEUP_CREATE",
    employeeId,
    target: emp.name,
    summary: `${emp.name}님의 보강계획을 등록했습니다 — ${makeupDateLabel(start, end)} · ${
      MAKEUP_CATEGORY_LABEL[row.category] ?? row.category
    } (${row.targetClass}).`,
    meta: { makeupId: row.id },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
