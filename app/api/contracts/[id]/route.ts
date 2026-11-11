import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import {
  templateKeyOf,
  refreshEmployeeCard,
  contractIssues,
  normalizeContractTimeline,
  paySchemeOfTemplate,
} from "@/lib/contracts";
import { parseSchedule } from "@/lib/constants";
import { resolveNonCompetePay, resolveNonCompeteRatio } from "@/lib/non-compete";
import { parseProbationMonths } from "@/lib/probation";
import { normalizeRatioTerms } from "@/lib/ratio-employee";

export const dynamic = "force-dynamic";

async function issuesFor(employeeId: number) {
  const [emp, list] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId } }),
    prisma.contract.findMany({
      where: { employeeId, status: { not: "DRAFT" } },
      orderBy: { startDate: "asc" },
    }),
  ]);
  if (!emp) return [];
  return contractIssues(emp, list).map((i) => i.message);
}

/** 계약 조건 수정 — 오타 정정·조건 변경. 보수조건을 바꾸는 두 경로 중 하나. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  const body = await req.json();

  const cur = await prisma.contract.findUnique({ where: { id } });
  if (!cur) return NextResponse.json({ error: "계약을 찾을 수 없습니다" }, { status: 404 });

  const data: any = {};
  const num = (v: any) => (v === "" || v == null ? 0 : Number(v));
  const numOrNull = (v: any) => (v === "" || v == null ? null : Number(v));

  for (const f of ["baseWage", "positionAllow", "mealAllow", "carAllow"])
    if (f in body) data[f] = num(body[f]);
  for (const f of [
    "incThreshold",
    "incPerStudent",
    "incRevenuePercent",
    "ratioPercent",
    "ratioMinGuarantee",
    "fixedBaseHours",
    "fixedOtHours",
    "fixedNightHours",
  ])
    if (f in body) data[f] = numOrNull(body[f]);
  // 인원 기준 인센티브의 산정 대상 — 방식(incCountMethod)은 ACADEMY 일 때만 뜻이 있어 함께 정리한다
  if ("incScope" in body) {
    data.incScope = body.incScope === "ACADEMY" ? "ACADEMY" : null;
    data.incCountMethod =
      body.incScope === "ACADEMY" ? body.incCountMethod || "SNAPSHOT15" : null;
  }
  if ("payScheme" in body) data.templateKey = templateKeyOf(body.payScheme);
  if ("incomeType" in body) data.incomeType = body.incomeType || null;
  if ("stage" in body) data.stage = body.stage;
  if ("isProbation" in body) data.isProbation = !!body.isProbation;
  // 수습 개월 — 안 보내면 저장값 그대로. 옛 계약(2개월)을 현행 기본값으로 바꿔 버리면
  // 다시 뽑는 계약서가 서명본과 달라지므로 기본값으로 메우지 않는다.
  if ("probationMonths" in body) {
    const pm = parseProbationMonths(body.probationMonths, cur.probationMonths);
    if (pm.error) return NextResponse.json({ error: pm.error }, { status: 400 });
    data.probationMonths = pm.value;
  }
  if ("isContractor" in body) data.isContractor = !!body.isContractor;
  if ("note" in body) data.note = body.note || null;
  if ("startDate" in body && body.startDate) data.startDate = new Date(body.startDate);
  if ("endDate" in body) data.endDate = body.endDate ? new Date(body.endDate) : null;

  // 수습 기한이 달라지면 수습 종료 알림을 다시 받게 한다 — 옛 기한으로 한 번 알린 것으로
  // 끝나면 고친 기한을 아무도 짚어 주지 않는다(lib/hr-notify.ts probationsToAnnounce).
  if (
    (data.startDate && +data.startDate !== +cur.startDate) ||
    (data.probationMonths != null && data.probationMonths !== cur.probationMonths) ||
    (data.isProbation != null && data.isProbation !== cur.isProbation)
  )
    data.probationNotifiedAt = null;

  const start = data.startDate ?? cur.startDate;
  const end = data.endDate !== undefined ? data.endDate : cur.endDate;
  if (end && end < start)
    return NextResponse.json({ error: "계약 종료일이 시작일보다 빠릅니다." }, { status: 400 });

  // 경업금지 보상금 — 고친 뒤의 조건으로 **다시 검사**한다. 금액을 안 건드렸어도 월 급여를 줄이면
  // 보상금을 떼고 남는 기본급이 없어질 수 있고, 시급제·위탁으로 바꾸면 남은 보상금을 지운다.
  // 교수부 필수 여부는 여기서 묻지 않는다 — 이미 서명한 옛 계약의 오타 정정까지 막게 된다.
  {
    const merged = { ...cur, ...data };
    const owner = await prisma.employee.findUnique({
      where: { id: cur.employeeId },
      select: { schedule: true, payScheme: true },
    });
    const scheme = paySchemeOfTemplate(merged.templateKey) ?? owner?.payScheme ?? "MONTHLY";
    // 완전비율제의 위탁/근로(4대보험)·근로소득 상한 — 고친 뒤의 급여형태로 다시 맞춘다.
    // 안 보낸 칸은 저장값을 잇고, 비율제가 아니게 바꾸면 근로 표시·상한을 지운다.
    const ratio = normalizeRatioTerms(
      {
        payScheme: scheme,
        ratioEmployee: "ratioEmployee" in body ? body.ratioEmployee === true : undefined,
        ratioWageCap: "ratioWageCap" in body ? body.ratioWageCap : undefined,
        isContractor: merged.isContractor === true,
      },
      { ratioEmployee: cur.ratioEmployee, ratioWageCap: cur.ratioWageCap }
    );
    if (ratio.error) return NextResponse.json({ error: ratio.error }, { status: 400 });
    if (ratio.ratioEmployee !== cur.ratioEmployee) data.ratioEmployee = ratio.ratioEmployee;
    if (ratio.ratioWageCap !== (cur.ratioWageCap ?? null)) data.ratioWageCap = ratio.ratioWageCap;
    if (ratio.isContractor !== cur.isContractor || "isContractor" in data) data.isContractor = ratio.isContractor;
    // 비율제 근로계약은 4대보험이 전제다 — 세무구분을 근로소득으로 맞춘다
    if (ratio.incomeType && (data.incomeType ?? cur.incomeType) !== ratio.incomeType)
      data.incomeType = ratio.incomeType;
    const nc = resolveNonCompetePay({
      raw: "nonCompetePay" in body ? body.nonCompetePay : undefined,
      fallback: cur.nonCompetePay,
      payScheme: scheme,
      isContractor: ratio.isContractor,
      terms: { ...merged, schedule: parseSchedule(owner?.schedule ?? "[]") },
    });
    if (nc.error) return NextResponse.json({ error: nc.error }, { status: 400 });
    if (nc.value !== (cur.nonCompetePay ?? null)) data.nonCompetePay = nc.value;
    // 위탁 보상금 비율 — 위탁 비율을 올려 합이 100% 를 넘으면 거르고, 위탁이 아니게 바꾸면 지운다
    const ncr = resolveNonCompeteRatio({
      raw: "nonCompeteRatio" in body ? body.nonCompeteRatio : undefined,
      fallback: cur.nonCompeteRatio,
      payScheme: scheme,
      ratioPercent: merged.ratioPercent,
      ratioEmployee: ratio.ratioEmployee,
    });
    if (ncr.error) return NextResponse.json({ error: ncr.error }, { status: 400 });
    if (ncr.value !== (cur.nonCompeteRatio ?? null)) data.nonCompeteRatio = ncr.value;
  }

  try {
    await prisma.contract.update({ where: { id }, data });
    // 날짜를 옮겼으면 앞뒤 계약과의 관계가 달라진다 — 이력 전체를 다시 맞춘다
    await normalizeContractTimeline(cur.employeeId);
    await refreshEmployeeCard(cur.employeeId);
    const emp = await prisma.employee.findUnique({ where: { id: cur.employeeId } });
    await logActivity({
      action: "CONTRACT_UPDATE",
      employeeId: cur.employeeId,
      target: emp?.name,
      summary: `${emp?.name ?? "직원"}의 계약 조건을 수정했습니다 (${Object.keys(data).join(", ")}).`,
      meta: { contractId: id, changed: data },
    });
    return NextResponse.json({ ok: true, issues: await issuesFor(cur.employeeId) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

/**
 * 계약 삭제 (잘못 만든 계약 정리).
 * 직전 계약의 종료일을 삭제된 계약의 종료일까지 늘려 빈틈을 메운다.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  const cur = await prisma.contract.findUnique({ where: { id } });
  if (!cur) return NextResponse.json({ error: "계약을 찾을 수 없습니다" }, { status: 404 });

  const count = await prisma.contract.count({
    where: { employeeId: cur.employeeId, status: { not: "DRAFT" } },
  });
  if (count <= 1)
    return NextResponse.json(
      { error: "마지막 계약은 삭제할 수 없습니다. 조건을 수정해 주세요." },
      { status: 400 }
    );

  try {
    const prev = await prisma.contract.findFirst({
      where: {
        employeeId: cur.employeeId,
        status: { not: "DRAFT" },
        startDate: { lt: cur.startDate },
      },
      orderBy: { startDate: "desc" },
    });
    await prisma.contract.delete({ where: { id } });
    if (prev) {
      // 삭제로 생긴 공백을 직전 계약이 이어받는다.
      // (뒤에 다른 계약이 남아 있으면 아래 normalize 가 다시 그 전날로 닫는다)
      await prisma.contract.update({
        where: { id: prev.id },
        data: { endDate: cur.endDate },
      });
    }
    await normalizeContractTimeline(cur.employeeId);
    await refreshEmployeeCard(cur.employeeId);
    const emp = await prisma.employee.findUnique({ where: { id: cur.employeeId } });
    await logActivity({
      action: "CONTRACT_DELETE",
      employeeId: cur.employeeId,
      target: emp?.name,
      summary: `${emp?.name ?? "직원"}의 계약(${cur.startDate.toISOString().slice(0, 10)} 시작)을 삭제했습니다.`,
      meta: { contractId: id },
    });
    return NextResponse.json({ ok: true, issues: await issuesFor(cur.employeeId) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
