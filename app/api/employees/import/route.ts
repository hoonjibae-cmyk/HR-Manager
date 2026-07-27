import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import {
  parseEmployeeWorkbook,
  buildTemplateWorkbook,
  buildFillTemplateWorkbook,
  planFill,
  FILL_FIELDS,
} from "@/lib/employee-import";
import { templateKeyOf, normalizeContractTimeline } from "@/lib/contracts";
import { logActivity } from "@/lib/activity";

/** 학원 표준 근로시간표 (월~금 15:00~22:00, 휴게 30분).
 *  비워 두면 통상시급이 0이 되어 연장·야간·연차수당이 계산되지 않는다. */
const DEFAULT_SCHEDULE = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({
  day,
  work: day !== "sat" && day !== "sun",
  start: "15:00",
  end: "22:00",
  breakH: 0.5,
}));

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 작성용 빈 템플릿 내려받기.
 * ?kind=fill — 이미 등록된 직원 명단이 깔린 '정보 채우기' 양식.
 */
export async function GET(req: Request) {
  if (!(await isAuthed())) return new Response("unauthorized", { status: 401 });
  const kind = new URL(req.url).searchParams.get("kind");
  let buf: Buffer;
  let filename: string;
  if (kind === "fill") {
    const emps = await prisma.employee.findMany({
      where: { active: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
      select: { empNo: true, name: true },
    });
    buf = buildFillTemplateWorkbook(emps);
    filename = "직원정보_채우기_양식.xlsx";
  } else {
    buf = buildTemplateWorkbook();
    filename = "직원명단_양식.xlsx";
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

/**
 * 직원 명단 일괄 등록 / 기존 직원 정보 채우기.
 * mode=preview(기본)   — 읽기만 하고 결과를 돌려준다. DB 변경 없음.
 * mode=commit          — 오류 없는 행만 등록. 각 직원의 초기 계약도 함께 만든다.
 * mode=fill-preview    — 이미 등록된 직원의 빈 인적사항을 무엇으로 채울지 미리 본다.
 * mode=fill-commit     — 위 계획을 실제로 적용한다. 보수조건은 건드리지 않는다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "preview");
  if (!(file instanceof File))
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  const isFill = mode.startsWith("fill");
  const overwrite = String(form.get("overwrite") ?? "") === "1";

  const buf = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parseEmployeeWorkbook(buf, { mode: isFill ? "fill" : "create" });
  } catch (e: any) {
    return NextResponse.json(
      { error: `파일을 읽지 못했습니다: ${e.message}` },
      { status: 400 }
    );
  }
  const { rows, unknownHeaders, mapped, presentKeys } = parsed;
  if (!rows.length)
    return NextResponse.json(
      {
        error:
          (isFill
            ? "읽어들인 직원이 없습니다. 첫 시트에 '성명' 열이 있는지 확인하세요."
            : "읽어들인 직원이 없습니다. 첫 시트에 '성명'·'입사일자' 열이 있는지 확인하세요.") +
          (unknownHeaders.length ? ` (인식 못한 열: ${unknownHeaders.join(", ")})` : ""),
      },
      { status: 400 }
    );

  /* ---------- 기존 직원 정보 채우기 ---------- */
  if (isFill) {
    const targets = await prisma.employee.findMany({
      select: {
        id: true,
        empNo: true,
        name: true,
        ...Object.fromEntries(FILL_FIELDS.map((f) => [f.key, true])),
      } as any,
    });
    const plan = planFill(rows, targets as any, { overwrite, presentKeys });

    if (mode !== "fill-commit") {
      // 미리보기 응답에는 실제 값(주민번호 등)을 싣지 않는다 — 화면 표기는 마스킹된 changes 로 충분
      return NextResponse.json({
        ok: true,
        mode: "fill-preview",
        total: rows.length,
        matchedCount: plan.matchedCount,
        changeCount: plan.changeCount,
        errorCount: plan.rows.filter((r) => r.errors.length).length,
        unmatched: plan.unmatched,
        unknownHeaders,
        mapped,
        overwrite,
        rows: plan.rows.map(({ data, ...rest }) => rest),
      });
    }

    let updated = 0;
    const fields = new Set<string>();
    const names: string[] = [];
    for (const r of plan.rows) {
      if (!r.employeeId || r.errors.length || !r.changes.length) continue;
      await prisma.employee.update({ where: { id: r.employeeId }, data: r.data });
      updated++;
      names.push(r.name);
      r.changes.forEach((c) => fields.add(c.label));
    }

    await logActivity({
      action: "EMPLOYEE_UPDATE",
      target: `${updated}명`,
      summary:
        `직원 인적사항을 일괄로 채웠습니다 — ${updated}명 / ${plan.changeCount}건` +
        (fields.size ? ` (${[...fields].join(", ")})` : "") +
        (overwrite ? " · 기존 값 덮어쓰기" : ""),
      // 주민등록번호 등 실제 값은 이력에 남기지 않는다 — 무엇을 바꿨는지만 남긴다
      meta: { names, fields: [...fields], overwrite },
    });

    return NextResponse.json({
      ok: true,
      mode: "fill-commit",
      updatedCount: updated,
      changeCount: plan.changeCount,
    });
  }

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
        ratioMinGuarantee: r.ratioMinGuarantee,
        fixedBaseHours: r.fixedBaseHours,
        fixedOtHours: r.fixedOtHours,
        fixedNightHours: r.fixedNightHours,
        schedule: JSON.stringify(DEFAULT_SCHEDULE),
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
        ratioMinGuarantee: r.ratioMinGuarantee,
        fixedBaseHours: r.fixedBaseHours,
        fixedOtHours: r.fixedOtHours,
        fixedNightHours: r.fixedNightHours,
        status: "ACTIVE",
        note: "명단 일괄 등록",
      },
    });
    // 계약기간이 이미 지난 채로 등록되는 경우가 있어 상태를 날짜에 맞춘다
    await normalizeContractTimeline(emp.id);
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
