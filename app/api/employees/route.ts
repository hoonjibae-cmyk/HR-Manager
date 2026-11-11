import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { templateKeyOf } from "@/lib/contracts";
import { parseSchedule } from "@/lib/constants";
import { PROBATION_MONTHS } from "@/lib/probation";
import { normalizeRatioTerms } from "@/lib/ratio-employee";
import {
  resolveNonCompetePay,
  nonCompeteRequired,
  resolveNonCompeteRatio,
  nonCompeteRatioRequired,
  ratioPctLabel,
  NON_COMPETE_REQUIRED_MESSAGE,
  nonCompeteRatioRequiredMessage,
} from "@/lib/non-compete";

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
    workEmail: body.workEmail || null,
    slackUserId: body.slackUserId || null,
    bankName: body.bankName || null,
    bankAccount: body.bankAccount || null,
    bankHolder: body.bankHolder || null,
    retentionBank: body.retentionBank || null,
    retentionAccount: body.retentionAccount || null,
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
    parkingFee: Math.round(Number(body.parkingFee) || 0), // (−) 허용 = 매달 환급
    incThreshold: body.incThreshold != null && body.incThreshold !== "" ? Number(body.incThreshold) : null,
    incPerStudent: body.incPerStudent != null && body.incPerStudent !== "" ? Number(body.incPerStudent) : null,
    incRevenuePercent:
      body.incRevenuePercent != null && body.incRevenuePercent !== ""
        ? Number(body.incRevenuePercent)
        : null,
    ratioPercent: body.ratioPercent != null && body.ratioPercent !== "" ? Number(body.ratioPercent) : null,
    schedule: typeof body.schedule === "string" ? body.schedule : JSON.stringify(body.schedule || []),
  };

  // 완전비율제 초기 계약의 위탁/근로(4대보험)·근로소득 상한 — 신규 계약 작성과 같은 규칙.
  // 카드는 초기 계약을 비추는 거울이라 같은 값을 함께 적는다(비율제 근로자는 세무구분이 근로소득).
  const ratio = normalizeRatioTerms({
    payScheme: data.payScheme,
    ratioEmployee: body.ratioEmployee === true,
    ratioWageCap: body.ratioWageCap,
    isContractor: body.isContractor === true,
  });
  if (ratio.error) return NextResponse.json({ error: ratio.error }, { status: 400 });
  data.isContractor = ratio.isContractor;
  data.ratioEmployee = ratio.ratioEmployee;
  data.ratioWageCap = ratio.ratioWageCap;
  if (ratio.incomeType) data.incomeType = ratio.incomeType;

  // 초기 계약의 경업금지 보상금 — 교수부 월급제·인센티브는 필수(신규 계약 작성과 같은 규칙).
  // 카드(data.nonCompetePay)는 초기 계약을 비추는 거울이라 계약을 만들 때만 같이 적는다.
  const ncShape = { payScheme: data.payScheme, isContractor: ratio.isContractor, ratioEmployee: ratio.ratioEmployee };
  const nc = body.createContract
    ? resolveNonCompetePay({
        raw: body.nonCompetePay,
        fallback: null,
        ...ncShape,
        terms: { ...data, schedule: parseSchedule(data.schedule) },
      })
    : { value: null, error: null };
  if (nc.error) return NextResponse.json({ error: nc.error }, { status: 400 });
  const ncRequired = !!body.createContract && nonCompeteRequired(data.department, ncShape);
  // 완전비율제 초기 계약 — 매출에 곱하는 보상금 비율. 위탁은 언제나, 비율제 근로계약은 교수부만 필수
  // (신규 계약 작성과 같은 규칙)
  const ncr = body.createContract
    ? resolveNonCompeteRatio({
        raw: body.nonCompeteRatio,
        fallback: null,
        payScheme: data.payScheme,
        ratioPercent: data.ratioPercent,
        ratioEmployee: ratio.ratioEmployee,
      })
    : { value: null, error: null };
  if (ncr.error) return NextResponse.json({ error: ncr.error }, { status: 400 });
  const ncrRequired =
    !!body.createContract &&
    nonCompeteRatioRequired({ payScheme: data.payScheme, ratioEmployee: ratio.ratioEmployee }, data.department);
  const missing = (ncRequired && !nc.value) || (ncrRequired && !ncr.value);
  const skipNonCompete = missing && body.skipNonCompete === true;
  if (missing && !skipNonCompete)
    return NextResponse.json(
      {
        error: ncrRequired ? nonCompeteRatioRequiredMessage(ratio.ratioEmployee) : NON_COMPETE_REQUIRED_MESSAGE,
        code: "NON_COMPETE_REQUIRED",
      },
      { status: 400 }
    );
  data.nonCompetePay = nc.value;
  data.nonCompeteRatio = ncr.value;

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
          probationMonths: PROBATION_MONTHS,
          baseWage: emp.baseWage,
          positionAllow: emp.positionAllow,
          mealAllow: emp.mealAllow,
          carAllow: emp.carAllow,
          nonCompetePay: nc.value,
          incThreshold: emp.incThreshold,
          incPerStudent: emp.incPerStudent,
          incRevenuePercent: emp.incRevenuePercent,
          ratioPercent: emp.ratioPercent,
          nonCompeteRatio: ncr.value,
          isContractor: ratio.isContractor,
          ratioEmployee: ratio.ratioEmployee,
          ratioWageCap: ratio.ratioWageCap,
          status: "ACTIVE",
        },
      });
    }
    await logActivity({
      action: "EMPLOYEE_CREATE",
      employeeId: emp.id,
      target: emp.name,
      summary:
        `직원 ${emp.name}(${emp.empNo})을 등록했습니다.` +
        (nc.value ? ` 초기 계약 경업금지 보상금 월 ${nc.value.toLocaleString()}원.` : "") +
        (ncr.value ? ` 초기 계약 경업금지 보상금 매출의 ${ratioPctLabel(ncr.value)}.` : "") +
        (ratio.ratioEmployee
          ? ` 비율제 근로계약(4대보험)${
              ratio.ratioWageCap ? ` · 근로소득 상한 월 ${ratio.ratioWageCap.toLocaleString()}원` : ""
            }.`
          : "") +
        (skipNonCompete
          ? ncrRequired && !ratio.ratioEmployee
            ? ` 위탁 초기 계약이지만 경업금지 보상금 없이 작성했습니다(관리자 선택).`
            : ` 교수부 초기 계약이지만 경업금지 조항 없이 작성했습니다(관리자 선택).`
          : ""),
      meta: {
        department: emp.department,
        hireDate: emp.hireDate,
        nonCompetePay: nc.value,
        nonCompeteRatio: ncr.value,
        ...(skipNonCompete ? { skipNonCompete: true } : {}),
      },
    });
    return NextResponse.json(emp, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
