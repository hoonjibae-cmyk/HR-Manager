import { prisma } from "@/lib/db";
import { verifyDocToken } from "@/lib/vacation-token";
import { pdfHeaders, submissionPdf } from "@/lib/vacation-service";

export const dynamic = "force-dynamic";

/**
 * 직원 본인 문서 내려받기 — 슬랙 *문서 받기* 가 본인 DM 으로 준 15분짜리 서명 링크.
 * 토큰만 믿지 않고 **제출의 주인이 그 슬랙 사용자인지 DB 에서 다시 대조**한다.
 */
export async function GET(req: Request) {
  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  const t = new URL(req.url).searchParams.get("t");
  const claims = secret.length >= 32 ? verifyDocToken(t, secret) : null;
  const deny = (msg: string, status = 403) =>
    new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  if (!claims) return deny("링크가 만료되었거나 올바르지 않습니다. 슬랙 DM 의 '문서 받기' 버튼을 다시 눌러 주세요.");
  const sub = await prisma.vacationSubmission.findUnique({ where: { id: claims.sid }, include: { employee: true } });
  if (!sub || sub.employee?.slackUserId !== claims.u) return deny("본인 문서만 열 수 있습니다.");
  try {
    const { pdf, filename } = await submissionPdf(sub.id);
    return new Response(new Uint8Array(pdf), { headers: pdfHeaders(filename) });
  } catch {
    return deny("PDF 를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요 — 제출 내용에는 영향이 없습니다.", 500);
  }
}
