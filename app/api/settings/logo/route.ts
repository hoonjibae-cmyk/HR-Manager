import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** data URI 로 저장한다 — 서버리스에는 쓸 수 있는 파일 경로가 없고, 문서 PDF 도 그대로 <img> 에 쓴다 */
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
/** DB 한 칸에 담기므로 넉넉하되 상한을 둔다 (화면에서 미리 줄여 보내면 보통 30KB 내외) */
const MAX_BYTES = 400_000;

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const dataUrl = String(b.dataUrl || "");

  const m = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!m)
    return NextResponse.json(
      { error: "이미지를 읽지 못했습니다. PNG · JPG · SVG 파일을 올려 주세요." },
      { status: 400 }
    );
  const [, mime, b64] = m;
  if (!ALLOWED.includes(mime.toLowerCase()))
    return NextResponse.json(
      { error: `지원하지 않는 형식입니다 (${mime}). PNG · JPG · WEBP · SVG 만 됩니다.` },
      { status: 400 }
    );
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > MAX_BYTES)
    return NextResponse.json(
      { error: `파일이 너무 큽니다 (${Math.round(bytes / 1024)}KB). 400KB 이하로 줄여 주세요.` },
      { status: 400 }
    );

  await prisma.company.upsert({
    where: { id: 1 },
    update: { logo: dataUrl },
    create: { id: 1, logo: dataUrl },
  });
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: "학원 로고",
    summary: `학원 로고를 등록했습니다 (${mime}, ${Math.round(bytes / 1024)}KB).`,
  });
  return NextResponse.json({ ok: true, bytes });
}

export async function DELETE() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await prisma.company.updateMany({ where: { id: 1 }, data: { logo: null } });
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: "학원 로고",
    summary: "학원 로고를 삭제했습니다.",
  });
  return NextResponse.json({ ok: true });
}
