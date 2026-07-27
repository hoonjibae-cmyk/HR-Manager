import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { genContract, pdfResponse } from "@/lib/doc-service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!(await isAuthed())) return new Response("unauthorized", { status: 401 });
  const { contractId } = await req.json();
  try {
    const { pdf, filename } = await genContract(Number(contractId));
    await logActivity({ action: "DOC_ISSUE", target: filename, summary: `계약서를 발급했습니다 — ${filename}` });
    return pdfResponse(pdf, filename);
  } catch (e: any) {
    return new Response(e.message, { status: 400 });
  }
}
