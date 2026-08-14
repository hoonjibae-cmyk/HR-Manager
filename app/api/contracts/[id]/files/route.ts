/**
 * 계약서 **서명본 스캔** — 목록·업로드 시작.
 *
 * 시스템이 뽑는 계약서(`genContract`)와 다른 물건이다 — 그쪽은 지금 조건으로 새로 만드는
 * 서식이라 조건을 고치면 따라 바뀌지만, 서명·날인해 주고받은 원본은 그대로 남아야 한다.
 *
 * 업로드 방식은 직원 서류함과 **같다**(조각내 올리기, `lib/attachment-service.ts`).
 */

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listAttachments, beginUpload } from "@/lib/attachment-service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const contractId = Number(params.id);
  if (!contractId) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 400 });
  return NextResponse.json({ ok: true, files: await listAttachments({ kind: "contract", contractId }) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const contractId = Number(params.id);
  if (!contractId) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 400 });

  const contract = await prisma.contract.findUnique({ where: { id: contractId }, select: { id: true } });
  if (!contract) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });

  const r = await beginUpload(
    { kind: "contract", contractId },
    { name: String(body.name ?? ""), size: Number(body.size), note: body.note ?? null }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
