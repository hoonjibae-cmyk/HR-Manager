// 휴직·휴업(무급휴직·유급휴직·휴업) — 직원별 목록·등록.
// 주소가 `unpaid-leaves` 인 것은 무급휴직만 있던 때(v1.63)의 이름이다 — 유급휴직·휴업도 여기로 온다.
//
// 등록한 기간만큼 그 달 정상 급여가 **역일수**로 일할되고, 유급휴직·휴업은 그 기간의 급여를 원급여 대비 비율이나
// 직접 넣은 금액으로 따로 지급한다(lib/unpaid-leave.ts). 연차가 아니라 연차 원장과 무관하다.
//
// ⚠ **여기서 급여를 다시 산정하지 않는다.** 이미 만든 급여 기록은 그대로 두고, 어느 달을 다시 산정해야
// 하는지를 돌려준다(계약을 고쳤을 때와 같다 — 급여 화면의 「급여 일괄 산정」이 반영한다). 다른 화면에서
// 조용히 급여 기록이 바뀌면 무엇이 언제 왜 달라졌는지 따라갈 수 없고, 손으로 조정해 둔 달(상여 칸의 차감 등)이
// 있으면 두 번 깎인다. 대신 급여 화면이 그 행을 「미반영」으로 띄워 지나치지 않게 한다.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed, currentHrUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isContractorContract } from "@/lib/constants";
import {
  unpaidLeaveError,
  normalizeLeaveTerms,
  leavePayTermsLabel,
  shutdownRateWarning,
  leaveKindOf,
  parseYmd,
  spanDays,
  LEAVE_KIND_LABEL,
} from "@/lib/unpaid-leave";
import {
  unpaidImpactFor,
  unpaidImpactsOfEmployee,
  monthsTouched,
  impactNotice,
} from "@/lib/unpaid-leave-service";

export const dynamic = "force-dynamic";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** 화면에 내리는 한 줄 */
function rowOf(l: {
  id: number;
  startDate: Date;
  endDate: Date;
  kind: string;
  payRate: number | null;
  payAmount: number | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: Date;
}) {
  return {
    id: l.id,
    startDate: ymd(l.startDate),
    endDate: ymd(l.endDate),
    days: spanDays(l.startDate, l.endDate),
    kind: leaveKindOf(l.kind),
    payRate: l.payRate,
    payAmount: l.payAmount,
    reason: l.reason ?? "",
    createdBy: l.createdBy ?? "",
    createdAt: l.createdAt.toISOString(),
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  const emp = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, hireDate: true, resignDate: true },
  });
  if (!emp) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  const leaves = await prisma.unpaidLeave.findMany({
    where: { employeeId: id },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
  });
  // 휴직·휴업이 걸친 달(그리고 그것으로 일할해 산정해 둔 달)의 급여 상태 — 다시 산정해야 하는 달을 카드가 늘
  // 보여 준다(등록 직후에만 알리면 잊는다)
  const impacts = await unpaidImpactsOfEmployee(emp, leaves);
  return NextResponse.json({ leaves: leaves.map(rowOf), impacts, notice: impactNotice(impacts) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 누가 등록했는지 기록·이력에 남기려고 신원까지 받는다 (isAuthed 와 같은 원장 대조)
  const me = await currentHrUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  const body = await req.json().catch(() => ({}) as any);

  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  const others = await prisma.unpaidLeave.findMany({
    where: { employeeId: id },
    select: { startDate: true, endDate: true, kind: true },
  });

  const input = {
    startDate: body.startDate,
    endDate: body.endDate,
    reason: body.reason,
    kind: body.kind,
    payRate: body.payRate,
    payAmount: body.payAmount,
  };
  const err = unpaidLeaveError(input, {
    hireDate: emp.hireDate,
    resignDate: emp.resignDate,
    contractor: isContractorContract(emp),
    // 완전비율제(근로계약)는 원급여가 매출에 달려 비율 지급을 쓸 수 없다 — 금액만 받는다
    ratio: emp.payScheme === "RATIO",
    others,
  });
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const startDate = parseYmd(body.startDate)!;
  const endDate = parseYmd(body.endDate)!;
  const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
  // 쓰지 않는 조건은 지워서 저장한다 — 무급이면 둘 다, 금액 지정이면 비율, 비율 지급이면 금액
  const terms = normalizeLeaveTerms(input);
  const leave = await prisma.unpaidLeave.create({
    data: { employeeId: id, startDate, endDate, ...terms, reason, createdBy: me.name },
  });

  const impacts = await unpaidImpactFor(emp, monthsTouched([leave]));
  // 휴업수당이 70% 에 못 미치면 알린다 — 막지는 않는다(노동위원회 승인·불가항력 휴업이면 정당하다)
  const warning = shutdownRateWarning(terms);
  const payTerms = leavePayTermsLabel(terms);
  await logActivity({
    action: "UNPAID_LEAVE_CREATE",
    actorName: me.name,
    employeeId: id,
    target: emp.name,
    summary:
      `${emp.name}님의 ${LEAVE_KIND_LABEL[terms.kind]}을 등록했습니다 — ${ymd(startDate)} ~ ${ymd(endDate)} ` +
      `(${spanDays(startDate, endDate)}일)` +
      (payTerms ? ` · ${payTerms}` : "") +
      (reason ? ` · ${reason}` : ""),
    meta: { leaveId: leave.id, startDate: ymd(startDate), endDate: ymd(endDate), ...terms, reason, impacts, warning },
  });

  return NextResponse.json({ ok: true, leave: rowOf(leave), impacts, notice: impactNotice(impacts), warning });
}
