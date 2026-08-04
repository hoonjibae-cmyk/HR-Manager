import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { checkDataUrl } from "@/lib/company-image";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const dataUrl = String(b.dataUrl || "");

  const chk = checkDataUrl(dataUrl);
  if (!chk.ok) return NextResponse.json({ error: chk.error }, { status: 400 });

  await prisma.company.upsert({
    where: { id: 1 },
    update: { logo: dataUrl },
    create: { id: 1, logo: dataUrl },
  });
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: "학원 로고",
    summary: `학원 로고를 등록했습니다 (${chk.mime}, ${Math.round(chk.bytes / 1024)}KB).`,
  });
  return NextResponse.json({ ok: true, bytes: chk.bytes });
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
