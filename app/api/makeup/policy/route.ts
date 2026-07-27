import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { getOvertimePolicy } from "@/lib/makeup-service";

export const dynamic = "force-dynamic";

const NUM = [
  "extraMultiplier",
  "overtimeMultiplier",
  "holidayMultiplier",
  "holidayOverMultiplier",
  "holidayOverAfterHours",
  "nightMultiplier",
  "nightStartHour",
  "nightEndHour",
  "mandatoryCapHours",
  "roundingMinutes",
] as const;
const BOOL = [
  "countNight",
  "applyStatutoryOvertime",
  "immediateDefault",
  "mandatoryDefault",
  "absenceDefault",
  "otherDefault",
] as const;

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getOvertimePolicy());
}

/** 오버타임 지급 조건 저장 — 배수를 낮추면 법정 기준에 못 미칠 수 있어 경고를 함께 돌려준다 */
export async function PATCH(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const data: any = {};
  for (const k of NUM) if (b[k] !== undefined && b[k] !== "" && Number.isFinite(Number(b[k]))) data[k] = Number(b[k]);
  for (const k of BOOL) if (b[k] !== undefined) data[k] = !!b[k];

  await getOvertimePolicy(); // 없으면 만들어 둔다
  const row = await prisma.overtimePolicy.update({ where: { id: 1 }, data });

  // 법내연장(×1.0)과 야간 미산정은 이 학원의 방침이라 경고 대상이 아니다.
  // 다만 '법정 초과분 가산' 을 켜 놓고 배수를 1.5 아래로 내리면 법정 기준에 못 미친다.
  const warn: string[] = [];
  if (row.applyStatutoryOvertime && row.overtimeMultiplier < 1.5)
    warn.push("법정 연장근로 가산이 1.5배보다 낮습니다.");
  if (row.holidayMultiplier < 1.5) warn.push("휴일근로 가산이 법정 1.5배보다 낮습니다.");
  if (row.holidayOverMultiplier < 2) warn.push("휴일 8시간 초과 가산이 법정 2배보다 낮습니다.");
  if (row.countNight && row.nightMultiplier < 0.5)
    warn.push("야간근로 가산이 법정 0.5배보다 낮습니다.");

  await logActivity({
    action: "SETTINGS_UPDATE",
    target: "오버타임 지급 조건",
    summary: `오버타임 수당 지급 조건을 변경했습니다.${warn.length ? ` (주의: ${warn.join(" ")})` : ""}`,
    meta: data,
  });

  return NextResponse.json({ ok: true, policy: row, warn });
}
