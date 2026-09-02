import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthed } from "@/lib/auth";
import { adjustLeave } from "@/lib/leave-service";
import { logActivity } from "@/lib/activity";
import { postMessage, slackConfigured } from "@/lib/slack";
import { businessDaysFrom, currentLeavePeriod } from "@/lib/leave";
import { ymd } from "@/lib/format";
import { isContractorContract } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 반영 유형 — 화면의 선택지와 1:1. 부호와 구분을 함께 정한다. */
const KINDS = {
  USE: { label: "연차 사용", sign: -1, type: "USE", category: "STATUTORY", spread: true },
  GRANT: { label: "연차 부여", sign: +1, type: "ADJUST", category: "STATUTORY", spread: false },
  COMP_USE: { label: "대휴 사용", sign: -1, type: "USE", category: "COMP", spread: true },
  COMP_GRANT: { label: "대휴 부여", sign: +1, type: "GRANT", category: "COMP", spread: false },
} as const;

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** 사람이 읽을 날짜 — "2026.08.03(월)" */
const dayText = (d: Date) => `${ymd(d)}(${WEEK[d.getUTCDay()]})`;
/** 기계가 읽을 날짜 — 응답의 dates[] 는 ISO 로 내려준다 */
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 운영자가 직원의 연차를 직접 반영한다 (신청·승인 절차 없이 바로 기록).
 *
 * - 직원을 여러 명 고를 수 있다 (방학 등으로 일괄 부여하는 경우).
 * - '사용' 을 2일 이상 반영하면 시작일부터 **평일 기준**으로 하루씩 나눠 기록한다.
 *   주말·공휴일은 건너뛴다. 부여(+)는 날짜를 나눌 이유가 없어 하루에 몰아 넣는다.
 * - 구글 캘린더에는 올리지 않는다. 방학처럼 전 직원이 같은 날 쉬는 경우가 많아
 *   캘린더가 같은 일정으로 도배되기 때문. (슬랙 승인 경로만 캘린더에 올린다)
 * - notify=true 면 대상자 각각에게 슬랙 DM 을 보낸다. 알림 실패가 반영을 되돌리지 않는다.
 * - preview=true 면 어떤 날짜에 누구에게 들어갈지 계산만 해서 돌려준다 (DB 변경 없음).
 */
export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // 미리보기는 입력할 때마다 날아오고 중간에 취소되기도 한다 — 본문이 끊겨도 500 을 던지지 않는다
  const b = await req.json().catch(() => ({} as any));

  const ids: number[] = (
    Array.isArray(b.employeeIds) && b.employeeIds.length
      ? b.employeeIds
      : b.employeeId
      ? [b.employeeId]
      : []
  )
    .map(Number)
    .filter(Boolean);
  if (!ids.length)
    return NextResponse.json({ error: "직원을 한 명 이상 선택해 주세요." }, { status: 400 });

  const kind = KINDS[b.kind as keyof typeof KINDS] ?? null;
  const rawDays = Number(b.days);
  if (!Number.isFinite(rawDays) || rawDays === 0)
    return NextResponse.json({ error: "일수를 확인해 주세요." }, { status: 400 });

  const employees = await prisma.employee.findMany({ where: { id: { in: ids } } });
  if (!employees.length)
    return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });

  const ratio = employees.filter((e) => isContractorContract(e));
  const targets = employees.filter((e) => !isContractorContract(e));
  if (!targets.length)
    return NextResponse.json(
      { error: "위탁계약(프리랜서·완전비율제)은 연차휴가 대상이 아닙니다." },
      { status: 400 }
    );

  const type = (kind?.type ?? b.type ?? "ADJUST") as "ADJUST" | "USE" | "PAYOUT" | "GRANT";
  const category = (kind?.category ?? b.category ?? "STATUTORY") as "STATUTORY" | "COMP";
  const label = kind?.label ?? "연차 조정";
  const start = b.date
    ? new Date(`${String(b.date).slice(0, 10)}T00:00:00Z`)
    : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

  // 사용분을 2일 이상 반영하면 평일 기준으로 날짜를 펼친다 (반차 0.5 는 하루)
  const amount = Math.abs(rawDays);
  const spread = !!kind?.spread && Number.isInteger(amount) && amount >= 2;
  const holidays = spread ? (await prisma.holiday.findMany()).map((h) => h.date) : [];
  const dates = spread ? businessDaysFrom(start, amount, { holidays }) : [start];
  const perDay = spread ? 1 : amount;
  const sign = kind ? kind.sign : rawDays < 0 ? -1 : 1;

  if (spread && dates.length < amount)
    return NextResponse.json(
      { error: "평일을 충분히 찾지 못했습니다. 시작일과 일수를 확인해 주세요." },
      { status: 400 }
    );

  const note = b.note?.trim() || `관리자 직접 반영 — ${label}`;

  // ⚠ **지난 연차기간 날짜로 넣는 사용(−)은 이번 기간 잔여에서 차감되지 않는다** —
  // 그 날짜에 유효했던(지난 기간의) 발생분이 흡수하고, 그 잔여는 어차피 기간 만료로 소멸
  // 처리되기 때문이다. 모르고 넣으면 '반영이 안 된다' 로 보인다(퇴직자 연차수당 상세도
  // 이번 기간 잔여를 쓰므로 함께 안 움직인다). **막지는 않는다** — 지난 기간의 사용 기록을
  // 사실대로 보정하려고 일부러 넣는 경우도 있다. 대신 미리보기·결과에 경고를 싣는다.
  // 기준은 직원마다 다르다(입사일 기준 기간) — 퇴직자는 퇴사일에 멈춘 기간으로 본다.
  let pastPeriodWarning: string | null = null;
  if (sign < 0 && category === "STATUTORY") {
    const now = new Date();
    const lastDate = dates[dates.length - 1];
    const past = targets.filter((e) => {
      const asOf = e.resignDate && e.resignDate < now ? e.resignDate : now;
      return lastDate < currentLeavePeriod(e.hireDate, asOf).start;
    });
    if (past.length)
      pastPeriodWarning =
        `${past.map((e) => e.name).join(", ")}: 선택한 날짜가 지난 연차기간에 속해 ` +
        `이번 기간 잔여(연차수당 상세 포함)에서는 차감되지 않습니다 — 그 기간의 발생분이 흡수하고 ` +
        `기간 만료로 소멸 처리됩니다. 이번 기간 잔여를 줄이려면 이번 연차기간 안의 날짜로 넣으세요.`;
  }

  if (b.preview) {
    return NextResponse.json({
      ok: true,
      mode: "preview",
      label,
      spread,
      perDay,
      dates: dates.map(iso),
      dateText: dates.map(dayText).join(", "),
      targets: targets.map((e) => ({ id: e.id, name: e.name, hasSlack: !!e.slackUserId })),
      excluded: ratio.map((e) => e.name),
      pastPeriodWarning,
    });
  }

  try {
    const results: Array<{ name: string; remaining: number; compRemaining: number }> = [];
    let notified = 0;
    let notifyFailed = 0;
    let notifyError: string | undefined;

    for (const emp of targets) {
      let summary: any = null;
      let comp: any = null;
      for (const d of dates) {
        const r = await adjustLeave(emp.id, perDay * sign, type, d, note, category);
        summary = r.summary;
        comp = r.comp;
      }
      results.push({
        name: emp.name,
        remaining: summary.remaining,
        compRemaining: comp.remaining,
      });

      if (!b.notify) continue;
      if (!slackConfigured()) {
        notifyFailed++;
        notifyError = "슬랙이 연동돼 있지 않습니다";
        continue;
      }
      if (!emp.slackUserId) {
        notifyFailed++;
        notifyError = "슬랙 계정이 연결되지 않은 직원이 있습니다";
        continue;
      }
      const lines = [
        `📌 *${emp.name}님의 연차가 아래와 같이 자동등록되었습니다.*`,
        "",
        `• 구분: ${label}`,
        dates.length > 1
          ? `• 일자: ${dates.map(dayText).join(", ")}  (평일 ${dates.length}일)`
          : `• 일자: ${dayText(dates[0])}`,
        `• 일수: ${perDay * dates.length}일`,
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
      if (r?.ok) notified++;
      else {
        notifyFailed++;
        notifyError = r?.error;
      }
    }

    const totalDays = perDay * dates.length;
    await logActivity({
      action: "LEAVE_ADJUST",
      employeeId: targets.length === 1 ? targets[0].id : null,
      target: targets.length === 1 ? targets[0].name : `${targets.length}명`,
      summary:
        `${targets.length === 1 ? targets[0].name : `${targets.length}명`}의 연차를 직접 반영했습니다 — ` +
        `${label} ${totalDays}일 (${dates.map(iso).join(", ")}).` +
        (targets.length > 1 ? ` 대상: ${targets.map((e) => e.name).join(", ")}` : "") +
        (ratio.length ? ` 완전비율제 ${ratio.length}명 제외.` : ""),
      meta: {
        kind: b.kind ?? null,
        names: targets.map((e) => e.name),
        dates: dates.map(iso),
        perDay,
        totalDays,
        type,
        category,
        note,
        excluded: ratio.map((e) => e.name),
      },
    });

    return NextResponse.json({
      ok: true,
      kindLabel: label,
      spread,
      dates: dates.map(iso),
      dateText: dates.map(dayText).join(", "),
      totalDays,
      results,
      excluded: ratio.map((e) => e.name),
      pastPeriodWarning,
      notified: b.notify ? notified : null,
      notifyFailed: b.notify ? notifyFailed : 0,
      notifyError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
