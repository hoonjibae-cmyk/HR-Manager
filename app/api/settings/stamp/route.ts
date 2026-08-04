// 법인 인감(직인) 업로드 — 로고와 같은 방식(data URI, lib/company-image.ts)
//
// 등록하면 계약서 "갑" 의 대표자 칸과 재직·경력증명서의 대표이사 옆에 자동으로 찍힌다.
// 지우면 예전처럼 `(인)`·`(직인)` 글자만 남아 종이에 손도장을 찍을 자리가 된다.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { checkDataUrl } from "@/lib/company-image";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  const dataUrl = String(b.dataUrl || "");

  const chk = checkDataUrl(dataUrl);
  if (!chk.ok) return NextResponse.json({ error: chk.error }, { status: 400 });

  await prisma.company.upsert({
    where: { id: 1 },
    update: { stamp: dataUrl },
    create: { id: 1, stamp: dataUrl },
  });
  // 도장은 문서의 효력에 직결되므로 언제 바뀌었는지 남긴다 (이미지 자체는 남기지 않는다)
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: "법인 인감",
    summary: `법인 인감을 등록했습니다 (${chk.mime}, ${Math.round(chk.bytes / 1024)}KB). 이후 발급되는 계약서·증명서에 찍힙니다.`,
  });
  return NextResponse.json({ ok: true, bytes: chk.bytes });
}

export async function DELETE() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await prisma.company.updateMany({ where: { id: 1 }, data: { stamp: null } });
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: "법인 인감",
    summary: "법인 인감을 삭제했습니다. 이후 문서에는 (인)·(직인) 글자만 찍힙니다.",
  });
  return NextResponse.json({ ok: true });
}
