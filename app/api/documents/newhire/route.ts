import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { genNewHirePackage, pdfResponse } from "@/lib/doc-service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!(await isAuthed())) return new Response("unauthorized", { status: 401 });
  const { employeeId, contractId } = await req.json();
  try {
    const { pdf, filename } = await genNewHirePackage(Number(employeeId), contractId);
    await logActivity({ action: "DOC_ISSUE", target: filename, summary: `신규입사 패키지를 발급했습니다 — ${filename}` });
    return pdfResponse(pdf, filename);
  } catch (e: any) {
    return new Response(e.message, { status: 400 });
  }
}
