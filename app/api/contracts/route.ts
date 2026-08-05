import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { templateKeyOf, normalizeContractTimeline, refreshEmployeeCard } from "@/lib/contracts";

export const dynamic = "force-dynamic";

/**
 * 신규 계약 생성 — 보수조건을 바꾸는 유일한 경로.
 * 직전 계약은 '새 계약 시작일 −1일' 로 닫아 날짜 빈틈이 생기지 않게 한다(이력은 유지).
 * 직원 카드는 계약이 아니라 '오늘 시점 지배 계약' 을 비추므로, 미래 시작 계약을 만들어도
 * 발효일 전까지는 카드·급여에 반영되지 않는다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();

  const employeeId = Number(body.employeeId);
  if (!employeeId) return NextResponse.json({ error: "employeeId 필요" }, { status: 400 });
  if (!body.startDate) return NextResponse.json({ error: "계약 시작일 필요" }, { status: 400 });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });

  const startDate = new Date(body.startDate);
  if (startDate < emp.hireDate)
    return NextResponse.json(
      { error: "계약 시작일이 입사일보다 빠릅니다." },
      { status: 400 }
    );

  const endDate = body.endDate ? new Date(body.endDate) : null;
  if (endDate && endDate < startDate)
    return NextResponse.json({ error: "계약 종료일이 시작일보다 빠릅니다." }, { status: 400 });

  const dup = await prisma.contract.findFirst({
    where: { employeeId, startDate, status: { not: "DRAFT" } },
  });
  if (dup)
    return NextResponse.json(
      { error: `같은 날(${body.startDate}) 시작하는 계약이 이미 있습니다. 기존 계약을 수정하세요.` },
      { status: 400 }
    );

  const payScheme = body.payScheme || emp.payScheme;
  const incomeType =
    body.incomeType === "EMPLOYEE" || body.incomeType === "FREELANCE"
      ? body.incomeType
      : emp.incomeType;
  const num = (v: any, fallback: number) =>
    v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : fallback;
  const numOrNull = (v: any, fallback: number | null) =>
    v === undefined ? fallback : v === null || v === "" ? null : Number(v);

  try {
    // 1) 새 계약
    const contract = await prisma.contract.create({
      data: {
        employeeId,
        stage: body.stage || "RENEWAL_1",
        templateKey: templateKeyOf(payScheme),
        incomeType,
        startDate,
        endDate,
        isProbation: !!body.isProbation,
        probationMonths: num(body.probationMonths, 2),
        baseWage: num(body.baseWage, emp.baseWage),
        positionAllow: num(body.positionAllow, emp.positionAllow),
        mealAllow: num(body.mealAllow, emp.mealAllow),
        carAllow: num(body.carAllow, emp.carAllow),
        incThreshold: numOrNull(body.incThreshold, emp.incThreshold),
        incPerStudent: numOrNull(body.incPerStudent, emp.incPerStudent),
        incRevenuePercent: numOrNull(body.incRevenuePercent, emp.incRevenuePercent),
        ratioPercent: numOrNull(body.ratioPercent, emp.ratioPercent),
        ratioMinGuarantee: numOrNull(body.ratioMinGuarantee, emp.ratioMinGuarantee),
        // 위탁계약(프리랜서) — 주휴·연차·퇴직금·4대보험 미적용
        isContractor:
          body.isContractor != null ? !!body.isContractor : !!(emp as any).isContractor,
        fixedBaseHours: numOrNull(body.fixedBaseHours, emp.fixedBaseHours),
        fixedOtHours: numOrNull(body.fixedOtHours, emp.fixedOtHours),
        fixedNightHours: numOrNull(body.fixedNightHours, emp.fixedNightHours),
        status: "ACTIVE",
        note: body.note || null,
      },
    });

    // 2) 이력 전체를 다시 맞춘다 — 앞 계약을 '새 계약 시작일 −1일' 로 닫고,
    //    끝난 계약은 EXPIRED 로 내린다 (과거 날짜로 끼워 넣은 계약도 함께 정리)
    const fixes = await normalizeContractTimeline(employeeId);
    const closed = fixes.filter((f) => f.endDate !== undefined).map((f) => f.id);

    // 3) 직책·업무는 계약서 본문에 쓰이므로 카드에도 반영 (보수조건 아님)
    const personal: any = {};
    if (body.position !== undefined) personal.position = body.position || null;
    if (body.duty !== undefined) personal.duty = body.duty || null;
    if (Object.keys(personal).length)
      await prisma.employee.update({ where: { id: employeeId }, data: personal });

    // 4) 카드를 '오늘 시점 지배 계약' 으로 갱신
    await refreshEmployeeCard(employeeId);

    await logActivity({
      action: "CONTRACT_CREATE",
      employeeId,
      target: emp.name,
      summary:
        `${emp.name}의 신규 계약을 작성했습니다 (${body.startDate} 시작).` +
        (closed.length ? ` 직전 계약 ${closed.length}건을 자동 종료했습니다.` : ""),
      meta: { contractId: contract.id, startDate: body.startDate, endDate: body.endDate ?? null },
    });
    return NextResponse.json({ ...contract, closedContractIds: closed }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
