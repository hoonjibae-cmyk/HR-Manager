import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { templateKeyOf } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const emps = await prisma.employee.findMany({ orderBy: { empNo: "asc" } });
  return NextResponse.json(emps);
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();

  // 사번 자동 생성
  let empNo = body.empNo;
  if (!empNo) {
    const last = await prisma.employee.findFirst({ orderBy: { id: "desc" } });
    const n = (last?.id ?? 0) + 1;
    empNo = `E${String(n).padStart(3, "0")}`;
  }

  const data: any = {
    empNo,
    name: body.name,
    rrn: body.rrn || null,
    birth: body.birth || null,
    department: body.department || null,
    position: body.position || null,
    duty: body.duty || null,
    address: body.address || null,
    phone: body.phone || null,
    email: body.email || null,
    slackUserId: body.slackUserId || null,
    bankName: body.bankName || null,
    bankAccount: body.bankAccount || null,
    hireDate: new Date(body.hireDate),
    resignDate: body.resignDate ? new Date(body.resignDate) : null,
    active: body.active ?? true,
    incomeType: body.incomeType || "EMPLOYEE",
    payScheme: body.payScheme || "MONTHLY",
    breakPaid: !!body.breakPaid,
    leaveEligible:
      body.leaveEligible === true ? true : body.leaveEligible === false ? false : null,
    baseWage: Number(body.baseWage) || 0,
    positionAllow: Number(body.positionAllow) || 0,
    mealAllow: Number(body.mealAllow) || 0,
    carAllow: Number(body.carAllow) || 0,
    dependents: Number(body.dependents) || 1,
    nonTaxTotal: Number(body.nonTaxTotal) || 0,
    parkingFee: Math.max(Number(body.parkingFee) || 0, 0),
    incThreshold: body.incThreshold != null && body.incThreshold !== "" ? Number(body.incThreshold) : null,
    incPerStudent: body.incPerStudent != null && body.incPerStudent !== "" ? Number(body.incPerStudent) : null,
    ratioPercent: body.ratioPercent != null && body.ratioPercent !== "" ? Number(body.ratioPercent) : null,
    schedule: typeof body.schedule === "string" ? body.schedule : JSON.stringify(body.schedule || []),
  };

  try {
    const emp = await prisma.employee.create({ data });
    // 초기 계약 생성 (선택)
    if (body.createContract) {
      await prisma.contract.create({
        data: {
          employeeId: emp.id,
          stage: body.contractStage || "SHORT_TERM_1",
          templateKey: templateKeyOf(emp.payScheme),
          incomeType: emp.incomeType,
          startDate: emp.hireDate,
          endDate: body.contractEnd ? new Date(body.contractEnd) : null,
          isProbation: body.isProbation ?? true,
          probationMonths: 2,
          baseWage: emp.baseWage,
          positionAllow: emp.positionAllow,
          mealAllow: emp.mealAllow,
          carAllow: emp.carAllow,
          incThreshold: emp.incThreshold,
          incPerStudent: emp.incPerStudent,
          ratioPercent: emp.ratioPercent,
          status: "ACTIVE",
        },
      });
    }
    await logActivity({
      action: "EMPLOYEE_CREATE",
      employeeId: emp.id,
      target: emp.name,
      summary: `직원 ${emp.name}(${emp.empNo})을 등록했습니다.`,
      meta: { department: emp.department, hireDate: emp.hireDate },
    });
    return NextResponse.json(emp, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
