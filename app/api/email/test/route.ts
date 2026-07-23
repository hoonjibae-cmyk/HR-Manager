import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { sendTestEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { to } = await req.json();
  try {
    await sendTestEmail(to);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
