/**
 * 직원 **서류함** — 목록·업로드 시작.
 *
 * 계약과 무관한 인사서류(동의서·서약서·자격증 사본 …)를 아무 형식이나 올려 둔다.
 * 업로드 방식은 계약 서명본과 **같다**(조각내 올리기, `lib/attachment-service.ts`).
 */

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listAttachments, beginUpload } from "@/lib/attachment-service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const employeeId = Number(params.id);
  if (!employeeId) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 400 });
  return NextResponse.json({ ok: true, files: await listAttachments({ kind: "employee", employeeId }) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const employeeId = Number(params.id);
  if (!employeeId) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 400 });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!emp) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });

  const r = await beginUpload(
    { kind: "employee", employeeId },
    { name: String(body.name ?? ""), size: Number(body.size), note: body.note ?? null }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
