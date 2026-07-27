import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { adjustLeave } from "@/lib/leave-service";
import { logActivity } from "@/lib/activity";
import { postMessage, slackConfigured } from "@/lib/slack";
import { ymd } from "@/lib/format";

export const dynamic = "force-dynamic";

/** 반영 유형 — 화면의 선택지와 1:1. 부호와 구분을 함께 정한다. */
const KINDS = {
  USE: { label: "연차 사용", sign: -1, type: "USE", category: "STATUTORY" },
  GRANT: { label: "연차 부여", sign: +1, type: "ADJUST", category: "STATUTORY" },
  COMP_USE: { label: "대휴 사용", sign: -1, type: "USE", category: "COMP" },
  COMP_GRANT: { label: "대휴 부여", sign: +1, type: "GRANT", category: "COMP" },
} as const;

/**
 * 운영자가 직원의 연차를 직접 반영한다 (신청·승인 절차 없이 바로 기록).
 * notify=true 면 당사자에게 슬랙 DM 으로 알린다 — 알림 실패가 반영을 되돌리지는 않는다.
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();

  const employeeId = Number(b.employeeId);
  if (!employeeId) return NextResponse.json({ error: "직원을 선택해 주세요." }, { status: 400 });

  const kind = KINDS[b.kind as keyof typeof KINDS] ?? null;
  const rawDays = Number(b.days);
  if (!Number.isFinite(rawDays) || rawDays === 0)
    return NextResponse.json({ error: "일수를 확인해 주세요." }, { status: 400 });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  if (emp.payScheme === "RATIO")
    return NextResponse.json(
      { error: "완전비율제(위탁) 계약은 연차휴가 대상이 아닙니다." },
      { status: 400 }
    );

  // kind 없이 호출하는 예전 방식(days 부호 + type)도 그대로 받는다
  const days = kind ? Math.abs(rawDays) * kind.sign : rawDays;
  const type = (kind?.type ?? b.type ?? "ADJUST") as "ADJUST" | "USE" | "PAYOUT" | "GRANT";
  const category = (kind?.category ?? b.category ?? "STATUTORY") as "STATUTORY" | "COMP";
  const date = b.date ? new Date(`${String(b.date).slice(0, 10)}T00:00:00Z`) : new Date();
  const label = kind?.label ?? "연차 조정";
  const note = b.note?.trim() || `관리자 직접 반영 — ${label}`;

  try {
    const { summary, comp } = await adjustLeave(employeeId, days, type, date, note, category);

    await logActivity({
      action: "LEAVE_ADJUST",
      employeeId,
      target: emp.name,
      summary:
        `${emp.name}의 연차를 직접 반영했습니다 — ${label} ${Math.abs(days)}일 (${ymd(date)}).` +
        ` 반영 후 잔여 ${summary.remaining}일.`,
      meta: { kind: b.kind ?? null, days, type, category, date: ymd(date), note },
    });

    let notified: boolean | null = null;
    let notifyError: string | undefined;
    if (b.notify) {
      if (!slackConfigured()) {
        notified = false;
        notifyError = "슬랙이 연동돼 있지 않습니다";
      } else if (!emp.slackUserId) {
        notified = false;
        notifyError = "이 직원의 슬랙 계정이 연결돼 있지 않습니다";
      } else {
        const lines = [
          `📌 *${emp.name}님의 연차가 아래와 같이 자동등록되었습니다.*`,
          "",
          `• 구분: ${label}`,
          `• 일자: ${ymd(date)}`,
          `• 일수: ${Math.abs(days)}일`,
          ...(b.note?.trim() ? [`• 사유: ${b.note.trim()}`] : []),
          "",
          category === "COMP"
            ? `현재 대휴 잔여: *${comp.remaining}일*`
            : `현재 잔여 연차: *${summary.remaining}일*  (${summary.period.label} · ${ymd(
                summary.period.start
              )} ~ ${ymd(summary.period.end)})`,
          "",
          "내용이 다르면 관리자에게 알려주세요.",
        ];
        const r = await postMessage(emp.slackUserId, lines.join("\n"));
        notified = !!r?.ok;
        if (!notified) notifyError = r?.error;
      }
    }

    return NextResponse.json({
      ok: true,
      name: emp.name,
      kindLabel: label,
      days: Math.abs(days),
      date: ymd(date),
      remaining: summary.remaining,
      compRemaining: comp.remaining,
      notified,
      notifyError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
