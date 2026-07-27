import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";

import { templateKeyOf } from "@/lib/contract-sync";

/**
 * 신규 계약 추가 생성.
 * 기존 확정(ACTIVE) 계약서는 삭제하지 않고 EXPIRED 로 전환하여 이력·재발급을 유지한다.
 * 새 계약의 보수 조건은 직원 카드에도 동기화되어 이후 급여 산정에 반영된다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();

  const employeeId = Number(body.employeeId);
  if (!employeeId) return NextResponse.json({ error: "employeeId 필요" }, { status: 400 });
  if (!body.startDate) return NextResponse.json({ error: "계약 시작일 필요" }, { status: 400 });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return NextResponse.json({ error: "직원을 찾을 수 없습니다" }, { status: 404 });

  const payScheme = body.payScheme || emp.payScheme;
  const incomeType =
    body.incomeType === "EMPLOYEE" || body.incomeType === "FREELANCE"
      ? body.incomeType
      : emp.incomeType;
  const num = (v: any, fallback: number) =>
    v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : fallback;
  const numOrNull = (v: any, fallback: number | null) =>
    v === undefined ? fallback : v === null || v === "" ? null : Number(v);

  const baseWage = num(body.baseWage, emp.baseWage);
  const positionAllow = num(body.positionAllow, emp.positionAllow);
  const mealAllow = num(body.mealAllow, emp.mealAllow);
  const carAllow = num(body.carAllow, emp.carAllow);
  const incThreshold = numOrNull(body.incThreshold, emp.incThreshold);
  const incPerStudent = numOrNull(body.incPerStudent, emp.incPerStudent);
  const ratioPercent = numOrNull(body.ratioPercent, emp.ratioPercent);
  const position = body.position !== undefined ? body.position || null : emp.position;
  const duty = body.duty !== undefined ? body.duty || null : emp.duty;

  try {
    const [, contract] = await prisma.$transaction([
      // 기존 진행 중 계약 → 만료 처리 (문서/이력은 그대로 유지)
      prisma.contract.updateMany({
        where: { employeeId, status: "ACTIVE" },
        data: { status: "EXPIRED" },
      }),
      prisma.contract.create({
        data: {
          employeeId,
          stage: body.stage || "RENEWAL_1",
          templateKey: templateKeyOf(payScheme),
          startDate: new Date(body.startDate),
          endDate: body.endDate ? new Date(body.endDate) : null,
          isProbation: !!body.isProbation,
          probationMonths: num(body.probationMonths, 2),
          baseWage,
          positionAllow,
          mealAllow,
          carAllow,
          incThreshold,
          incPerStudent,
          ratioPercent,
          status: "ACTIVE",
          note: body.note || null,
        },
      }),
      // 직원 카드 동기화 — 이후 급여 산정·문서에 새 조건 반영
      prisma.employee.update({
        where: { id: employeeId },
        data: {
          incomeType,
          payScheme,
          baseWage,
          positionAllow,
          mealAllow,
          carAllow,
          incThreshold,
          incPerStudent,
          ratioPercent,
          position,
          duty,
        },
      }),
    ]);
    return NextResponse.json(contract, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
