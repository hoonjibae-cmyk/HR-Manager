/**
 * **운영진 일일 안내** — 오늘 휴가와 오늘 보강을 슬랙 채널에 올린다 (순수 함수, DB 무관).
 *
 * 매일 정해진 시각(기본 14:00 KST)에 나간다. 학원이 14시에 문을 열므로 그때 자리에 없는
 * 사람과 그날 잡힌 보강을 한 번에 훑을 수 있어야 한다.
 *
 * **두 갈래를 한 통에 담지 않는다.** 휴가는 '오늘 누가 없나', 보강은 '오늘 무슨 수업이
 * 더 있나' 로 챙기는 사람도 할 일도 다르다. 한 통이면 스레드에서 한쪽만 이야기하기 어렵고,
 * 한쪽이 비었을 때 빈 자리를 남기게 된다.
 *
 * **낼 것이 없으면 보내지 않는다.** 매일 "오늘은 없습니다" 가 오면 곧 아무도 안 읽는다 —
 * 그러면 정작 있는 날의 알림도 같이 묻힌다. 그래서 두 함수 모두 **비면 `null`** 을 돌려주고,
 * 부르는 쪽이 그때만 발송한다.
 */

import { POOL_LABEL, LEAVE_DAY_STATUS_LABEL, type LeaveDay } from "./leave-calendar";

/** 운영진 채널 — 설정 화면에서 바꿀 수 있다 */
export const DEFAULT_DAILY_CHANNEL = "C0AP5EWJR71";
/** 기본 발송 시각 — 학원이 문을 여는 14:00 KST */
export const DEFAULT_DAILY_TIMING = { enabled: true, hour: 14, minute: 0 };

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** `2026-08-12` → `8월 12일 (수)` */
export function dayLabel(dateYmd: string): string {
  const d = new Date(`${dateYmd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`;
}

/** KST 벽시계로 저장된 시각 → `14:00` */
export function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/* ─────────────────────────── 오늘 휴가 ─────────────────────────── */

/**
 * 그날 자리를 비우는 사람 한 줄.
 *
 * 종류(연차/반차/대휴/병가·경조/휴무)를 **그대로 적는다** — 운영진이 챙길 일이 갈린다.
 * 휴무는 연차가 아니지만(근무일을 옮긴 것) '오늘 자리에 없다' 는 같아서 함께 낸다.
 */
function leaveLine(d: LeaveDay): string {
  const who = d.department ? `${d.name} (${d.department})` : d.name;
  const kind = d.days === 0.5 ? "반차" : POOL_LABEL[d.pool];
  const span = d.span && d.span.total > 1 ? ` · ${d.span.total}일 중 ${d.span.index + 1}일째` : "";
  return `• ${who} — ${kind}${span}`;
}

/**
 * 오늘 휴가 안내. 낼 것이 없으면 `null`.
 *
 * **승인 대기는 따로 모아 아래에 붙인다** — 결재가 안 된 채 오늘이 된 건이 가장 급한데
 * 승인분과 섞어 놓으면 그냥 쉬는 사람으로 읽힌다.
 */
export function leaveBriefText(days: LeaveDay[], dateYmd: string): string | null {
  const today = days.filter((d) => d.date === dateYmd);
  if (!today.length) return null;

  const sorted = [...today].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const settled = sorted.filter((d) => d.status !== "PENDING" && d.status !== "CANCEL_PENDING");
  const pending = sorted.filter((d) => d.status === "PENDING" || d.status === "CANCEL_PENDING");

  const lines = [`🌴 *오늘 휴가* — ${dayLabel(dateYmd)} · ${today.length}명`];
  if (settled.length) lines.push(...settled.map(leaveLine));
  if (pending.length) {
    lines.push("");
    lines.push(`⚠️ *아직 결재되지 않은 건 ${pending.length}건*`);
    lines.push(
      ...pending.map((d) => `${leaveLine(d)} · ${LEAVE_DAY_STATUS_LABEL[d.status]}`)
    );
  }
  return lines.join("\n");
}

/* ─────────────────────────── 오늘 보강 ─────────────────────────── */

export interface BriefSession {
  id: number;
  name: string;
  department: string | null;
  category: string;
  status: string;
  planStart: Date;
  planEnd: Date;
  targetClass: string | null;
  headcount: number | null;
}

/** 안내에 낼 건인가 — 취소·미실시는 그날 일이 없어진 것이라 뺀다 */
export function isBriefable(s: { status: string }): boolean {
  return s.status !== "CANCELED" && s.status !== "NOSHOW";
}

/**
 * 오늘 보강·주말근무 안내. 낼 것이 없으면 `null`.
 *
 * 시각 순으로 세운다 — 운영진은 '몇 시에 누가 남아 있나' 를 시간 축으로 본다.
 */
export function makeupBriefText(
  sessions: BriefSession[],
  dateYmd: string,
  categoryLabel: Record<string, string>
): string | null {
  const rows = sessions.filter(isBriefable);
  if (!rows.length) return null;

  const sorted = [...rows].sort(
    (a, b) => a.planStart.getTime() - b.planStart.getTime() || a.name.localeCompare(b.name, "ko")
  );
  const lines = [`📚 *오늘 보강·주말근무* — ${dayLabel(dateYmd)} · ${rows.length}건`];
  for (const s of sorted) {
    const who = s.department ? `${s.name} (${s.department})` : s.name;
    const bits = [
      `${hhmm(s.planStart)}~${hhmm(s.planEnd)}`,
      who,
      categoryLabel[s.category] ?? s.category,
    ];
    if (s.targetClass) bits.push(s.targetClass);
    if (s.headcount) bits.push(`${s.headcount}명`);
    lines.push(`• ${bits.join(" · ")}`);
  }
  return lines.join("\n");
}
