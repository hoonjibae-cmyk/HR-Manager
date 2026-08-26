import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { CONTRACT_OWNED_FIELDS } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const emp = await prisma.employee.findUnique({
    where: { id: Number(params.id) },
    include: { contracts: { orderBy: { startDate: "desc" } } },
  });
  if (!emp) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(emp);
}

/**
 * 직원 카드 수정 — 인적사항·소속·근태 설정만.
 * 보수조건(기본급·수당·비율·인센티브·급여형태·세무구분)은 계약이 정하므로 여기서 받지 않는다.
 * 조건을 바꾸려면 계약을 새로 쓰거나(POST /api/contracts) 고친다(PATCH /api/contracts/[id]).
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const data: any = {};
  const fields = [
    "name", "rrn", "birth", "department", "position", "duty", "address",
    "phone", "email", "slackUserId", "bankName", "bankAccount", "bankHolder",
    "retentionBank", "retentionAccount",
  ];
  for (const f of fields) if (f in body) data[f] = body[f] || null;
  for (const f of ["dependents", "nonTaxTotal"])
    if (f in body) data[f] = Math.max(Number(body[f]) || 0, 0);
  // parkingFee(월 정기주차 비용)는 보수조건이 아니라 복리후생이라 여기서 받는다.
  // 매달 돌려줄 몫이 있는 경우가 있어 **음수를 허용**한다.
  if ("parkingFee" in body) data.parkingFee = Math.round(Number(body.parkingFee) || 0);
  if ("hireDate" in body && body.hireDate) data.hireDate = new Date(body.hireDate);
  if ("resignDate" in body) data.resignDate = body.resignDate ? new Date(body.resignDate) : null;
  if ("active" in body) data.active = !!body.active;
  if ("breakPaid" in body) data.breakPaid = !!body.breakPaid;
  // 연차 적용: null = 자동(주 15시간 기준), true/false = 계약상 강제
  if ("leaveEligible" in body)
    data.leaveEligible =
      body.leaveEligible === true ? true : body.leaveEligible === false ? false : null;
  if ("schedule" in body)
    data.schedule = typeof body.schedule === "string" ? body.schedule : JSON.stringify(body.schedule);

  // 계약이 소유한 항목이 섞여 들어오면 조용히 무시하고 사실만 알려준다
  const ignored = CONTRACT_OWNED_FIELDS.filter((f) => f in body);

  try {
    const emp = await prisma.employee.update({ where: { id: Number(params.id) }, data });
    await logActivity({
      action: "EMPLOYEE_UPDATE",
      employeeId: emp.id,
      target: emp.name,
      summary: `${emp.name}의 인적사항을 수정했습니다 (${Object.keys(data).join(", ")}).`,
      meta: { changed: Object.keys(data) },
    });
    return NextResponse.json({ ...emp, ignoredContractFields: ignored });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

/**
 * 직원 완전 삭제 — **입사 취소용**이다(입사하기로 했다가 오지 않은 사람은 DB 에 남길 이유가 없다).
 *
 * 되돌릴 수 없는 작업이라 안전장치가 셋이다.
 *  ① **확인 문구** — body 로 `confirm: "삭제"` 가 정확히 와야 지운다. 없으면 지우지 않고
 *     **무엇이 함께 지워지는지**(계약·급여·연차·첨부 건수)를 돌려준다 — 화면이 이걸 미리보기로
 *     띄우고 사용자가 '삭제' 를 직접 타이핑한 뒤에야 실제 요청이 나간다.
 *  ② **명세서가 발송된 직원은 막는다** — 이미 급여가 나간 사람이면 입사 취소가 아니라
 *     퇴사다. 임금 기록은 3년 보존 의무(근로기준법 §42)가 있어 지우면 안 되고,
 *     퇴사일을 넣으면 급여 시트에서 자동으로 내려간다.
 *  ③ **작업 이력에 지운 내용을 남긴다** — AuditLog 는 cascade 가 아니라 남는다(SetNull).
 *     이름·사번·건수까지 적어 나중에 '왜 이 사람이 없지' 를 되짚을 수 있게 한다.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  try {
    const emp = await prisma.employee.findUnique({ where: { id } });
    if (!emp) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });

    const [contracts, payroll, payrollSent, leaveTxns, files, contractFiles, makeups, timesheets] =
      await Promise.all([
        prisma.contract.count({ where: { employeeId: id } }),
        prisma.payrollRecord.count({ where: { employeeId: id } }),
        prisma.payrollRecord.count({ where: { employeeId: id, status: "SENT" } }),
        prisma.leaveTransaction.count({ where: { employeeId: id } }),
        prisma.attachedFile.count({ where: { employeeId: id, complete: true } }),
        prisma.attachedFile.count({
          where: { contract: { employeeId: id }, complete: true },
        }),
        prisma.makeupSession.count({ where: { employeeId: id } }),
        prisma.timesheetDay.count({ where: { employeeId: id } }),
      ]);

    const summary = {
      name: emp.name,
      empNo: emp.empNo,
      contracts,
      payroll,
      payrollSent,
      leaveTxns,
      files: files + contractFiles,
      makeups,
      timesheets,
    };

    // ② 명세서가 나간 직원은 삭제가 아니라 퇴사 처리다
    if (payrollSent > 0)
      return NextResponse.json(
        {
          error:
            `${emp.name}님은 급여명세서가 이미 발송된 기록이 ${payrollSent}건 있습니다. ` +
            `임금 기록은 3년 보존 의무가 있어 삭제할 수 없습니다 — 직원 정보에 퇴사일을 넣으면 ` +
            `급여 시트에서 자동으로 빠집니다.`,
          summary,
        },
        { status: 409 }
      );

    // ① 확인 문구가 없으면 지우지 않고 미리보기를 돌려준다
    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "삭제")
      return NextResponse.json(
        { error: "확인 문구가 필요합니다.", requires: "삭제", summary },
        { status: 428 }
      );

    await prisma.employee.delete({ where: { id } });
    await logActivity({
      action: "EMPLOYEE_DELETE",
      target: emp.name,
      summary:
        `직원 ${emp.name}(${emp.empNo})을(를) 완전 삭제했습니다 — ` +
        `계약 ${contracts}건 · 급여기록 ${payroll}건 · 연차기록 ${leaveTxns}건 · ` +
        `첨부파일 ${summary.files}건 · 보강/근무 ${makeups}건이 함께 삭제됐습니다.`,
      meta: summary,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
