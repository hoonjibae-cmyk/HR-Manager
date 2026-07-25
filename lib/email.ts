import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "./db";
import { genPayslip } from "./doc-service";

let _transporter: Transporter | null = null;

export function getTransporter(): Transporter | null {
  if (_transporter) return _transporter;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  _transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return _transporter;
}

export function mailFrom(): string {
  return process.env.MAIL_FROM || "주식회사 유쌤에듀 <no-reply@yoossam.edu>";
}

export async function sendTestEmail(to: string) {
  const t = getTransporter();
  if (!t) throw new Error("SMTP가 설정되지 않았습니다 (.env SMTP_HOST)");
  await t.sendMail({
    from: mailFrom(),
    to,
    subject: "[유쌤에듀 HR] 테스트 메일",
    text: "유쌤에듀 HR 관리 프로그램의 SMTP 설정이 정상적으로 동작합니다.",
  });
}

/**
 * 특정 월의 급여명세서를 대상 직원 이메일로 발송.
 * 이미 발송(SENT)된 기록은 제외 — 재클릭 시 중복 발송을 막고,
 * 발송 성공한 기록은 SENT 로 전환되어 자동 잠금(재계산·공제수정 불가)된다.
 */
export async function sendPayslipsForMonth(year: number, month: number) {
  const t = getTransporter();
  if (!t) throw new Error("SMTP가 설정되지 않았습니다 (.env SMTP_HOST)");

  const [recs, skippedSent] = await Promise.all([
    prisma.payrollRecord.findMany({
      where: { year, month, status: { not: "SENT" } },
      include: { employee: true },
    }),
    prisma.payrollRecord.count({ where: { year, month, status: "SENT" } }),
  ]);

  let sent = 0;
  let failed = 0;
  const results: { name: string; ok: boolean; error?: string }[] = [];

  for (const r of recs) {
    const to = r.employee.email;
    const log = await prisma.emailLog.create({
      data: {
        to: to || "(없음)",
        subject: `[${r.employee.name}] ${year}년 ${month}월 급여명세서`,
        status: "PENDING",
        payrollId: r.id,
      },
    });
    if (!to) {
      failed++;
      await prisma.emailLog.update({ where: { id: log.id }, data: { status: "FAILED", error: "이메일 주소 없음" } });
      results.push({ name: r.employee.name, ok: false, error: "이메일 없음" });
      continue;
    }
    try {
      const { pdf, filename } = await genPayslip(r.id);
      const isFree = r.incomeType === "FREELANCE";
      await t.sendMail({
        from: mailFrom(),
        to,
        subject: `[${process.env.COMPANY_NAME || "주식회사 유쌤에듀"}] ${year}년 ${month}월 ${isFree ? "사업소득 지급명세서" : "급여명세서"}`,
        text: `${r.employee.name}님, ${year}년 ${month}월 ${isFree ? "사업소득 지급" : "급여"}명세서를 첨부드립니다.\n실수령액: ${r.net.toLocaleString()}원\n\n주식회사 유쌤에듀 드림`,
        attachments: [{ filename, content: pdf }],
      });
      sent++;
      await prisma.$transaction([
        prisma.emailLog.update({ where: { id: log.id }, data: { status: "SENT", sentAt: new Date() } }),
        prisma.payrollRecord.update({ where: { id: r.id }, data: { status: "SENT", emailedAt: new Date() } }),
      ]);
      results.push({ name: r.employee.name, ok: true });
    } catch (e: any) {
      failed++;
      await prisma.emailLog.update({ where: { id: log.id }, data: { status: "FAILED", error: String(e.message) } });
      results.push({ name: r.employee.name, ok: false, error: e.message });
    }
  }

  return { sent, failed, total: recs.length, skippedSent, results };
}
