// 슬랙 보강계획 사전신청 공통 처리 (모달 제출 · 슬래시 명령 · 앱 홈이 함께 쓴다)

import { prisma } from "./db";
import { MAKEUP_CATEGORY_LABEL, MAKEUP_STATUS_LABEL } from "./constants";
import { sessionHours, workWindow } from "./overtime";
import type { MakeupModalValues } from "./slack";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 슬랙 날짜·시간 선택값 → Date.
 * KST 벽시계 값을 UTC 필드에 그대로 담는다 (앱 전체 규칙 — 달력·공휴일 판정이 모두 getUTC*).
 */
export function slackDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time.length === 5 ? time : time.slice(0, 5)}:00Z`);
}

/** "2026.08.15(토) 09:00~16:00 · 7시간" */
export function makeupDateLabel(start: Date, end: Date): string {
  const d = `${start.getUTCFullYear()}.${String(start.getUTCMonth() + 1).padStart(2, "0")}.${String(
    start.getUTCDate()
  ).padStart(2, "0")}(${WEEK[start.getUTCDay()]})`;
  const t = (x: Date) =>
    `${String(x.getUTCHours()).padStart(2, "0")}:${String(x.getUTCMinutes()).padStart(2, "0")}`;
  const hours = sessionHours({ planStart: start, planEnd: end } as any);
  const crossed = start.toISOString().slice(0, 10) !== end.toISOString().slice(0, 10);
  return `${d} ${t(start)}~${crossed ? "익일 " : ""}${t(end)} · ${hours}시간`;
}

export interface MakeupParseResult {
  ok: boolean;
  error?: string;
  /** 오류가 난 블록 id — 모달 필드 오류로 되돌려 준다 */
  field?: string;
  start?: Date;
  end?: Date;
}

/** 모달 입력 검증 — 시각이 뒤집히거나 터무니없이 긴 신청을 막는다 */
export function parseMakeupInput(v: MakeupModalValues): MakeupParseResult {
  if (!v.startDate || !v.startTime) return { ok: false, error: "보강 시작 시간을 선택해 주세요.", field: "sdate" };
  if (!v.endTime) return { ok: false, error: "보강 종료 시간을 선택해 주세요.", field: "etime" };
  const start = slackDateTime(v.startDate, v.startTime);
  let end = slackDateTime(v.endDate || v.startDate, v.endTime);
  // 종료일을 안 적었는데 시각이 시작보다 이르면 자정을 넘긴 것으로 본다
  if (!v.endDate && end <= start) end = new Date(end.getTime() + 86400000);
  if (end <= start)
    return { ok: false, error: "종료 시간이 시작 시간보다 빠릅니다.", field: "etime" };
  const hours = (end.getTime() - start.getTime()) / 3600000;
  if (hours > 24)
    return { ok: false, error: "한 건이 24시간을 넘습니다. 날짜를 확인해 주세요.", field: "edate" };
  if (!v.targetClass) return { ok: false, error: "대상반을 적어 주세요.", field: "target" };
  return { ok: true, start, end };
}

/** 직원이 '내 보강 내역' 을 눌렀을 때 보여줄 문구 */
export async function makeupListText(employeeId: number, name: string): Promise<string> {
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const from = new Date(today.getTime() - 60 * 86400000);
  const rows = await prisma.makeupSession.findMany({
    where: { employeeId, planStart: { gte: from } },
    orderBy: { planStart: "asc" },
    take: 30,
  });
  if (!rows.length)
    return `*${name}님의 보강 내역*\n\n_최근 두 달 안에 등록된 보강이 없습니다._\n\`/보강\` 으로 새 계획을 등록할 수 있습니다.`;

  const upcoming = rows.filter((r) => r.planStart >= today);
  const past = rows.filter((r) => r.planStart < today).slice(-8);
  const line = (r: (typeof rows)[number]) => {
    const w = workWindow(r as any);
    const label = makeupDateLabel(w.start, w.end);
    const cat = MAKEUP_CATEGORY_LABEL[r.category] ?? r.category;
    const st = MAKEUP_STATUS_LABEL[r.status] ?? r.status;
    return `• ${label}\n   ${cat} · ${r.targetClass} · _${st}_`;
  };

  const out = [`*${name}님의 보강 내역*`];
  out.push("", "*예정*", ...(upcoming.length ? upcoming.map(line) : ["_예정된 보강이 없습니다._"]));
  if (past.length) out.push("", "*지난 보강*", ...past.map(line));
  out.push(
    "",
    "_실제 근무 여부는 관리자가 확인한 뒤 오버타임 수당으로 산정됩니다._"
  );
  return out.join("\n");
}

/** 앱 홈 '예정된 보강' 목록 */
export async function upcomingMakeups(employeeId: number) {
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const rows = await prisma.makeupSession.findMany({
    where: { employeeId, planStart: { gte: today }, status: { notIn: ["CANCELED", "NOSHOW"] } },
    orderBy: { planStart: "asc" },
    take: 5,
  });
  return rows.map((r) => {
    const w = workWindow(r as any);
    return {
      label: `${makeupDateLabel(w.start, w.end)} · ${MAKEUP_CATEGORY_LABEL[r.category] ?? r.category} (${r.targetClass})`,
      status: MAKEUP_STATUS_LABEL[r.status] ?? r.status,
    };
  });
}
