import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { approveLeaveRequest, rejectLeaveRequest } from "@/lib/leave-service";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { action, note } = await req.json();
  try {
    if (action === "approve") {
      await approveLeaveRequest(Number(params.id));
    } else if (action === "reject") {
      await rejectLeaveRequest(Number(params.id), "admin", note || "");
    } else {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
