/**
 * 계약서 서명본 스캔 — **조각 받기**.
 *
 * 브라우저가 파일을 `CHUNK_SIZE` 씩 잘라 `?index=N` 으로 하나씩 보낸다.
 * 조각 하나는 Vercel 요청 본문 상한(4.5MB) 안쪽이라 파일이 몇십 MB 든 통과한다.
 *
 * **마지막 조각이 닿으면 여기서 이어 붙이고 완성 처리까지 한다** — 마무리를 위한 API 를
 * 따로 두면 브라우저가 그걸 못 부르고 끝났을 때 파일이 영영 미완성으로 남는다.
 */

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { checkFormat, safeName, formatSize } from "@/lib/contract-file";
import { checkChunk, isLastChunk, chunkCount } from "@/lib/upload-chunk";

export const dynamic = "force-dynamic";
// 조각 하나는 몇 MB 라 느린 회선에서는 기본 시간을 넘길 수 있다
export const maxDuration = 60;

export async function PUT(req: Request, { params }: { params: { uploadId: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const uploadId = String(params.uploadId ?? "");
  const index = Number(new URL(req.url).searchParams.get("index"));

  // uploadId 에 유니크를 걸지 않았으므로(스키마 주석 참조) findFirst 로 찾는다.
  // 아직 올리는 중인 것만 본다 — 완성된 행의 uploadId 는 비워 두므로 걸릴 일이 없다.
  const file = await prisma.contractFile.findFirst({
    where: { uploadId, complete: false },
    select: {
      id: true,
      name: true,
      size: true,
      complete: true,
      contractId: true,
      contract: { select: { employeeId: true, employee: { select: { name: true } } } },
    },
  });
  if (!file) return NextResponse.json({ error: "업로드를 찾을 수 없습니다." }, { status: 404 });
  if (file.complete) return NextResponse.json({ error: "이미 완료된 업로드입니다." }, { status: 409 });

  const bytes = new Uint8Array(await req.arrayBuffer());
  const pos = checkChunk(index, bytes.byteLength, file.size);
  if (!pos.ok) return NextResponse.json({ error: pos.error }, { status: 400 });

  /*
   * **형식은 첫 조각에서 가린다.** 앞머리(매직 넘버)가 거기 있기 때문이고,
   * 여기서 걸러야 나머지 수십 MB 를 헛되이 올리지 않는다.
   * 아니면 자리(행)와 조각을 그 자리에서 지운다 — 쓰레기를 남기지 않는다.
   */
  if (index === 0) {
    const check = checkFormat(bytes, file.name);
    if (!check.ok || !check.mime) {
      await prisma.contractFile.delete({ where: { id: file.id } }).catch(() => {});
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    await prisma.contractFile.update({
      where: { id: file.id },
      data: { mime: check.mime, name: safeName(file.name, check.mime) },
    });
  }

  // 같은 조각을 두 번 보내도(재시도) 덮어쓰기만 한다 — 이어 붙일 때 겹치지 않는다
  await prisma.contractFileChunk.upsert({
    where: { fileId_index: { fileId: file.id, index } },
    update: { data: Buffer.from(bytes) },
    create: { fileId: file.id, index, data: Buffer.from(bytes) },
  });

  if (!isLastChunk(pos.start!, bytes.byteLength, file.size))
    return NextResponse.json({ ok: true, received: index });

  /* ───────── 마지막 조각 — 이어 붙여 완성한다 ───────── */

  const want = chunkCount(file.size);
  const have = await prisma.contractFileChunk.count({ where: { fileId: file.id } });
  if (have !== want)
    // 중간 조각이 빠졌다. 이대로 이어 붙이면 **열리지 않는 파일이 조용히 저장된다**
    return NextResponse.json(
      { error: `조각이 모자랍니다 (${have}/${want}). 다시 올려 주세요.`, missing: want - have },
      { status: 409 }
    );

  /*
   * 조각을 **DB 안에서 한 번에** 이어 붙인다. 서버 메모리로 끌어와 합치면 수십 MB 를
   * 서버리스 함수에 올리게 되고, 조각마다 `data = data || 조각` 으로 덧붙이면 Postgres 가
   * 그 행을 매번 통째로 다시 써서 쓰기량이 제곱으로 는다.
   */
  await prisma.$executeRaw`
    UPDATE "ContractFile"
       SET "data" = (
             SELECT string_agg(c."data", ''::bytea ORDER BY c."index")
               FROM "ContractFileChunk" c
              WHERE c."fileId" = ${file.id}
           ),
           "complete" = true,
           "uploadId" = NULL
     WHERE "id" = ${file.id}
  `;
  await prisma.contractFileChunk.deleteMany({ where: { fileId: file.id } });

  const saved = await prisma.contractFile.findUnique({
    where: { id: file.id },
    select: { id: true, name: true, mime: true, size: true, note: true, uploadedAt: true },
  });

  await logActivity({
    action: "CONTRACT_FILE_ADD",
    employeeId: file.contract?.employeeId ?? null,
    target: file.contract?.employee?.name ?? String(file.contractId),
    summary: `계약(#${file.contractId})에 서명본 스캔을 첨부했습니다 — ${saved?.name} (${formatSize(file.size)})`,
    meta: { contractId: file.contractId, name: saved?.name, size: file.size, chunks: want },
  }).catch(() => {});

  return NextResponse.json({ ok: true, done: true, file: saved });
}

/** 올리다 그만둘 때 — 자리와 조각을 치운다 */
export async function DELETE(_req: Request, { params }: { params: { uploadId: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await prisma.contractFile.findFirst({
    where: { uploadId: String(params.uploadId ?? ""), complete: false },
    select: { id: true, complete: true },
  });
  // 완성된 파일은 이 경로로 지우지 않는다 (그건 삭제 버튼이 할 일이다)
  if (row && !row.complete) await prisma.contractFile.delete({ where: { id: row.id } });
  return NextResponse.json({ ok: true });
}
