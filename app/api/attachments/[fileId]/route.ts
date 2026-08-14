/**
 * 첨부 파일 — **본문 조회·삭제** (계약 서명본·직원 서류함 공통).
 *
 * 붙는 자리(계약/직원) 밑이 아니라 따로 둔 이유: 파일 하나를 여는 데 부모 번호까지 알아야
 * 하면 화면이 링크를 만들 때마다 두 값을 들고 다녀야 한다. 파일 id 는 그 자체로 유일하다.
 *
 * 개인정보가 담긴 문서라 **반드시 `isAuthed()` 를 거쳐** 앱이 직접 흘려보낸다.
 */

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { contentDisposition, formatSize, isViewable } from "@/lib/contract-file";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.fileId);
  if (!id) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 400 });

  const meta = await prisma.attachedFile.findUnique({
    where: { id },
    select: { id: true, name: true, mime: true, size: true, complete: true },
  });
  if (!meta) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  // 올리다 만 파일은 이어 붙이기 전이라 열어도 깨진 문서가 나온다
  if (!meta.complete)
    return NextResponse.json({ error: "아직 올리는 중인 파일입니다." }, { status: 409 });

  /*
   * **아는 형식만 브라우저에 보여 준다.** 앞머리로 못 가린 것(hwp·docx·zip …)은
   * `application/octet-stream` 으로 담겨 있고, 그런 것을 inline 으로 내보내면 브라우저가
   * 제멋대로 해석할 여지를 준다. 그래서 **모르는 형식은 무조건 내려받기**로 돌린다.
   */
  const asked = new URL(req.url).searchParams.get("download") === "1";
  const download = asked || !isViewable(meta.mime);

  const row = await prisma.attachedFile.findUnique({ where: { id }, select: { data: true } });
  if (!row?.data) return NextResponse.json({ error: "파일 본문이 없습니다." }, { status: 500 });

  return new NextResponse(Buffer.from(row.data) as any, {
    headers: {
      "Content-Type": meta.mime,
      "Content-Length": String(meta.size),
      "Content-Disposition": contentDisposition(meta.name, meta.mime, download),
      // 개인정보가 담긴 문서 — 공용 캐시에 남기지 않고, 저장한 형식대로만 해석되게 한다
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: { fileId: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.fileId);
  if (!id) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 400 });

  // 본문(`data`)은 빼고 읽는다 — 지우려고 수십 MB 를 메모리에 들일 이유가 없다
  const file = await prisma.attachedFile.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      size: true,
      contractId: true,
      employeeId: true,
      contract: { select: { employeeId: true, employee: { select: { name: true } } } },
      employee: { select: { name: true } },
    },
  });
  if (!file) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

  await prisma.attachedFile.delete({ where: { id } });

  // **되돌릴 수 없는 작업이라 반드시 남긴다** — 원본은 다시 스캔하지 않으면 복구되지 않는다
  const who = file.contract?.employee?.name ?? file.employee?.name ?? "";
  await logActivity({
    action: file.contractId ? "CONTRACT_FILE_DELETE" : "EMPLOYEE_FILE_DELETE",
    employeeId: file.employeeId ?? file.contract?.employeeId ?? null,
    target: who,
    summary: file.contractId
      ? `계약(#${file.contractId})의 서명본 스캔을 삭제했습니다 — ${file.name} (${formatSize(file.size)})`
      : `${who} 서류함의 파일을 삭제했습니다 — ${file.name} (${formatSize(file.size)})`,
    meta: { contractId: file.contractId, name: file.name, size: file.size },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
