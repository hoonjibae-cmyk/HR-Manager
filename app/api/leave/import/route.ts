import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { parseLeaveWorkbook, planLeaveImport } from "@/lib/leave-import";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 연차 관리시트(엑셀) → 연차 사용 내역 일괄 등록.
 * mode=preview(기본) — 무엇이 등록될지 보여만 준다. DB 변경 없음.
 * mode=commit       — 실제 등록.
 *
 * 발생(부여)은 가져오지 않는다. 시트는 회계연도 기준이고 이 시스템은 입사일 기준이라
 * 총일수가 다를 수 있어, 발생은 시스템이 근로기준법대로 계산한 값을 그대로 쓴다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "preview");
  const yearRaw = form.get("year");
  const year = yearRaw ? Number(yearRaw) : undefined;
  if (!(file instanceof File))
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parseLeaveWorkbook(buf, { year });
  } catch (e: any) {
    return NextResponse.json({ error: `파일을 읽지 못했습니다: ${e.message}` }, { status: 400 });
  }
  if (!parsed.rows.length)
    return NextResponse.json(
      {
        error:
          `${parsed.year}년 시트에서 읽어들인 직원이 없습니다.` +
          (parsed.availableYears.length
            ? ` (파일에 있는 연도: ${parsed.availableYears.join(", ")})`
            : " 시트 이름이 연도(예: 2026)인지 확인하세요."),
      },
      { status: 400 }
    );

  const employees = await prisma.employee.findMany({
    select: { id: true, name: true, payScheme: true },
  });
  // 같은 날짜에 이미 기록된 사용분은 다시 넣지 않는다 (두 번 올려도 안전)
  const existing = await prisma.leaveTransaction.findMany({
    where: { type: "USE" },
    select: { employeeId: true, date: true, category: true },
  });

  const plan = planLeaveImport(
    parsed.rows,
    employees,
    existing.map((t) => ({
      employeeId: t.employeeId,
      date: ymd(t.date),
      category: t.category ?? "STATUTORY",
    })),
    { note: `${parsed.year}년 연차 관리시트 일괄 등록` }
  );

  if (mode !== "commit") {
    return NextResponse.json({
      ok: true,
      mode: "preview",
      year: parsed.year,
      availableYears: parsed.availableYears,
      unknownKinds: parsed.unknownKinds,
      matchedCount: plan.matchedCount,
      addCount: plan.addCount,
      skipCount: plan.skipCount,
      duplicateCount: plan.duplicateCount,
      errorCount: plan.rows.filter((r) => r.errors.length).length,
      unmatched: plan.unmatched,
      rows: plan.rows.map(({ txns, ...rest }) => rest),
    });
  }

  let added = 0;
  const names: string[] = [];
  for (const r of plan.rows) {
    if (!r.employeeId || r.errors.length || !r.txns.length) continue;
    await prisma.leaveTransaction.createMany({
      data: r.txns.map((t) => ({
        employeeId: t.employeeId,
        date: new Date(`${t.date}T00:00:00Z`),
        days: t.days,
        type: t.type,
        category: t.category,
        note: t.note,
      })),
    });
    added += r.adds.length;
    names.push(r.name);
  }

  await logActivity({
    action: "LEAVE_IMPORT",
    target: `${names.length}명`,
    summary:
      `${parsed.year}년 연차 사용 내역을 일괄 등록했습니다 — ${names.length}명 / ${added}건` +
      (plan.skipCount ? ` (이미 있어 건너뜀 ${plan.skipCount}건)` : "") +
      (plan.duplicateCount ? ` (시트 내 날짜 중복 ${plan.duplicateCount}건)` : ""),
    meta: { year: parsed.year, names, added, skipped: plan.skipCount, duplicates: plan.duplicateCount },
  });

  return NextResponse.json({
    ok: true,
    mode: "commit",
    year: parsed.year,
    addedCount: added,
    employeeCount: names.length,
    skipCount: plan.skipCount,
    duplicateCount: plan.duplicateCount,
  });
}
