import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { getNotifySetting, previewHrNotices, runHrNotices } from "@/lib/hr-notify-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NUM = ["contractLeadDays", "contractHour", "contractMinute", "birthdayLeadDays", "birthdayHour", "birthdayMinute"] as const;
const BOOL = ["contractEnabled", "birthdayEnabled"] as const;

/** 설정 + **지금 조건이면 무엇이 나갈지** 미리보기를 함께 돌려준다 */
export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await previewHrNotices());
}

export async function PATCH(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  await getNotifySetting(); // 행이 없으면 만든다

  const data: any = {};
  for (const k of NUM) if (b[k] != null && Number.isFinite(Number(b[k]))) data[k] = Math.round(Number(b[k]));
  for (const k of BOOL) if (typeof b[k] === "boolean") data[k] = b[k];
  if (typeof b.targetDepartment === "string" && b.targetDepartment.trim())
    data.targetDepartment = b.targetDepartment.trim();
  // 빈 문자열은 '채널 안 씀'(= 부서 DM) 이라는 뜻이라 null 로 저장한다
  if (typeof b.channel === "string") data.channel = b.channel.trim() || null;

  // 시각·일수는 있을 수 없는 값을 막는다 — 24시로 저장되면 그날 알림이 통째로 안 나간다
  const clamp = (k: string, lo: number, hi: number) => {
    if (data[k] != null) data[k] = Math.min(hi, Math.max(lo, data[k]));
  };
  clamp("contractHour", 0, 23);
  clamp("birthdayHour", 0, 23);
  clamp("contractMinute", 0, 59);
  clamp("birthdayMinute", 0, 59);
  clamp("contractLeadDays", 0, 365);
  clamp("birthdayLeadDays", 0, 30);

  const row = await prisma.hrNotifySetting.update({ where: { id: 1 }, data });
  await logActivity({ action: "SETTINGS_UPDATE", summary: "경영지원 알림 설정을 변경했습니다." }).catch(() => {});
  return NextResponse.json({ ...(await previewHrNotices()), setting: row });
}

/**
 * 지금 보내기 — 설정한 시각을 기다리지 않고 확인용으로 한 번 보낸다.
 *
 * **계약 예고는 이때도 `expiryNotifiedAt` 을 새긴다** — 테스트로 보냈다고 안 새기면
 * 정작 예정 시각에 같은 알림이 또 나간다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const out = await runHrNotices(new Date(), { force: true });
  return NextResponse.json(out);
}
