import { logActivity } from "@/lib/activity";
import { genCertificate, pdfResponse } from "@/lib/doc-service";
import { authenticatedPortalStaff } from "@/lib/portal-staff-request";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const auth = await authenticatedPortalStaff(req, "hr:certificate");
  if (!auth)
    return Response.json(
      { error: "직원 권한을 확인할 수 없습니다." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  const { employee, claims } = auth;
  const size = Number(req.headers.get("content-length") || 0);
  if (size > 8_192) return new Response("입력 내용이 너무 깁니다.", { status: 413 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const purpose = typeof body?.purpose === "string" ? body.purpose.trim().slice(0, 100) : "";
  try {
    const { pdf, filename } = await genCertificate(employee.id, "CERT_EMPLOYMENT", {
      purpose: purpose || "제출용",
    });
    await logActivity({
      action: "DOC_ISSUE",
      actor: "PORTAL",
      actorName: employee.name,
      employeeId: employee.id,
      target: filename,
      summary: `${employee.name}님이 포털에서 본인의 재직증명서를 발급했습니다.`,
      meta: { slackUserId: claims.slackUserId, purpose: purpose || "제출용" },
    });
    const response = pdfResponse(pdf, filename);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "재직증명서를 발급하지 못했습니다.";
    return Response.json(
      { error: message },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
