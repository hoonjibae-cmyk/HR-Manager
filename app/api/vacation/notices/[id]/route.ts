import { isAuthed, currentHrUser } from "@/lib/auth";
import {
  deleteDraftNotice,
  draftContent,
  noticeDashboard,
  previewContent,
  publishNotice,
  recordReview,
  remindNonResponders,
  reviseNotice,
  saveDraft,
  setNoticeStatus,
} from "@/lib/vacation-service";
import { parseContent } from "@/lib/vacation";

export const dynamic = "force-dynamic";

async function admin() {
  if (!(await isAuthed())) return null;
  const me = await currentHrUser();
  return me ? { kind: "ADMIN" as const, name: me.name } : null;
}

const bad = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** 공고 현황 + 초안(있으면) */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await admin())) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const id = Number(params.id);
    const [dashboard, draft] = await Promise.all([noticeDashboard(id), draftContent(id)]);
    return Response.json({ dashboard, draft });
  } catch (e) {
    return bad(e, 404);
  }
}

/** 초안 저장 — 게시한 판은 고치지 않는다 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await admin())) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const content = await saveDraft(Number(params.id), parseContent(JSON.stringify(body.content ?? {})));
    return Response.json({ content });
  } catch (e) {
    return bad(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await admin())) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    await deleteDraftNotice(Number(params.id));
    return Response.json({ ok: true });
  } catch (e) {
    return bad(e, 409);
  }
}

/**
 * 동작: preview(발행 전 점검) · publish(발행 — 운영 사실 확인 필수) · revise(수정본 만들기) ·
 * close(마감) · reopen(다시 게시 중으로) · archive(보관) · remind(미응답자 확인 요청) ·
 * review(사실 확인 결과 기록) · workNotProvided(정상근무 제공 불가 기록)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await admin();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "preview": {
        const content = body.content ? parseContent(JSON.stringify(body.content)) : (await draftContent(id))?.content;
        if (!content) return bad("점검할 초안이 없습니다.");
        return Response.json(await previewContent(content));
      }
      case "publish":
        return Response.json(await publishNotice(id, body.attest ?? {}, actor));
      case "revise":
        await reviseNotice(id, actor);
        return Response.json({ ok: true });
      case "close":
        await setNoticeStatus(id, "CLOSED", actor);
        return Response.json({ ok: true });
      case "reopen":
        await setNoticeStatus(id, "PUBLISHED", actor);
        return Response.json({ ok: true });
      case "archive":
        await setNoticeStatus(id, "ARCHIVED", actor);
        return Response.json({ ok: true });
      case "remind":
        return Response.json(await remindNonResponders(id, actor));
      case "review":
        await recordReview(id, { type: "REVIEW_RESOLVED", date: String(body.date), employeeId: Number(body.employeeId) || null, kind: String(body.kind ?? ""), note: String(body.note ?? "") }, actor);
        return Response.json({ ok: true });
      case "workNotProvided":
        await recordReview(id, { type: "WORK_NOT_PROVIDED", date: String(body.date), note: String(body.note ?? "") }, actor);
        return Response.json({ ok: true });
      default:
        return bad("알 수 없는 동작입니다.");
    }
  } catch (e) {
    return bad(e);
  }
}
