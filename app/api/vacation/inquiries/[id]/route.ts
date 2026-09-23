import { isAuthed, currentHrUser } from "@/lib/auth";
import { answerInquiry } from "@/lib/vacation-service";

export const dynamic = "force-dynamic";

/** 「안내 내용 확인 요청」에 답변 — 직원에게 DM 으로 간다 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const me = await currentHrUser();
  try {
    const body = await req.json();
    await answerInquiry(Number(params.id), String(body.answer ?? ""), { kind: "ADMIN", name: me!.name });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
