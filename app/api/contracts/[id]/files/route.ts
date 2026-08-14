/**
 * 계약서 **서명본 스캔** 첨부 — 목록·업로드.
 *
 * 판정(형식·크기·이름)은 `lib/contract-file.ts`(순수 함수, 테스트 있음)에 있고
 * 여기서는 읽고 저장하고 기록만 한다.
 *
 * 파일 본문 조회·삭제는 `/api/contract-files/[fileId]` 가 맡는다 — 계약 밑에 두면
 * 파일 하나를 열 때마다 계약 번호를 함께 알아야 해서 링크가 길어진다.
 */

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { checkUpload, safeName, formatSize } from "@/lib/contract-file";
import {
  driveConfigured,
  uploadToDrive,
  employeeFolderName,
  driveFileName,
} from "@/lib/gdrive";

export const dynamic = "force-dynamic";
// 스캔본은 수 MB 라 업로드가 기본 시간 안에 안 끝나는 회선이 있다
export const maxDuration = 60;

/** 목록 — **본문(`data`)은 절대 싣지 않는다**. 한 번 그리는 데 수 MB 가 딸려 온다 */
const META = {
  id: true,
  name: true,
  mime: true,
  size: true,
  note: true,
  uploadedAt: true,
  storage: true,
  driveWebLink: true,
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const contractId = Number(params.id);
  if (!contractId) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 400 });

  const files = await prisma.contractFile.findMany({
    where: { contractId },
    select: META,
    orderBy: { uploadedAt: "asc" },
  });
  return NextResponse.json({ ok: true, files });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const contractId = Number(params.id);
  if (!contractId) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 400 });

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      employeeId: true,
      startDate: true,
      employee: { select: { name: true, empNo: true } },
    },
  });
  if (!contract) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "파일을 읽지 못했습니다." }, { status: 400 });

  // 여러 장을 한 번에 고를 수 있다 — 계약서·별지·확인서가 따로 스캔돼 오는 일이 잦다
  const picked = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!picked.length) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  const note = String(form.get("note") ?? "").trim() || null;

  const saved: Array<{ id: number; name: string; size: number; storage: string }> = [];
  const failed: string[] = [];
  /**
   * 드라이브가 설정돼 있는데 실패했을 때의 사유.
   *
   * **실패해도 DB 로 받아 둔다** — 여기서 거절하면 담당자는 스캔본을 아예 보관하지 못한다.
   * 대신 조용히 넘어가지 않고 무슨 일이 있었는지 화면에 돌려준다(안 그러면 드라이브에
   * 파일이 없는 이유를 아무도 모른 채 몇 달이 지난다).
   */
  let driveFallback: string | null = null;
  const useDrive = driveConfigured();
  const folderName = employeeFolderName({
    empNo: contract.employee?.empNo,
    name: contract.employee?.name ?? String(contract.employeeId),
  });
  const startYmd = contract.startDate.toISOString().slice(0, 10);

  for (const f of picked) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const check = checkUpload(bytes, f.name);
    if (!check.ok || !check.mime) {
      failed.push(`${f.name || "(이름 없음)"} — ${check.error}`);
      continue;
    }
    const name = safeName(f.name, check.mime);

    let store: any = { storage: "DB", data: Buffer.from(bytes) };
    if (useDrive) {
      const up = await uploadToDrive({
        name: driveFileName(startYmd, name),
        mime: check.mime,
        bytes,
        folderName,
      });
      if (up.ok) {
        store = { storage: "DRIVE", driveFileId: up.fileId, driveWebLink: up.webViewLink ?? null };
      } else {
        driveFallback = up.error ?? "구글 드라이브에 올리지 못했습니다.";
      }
    }

    const row = await prisma.contractFile.create({
      data: { contractId, name, mime: check.mime, size: bytes.byteLength, note, ...store },
      select: { id: true, name: true, size: true, storage: true },
    });
    saved.push(row);
  }

  // **한 장도 못 올렸으면 실패로 답한다** — 화면이 성공으로 읽고 목록만 비어 있으면
  // 무엇이 잘못됐는지 알 수가 없다.
  if (!saved.length)
    return NextResponse.json({ error: failed.join("\n") || "저장하지 못했습니다." }, { status: 400 });

  await logActivity({
    action: "CONTRACT_FILE_ADD",
    employeeId: contract.employeeId,
    target: contract.employee?.name ?? String(contract.employeeId),
    summary:
      `계약(#${contractId})에 서명본 스캔 ${saved.length}건을 첨부했습니다 — ` +
      saved.map((s) => `${s.name}(${formatSize(s.size)}·${s.storage})`).join(", ") +
      (driveFallback ? " ※ 드라이브 업로드 실패로 DB 에 보관했습니다." : ""),
    meta: { contractId, files: saved, failed, driveFallback },
  }).catch(() => {});

  const files = await prisma.contractFile.findMany({
    where: { contractId },
    select: META,
    orderBy: { uploadedAt: "asc" },
  });
  return NextResponse.json({ ok: true, added: saved.length, failed, driveFallback, files });
}
