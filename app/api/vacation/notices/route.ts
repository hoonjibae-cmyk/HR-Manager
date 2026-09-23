import { isAuthed, currentHrUser } from "@/lib/auth";
import { createNotice, listNotices } from "@/lib/vacation-service";

export const dynamic = "force-dynamic";

/** 방학 근무·연차 공고 목록 / 새 공고(초안) */
export async function GET() {
  if (!(await isAuthed())) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ notices: await listNotices() });
}

export async function POST() {
  if (!(await isAuthed())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const me = await currentHrUser();
  const n = await createNotice({ kind: "ADMIN", name: me!.name });
  return Response.json({ id: n.id });
}
