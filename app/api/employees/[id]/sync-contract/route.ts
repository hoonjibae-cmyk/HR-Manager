import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { forceSyncActiveContract } from "@/lib/contract-sync";

export const dynamic = "force-dynamic";

/** 직원 카드의 보수조건을 진행 중(ACTIVE) 계약서에 반영 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const res = await forceSyncActiveContract(Number(params.id));
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
