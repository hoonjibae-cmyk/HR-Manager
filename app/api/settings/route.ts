import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { invalidateTaxCache } from "@/lib/repo";
import { computeNextRun, formatKst } from "@/lib/scheduler";
import { listHolidays } from "@/lib/holiday-service";
import { gcalConfigured, makeupCalendarConfigured } from "@/lib/gcal";
import { logActivity } from "@/lib/activity";
import { encryptionEnabled } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [company, rates, schedule, emailLogs, holidays] = await Promise.all([
    prisma.company.findFirst({ where: { id: 1 } }),
    prisma.insuranceRate.findFirst({ where: { isActive: true }, orderBy: { year: "desc" } }),
    prisma.emailSchedule.findFirst(),
    prisma.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
    // 발송일이 쉬는 날이면 앞당겨지므로 '다음 예정' 도 그 날짜로 답해야 한다
    listHolidays().catch(() => [] as Array<{ date: string }>),
  ]);
  const next = schedule ? computeNextRun(schedule, holidays.map((h) => h.date)) : null;
  return NextResponse.json({
    company,
    rates,
    schedule,
    scheduleStatus: {
      nextRunLabel: next ? formatKst(next) : null,
      lastRunLabel: schedule?.lastRunAt ? formatKst(schedule.lastRunAt) : null,
      // vercel.json: 매시 정각 점검 → 아래 설정한 시각(KST 정시)에 발송
      cronLabel: "매시 정각 점검 → 설정한 시각에 발송",
      serverless: !!process.env.VERCEL,
    },
    emailLogs: emailLogs.map((l) => ({
      id: l.id,
      to: l.to,
      subject: l.subject,
      status: l.status,
      error: l.error,
      at: formatKst(l.sentAt ?? l.createdAt),
    })),
    integrations: {
      // 개인정보(주민번호·계좌번호) 암호화 키가 들어와 있는지 — 없으면 평문으로 저장된다
      pii: encryptionEnabled(),
      smtp: !!process.env.SMTP_HOST,
      smtpHost: process.env.SMTP_HOST || null,
      smtpUser: process.env.SMTP_USER || null,
      mailFrom: process.env.MAIL_FROM || null,
      // 슬랙은 봇 토큰 + 서명 시크릿이 모두 있어야 동작
      slack: !!process.env.SLACK_BOT_TOKEN && !!process.env.SLACK_SIGNING_SECRET,
      slackToken: !!process.env.SLACK_BOT_TOKEN,
      slackSecret: !!process.env.SLACK_SIGNING_SECRET,
      slackChannel: !!process.env.SLACK_APPROVAL_CHANNEL,
      slackRecordChannel: !!process.env.SLACK_RECORD_CHANNEL,
      // 키 파일 통째로(GOOGLE_SERVICE_ACCOUNT_JSON) 넣은 경우도 인정해야 하므로 엔진 판정을 그대로 쓴다
      gcal: gcalConfigured(),
      gcalMakeup: makeupCalendarConfigured(),
      makeupChannel: !!process.env.SLACK_MAKEUP_CHANNEL,
      // 서버리스(Vercel)에서는 내부 스케줄러가 아니라 Vercel Cron 이 실행 주체
      serverless: !!process.env.VERCEL,
      scheduler: !!process.env.VERCEL || process.env.ENABLE_SCHEDULER === "true",
      cronSecret: !!process.env.CRON_SECRET,
    },
  });
}

const SECTION_LABEL: Record<string, string> = {
  company: "회사 정보",
  rates: "4대보험 요율",
  schedule: "명세서 예약 발송",
};

export async function PATCH(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { section, data } = await req.json();
  await logActivity({
    action: "SETTINGS_UPDATE",
    target: SECTION_LABEL[section] ?? section,
    summary: `설정을 변경했습니다 — ${SECTION_LABEL[section] ?? section}`,
    meta: data,
  });

  if (section === "company") {
    const c = await prisma.company.upsert({
      where: { id: 1 },
      update: {
        name: data.name,
        ceo: data.ceo,
        bizNo: data.bizNo,
        phone: data.phone,
        address: data.address,
        payday: Number(data.payday) || 7,
        // 비우면 회사명이 통장 적요로 나가 자리가 넘친다 — 기본 약칭으로 되돌린다
        transferAlias: String(data.transferAlias ?? "").trim() || "유쌤",
      },
      create: { id: 1, ...data, payday: Number(data.payday) || 7 },
    });
    return NextResponse.json(c);
  }

  if (section === "rates") {
    const existing = await prisma.insuranceRate.findFirst({ where: { isActive: true } });
    const payload = {
      nationalPension: Number(data.nationalPension),
      employment: Number(data.employment),
      health: Number(data.health),
      longTermCare: Number(data.longTermCare),
      localIncomeTaxRate: Number(data.localIncomeTaxRate),
      businessIncomeTax: Number(data.businessIncomeTax),
      pensionBaseMin: Number(data.pensionBaseMin),
      pensionBaseMax: Number(data.pensionBaseMax),
    };
    const r = existing
      ? await prisma.insuranceRate.update({ where: { id: existing.id }, data: payload })
      : await prisma.insuranceRate.create({ data: { year: new Date().getFullYear(), ...payload } });
    invalidateTaxCache();
    return NextResponse.json(r);
  }

  if (section === "schedule") {
    const existing = await prisma.emailSchedule.findFirst();
    const payload = {
      enabled: !!data.enabled,
      frequency: data.frequency,
      dayOfMonth: Number(data.dayOfMonth) || 7,
      dayOfWeek: Number(data.dayOfWeek) || 1,
      hour: Number(data.hour) || 9,
      minute: Number(data.minute) || 0,
      targetMonthOffset: Number(data.targetMonthOffset) || 0,
    };
    const saved = existing
      ? await prisma.emailSchedule.update({ where: { id: existing.id }, data: payload })
      : await prisma.emailSchedule.create({ data: payload });
    // 다음 발송 예정 시각 저장 (KST 기준. 쉬는 날이면 그 전 마지막 평일로 당겨진다)
    const hols = (await listHolidays().catch(() => [] as Array<{ date: string }>)).map((h) => h.date);
    const nextRunAt = computeNextRun(saved, hols);
    const s = await prisma.emailSchedule.update({
      where: { id: saved.id },
      data: { nextRunAt },
    });
    return NextResponse.json({ ...s, nextRunLabel: nextRunAt ? formatKst(nextRunAt) : null });
  }

  return NextResponse.json({ error: "unknown section" }, { status: 400 });
}
