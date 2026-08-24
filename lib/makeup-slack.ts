// 슬랙 보강·주말근무 사전신청 공통 처리 (모달 제출 · 슬래시 명령 · 앱 홈이 함께 쓴다)

import { prisma } from "./db";
import {
  MAKEUP_CATEGORY_LABEL,
  MAKEUP_STATUS_LABEL,
  MAKEUP_CONFIRMED_BY_LABEL,
  makeupKindLabel,
} from "./constants";
import { sessionHours, workWindow, isPayEligible, DEFAULT_OT_POLICY, type OtPolicy } from "./overtime";
import { canSelfConfirm, canSelfCancel, NOT_PAYABLE_HINT, type ConfirmableSession } from "./makeup-confirm";
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

/** 한 줄 요약 — 목록·홈이 함께 쓴다 */
function lineOf(r: { category: string; status: string; targetClass: string; confirmedBy?: string | null }, label: string) {
  const cat = MAKEUP_CATEGORY_LABEL[r.category] ?? r.category;
  const st = MAKEUP_STATUS_LABEL[r.status] ?? r.status;
  const by = r.confirmedBy ? ` · ${MAKEUP_CONFIRMED_BY_LABEL[r.confirmedBy] ?? r.confirmedBy}` : "";
  return `• ${label}\n   ${cat} · ${r.targetClass} · _${st}${by}_`;
}

/**
 * 지급 조건 — 수당 대상 판정에만 쓴다. 행이 없으면 기본값이 그대로 적용되는 것이 맞다
 * (`getOvertimePolicy` 는 upsert 라 여기서 부르면 조회가 쓰기가 된다).
 */
async function policyForList(): Promise<OtPolicy> {
  const row = await prisma.overtimePolicy.findUnique({ where: { id: 1 } }).catch(() => null);
  return (row as any) ?? DEFAULT_OT_POLICY;
}

/**
 * 공휴일 표 — 직전·내신보강의 기본 반영 여부가 **근무일이 토·일·공휴일인지**로 갈리므로
 * 판정하는 자리마다 함께 읽어야 한다. 빠뜨리면 공휴일 보강이 평일로 잡혀 화면(관리자)과
 * 슬랙(직원)이 서로 다른 답을 낸다.
 */
async function holidaysForList(): Promise<string[]> {
  const rows = await prisma.holiday.findMany({ select: { date: true } }).catch(() => []);
  return rows.map((h: { date: Date }) => h.date.toISOString().slice(0, 10));
}

/**
 * 직원이 '내 신청 내역' 을 눌렀을 때 보여줄 화면.
 *
 * **지난 건에는 「실근무 확정」 버튼이 붙는다** — 확정은 관리자가 아니라 신청자가 한다.
 * 근무 다음날부터 열리고, 이미 확정한 건도 기간 안이면 다시 고칠 수 있다(`canSelfConfirm`).
 *
 * 다만 **수당 대상인 건에만 붙인다**. 확정 화면은 '적은 시간이 곧 수당' 이라는 전제로
 * 쓰여 있어서, 결시보강처럼 아직 반영이 정해지지 않은 건에까지 버튼을 두면 직전보강과
 * 똑같이 읽혀 지급되는 줄 알게 된다. 그런 건은 버튼 대신 **왜 안 열렸는지와 무엇을
 * 하면 되는지**를 그 줄 밑에 작게 적는다.
 */
export async function makeupListBlocks(
  employeeId: number,
  name: string,
  now: Date = new Date()
): Promise<{ text: string; blocks: any[] }> {
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const from = new Date(today.getTime() - 60 * 86400000);
  const [rows, policy, holidays] = await Promise.all([
    prisma.makeupSession.findMany({
      where: { employeeId, planStart: { gte: from } },
      orderBy: { planStart: "asc" },
      take: 30,
    }),
    policyForList(),
    holidaysForList(),
  ]);
  const title = `*${name}님의 보강 · 주말·초과근무 내역*`;
  if (!rows.length) {
    const text = `${title}\n\n_최근 두 달 안에 등록된 신청이 없습니다._\n\`/보강\` 으로 새로 신청할 수 있습니다.`;
    return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
  }

  const upcoming = rows.filter((r) => r.planStart >= today);
  const past = rows.filter((r) => r.planStart < today).slice(-8);
  const label = (r: (typeof rows)[number]) => {
    const w = workWindow(r as any);
    return makeupDateLabel(w.start, w.end);
  };

  const blocks: any[] = [{ type: "section", text: { type: "mrkdwn", text: title } }];
  const push = (heading: string, list: typeof rows, withButton: boolean) => {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${heading}*` } });
    if (!list.length) {
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "_없습니다._" }] });
      return;
    }
    for (const r of list) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: lineOf(r, label(r)) } });

      const open = withButton && canSelfConfirm(r as unknown as ConfirmableSession, now).ok;
      const payable = isPayEligible(r, policy, holidays);
      // **미실시는 수당 대상과 무관하게, 근무 전에도 열어 둔다** — 취소는 돈 이야기가 아니라
      // '그 일이 있었나' 의 문제이고, 미리 알수록 캘린더·확정 요청이 헛돌지 않는다.
      const cancelable = canSelfCancel(r as unknown as ConfirmableSession, now).ok;

      // 한 줄에 버튼이 둘일 수 있어 accessory 가 아니라 actions 블록을 쓴다
      // (섹션 accessory 는 하나만 붙는다).
      const buttons: any[] = [];
      if (open && payable)
        buttons.push({
          type: "button",
          ...(r.status === "CONFIRMED" ? {} : { style: "primary" }),
          text: {
            type: "plain_text",
            text: r.status === "CONFIRMED" ? "확정 수정" : "실근무 확정",
            emoji: true,
          },
          action_id: "open_makeup_confirm",
          value: String(r.id),
        });
      if (cancelable)
        buttons.push({
          type: "button",
          text: { type: "plain_text", text: "미실시", emoji: true },
          action_id: "open_makeup_cancel",
          value: String(r.id),
        });
      if (buttons.length) blocks.push({ type: "actions", elements: buttons });

      // 확정 버튼 자리를 비워 두기만 하면 왜 없는지 알 수 없다 — 그 줄 밑에 작게 적는다
      if (open && !payable)
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: `_${NOT_PAYABLE_HINT}_` }],
        });
    }
  };

  push("예정", upcoming, false);
  if (past.length) push("지난 근무", past, true);
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text:
          "확정은 근무가 끝난 *다음날부터* 가능하고 *그 달의 다음 달 1일까지* 열려 있습니다 " +
          "(예: 8월 근무 → 9월 1일까지). 기간 안에는 몇 번이든 고칠 수 있습니다. " +
          "*수당 반영 대상인 건에만* 확정 버튼이 열립니다 — 확정한 시간이 그대로 오버타임 수당으로 산정됩니다.",
      },
    ],
  });

  const text = [
    title,
    "",
    "*예정*",
    ...(upcoming.length ? upcoming.map((r) => lineOf(r, label(r))) : ["_없습니다._"]),
    ...(past.length ? ["", "*지난 근무*", ...past.map((r) => lineOf(r, label(r)))] : []),
  ].join("\n");
  return { text, blocks };
}

/** 앱 홈 '예정된 보강·주말근무' 목록 */
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

/** 확정 모달의 초기값 — 실근무 시각이 있으면 그것, 없으면 예정값 */
export function confirmInitials(r: {
  planStart: Date;
  planEnd: Date;
  actualStart?: Date | null;
  actualEnd?: Date | null;
}) {
  const s = r.actualStart ?? r.planStart;
  const e = r.actualEnd ?? r.planEnd;
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const t = (x: Date) => x.toISOString().slice(11, 16);
  return { startDate: d(s), startTime: t(s), endDate: d(e), endTime: t(e) };
}

/** 확정 모달 제출값 검증 — 신청 검증과 같은 규칙(자정 넘김·24시간 상한) */
export function parseConfirmInput(v: {
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
}): MakeupParseResult {
  if (!v.startDate || !v.startTime)
    return { ok: false, error: "실제 시작 시간을 선택해 주세요.", field: "sdate" };
  if (!v.endTime) return { ok: false, error: "실제 종료 시간을 선택해 주세요.", field: "etime" };
  const start = slackDateTime(v.startDate, v.startTime);
  let end = slackDateTime(v.endDate || v.startDate, v.endTime);
  if (!v.endDate && end <= start) end = new Date(end.getTime() + 86400000);
  if (end <= start)
    return { ok: false, error: "종료 시간이 시작 시간보다 빠릅니다.", field: "etime" };
  if ((end.getTime() - start.getTime()) / 3600000 > 24)
    return { ok: false, error: "한 건이 24시간을 넘습니다. 날짜를 확인해 주세요.", field: "edate" };
  return { ok: true, start, end };
}

/** 신청 종류 라벨 — 화면·메시지가 함께 쓴다 */
export { makeupKindLabel };
