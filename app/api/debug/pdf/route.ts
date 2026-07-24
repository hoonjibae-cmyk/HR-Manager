import { htmlToPdf } from "@/lib/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 실제 htmlToPdf 경로(폰트 임베드 + 서버리스 브라우저)를 테스트. 확인 후 제거 예정.
export async function GET() {
  const t0 = Date.now();
  try {
    const pdf = await htmlToPdf(
      `<div class="doc-title">테스트 급여명세서</div>
       <table class="pay"><thead><tr><th>임금 항목</th><th>지급 금액</th></tr></thead>
       <tbody><tr><td>기본급</td><td class="num">5,000,000</td></tr>
       <tr class="total"><td>실수령액</td><td class="num">4,835,000</td></tr></tbody></table>`
    );
    return Response.json({
      ok: true,
      ms: Date.now() - t0,
      bytes: pdf.length,
      node: process.version,
    });
  } catch (e: any) {
    return Response.json({
      ok: false,
      ms: Date.now() - t0,
      error: String(e?.message || e),
      stack: String(e?.stack || "").split("\n").slice(0, 8),
    });
  }
}
