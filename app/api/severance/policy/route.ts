import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { getSeverancePolicy } from "@/lib/severance-service";

export const dynamic = "force-dynamic";

const NUM = ["dcAfterMonths", "divisor", "minWeeklyHours"] as const;
const BOOL = [
  "includeBonus",
  "includeIncentive",
  "includeFixedOvertime",
  "includeOvertime",
  "includeUnusedLeave",
  "includeMealCar",
] as const;

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getSeverancePolicy());
}

/**
 * 퇴직급여 산정 조건 저장.
 *
 * 법정 기준에서 벗어나는 설정은 **막지 않고 경고를 함께 돌려준다** — 산입 범위는
 * 노무 자문으로 정할 판단이고, 시스템이 막아 버리면 DB 를 직접 만지게 되어 기록이 안 남는다.
 */
export async function PATCH(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}) as any);
  const data: any = {};
  for (const k of NUM)
    if (b[k] !== undefined && b[k] !== "" && Number.isFinite(Number(b[k]))) data[k] = Number(b[k]);
  for (const k of BOOL) if (b[k] !== undefined) data[k] = !!b[k];

  if (data.divisor !== undefined && data.divisor < 1)
    return NextResponse.json({ error: "나누는 수는 1 이상이어야 합니다." }, { status: 400 });

  await getSeverancePolicy(); // 없으면 만들어 둔다
  const row = await prisma.severancePolicy.update({ where: { id: 1 }, data });

  const warn: string[] = [];
  if (row.divisor > 12)
    warn.push(
      `연간 임금총액을 ${row.divisor} 로 나누면 법정 하한(1/12)에 미달합니다 — 근로자퇴직급여보장법 §20①.`
    );
  if (!row.includeFixedOvertime)
    warn.push(
      "포괄임금 약정 시간외·야간을 산입하지 않습니다 — 계약서에 합의된 월 급여의 일부라 매달 일률적으로 지급되는 임금입니다. 산정기준이 계약 월 급여총액보다 적어져 법정 하한에 미달할 소지가 큽니다."
    );
  if (!row.includeOvertime)
    warn.push(
      "그 달 발생한 연장·야간·휴일수당을 산입하지 않습니다. 이들 수당도 임금이라 법정 하한(연간 임금총액의 1/12)에 미달할 수 있습니다."
    );
  if (row.minWeeklyHours > 15)
    warn.push(
      `주 ${row.minWeeklyHours}시간 미만을 제외하면 법정 기준(15시간)보다 좁습니다 — 대상자가 부당하게 빠질 수 있습니다.`
    );
  if (row.dcAfterMonths > 12)
    warn.push(
      `근속 ${row.dcAfterMonths}개월 뒤 전환은 1년보다 늦습니다. 1년을 넘기면 입사일부터 전체 기간이 지급 대상입니다(§8①).`
    );

  await logActivity({
    action: "SEVERANCE_POLICY",
    summary: "퇴직급여 산정 조건을 변경했습니다.",
    meta: { data, warn },
  }).catch(() => {});

  return NextResponse.json({ ok: true, policy: row, warn });
}
