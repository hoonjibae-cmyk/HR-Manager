import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { listDepartments, DEPT_DOC_FIELDS } from "@/lib/departments";

export const dynamic = "force-dynamic";

/** 부서 목록 + 관리자에게 물어볼 서류 정책 항목 */
export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await listDepartments();
  const counts = await prisma.employee.groupBy({
    by: ["department"],
    _count: { _all: true },
    where: { active: true },
  });
  const used = new Map(counts.map((c) => [c.department ?? "", c._count._all]));
  return NextResponse.json({
    departments: rows.map((d) => ({ ...d, employeeCount: used.get(d.name) ?? 0 })),
    docFields: DEPT_DOC_FIELDS,
    /// 부서가 비어 있는 직원 — 이들은 서류 발급이 막히므로 화면에서 짚어 준다
    missingDept: used.get("") ?? 0,
  });
}

const BOOLS = ["docPledgeServiceII", "docPromotion", "docHealth", "docNonCompete"] as const;

function policyFrom(body: any) {
  const out: Record<string, boolean> = {};
  for (const k of BOOLS) if (k in body) out[k] = !!body[k];
  return out;
}

/** 부서 추가 — 이름과 함께 **서류 정책을 반드시 받는다** */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "부서명이 필요합니다" }, { status: 400 });

  const dup = await prisma.department.findUnique({ where: { name } });
  if (dup) return NextResponse.json({ error: `'${name}' 은(는) 이미 있습니다` }, { status: 400 });

  const last = await prisma.department.findFirst({ orderBy: { sortOrder: "desc" } });
  const dept = await prisma.department.create({
    data: {
      name,
      sortOrder: (last?.sortOrder ?? 0) + 10,
      ...policyFrom(body),
    },
  });
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: name,
    summary: `부서 '${name}' 을(를) 추가했습니다.`,
    meta: dept,
  });
  return NextResponse.json(dept);
}

/** 부서 수정 (이름·서류 정책·사용 여부) */
export async function PATCH(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!id) return NextResponse.json({ error: "id 가 필요합니다" }, { status: 400 });

  const cur = await prisma.department.findUnique({ where: { id } });
  if (!cur) return NextResponse.json({ error: "부서를 찾지 못했습니다" }, { status: 404 });

  const data: any = policyFrom(body);
  if (typeof body.active === "boolean") data.active = body.active;
  if (body.name != null && String(body.name).trim() && String(body.name).trim() !== cur.name) {
    const name = String(body.name).trim();
    // 이름을 바꾸면 그 부서로 등록된 직원의 부서 문자열도 함께 옮겨야 한다 —
    // 안 옮기면 '등록되지 않은 부서' 가 되어 그 사람들 서류 발급이 통째로 막힌다
    data.name = name;
    await prisma.employee.updateMany({ where: { department: cur.name }, data: { department: name } });
  }

  const dept = await prisma.department.update({ where: { id }, data });
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: dept.name,
    summary: `부서 '${dept.name}' 설정을 수정했습니다.`,
    meta: data,
  });
  return NextResponse.json(dept);
}

/**
 * 부서 삭제 — **그 부서 직원이 없을 때만.**
 * 직원이 남아 있는데 지우면 그 사람들의 부서가 '등록되지 않은 이름' 이 되어
 * 서류 발급이 막힌다. 쓰지 않을 부서는 지우지 말고 꺼 두면 된다(active=false).
 */
export async function DELETE(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id 가 필요합니다" }, { status: 400 });

  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept) return NextResponse.json({ error: "부서를 찾지 못했습니다" }, { status: 404 });

  const n = await prisma.employee.count({ where: { department: dept.name, active: true } });
  if (n > 0)
    return NextResponse.json(
      {
        error: `'${dept.name}' 소속 직원이 ${n}명 있어 삭제할 수 없습니다. 쓰지 않으려면 '사용 안 함' 으로 꺼 두세요.`,
      },
      { status: 400 }
    );

  await prisma.department.delete({ where: { id } });
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: dept.name,
    summary: `부서 '${dept.name}' 을(를) 삭제했습니다.`,
  });
  return NextResponse.json({ ok: true });
}
