/**
 * 계약서 서명본 스캔 — **파일 본문 조회·삭제**.
 *
 * 계약 밑(`/api/contracts/[id]/files/...`)이 아니라 따로 둔 이유: 파일 하나를 여는 데
 * 계약 번호까지 알아야 하면 화면이 링크를 만들 때마다 두 값을 들고 다녀야 한다.
 * 파일 id 는 그 자체로 유일하다.
 *
 * **저장소가 두 가지다**(`storage` = DB | DRIVE). 드라이브를 붙이기 전에 올린 파일과
 * 드라이브가 잠깐 안 될 때 받아 둔 파일이 DB 로 남아 있으므로, 여는 쪽은 둘 다 다뤄야 한다.
 *
 * ⚠ **드라이브 파일이라도 링크를 그대로 브라우저에 주지 않고 여기서 프록시한다.**
 * 계약서에는 주민등록번호·주소·급여가 들어 있어, 드라이브의 '링크가 있는 모든 사용자'
 * 공유로 열어 두면 주소 하나가 새는 순간 통째로 열린다. 이 경로는 `isAuthed()` 를 거친다.
 */

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { contentDisposition, formatSize } from "@/lib/contract-file";
import { driveStream, deleteFromDrive } from "@/lib/gdrive";

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
    select: { id: true, name: true, mime: true, size: true, storage: true, driveFileId: true },
  });
  if (!meta) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

  const download = new URL(req.url).searchParams.get("download") === "1";

  if (meta.storage === "DRIVE") {
    if (!meta.driveFileId)
      return NextResponse.json({ error: "드라이브 파일 정보가 없습니다." }, { status: 500 });
    const r = await driveStream(meta.driveFileId);
    if (!r.ok || !r.body)
      // 드라이브에서 사람이 파일을 지웠거나 권한이 바뀐 경우다 — 원인을 그대로 돌려준다
      return NextResponse.json(
        { error: `구글 드라이브에서 파일을 가져오지 못했습니다.\n${r.error ?? ""}` },
        { status: r.status === 404 ? 404 : 502 }
      );
    // 버퍼로 받지 않고 그대로 흘려보낸다 — 서버리스 메모리에 수 MB 를 올릴 이유가 없다
    return new NextResponse(r.body, { headers: headersFor(meta.name, meta.mime, download) });
  }

  // DB 보관분 — 본문은 여기서만 읽는다
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
      storage: true,
      driveFileId: true,
      contractId: true,
      contract: { select: { employeeId: true, employee: { select: { name: true } } } },
    },
  });
  if (!file) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });

  /*
   * 드라이브 파일이면 저쪽도 지운다. **실패해도 행은 지운다** —
   * 목록에서 뺄 방법이 없으면 담당자가 할 수 있는 일이 없어진다.
   * 대신 드라이브에 남은 파일 id 를 이력에 남겨 나중에 찾아 지울 수 있게 한다
   * (파일이 드라이브에 남는 쪽이 앱에서 못 지우는 쪽보다 덜 나쁘다 — 원본은 잃지 않는다).
   */
  let driveError: string | null = null;
  if (file.storage === "DRIVE" && file.driveFileId) {
    const r = await deleteFromDrive(file.driveFileId);
    if (!r.ok) driveError = r.error ?? "드라이브에서 지우지 못했습니다.";
  }

  await prisma.contractFile.delete({ where: { id } });

  // **되돌릴 수 없는 작업이라 반드시 남긴다** — 원본 스캔은 다시 스캔하지 않으면 복구되지 않는다
  await logActivity({
    action: "CONTRACT_FILE_DELETE",
    employeeId: file.contract?.employeeId ?? null,
    target: file.contract?.employee?.name ?? String(file.contractId),
    summary:
      `계약(#${file.contractId})의 서명본 스캔을 삭제했습니다 — ${file.name} (${formatSize(file.size)})` +
      (driveError ? ` ※ 구글 드라이브 파일(${file.driveFileId})은 남아 있습니다: ${driveError}` : ""),
    meta: { contractId: file.contractId, name: file.name, size: file.size, storage: file.storage, driveError },
  }).catch(() => {});

  return NextResponse.json({ ok: true, driveError });
}
