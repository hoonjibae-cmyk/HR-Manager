/**
 * 첨부 파일 — **조각 받기** (계약 서명본·직원 서류함 공통).
 *
 * 브라우저가 파일을 `CHUNK_SIZE` 씩 잘라 `?index=N` 으로 하나씩 보낸다.
 * 조각 하나는 Vercel 요청 본문 상한(4.5MB) 안쪽이라 파일이 몇십 MB 든 통과한다.
 *
 * 실제 처리는 `lib/attachment-service.ts` 한곳에 있다 — 붙는 자리마다 따로 두면
 * 한쪽만 고쳐져 언젠가 갈라진다.
 */

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { receiveChunk, abortUpload } from "@/lib/attachment-service";

export const dynamic = "force-dynamic";
// 조각 하나는 몇 MB 라 느린 회선에서는 기본 시간을 넘길 수 있다
export const maxDuration = 60;

export async function PUT(req: Request, { params }: { params: { uploadId: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const index = Number(new URL(req.url).searchParams.get("index"));
  const bytes = new Uint8Array(await req.arrayBuffer());
  const r = await receiveChunk(String(params.uploadId ?? ""), index, bytes);

  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
  return NextResponse.json({ ok: true, done: !!r.done, file: r.file });
}

/** 올리다 그만둘 때 — 자리와 조각을 치운다 */
export async function DELETE(_req: Request, { params }: { params: { uploadId: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await abortUpload(String(params.uploadId ?? ""));
  return NextResponse.json({ ok: true });
}
