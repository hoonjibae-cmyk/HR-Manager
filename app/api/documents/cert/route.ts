import { isAuthed } from "@/lib/auth";
import { genCertificate, pdfResponse } from "@/lib/doc-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await isAuthed())) return new Response("unauthorized", { status: 401 });
  const { employeeId, type, purpose } = await req.json();
  if (type !== "CERT_EMPLOYMENT" && type !== "CERT_CAREER")
    return new Response("invalid type", { status: 400 });
  try {
    const { pdf, filename } = await genCertificate(Number(employeeId), type, { purpose });
    return pdfResponse(pdf, filename);
  } catch (e: any) {
    return new Response(e.message, { status: 400 });
  }
}
