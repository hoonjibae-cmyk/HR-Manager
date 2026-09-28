import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCompany } from "@/lib/repo";
import { htmlToPdf } from "@/lib/pdf";
import { LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL } from "@/lib/constants";
import { consentRecordHtml, parseConsentRecord } from "@/lib/leave-overdraft";
import { recordHash } from "@/lib/vacation-hash";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * 연차 초과사용 급여공제 동의 기록 PDF (관리자) — 신청 순간 저장한 원문을 그대로 옮긴다.
 * 무결성 점검값은 저장된 지문을 싣되, 지금 기록으로 다시 계산한 값과 다르면 문서에 그 사실을 밝힌다.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await isAuthed())) return new Response("unauthorized", { status: 401 });
  const id = Number(params.id);
  const r = await prisma.leaveRequest.findUnique({ where: { id }, include: { employee: true } });
  if (!r || !r.overdraftConsentAt) return new Response("동의 기록이 있는 신청이 아닙니다.", { status: 404 });
  try {
    const record = parseConsentRecord(r.overdraftConsent);
    const intact = record && r.overdraftConsentHash ? recordHash(record) === r.overdraftConsentHash : null;
    const company = await getCompany();
    let html = consentRecordHtml({
      companyName: company.name,
      requestId: r.id,
      status: LEAVE_STATUS_LABEL[r.status] ?? r.status,
      record,
      hash: r.overdraftConsentHash,
      legacy: record
        ? undefined
        : {
            agreedAt: r.overdraftConsentAt,
            after: r.overdraftAfter,
            employeeName: r.employee.name,
            department: r.employee.department,
            typeLabel: LEAVE_TYPE_LABEL[r.leaveType] ?? r.leaveType,
            start: r.startDate,
            end: r.endDate,
            days: r.days,
            source: r.source,
          },
      printedAt: new Date(),
    });
    if (intact === false)
      html += `<p class="small" style="color:#b91c1c">⚠ 저장된 기록을 다시 계산한 점검값이 저장 당시 값과 다릅니다 — 기록이 저장 뒤 바뀌었을 수 있습니다.</p>`;
    const pdf = await htmlToPdf(html);
    await logActivity({
      action: "DOC_ISSUE",
      employeeId: r.employeeId,
      target: r.employee.name,
      summary: `${r.employee.name} 연차 초과사용 동의 기록(신청 ${r.id}) 출력`,
      meta: { requestId: r.id },
    });
    const name = `연차초과사용동의_${r.employee.name}_${r.startDate.toISOString().slice(0, 10)}.pdf`;
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return new Response(`PDF 를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요. (${e instanceof Error ? e.message : String(e)})`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
