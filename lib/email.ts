import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "./db";
import { genPayslip } from "./doc-service";
import { ymd } from "./format";
import { planPayslipSend } from "./payslip-send";

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
 *
 * `payrollIds` 를 주면 **그 기록만** 보낸다(급여 화면의 선택 발송). 한 사람만 정정본을
 * 다시 보내거나, 메일 주소 오류로 실패한 건만 재시도할 때 쓴다 — 그때마다 전체 발송을
 * 누르게 하면 잠금이 풀려 있는 다른 사람에게까지 다시 나간다.
 *
 * ⚠ **연·월 조건을 함께 건다** — id 만 믿으면 화면이 8월을 보고 있는데 7월 기록 id 가
 * 넘어왔을 때 그대로 나간다. 대상 판정은 화면과 **같은 함수**(`planPayslipSend`)를 쓴다.
 */
export async function sendPayslipsForMonth(
  year: number,
  month: number,
  opts: { payrollIds?: number[] | null } = {}
) {
  const t = getTransporter();
  if (!t) throw new Error("SMTP가 설정되지 않았습니다 (.env SMTP_HOST)");

  const ids = opts.payrollIds ?? null;
  // 빈 배열은 '아무도 안 고름' 이다 — 전체로 읽으면 실수가 전 직원 발송이 된다
  if (ids && ids.length === 0)
    return { sent: 0, failed: 0, total: 0, skippedSent: 0, skippedSentNames: [], noEmailNames: [], results: [] };

  const all = await prisma.payrollRecord.findMany({
    where: { year, month, ...(ids ? { id: { in: ids } } : {}) },
    include: { employee: true },
  });

  const plan = planPayslipSend(
    all.map((r) => ({ id: r.id, name: r.employee.name, email: r.employee.email, status: r.status }))
  );
  const sendable = new Set(plan.targets.map((r) => r.id));
  // 메일 주소가 없는 건도 예전처럼 실패로 기록해 남긴다(조용히 빠지면 아무도 모른다)
  const recs = all.filter((r) => sendable.has(r.id) || plan.noEmail.some((n) => n.id === r.id));
  const skippedSent = plan.alreadySent.length;

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
      const docName = isFree ? "사업소득 지급명세서" : "급여명세서";
      // 잠금을 풀고 고쳐 다시 보내는 건이면 앞서 받은 것과 구분되게 알린다 —
      // 정정본이라고 말해 주지 않으면 직원 메일함에 같은 달 명세서가 두 통 남아
      // 어느 것이 최종본인지 알 수 없다.
      const fix = r.reissueCount > 0;
      const firstSent = r.firstSentAt ?? r.emailedAt;
      await t.sendMail({
        from: mailFrom(),
        to,
        subject: `${fix ? "[정정] " : ""}[${process.env.COMPANY_NAME || "주식회사 유쌤에듀"}] ${year}년 ${month}월 ${docName}`,
        text:
          (fix
            ? `${r.employee.name}님, 앞서 보내드린 ${year}년 ${month}월 ${docName}에 정정할 내용이 있어 다시 보내드립니다.\n` +
              `본 메일에 첨부된 것이 최종본이며, 이전 메일의 명세서는 무효입니다.\n` +
              (firstSent ? `최초 발급일: ${ymd(firstSent)}\n` : "") +
              `\n실수령액: ${r.net.toLocaleString()}원\n\n주식회사 유쌤에듀 드림`
            : `${r.employee.name}님, ${year}년 ${month}월 ${isFree ? "사업소득 지급" : "급여"}명세서를 첨부드립니다.\n` +
              `실수령액: ${r.net.toLocaleString()}원\n\n주식회사 유쌤에듀 드림`),
        attachments: [{ filename, content: pdf }],
      });
      sent++;
      await prisma.$transaction([
        prisma.emailLog.update({ where: { id: log.id }, data: { status: "SENT", sentAt: new Date() } }),
        prisma.payrollRecord.update({
          where: { id: r.id },
          data: {
            status: "SENT",
            emailedAt: new Date(),
            // 최초 발송 시각은 처음 한 번만 새긴다 (정정본에 '최초 발급일' 로 찍힌다)
            ...(r.firstSentAt ? {} : { firstSentAt: new Date() }),
          },
        }),
      ]);
      results.push({ name: r.employee.name, ok: true });
    } catch (e: any) {
      failed++;
      await prisma.emailLog.update({ where: { id: log.id }, data: { status: "FAILED", error: String(e.message) } });
      results.push({ name: r.employee.name, ok: false, error: e.message });
    }
  }

  // **누가 빠졌는지 이름까지 돌려준다** — 인원수만 주면 화면이 "1건 제외" 라고만 적게 되고,
  // 정정본을 다시 보내려던 사람이 잠겨서 빠진 것을 눌러 본 뒤에도 알 수 없다.
  return {
    sent,
    failed,
    total: recs.length,
    skippedSent,
    skippedSentNames: plan.alreadySent.map((r) => r.name),
    noEmailNames: plan.noEmail.map((r) => r.name),
    selective: !!ids,
    results,
  };
}
