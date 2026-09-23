import { isAuthed } from "@/lib/auth";
import { pdfHeaders, submissionPdf } from "@/lib/vacation-service";

export const dynamic = "force-dynamic";

/**
 * 제출 원문 PDF (관리자) — 저장된 원문을 그대로 렌더한다. 실패해도 제출·차감에 영향이 없고
 * 다시 누르면 된다(실패를 성공으로 보이지 않게 오류를 그대로 돌려준다).
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return new Response("unauthorized", { status: 401 });
  try {
    const { pdf, filename } = await submissionPdf(Number(params.id));
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(pdf), { headers: pdfHeaders(filename, download ? "attachment" : "inline") });
  } catch (e) {
    return new Response(`PDF 를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요. (${e instanceof Error ? e.message : String(e)})`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
