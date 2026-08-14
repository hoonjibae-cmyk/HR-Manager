/**
 * 첨부 파일 — **조각내 올리고 이어 붙이는 한 벌**(DB 어댑터).
 *
 * 붙는 자리가 둘이다(계약 서명본 / 직원 서류함). **같은 함수를 쓰게 한 이유**는,
 * 자리마다 따로 두면 한쪽만 고쳐져 언젠가 갈라지기 때문이다 — 조각 이어 붙이기처럼
 * 틀리면 **열리지 않는 파일이 조용히 저장되는** 자리는 특히 그렇다.
 *
 * 판정(조각 경계·크기·형식)은 순수 함수에 있다: `lib/upload-chunk.ts`, `lib/contract-file.ts`.
 */

import { randomUUID } from "crypto";
import { prisma } from "./db";
import { logActivity } from "./activity";
import { checkFormat, safeName, formatSize } from "./contract-file";
import { checkChunk, chunkCount, isLastChunk, checkFileSize, CHUNK_SIZE } from "./upload-chunk";

/** 어디에 붙는 파일인가 */
export type AttachOwner = { kind: "contract"; contractId: number } | { kind: "employee"; employeeId: number };

/** 목록·응답에 싣는 값 — **본문(`data`)은 절대 넣지 않는다** */
export const FILE_META = {
  id: true,
  name: true,
  mime: true,
  size: true,
  note: true,
  uploadedAt: true,
} as const;

const ownerWhere = (o: AttachOwner) =>
  o.kind === "contract" ? { contractId: o.contractId } : { employeeId: o.employeeId };

/** 완성된 첨부만 — 올리다 만 파일이 목록에 뜨면 열었을 때 깨진 문서가 나온다 */
export async function listAttachments(owner: AttachOwner) {
  return prisma.attachedFile.findMany({
    where: { ...ownerWhere(owner), complete: true },
    select: FILE_META,
    orderBy: { uploadedAt: "asc" },
  });
}

export interface BeginResult {
  ok: boolean;
  error?: string;
  uploadId?: string;
  chunkSize?: number;
  chunks?: number;
}

/**
 * 업로드 시작 — 자리만 잡고 `uploadId` 를 돌려준다.
 *
 * 형식은 여기서 못 가린다. 아직 본문이 한 바이트도 안 왔기 때문이다 —
 * **첫 조각이 닿을 때 가려서 아니면 그 자리에서 지운다**(`receiveChunk`).
 */
export async function beginUpload(
  owner: AttachOwner,
  file: { name: string; size: number; note?: string | null }
): Promise<BeginResult> {
  const sizeCheck = checkFileSize(file.size, file.name);
  if (!sizeCheck.ok) return { ok: false, error: sizeCheck.error };

  /*
   * 올리다 만 흔적을 치운다. 브라우저를 닫거나 회선이 끊기면 조각만 남는데 그대로 두면
   * DB 에 쓰레기가 쌓인다. **한 시간을 넘긴 미완성분만** 지운다 — 지금 올리는 중인 것을
   * 건드리면 안 된다(조각은 cascade 로 함께 사라진다).
   */
  await prisma.attachedFile
    .deleteMany({
      where: { ...ownerWhere(owner), complete: false, uploadedAt: { lt: new Date(Date.now() - 3600_000) } },
    })
    .catch(() => {});

  const uploadId = randomUUID();
  await prisma.attachedFile.create({
    data: {
      ...ownerWhere(owner),
      name: safeName(file.name, "application/octet-stream"),
      mime: "application/octet-stream", // 형식은 첫 조각에서 가려 다시 맞춘다
      size: file.size,
      note: file.note?.trim() || null,
      complete: false,
      uploadId,
    },
    select: { id: true },
  });

  return { ok: true, uploadId, chunkSize: CHUNK_SIZE, chunks: chunkCount(file.size) };
}

export interface ChunkResult {
  ok: boolean;
  status?: number;
  error?: string;
  done?: boolean;
  file?: { id: number; name: string; mime: string; size: number; note: string | null; uploadedAt: Date };
}

/**
 * 조각 하나를 받는다. **마지막 조각이면 여기서 이어 붙이고 완성 처리까지 한다** —
 * 마무리용 API 를 따로 두면 브라우저가 그걸 못 부르고 끝났을 때 파일이 영영 미완성으로 남는다.
 */
export async function receiveChunk(
  uploadId: string,
  index: number,
  bytes: Uint8Array
): Promise<ChunkResult> {
  // uploadId 에 유니크를 걸지 않았으므로(스키마 주석) findFirst 로 찾는다.
  // 아직 올리는 중인 것만 본다 — 완성된 행의 uploadId 는 비워 두므로 걸릴 일이 없다.
  const file = await prisma.attachedFile.findFirst({
    where: { uploadId, complete: false },
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
  if (!file) return { ok: false, status: 404, error: "업로드를 찾을 수 없습니다." };

  const pos = checkChunk(index, bytes.byteLength, file.size);
  if (!pos.ok) return { ok: false, status: 400, error: pos.error };

  /*
   * **형식은 첫 조각에서 가린다.** 앞머리(매직 넘버)가 거기 있고, 여기서 가려야 나머지
   * 수십 MB 를 헛되이 올리지 않는다.
   *
   * 못 가린 형식도 **받는다** — 인사서류는 hwp·docx 처럼 앞머리로 못 가리는 것이 흔하다.
   * 대신 `application/octet-stream` 으로 담아 열 때 **브라우저에 렌더시키지 않고 내려받게**
   * 한다(모르는 것을 inline 으로 내보내면 그 자체가 위험하다).
   */
  if (index === 0) {
    const check = checkFormat(bytes, file.name);
    const mime = check.ok && check.mime ? check.mime : "application/octet-stream";
    await prisma.attachedFile.update({
      where: { id: file.id },
      data: { mime, name: safeName(file.name, mime) },
    });
  }

  // 같은 조각을 두 번 보내도(재시도) 덮어쓰기만 한다 — 이어 붙일 때 겹치지 않는다
  await prisma.attachedFileChunk.upsert({
    where: { fileId_index: { fileId: file.id, index } },
    update: { data: Buffer.from(bytes) },
    create: { fileId: file.id, index, data: Buffer.from(bytes) },
  });

  if (!isLastChunk(pos.start!, bytes.byteLength, file.size)) return { ok: true };

  /* ───────── 마지막 조각 — 이어 붙여 완성한다 ───────── */

  const want = chunkCount(file.size);
  const have = await prisma.attachedFileChunk.count({ where: { fileId: file.id } });
  if (have !== want)
    // 중간 조각이 빠졌다. 이대로 이어 붙이면 **열리지 않는 파일이 조용히 저장된다**
    return { ok: false, status: 409, error: `조각이 모자랍니다 (${have}/${want}). 다시 올려 주세요.` };

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
  await prisma.attachedFileChunk.deleteMany({ where: { fileId: file.id } });

  const saved = await prisma.attachedFile.findUnique({
    where: { id: file.id },
    select: FILE_META,
  });

  const who = file.contract?.employee?.name ?? file.employee?.name ?? "";
  await logActivity({
    action: file.contractId ? "CONTRACT_FILE_ADD" : "EMPLOYEE_FILE_ADD",
    employeeId: file.employeeId ?? file.contract?.employeeId ?? null,
    target: who,
    summary: file.contractId
      ? `계약(#${file.contractId})에 서명본 스캔을 첨부했습니다 — ${saved?.name} (${formatSize(file.size)})`
      : `${who} 서류함에 파일을 올렸습니다 — ${saved?.name} (${formatSize(file.size)})`,
    meta: { contractId: file.contractId, name: saved?.name, size: file.size, chunks: want },
  }).catch(() => {});

  return { ok: true, done: true, file: saved as any };
}

/** 올리다 그만둘 때 — 자리와 조각을 치운다 (완성된 파일은 건드리지 않는다) */
export async function abortUpload(uploadId: string) {
  const row = await prisma.attachedFile.findFirst({
    where: { uploadId, complete: false },
    select: { id: true },
  });
  if (row) await prisma.attachedFile.delete({ where: { id: row.id } });
}
