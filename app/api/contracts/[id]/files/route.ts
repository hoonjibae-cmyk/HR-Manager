/**
 * 계약서 **서명본 스캔** 첨부 — 목록·업로드 시작.
 *
 * 업로드는 **조각내 올린다**(`lib/upload-chunk.ts`). Vercel 서버리스 함수의 요청 본문 상한이
 * 4.5MB 라 600dpi 컬러 스캔은 한 번에 보낼 수가 없고, 그대로 보내면 함수에 닿기도 전에
 * 플랫폼이 잘라 화면에 아무 단서도 남지 않는다.
 *
 *   ① `POST .../files`            — 자리를 잡고 `uploadId` 를 받는다 (이 파일)
 *   ② `PUT /api/contract-files/upload/[uploadId]?index=N` — 조각을 하나씩 보낸다
 *   ③ 마지막 조각이 닿으면 서버가 이어 붙이고 `complete=true` 로 올린다
 *
 * 판정(형식·크기·이름)은 `lib/contract-file.ts`(순수 함수, 테스트 있음)에 있다.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { safeName } from "@/lib/contract-file";
import { checkFileSize, chunkCount, CHUNK_SIZE } from "@/lib/upload-chunk";

export const dynamic = "force-dynamic";

/** 목록 — **본문(`data`)은 절대 싣지 않는다**. 한 번 그리는 데 수십 MB 가 딸려 온다 */
const META = { id: true, name: true, mime: true, size: true, note: true, uploadedAt: true };

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const contractId = Number(params.id);
  if (!contractId) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 400 });

  const files = await prisma.contractFile.findMany({
    // **완성된 것만** 낸다 — 올리다 만 파일이 목록에 뜨면 열었을 때 깨진 문서가 나온다
    where: { contractId, complete: true },
    select: META,
    orderBy: { uploadedAt: "asc" },
  });
  return NextResponse.json({ ok: true, files });
}

/**
 * 업로드 시작 — 자리만 잡고 `uploadId` 를 돌려준다.
 *
 * 형식(매직 넘버)은 여기서 못 가린다. 아직 본문이 한 바이트도 안 왔기 때문이다 —
 * **첫 조각이 닿을 때 가려서 아니면 그 자리에서 지운다**(조각 API 참조).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const contractId = Number(params.id);
  if (!contractId) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 400 });

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true },
  });
  if (!contract) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });

  const size = Number(body.size);
  const rawName = String(body.name ?? "");
  const note = String(body.note ?? "").trim() || null;

  const sizeCheck = checkFileSize(size, rawName);
  if (!sizeCheck.ok) return NextResponse.json({ error: sizeCheck.error }, { status: 400 });

  /*
   * 올리다 만 흔적을 치운다. 브라우저를 닫거나 회선이 끊기면 조각만 남는데, 그대로 두면
   * DB 에 쓰레기가 쌓인다. **한 시간을 넘긴 미완성분만** 지운다 — 지금 올리는 중인 것을
   * 건드리면 안 된다(조각은 cascade 로 함께 사라진다).
   */
  await prisma.contractFile
    .deleteMany({
      where: { contractId, complete: false, uploadedAt: { lt: new Date(Date.now() - 3600_000) } },
    })
    .catch(() => {});

  const uploadId = randomUUID();
  const row = await prisma.contractFile.create({
    data: {
      contractId,
      name: safeName(rawName, "application/pdf"), // 형식은 첫 조각에서 가려 다시 맞춘다
      mime: "application/octet-stream",
      size,
      note,
      complete: false,
      uploadId,
    },
    select: { id: true },
  });

  return NextResponse.json({
    ok: true,
    uploadId,
    fileId: row.id,
    chunkSize: CHUNK_SIZE,
    chunks: chunkCount(size),
  });
}
