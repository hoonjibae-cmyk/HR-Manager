/**
 * 계약서 서명본 스캔 — **파일 본문 조회·삭제**.
 *
 * 계약 밑(`/api/contracts/[id]/files/...`)이 아니라 따로 둔 이유: 파일 하나를 여는 데
 * 계약 번호까지 알아야 하면 화면이 링크를 만들 때마다 두 값을 들고 다녀야 한다.
 * 파일 id 는 그 자체로 유일하다.
 *
 * 개인정보가 담긴 문서라 **반드시 `isAuthed()` 를 거쳐** 앱이 직접 흘려보낸다.
 */

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { contentDisposition, formatSize } from "@/lib/contract-file";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 개인정보가 담긴 문서 — 공용 캐시에 남기지 않고, 저장한 형식대로만 해석되게 한다 */
const headersFor = (name: string, mime: string, download: boolean) => ({
  "Content-Type": mime,
  "Content-Disposition": contentDisposition(name, mime, download),
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
});

export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.fileId);
  if (!id) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 400 });

  const meta = await prisma.contractFile.findUnique({
    where: { id },
    select: { id: true, name: true, mime: true, size: true, complete: true },
  });
  if (!meta) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  // 올리다 만 파일은 이어 붙이기 전이라 열어도 깨진 문서가 나온다
  if (!meta.complete)
    return NextResponse.json({ error: "아직 올리는 중인 파일입니다." }, { status: 409 });

  const download = new URL(req.url).searchParams.get("download") === "1";

  // 본문은 여기서만 읽는다
  const row = await prisma.contractFile.findUnique({ where: { id }, select: { data: true } });
  if (!row?.data) return NextResponse.json({ error: "파일 본문이 없습니다." }, { status: 500 });
  return new NextResponse(Buffer.from(row.data) as any, {
    headers: { ...headersFor(meta.name, meta.mime, download), "Content-Length": String(meta.size) },
  });
}

export async function DELETE(_req: Request, { params }: { params: { fileId: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.fileId);
  if (!id) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 400 });

  // 본문(`data`)은 빼고 읽는다 — 지우려고 수 MB 를 메모리에 들일 이유가 없다
  const file = await prisma.contractFile.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      size: true,
      contractId: true,
      contract: { select: { employeeId: true, employee: { select: { name: true } } } },
    },
  });
  if (!file) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

  await prisma.contractFile.delete({ where: { id } });

  // **되돌릴 수 없는 작업이라 반드시 남긴다** — 원본 스캔은 다시 스캔하지 않으면 복구되지 않는다
  await logActivity({
    action: "CONTRACT_FILE_DELETE",
    employeeId: file.contract?.employeeId ?? null,
    target: file.contract?.employee?.name ?? String(file.contractId),
    summary:
      `계약(#${file.contractId})의 서명본 스캔을 삭제했습니다 — ${file.name} (${formatSize(file.size)})`,
    meta: { contractId: file.contractId, name: file.name, size: file.size },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
