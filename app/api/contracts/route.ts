import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { templateKeyOf, normalizeContractTimeline, refreshEmployeeCard } from "@/lib/contracts";
import { parseSchedule } from "@/lib/constants";
import {
  resolveNonCompetePay,
  nonCompeteRequired,
  resolveNonCompeteRatio,
  nonCompeteRatioRequired,
  ratioPctLabel,
  NON_COMPETE_REQUIRED_MESSAGE,
  NON_COMPETE_RATIO_REQUIRED_MESSAGE,
} from "@/lib/non-compete";

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

  // 금액 조건 — 경업금지 보상금 검사가 '떼고 남는 기본급' 을 봐야 해서 저장 전에 먼저 정한다
  const wage = {
    baseWage: num(body.baseWage, emp.baseWage),
    positionAllow: num(body.positionAllow, emp.positionAllow),
    mealAllow: num(body.mealAllow, emp.mealAllow),
    carAllow: num(body.carAllow, emp.carAllow),
    fixedBaseHours: numOrNull(body.fixedBaseHours, emp.fixedBaseHours),
    fixedOtHours: numOrNull(body.fixedOtHours, emp.fixedOtHours),
    fixedNightHours: numOrNull(body.fixedNightHours, emp.fixedNightHours),
  };
  // 위탁계약(프리랜서) — 주휴·연차·퇴직금·4대보험 미적용
  const isContractor =
    body.isContractor != null ? !!body.isContractor : !!(emp as any).isContractor;

  // 경업금지 보상금 — 월급제·인센티브 근로계약만. **교수부는 새 계약마다 반드시 적는다**
  // (근로계약서에 경업금지 조항이 들어가는 조건이다). 옛 계약을 옮겨 적는 경우처럼 조항을 넣지
  // 않을 때는 화면에서 명시적으로 체크해야 하고(skipNonCompete), 작업 이력에 남는다.
  const nc = resolveNonCompetePay({
    raw: body.nonCompetePay,
    fallback: (emp as any).nonCompetePay ?? null,
    payScheme,
    isContractor,
    terms: { ...wage, schedule: parseSchedule(emp.schedule) },
  });
  if (nc.error) return NextResponse.json({ error: nc.error }, { status: 400 });
  const ncRequired = nonCompeteRequired(emp.department, { payScheme, isContractor });
  // 위탁(강의위탁계약서)은 금액이 아니라 **매출에 곱하는 비율**로 정하고, 새 계약마다 필수다(부서 무관).
  // 위탁 비율과 합쳐 매출의 100% 를 넘으면 거른다.
  const ratioPercent = numOrNull(body.ratioPercent, emp.ratioPercent);
  const ncr = resolveNonCompeteRatio({
    raw: body.nonCompeteRatio,
    fallback: (emp as any).nonCompeteRatio ?? null,
    payScheme,
    ratioPercent,
  });
  if (ncr.error) return NextResponse.json({ error: ncr.error }, { status: 400 });
  const ncrRequired = nonCompeteRatioRequired({ payScheme });
  const missing = (ncRequired && !nc.value) || (ncrRequired && !ncr.value);
  const skipNonCompete = missing && body.skipNonCompete === true;
  if (missing && !skipNonCompete)
    return NextResponse.json(
      {
        error: ncrRequired ? NON_COMPETE_RATIO_REQUIRED_MESSAGE : NON_COMPETE_REQUIRED_MESSAGE,
        code: "NON_COMPETE_REQUIRED",
      },
      { status: 400 }
    );

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
        baseWage: wage.baseWage,
        positionAllow: wage.positionAllow,
        mealAllow: wage.mealAllow,
        carAllow: wage.carAllow,
        nonCompetePay: nc.value,
        incThreshold: numOrNull(body.incThreshold, emp.incThreshold),
        incPerStudent: numOrNull(body.incPerStudent, emp.incPerStudent),
        incRevenuePercent: numOrNull(body.incRevenuePercent, emp.incRevenuePercent),
        // 인원 기준 인센티브의 산정 대상·재원생 산정 방식 (교수부장 = ACADEMY).
        // 방식은 ACADEMY 일 때만 뜻이 있다 — 담당 원생 기준으로 되돌리면 함께 비운다.
        incScope: body.incScope === "ACADEMY" ? "ACADEMY" : null,
        incCountMethod:
          body.incScope === "ACADEMY" ? body.incCountMethod || "SNAPSHOT15" : null,
        ratioPercent,
        ratioMinGuarantee: numOrNull(body.ratioMinGuarantee, emp.ratioMinGuarantee),
        nonCompeteRatio: ncr.value,
        isContractor,
        fixedBaseHours: wage.fixedBaseHours,
        fixedOtHours: wage.fixedOtHours,
        fixedNightHours: wage.fixedNightHours,
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
        (nc.value ? ` 경업금지 보상금 월 ${nc.value.toLocaleString()}원.` : "") +
        (ncr.value ? ` 경업금지 보상금 매출의 ${ratioPctLabel(ncr.value)}.` : "") +
        (skipNonCompete
          ? ncrRequired
            ? ` 위탁계약이지만 경업금지 보상금 없이 작성했습니다(관리자 선택).`
            : ` 교수부 계약이지만 경업금지 조항 없이 작성했습니다(관리자 선택).`
          : "") +
        (closed.length ? ` 직전 계약 ${closed.length}건을 자동 종료했습니다.` : ""),
      meta: {
        contractId: contract.id,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        nonCompetePay: nc.value,
        nonCompeteRatio: ncr.value,
        ...(skipNonCompete ? { skipNonCompete: true } : {}),
      },
    });
    return NextResponse.json({ ...contract, closedContractIds: closed }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
