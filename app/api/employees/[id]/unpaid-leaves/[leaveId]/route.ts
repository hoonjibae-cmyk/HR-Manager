// 휴직·휴업(무급휴직·유급휴직·휴업) — 한 건 수정·삭제.
//
// 급여를 다시 산정하지 않는 이유는 목록·등록 라우트(../route.ts)와 같다 — 다시 봐야 하는 달을 돌려주고
// 급여 화면이 그 행을 「미반영」으로 띄운다. 수정은 **옛 기간과 새 기간 양쪽 달**을 모두 본다
// (기간을 11월에서 12월로 옮기면 11월도 '휴직 없음' 으로 다시 산정해야 한다). 날짜는 그대로 두고 구분·비율·
// 금액만 고쳐도 그 달은 다시 산정해야 한다(급여 화면이 지급 조건까지 견준다).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentHrUser, isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isContractorContract } from "@/lib/constants";
import {
  unpaidLeaveError,
  normalizeLeaveTerms,
  leaveTermsLabel,
  leavePayTermsLabel,
  leaveKindOf,
  shutdownRateWarning,
  parseYmd,
  spanDays,
  LEAVE_KIND_LABEL,
} from "@/lib/unpaid-leave";
import { unpaidImpactFor, monthsTouched, impactNotice } from "@/lib/unpaid-leave-service";

export const dynamic = "force-dynamic";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const blank = (v: unknown) => v == null || v === "";

type Params = { params: { id: string; leaveId: string } };

/** 주소의 직원과 휴직이 서로 맞는지까지 본다 — 휴직 번호만 믿으면 남의 휴직을 고칠 수 있다 */
async function load(params: Params["params"]) {
  const employeeId = Number(params.id);
  const leaveId = Number(params.leaveId);
  if (!employeeId || !leaveId) return null;
  const leave = await prisma.unpaidLeave.findFirst({
    where: { id: leaveId, employeeId },
    include: { employee: true },
  });
  return leave;
}

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 누가 고쳤는지 이력에 남기려고 신원까지 받는다 (isAuthed 와 같은 원장 대조)
  const me = await currentHrUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const leave = await load(params);
  if (!leave) return NextResponse.json({ error: "휴직·휴업 기록을 찾을 수 없습니다." }, { status: 404 });
  const emp = leave.employee;
  const body = await req.json().catch(() => ({}) as any);

  // 보내지 않은 칸은 지금 값 그대로 — 사유만 고치는 요청도 받는다.
  // 지급 방식은 둘 중 하나라, **한쪽만 새로 보냈으면 다른 쪽은 지운다** — 비율(70%)로 등록한 건에 금액만 보내면
  // 저장된 비율이 남아 '둘 다 있다' 로 막히고, 그 반대도 같다.
  const sentRate = "payRate" in body;
  const sentAmount = "payAmount" in body;
  const next = {
    startDate: body.startDate ?? ymd(leave.startDate),
    endDate: body.endDate ?? ymd(leave.endDate),
    reason: "reason" in body ? body.reason : leave.reason,
    kind: "kind" in body ? body.kind : leave.kind,
    payRate: sentRate ? body.payRate : sentAmount && !blank(body.payAmount) ? null : leave.payRate,
    payAmount: sentAmount ? body.payAmount : sentRate && !blank(body.payRate) ? null : leave.payAmount,
  };
  const others = await prisma.unpaidLeave.findMany({
    where: { employeeId: emp.id, id: { not: leave.id } },
    select: { startDate: true, endDate: true, kind: true },
  });
  const err = unpaidLeaveError(next, {
    hireDate: emp.hireDate,
    resignDate: emp.resignDate,
    contractor: isContractorContract(emp),
    ratio: emp.payScheme === "RATIO",
    others,
  });
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const startDate = parseYmd(next.startDate)!;
  const endDate = parseYmd(next.endDate)!;
  const reason = typeof next.reason === "string" ? next.reason.trim() || null : null;
  const terms = normalizeLeaveTerms(next);
  const updated = await prisma.unpaidLeave.update({
    where: { id: leave.id },
    data: { startDate, endDate, ...terms, reason },
  });

  const impacts = await unpaidImpactFor(emp, monthsTouched([leave, updated]));
  const warning = shutdownRateWarning(terms);
  const before = leaveTermsLabel(leave);
  const after = leaveTermsLabel(terms);
  await logActivity({
    action: "UNPAID_LEAVE_UPDATE",
    actorName: me.name,
    employeeId: emp.id,
    target: emp.name,
    summary:
      `${emp.name}님의 휴직·휴업을 고쳤습니다 — ${before} ${ymd(leave.startDate)} ~ ${ymd(leave.endDate)} → ` +
      `${after} ${ymd(startDate)} ~ ${ymd(endDate)} (${spanDays(startDate, endDate)}일)`,
    meta: {
      leaveId: leave.id,
      before: {
        startDate: ymd(leave.startDate),
        endDate: ymd(leave.endDate),
        kind: leave.kind,
        payRate: leave.payRate,
        payAmount: leave.payAmount,
        reason: leave.reason,
      },
      after: { startDate: ymd(startDate), endDate: ymd(endDate), ...terms, reason },
      impacts,
      warning,
    },
  });

  return NextResponse.json({ ok: true, impacts, notice: impactNotice(impacts), warning });
}

export async function DELETE(_req: Request, { params }: Params) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const me = await currentHrUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const leave = await load(params);
  if (!leave) return NextResponse.json({ error: "휴직·휴업 기록을 찾을 수 없습니다." }, { status: 404 });
  const emp = leave.employee;

  await prisma.unpaidLeave.delete({ where: { id: leave.id } });

  // 지운 뒤의 상태로 본다 — 그 달들이 '휴직 없음' 으로 바뀌었으므로 이미 산정한 달은 다시 산정해야 한다
  const impacts = await unpaidImpactFor(emp, monthsTouched([leave]));
  await logActivity({
    action: "UNPAID_LEAVE_DELETE",
    actorName: me.name,
    employeeId: emp.id,
    target: emp.name,
    summary:
      `${emp.name}님의 ${LEAVE_KIND_LABEL[leaveKindOf(leave.kind)]}을 지웠습니다 — ` +
      `${ymd(leave.startDate)} ~ ${ymd(leave.endDate)} (${spanDays(leave.startDate, leave.endDate)}일)` +
      (leavePayTermsLabel(leave) ? ` · ${leavePayTermsLabel(leave)}` : "") +
      (leave.reason ? ` · ${leave.reason}` : ""),
    // 지운 내용을 그대로 남긴다 — 나중에 '왜 그 달 급여가 달라졌나' 를 되짚을 수 있어야 한다
    meta: {
      leaveId: leave.id,
      startDate: ymd(leave.startDate),
      endDate: ymd(leave.endDate),
      kind: leave.kind,
      payRate: leave.payRate,
      payAmount: leave.payAmount,
      reason: leave.reason,
      createdBy: leave.createdBy,
      impacts,
    },
  });

  return NextResponse.json({ ok: true, impacts, notice: impactNotice(impacts) });
}
