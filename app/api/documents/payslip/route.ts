import { isAuthed } from "@/lib/auth";
import { genPayslip, pdfResponse } from "@/lib/doc-service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!(await isAuthed())) return new Response("unauthorized", { status: 401 });
  const { payrollId } = await req.json();
  try {
    const { pdf, filename } = await genPayslip(Number(payrollId));
    return pdfResponse(pdf, filename);
  } catch (e: any) {
    return new Response(e.message, { status: 400 });
  }
}
