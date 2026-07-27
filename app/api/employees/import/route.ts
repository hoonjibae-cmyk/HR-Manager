import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { parseEmployeeWorkbook, buildTemplateWorkbook } from "@/lib/employee-import";
import { templateKeyOf } from "@/lib/contracts";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 작성용 빈 템플릿 내려받기 */
export async function GET() {
  if (!(await isAuthed())) return new Response("unauthorized", { status: 401 });
  const buf = buildTemplateWorkbook();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("직원명단_양식.xlsx")}`,
    },
  });
}

/**
 * 직원 명단 일괄 등록.
 * mode=preview(기본) — 읽기만 하고 결과를 돌려준다. DB 변경 없음.
 * mode=commit       — 오류 없는 행만 등록. 각 직원의 초기 계약도 함께 만든다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "preview");
  if (!(file instanceof File))
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parseEmployeeWorkbook(buf);
  } catch (e: any) {
    return NextResponse.json(
      { error: `파일을 읽지 못했습니다: ${e.message}` },
      { status: 400 }
    );
  }
  const { rows, unknownHeaders, mapped } = parsed;
  if (!rows.length)
    return NextResponse.json(
      {
        error:
          "읽어들인 직원이 없습니다. 첫 시트에 '성명'·'입사일자' 열이 있는지 확인하세요." +
          (unknownHeaders.length ? ` (인식 못한 열: ${unknownHeaders.join(", ")})` : ""),
      },
      { status: 400 }
    );

  // 이미 등록된 직원과의 충돌 검사
  const existing = await prisma.employee.findMany({ select: { empNo: true, name: true } });
  const existingNames = new Set(existing.map((e) => e.name));
  const existingNos = new Set(existing.map((e) => e.empNo));
  for (const r of rows) {
    if (r.empNo && existingNos.has(r.empNo)) r.errors.push(`사번 ${r.empNo} 는 이미 등록돼 있습니다`);
    if (existingNames.has(r.name)) r.warnings.push("같은 이름의 직원이 이미 등록돼 있습니다");
  }

  const valid = rows.filter((r) => r.errors.length === 0);

  if (mode !== "commit") {
    return NextResponse.json({
      ok: true,
      mode: "preview",
      total: rows.length,
      validCount: valid.length,
      errorCount: rows.length - valid.length,
      unknownHeaders,
      mapped,
      rows,
      alreadyRegistered: existing.length,
    });
  }

  // ---- 실제 등록 ----
  let seq = 0;
  const last = await prisma.employee.findFirst({ orderBy: { id: "desc" } });
  let nextNo = (last?.id ?? 0) + 1;
  const created: string[] = [];

  for (const r of valid) {
    const empNo = r.empNo || `E${String(nextNo).padStart(3, "0")}`;
    nextNo++;
    seq++;
    const emp = await prisma.employee.create({
      data: {
        empNo,
        name: r.name,
        rrn: r.rrn ?? null,
        birth: r.birth ?? null,
        department: r.department ?? null,
        position: r.position ?? null,
        duty: r.duty ?? null,
        address: r.address ?? null,
        phone: r.phone ?? null,
        email: r.email ?? null,
        bankName: r.bankName ?? null,
        bankAccount: r.bankAccount ?? null,
        hireDate: new Date(r.hireDate),
        resignDate: r.resignDate ? new Date(r.resignDate) : null,
        active: !r.resignDate,
        incomeType: r.incomeType,
        payScheme: r.payScheme,
        baseWage: r.baseWage,
        positionAllow: r.positionAllow,
        mealAllow: r.mealAllow,
        carAllow: r.carAllow,
        dependents: r.dependents,
        incThreshold: r.incThreshold,
        incPerStudent: r.incPerStudent,
        ratioPercent: r.ratioPercent,
      },
    });
    // 보수조건의 단일 진실은 계약이므로 초기 계약을 함께 만든다
    await prisma.contract.create({
      data: {
        employeeId: emp.id,
        stage: "SHORT_TERM_1",
        templateKey: templateKeyOf(r.payScheme),
        incomeType: r.incomeType,
        startDate: new Date(r.contractStart || r.hireDate),
        endDate: r.contractEnd ? new Date(r.contractEnd) : null,
        isProbation: false,
        probationMonths: 2,
        baseWage: r.baseWage,
        positionAllow: r.positionAllow,
        mealAllow: r.mealAllow,
        carAllow: r.carAllow,
        incThreshold: r.incThreshold,
        incPerStudent: r.incPerStudent,
        ratioPercent: r.ratioPercent,
        status: "ACTIVE",
        note: "명단 일괄 등록",
      },
    });
    created.push(emp.name);
  }

  await logActivity({
    action: "EMPLOYEE_CREATE",
    target: `${seq}명`,
    summary: `직원 명단을 일괄 등록했습니다 — ${seq}명 (${created.slice(0, 5).join(", ")}${
      created.length > 5 ? " 외" : ""
    }).`,
    meta: { created, skipped: rows.length - valid.length },
  });

  return NextResponse.json({
    ok: true,
    mode: "commit",
    createdCount: seq,
    skippedCount: rows.length - valid.length,
    created,
  });
}
