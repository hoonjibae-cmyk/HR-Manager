// 계좌 일괄 등록 — 은행 이체 양식을 거꾸로 읽어 직원 정보의 은행·계좌를 채운다.
//
// 매달 손으로 채워 쓰던 이체 파일에 이미 전 직원의 계좌가 들어 있어, 그 파일을 그대로 올리면
// 옮겨 적을 일이 없다. 계좌는 잘못 넣으면 돈이 남에게 가므로 **비어 있는 항목만** 채우는 것이
// 기본이고, 덮어쓰기는 화면에서 따로 켠다.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { parseBankAccountWorkbook, planBankAccounts } from "@/lib/bank-transfer";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "preview");
  const overwrite = String(form.get("overwrite") ?? "") === "1";
  if (!(file instanceof File))
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  let parsed;
  try {
    parsed = parseBankAccountWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e: any) {
    return NextResponse.json({ error: `파일을 읽지 못했습니다: ${e.message}` }, { status: 400 });
  }
  const { rows, skipped } = parsed;
  if (!rows.length)
    return NextResponse.json(
      {
        error:
          "읽어들인 계좌가 없습니다. 첫 시트에 '입금은행'·'입금계좌번호'·'예상예금주' 열이 있는지 확인하세요.",
      },
      { status: 400 }
    );

  const targets = await prisma.employee.findMany({
    select: {
      id: true,
      name: true,
      bankName: true,
      bankAccount: true,
      retentionBank: true,
      retentionAccount: true,
    },
  });
  const plan = planBankAccounts(rows, targets, { overwrite });

  if (mode !== "commit") {
    // 미리보기 응답에는 실제 계좌번호를 싣지 않는다 — changes 의 마스킹된 값으로 충분하다
    return NextResponse.json({
      ok: true,
      total: rows.length,
      skipped,
      matchedCount: plan.matchedCount,
      changeCount: plan.changeCount,
      errorCount: plan.rows.filter((r) => r.errors.length).length,
      unmatched: plan.unmatched,
      overwrite,
      rows: plan.rows.map(({ data, ...rest }) => rest),
    });
  }

  // 한 사람이 급여·유보금 두 줄로 나뉘어 오므로 직원별로 합쳐 한 번에 저장한다
  const merged = new Map<number, Record<string, string>>();
  const names = new Set<string>();
  for (const r of plan.rows) {
    if (!r.employeeId || r.errors.length || !r.changes.length) continue;
    merged.set(r.employeeId, { ...(merged.get(r.employeeId) ?? {}), ...r.data });
    names.add(r.name);
  }
  for (const [id, data] of merged) await prisma.employee.update({ where: { id }, data });

  await logActivity({
    action: "EMPLOYEE_UPDATE",
    target: `${merged.size}명`,
    summary:
      `직원 계좌를 일괄로 등록했습니다 — ${merged.size}명 / ${plan.changeCount}건` +
      (overwrite ? " · 기존 값 덮어쓰기" : ""),
    // 계좌번호 자체는 이력에 남기지 않는다 — 누구를 바꿨는지만 남긴다
    meta: { names: [...names], overwrite },
  });

  return NextResponse.json({
    ok: true,
    updatedCount: merged.size,
    changeCount: plan.changeCount,
    unmatched: plan.unmatched,
  });
}
