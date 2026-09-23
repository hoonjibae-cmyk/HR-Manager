// 방학 근무·연차 — 수업이 없는 기간에 직원이 날짜별로 「정상근무」와 「연차 신청」 중 하나를
// **스스로** 고르게 하는 공고. DB 무관 순수 함수(판정·문안·원문 렌더)만 둔다(테스트 있음).
//
// 운영 원칙(어기면 일괄 연차대체처럼 읽힌다):
//  - 두 선택지를 같은 무게로 보여 주고 어느 쪽도 미리 고르지 않는다.
//  - 미응답·열람·마감 경과는 아무 선택도 아니다 — 연차·동의·결근을 만들지 않는다.
//  - 정상근무 선택자에게는 서명을 받지 않는다(선택 결과만 남긴다).
//  - 잔여가 모자라면 막고 안내한다 — 마이너스 연차·선사용·무급·급여 공제로 바꾸지 않는다.
//  - 권리 포기·이의 제기 금지 같은 문구는 넣지 않는다(추가 안내에도 못 넣게 막는다).
import type { ScheduleDay } from "./constants";

/* ============================== 공고 문안 ============================== */

export const NOTICE_TITLE_DEFAULT = "수업 미운영 기간 근무 및 연차 신청 안내";

/** 공고 본문 — 시스템 고정 템플릿. 관리자는 날짜·조건 같은 변수만 채운다 */
export const NOTICE_BODY = [
  "해당 기간에는 학생 정규수업을 운영하지 않지만, 개인별 소정근로일에는 정상근무가 가능합니다.",
  "휴가를 희망하는 직원은 사용 가능한 연차 범위에서 원하는 날짜를 선택하여 신청할 수 있습니다.",
  "연차 사용 여부는 개인의 선택이며, 신청하지 않은 날짜를 일괄적으로 연차 처리하지 않습니다.",
  "정상근무 시 근무 장소·시간·업무는 아래 안내를 확인해 주세요. 임금은 기존 근로조건에 따라 지급합니다.",
  "아래 응답 기한은 근무계획 취합을 위한 일정이며, 이 안내는 다른 날짜의 연차 신청을 제한하지 않습니다.",
];

export const APPLICATION_TITLE = "연차유급휴가 신청서";
export const WORK_RECEIPT_TITLE = "근무 선택 확인 내역";

export const APPLICATION_STATEMENT = [
  "본인은 위 신청일에 연차를 사용하지 않고 정상근무할 수 있다는 안내와 근무 장소·시간·업무에 관한 설명을 확인했습니다.",
  "본인의 선택에 따라 위 날짜에 연차유급휴가 사용을 신청하며, 실제 사용한 연차가 본인의 연차 잔여량에서 차감되는 것을 확인합니다.",
];

/** 연차 신청자에게만 보이는 확인 항목 — 언제나 미체크로 시작한다 */
export const CHECK_ITEMS = [
  { value: "c1", label: "위 날짜의 정상근무 가능 여부와 안내된 근무조건을 확인했습니다." },
  { value: "c2", label: "제가 선택한 날짜에 제 의사로 연차유급휴가를 신청합니다." },
  { value: "c3", label: "신청일과 사용량을 확인했으며, 실제 사용한 연차가 차감되는 것을 확인했습니다." },
];

/**
 * 관리자가 발행 전에 확인하는 운영 사실 — 확인자·시각을 남긴다.
 * 이것은 **운영 사실 확인**이지 법률 검토 완료가 아니다(화면에도 그렇게 적는다).
 */
export const ATTESTATIONS = [
  { key: "workplace", label: "정상근무를 선택한 직원에게 실제 근무 장소와 업무환경을 제공할 수 있습니다." },
  { key: "wage", label: "정상근무자의 임금을 기존 근로조건대로 지급할 예정입니다." },
  { key: "workdays", label: "대상 날짜가 직원별로 원래 근무해야 하는 날인지 근무표로 확인했습니다." },
] as const;

/**
 * 추가 안내·조건 문구에 넣을 수 없는 표현 — 권리 포기·면책·간주 동의로 읽히는 말.
 * 부분일치(공백 무시)로 본다. 막는 것이 목적이 아니라 **발행 전에 사람이 다시 보게** 하는 것.
 */
export const BANNED_PHRASES = [
  "이의제기",
  "이의를제기하지",
  "민형사",
  "민·형사",
  "책임면제",
  "책임을면제",
  "권리포기",
  "권리를포기",
  "모든권리",
  "동의한것으로간주",
  "동의한것으로본다",
  "간주합니다",
  "간주한다",
  "일괄연차",
  "연차로대체",
  "연차대체",
];

export function bannedPhrasesIn(text: string): string[] {
  const t = (text ?? "").replace(/\s+/g, "");
  return BANNED_PHRASES.filter((p) => t.includes(p.replace(/\s+/g, "")));
}

/* ============================== 공고 내용 ============================== */

/** 직군(부서)별 정상근무 조건 — 예정 업무는 관리자가 적는다(예시로 자동 확정하지 않는다) */
export interface WorkCondition {
  place: string;
  hours: string;
  breakTime: string;
  duties: string;
  environment: string;
}

export const CONDITION_FIELDS: { key: keyof WorkCondition; label: string; placeholder: string }[] = [
  { key: "place", label: "근무 장소", placeholder: "예: 본원 3층 교무실" },
  { key: "hours", label: "출퇴근 시간", placeholder: "예: 개인 근로계약상 근무시간(근무표) 그대로" },
  { key: "breakTime", label: "휴게 시간", placeholder: "예: 근무 중 30분 (근무표 기준)" },
  { key: "duties", label: "예정 업무", placeholder: "예(참고용): 강사 — 수업 준비·교재 검수 / 운영팀 — 학사자료 정비" },
  { key: "environment", label: "출입·업무환경", placeholder: "예: 정문 출입, 냉난방 가동, 교무실 PC 사용 가능" },
];

export interface NoticeContent {
  title: string;
  /** 수업 미운영 기간 (YYYY-MM-DD) */
  classOffStart: string;
  classOffEnd: string;
  /** 실제 선택 대상 날짜 (YYYY-MM-DD, 오름차순) */
  dates: string[];
  /** 응답 요청 기한 (YYYY-MM-DD) — 근무계획 취합용. 다른 연차를 막는 근거가 아니다 */
  deadline: string;
  contactName: string;
  /** 문의 담당자 직원 id — 문의 알림(DM)을 받는다 */
  contactEmployeeId: number | null;
  /** 추가 안내 (선택) — 금지 표현 검사를 거친다 */
  extraNote: string;
  targetDepts: string[];
  targetEmployeeIds: number[];
  excludeEmployeeIds: number[];
  /** 부서명 → 정상근무 조건 */
  conditions: Record<string, WorkCondition>;
  /** 운영조건 확인이 안 된 직원·날짜 — `${employeeId}:${ymd}` 또는 `${employeeId}:*` */
  unconfirmed: string[];
}

export function emptyContent(): NoticeContent {
  return {
    title: NOTICE_TITLE_DEFAULT,
    classOffStart: "",
    classOffEnd: "",
    dates: [],
    deadline: "",
    contactName: "",
    contactEmployeeId: null,
    extraNote: "",
    targetDepts: [],
    targetEmployeeIds: [],
    excludeEmployeeIds: [],
    conditions: {},
    unconfirmed: [],
  };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 저장된 JSON → 내용 (빠진 칸은 빈 값으로 메운다) */
export function parseContent(json: string | null | undefined): NoticeContent {
  let raw: any = {};
  try {
    raw = JSON.parse(json || "{}");
  } catch {}
  const base = emptyContent();
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  return {
    ...base,
    ...raw,
    dates: [...new Set(arr(raw.dates).filter((d: any) => YMD.test(String(d))))].sort() as string[],
    targetDepts: arr(raw.targetDepts).map(String),
    targetEmployeeIds: arr(raw.targetEmployeeIds).map(Number).filter(Number.isFinite),
    excludeEmployeeIds: arr(raw.excludeEmployeeIds).map(Number).filter(Number.isFinite),
    unconfirmed: arr(raw.unconfirmed).map(String),
    conditions: raw.conditions && typeof raw.conditions === "object" ? raw.conditions : {},
    contactEmployeeId: raw.contactEmployeeId == null ? null : Number(raw.contactEmployeeId),
  };
}

export function conditionMissing(c: Partial<WorkCondition> | undefined | null): string[] {
  return CONDITION_FIELDS.filter((f) => !String(c?.[f.key] ?? "").trim()).map((f) => f.label);
}

/** 발행을 막는 문제 — 비면 발행할 수 있다 */
export function publishProblems(c: NoticeContent, targetDeptNames: string[]): string[] {
  const out: string[] = [];
  if (!c.title.trim()) out.push("제목을 입력하세요.");
  if (!YMD.test(c.classOffStart) || !YMD.test(c.classOffEnd)) out.push("수업 미운영 기간을 입력하세요.");
  else if (c.classOffEnd < c.classOffStart) out.push("수업 미운영 기간의 끝이 시작보다 빠릅니다.");
  if (!c.dates.length) out.push("선택 대상 날짜를 하나 이상 고르세요.");
  if (!YMD.test(c.deadline)) out.push("응답 요청 기한을 입력하세요.");
  if (!c.contactName.trim()) out.push("문의 담당자를 입력하세요.");
  for (const d of targetDeptNames) {
    const miss = conditionMissing(c.conditions[d]);
    if (miss.length) out.push(`${d} 정상근무 조건이 비어 있습니다: ${miss.join(", ")} — 이 부서 직원은 '운영조건 확인 필요'로 남습니다.`);
  }
  const texts = [c.title, c.extraNote, ...Object.values(c.conditions).flatMap((x) => Object.values(x ?? {}))];
  const banned = [...new Set(texts.flatMap((t) => bannedPhrasesIn(String(t ?? ""))))];
  if (banned.length) out.push(`쓸 수 없는 표현이 있습니다: ${banned.join(", ")} — 권리 포기·간주 동의로 읽힙니다.`);
  return out;
}

/** 비어 있는 부서 조건은 발행을 막지 않고(그 부서만 '운영조건 확인 필요'), 나머지는 막는다 */
export function blockingProblems(problems: string[]): string[] {
  return problems.filter((p) => !p.includes("'운영조건 확인 필요'로 남습니다"));
}

/**
 * **바뀌면 재확인이 필요한 변경인가** — 날짜·근무조건·운영조건 확인 범위·수업 미운영 기간.
 * 제목·기한·문의처·추가 안내만 바뀐 것은 안내만 하고 재확인을 요구하지 않는다.
 */
export function isMaterialChange(prev: NoticeContent, next: NoticeContent): boolean {
  const j = (v: any) => JSON.stringify(v);
  const cond = (c: NoticeContent) =>
    Object.keys(c.conditions)
      .sort()
      .map((k) => [k, CONDITION_FIELDS.map((f) => (c.conditions[k]?.[f.key] ?? "").trim())]);
  return (
    j(prev.dates) !== j(next.dates) ||
    prev.classOffStart !== next.classOffStart ||
    prev.classOffEnd !== next.classOffEnd ||
    j(cond(prev)) !== j(cond(next)) ||
    j([...prev.unconfirmed].sort()) !== j([...next.unconfirmed].sort())
  );
}

/** 변경 요약 한 줄씩 — 직원에게 보내는 변경 안내에 쓴다 */
export function changeSummary(prev: NoticeContent, next: NoticeContent): string[] {
  const out: string[] = [];
  const added = next.dates.filter((d) => !prev.dates.includes(d));
  const removed = prev.dates.filter((d) => !next.dates.includes(d));
  if (added.length) out.push(`대상 날짜 추가: ${added.join(", ")}`);
  if (removed.length) out.push(`대상 날짜 제외: ${removed.join(", ")}`);
  if (prev.classOffStart !== next.classOffStart || prev.classOffEnd !== next.classOffEnd)
    out.push(`수업 미운영 기간: ${next.classOffStart} ~ ${next.classOffEnd}`);
  const depts = new Set([...Object.keys(prev.conditions), ...Object.keys(next.conditions)]);
  for (const d of depts) {
    for (const f of CONDITION_FIELDS) {
      const a = (prev.conditions[d]?.[f.key] ?? "").trim();
      const b = (next.conditions[d]?.[f.key] ?? "").trim();
      if (a !== b) out.push(`${d} ${f.label}: ${b || "(비움)"}`);
    }
  }
  if (prev.deadline !== next.deadline) out.push(`응답 요청 기한: ${next.deadline}`);
  if (prev.contactName !== next.contactName) out.push(`문의 담당자: ${next.contactName}`);
  if (prev.title !== next.title) out.push(`제목: ${next.title}`);
  if (prev.extraNote !== next.extraNote) out.push("추가 안내 문구가 바뀌었습니다.");
  if (JSON.stringify([...prev.unconfirmed].sort()) !== JSON.stringify([...next.unconfirmed].sort()))
    out.push("운영조건 확인 범위가 바뀌었습니다.");
  return out;
}

/* ============================== 대상자 ============================== */

export interface TargetEmployee {
  id: number;
  name: string;
  department: string | null;
  active: boolean;
  hireDate: Date;
  resignDate: Date | null;
  slackUserId: string | null;
  /** isContractorContract 판정 결과 */
  contractor: boolean;
}

export interface TargetResult {
  targets: TargetEmployee[];
  excluded: { employee: TargetEmployee; reason: string }[];
}

/**
 * 공고 대상 — 고른 부서 + 개별 추가 − 개별 제외. 위탁계약은 연차(§60)가 없어 뺀다.
 * 퇴직자·대상 기간에 재직하지 않는 사람도 뺀다(사유를 남겨 화면에 보인다).
 */
export function resolveTargets(employees: TargetEmployee[], c: NoticeContent): TargetResult {
  const first = c.dates[0];
  const last = c.dates[c.dates.length - 1];
  const targets: TargetEmployee[] = [];
  const excluded: TargetResult["excluded"] = [];
  for (const e of employees) {
    const picked =
      (e.department != null && c.targetDepts.includes(e.department)) || c.targetEmployeeIds.includes(e.id);
    if (!picked) continue;
    if (c.excludeEmployeeIds.includes(e.id)) excluded.push({ employee: e, reason: "관리자가 대상에서 제외" });
    else if (!e.active) excluded.push({ employee: e, reason: "재직자 아님" });
    else if (e.contractor) excluded.push({ employee: e, reason: "위탁계약 — 연차휴가 적용 대상 아님" });
    else if (first && e.resignDate && ymdOf(e.resignDate) < first)
      excluded.push({ employee: e, reason: "대상 기간 전 퇴사" });
    else if (last && ymdOf(e.hireDate) > last) excluded.push({ employee: e, reason: "대상 기간 이후 입사" });
    else targets.push(e);
  }
  return { targets, excluded };
}

/* ============================== 날짜별 판정 ============================== */

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

export function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dayLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${DAY_KO[d.getUTCDay()]})`;
}

export type DateStatus =
  /** 정상근무·연차 중 고를 수 있다 */
  | "OPEN"
  /** 원래 근무일이 아니거나 재직 기간 밖 — 선택 대상 아님 */
  | "NOT_WORKDAY"
  /** 같은 날 이미 다른 휴가·휴무가 있다 — 기존 기록을 보여 주고 새로 만들지 않는다 */
  | "EXISTING"
  /** 운영조건·근무표를 사람이 확인해야 한다 — 신청·차감 대상이 아니다 */
  | "UNCONFIRMED";

export interface DateInfo {
  date: string;
  label: string;
  status: DateStatus;
  /** 선택할 수 없는 이유 (OPEN 이면 null) */
  reason: string | null;
  /** 근무표상 그날 근무시간 (예: 14:00~22:00, 휴게 0.5h) */
  hours: string | null;
  /** OPEN 인데 연차는 고를 수 없는 경우의 사유 (정상근무만 가능) */
  leaveBlocked: string | null;
  /** 연차 1회 사용량 — 기존 연차 단위(일)를 그대로 쓴다 */
  leaveDays: number;
  existing?: { requestId: number | null; label: string };
}

export interface ExistingLeave {
  date: string;
  requestId: number | null;
  label: string;
  /** 이 공고(배정)로 만든 신청이면 true — 막지 않고 '이전 선택' 으로 보인다 */
  own: boolean;
}

export interface DateContext {
  employee: Pick<TargetEmployee, "id" | "hireDate" | "resignDate">;
  schedule: ScheduleDay[];
  holidays: Map<string, string>;
  dayOffs: Set<string>;
  existing: ExistingLeave[];
  unconfirmed: Set<string>;
  /** 부서 정상근무 조건이 채워져 있는가 */
  conditionReady: boolean;
  /** 이번 연차기간 마지막 날(YYYY-MM-DD) — 그 뒤 날짜는 잔여 산정이 달라진다 */
  periodLastDay: string | null;
}

export function dateInfo(date: string, ctx: DateContext): DateInfo {
  const d = new Date(`${date}T00:00:00Z`);
  const key = DAY_KEYS[d.getUTCDay()];
  const sched = ctx.schedule.find((s) => s.day === key);
  const hours = sched?.work ? `${sched.start}~${sched.end}${sched.breakH ? `, 휴게 ${sched.breakH}h` : ""}` : null;
  const base = { date, label: dayLabel(date), hours, leaveBlocked: null, leaveDays: 1 };
  const block = (status: DateStatus, reason: string, extra: Partial<DateInfo> = {}): DateInfo => ({
    ...base,
    status,
    reason,
    ...extra,
  });

  if (date < ymdOf(ctx.employee.hireDate)) return block("NOT_WORKDAY", "입사 전 날짜");
  if (ctx.employee.resignDate && date > ymdOf(ctx.employee.resignDate)) return block("NOT_WORKDAY", "퇴사 후 날짜");
  const hol = ctx.holidays.get(date);
  if (hol) return block("NOT_WORKDAY", `공휴일(${hol})`);
  if (!ctx.schedule.length || !ctx.schedule.some((s) => s.work))
    return block("UNCONFIRMED", "근로시간표가 없어 소정근로일인지 확인이 필요합니다");
  if (!sched?.work) return block("NOT_WORKDAY", "계약 근무표상 근무일이 아님");
  if (ctx.dayOffs.has(date)) return block("EXISTING", "평일 휴무일로 등록됨");
  const ex = ctx.existing.find((x) => x.date === date && !x.own);
  if (ex) return block("EXISTING", `기존 ${ex.label}`, { existing: { requestId: ex.requestId, label: ex.label } });
  if (ctx.unconfirmed.has(`${ctx.employee.id}:*`) || ctx.unconfirmed.has(`${ctx.employee.id}:${date}`))
    return block("UNCONFIRMED", "운영조건 확인 필요 (관리자 확인 전)");
  if (!ctx.conditionReady) return block("UNCONFIRMED", "운영조건 확인 필요 (근무 조건 미입력)");
  const leaveBlocked =
    ctx.periodLastDay && date > ctx.periodLastDay
      ? `이번 연차기간(~${ctx.periodLastDay}) 이후 날짜라 사용 가능량 산정 확인이 필요합니다 — 담당자에게 문의해 주세요`
      : null;
  return { ...base, status: "OPEN", reason: null, leaveBlocked };
}

/* ============================== 선택·잔여 ============================== */

export type Choice = "WORK" | "LEAVE";
export type Choices = Record<string, Choice>;

/** 모달·임시저장 값 정리 — 고를 수 없는 날짜나 막힌 연차는 버린다 */
/**
 * 직원이 고를 날짜인가 — 근무일이고 운영조건이 확인됐고, 연차도 고를 수 있어야 한다.
 * 연차만 막힌 날(연차기간 경계)은 고를 거리가 없으므로 선택 대상에서 빼고 사유를 보여 준다
 * (정상근무만 남은 칸을 '선택' 하게 하면 선택처럼 보이는 강요가 된다).
 */
export function isSelectable(i: DateInfo): boolean {
  return i.status === "OPEN" && !i.leaveBlocked;
}

/** 고를 수 없는 이유 (선택 대상이면 null) */
export function skipReason(i: DateInfo): string | null {
  if (i.status !== "OPEN") return i.reason;
  return i.leaveBlocked;
}

/** 모달·임시저장 값 정리 — 고를 수 없는 날짜는 버린다 */
export function sanitizeChoices(raw: Record<string, any>, infos: DateInfo[]): Choices {
  const out: Choices = {};
  for (const i of infos) {
    if (!isSelectable(i)) continue;
    const v = raw?.[i.date];
    if (v === "WORK" || v === "LEAVE") out[i.date] = v;
  }
  return out;
}

export function unselectedDates(choices: Choices, infos: DateInfo[]): string[] {
  return infos.filter((i) => isSelectable(i) && !choices[i.date]).map((i) => i.date);
}

export function leaveDates(choices: Choices): string[] {
  return Object.keys(choices)
    .filter((d) => choices[d] === "LEAVE")
    .sort();
}

export interface BalanceCheck {
  /** 현재 확정 잔여 (승인된 사용분만 반영) */
  remaining: number;
  /** 승인 대기 중인 연차 (이 공고로 이미 낸 것 포함) */
  pending: number;
  /** 이번 제출로 새로 신청하는 일수 */
  adding: number;
  /** 이번 제출로 철회되는 승인 대기 일수 (다시 쓸 수 있게 된다) */
  releasing: number;
  /** 모두 반영되면 남는 잔여 */
  after: number;
  shortage: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 잔여 판정 — 승인 대기분을 함께 빼고, 이번에 철회되는 **승인 대기**분만 되돌려 준다.
 * 이미 승인된 연차의 취소는 운영진 승인 뒤에야 복원되므로 여기서 미리 되돌리지 않는다(보수적).
 * 앞으로 발생할 연차(월 개근분)는 가용량에 넣지 않는다 — 확정되지 않은 값이다.
 */
export function checkBalance(input: { remaining: number; pending: number; adding: number; releasing: number }): BalanceCheck {
  const after = r2(input.remaining - input.pending + input.releasing - input.adding);
  return {
    remaining: r2(input.remaining),
    pending: r2(input.pending),
    adding: r2(input.adding),
    releasing: r2(input.releasing),
    after,
    shortage: after < 0 && input.adding > 0 ? r2(-after) : 0,
  };
}

/** 이전 제출과 비교 — 새로 신청할 날·철회할 날·그대로 둘 날 */
export function diffLeave(prev: string[], next: string[]) {
  const p = new Set(prev);
  const n = new Set(next);
  return {
    added: next.filter((d) => !p.has(d)).sort(),
    removed: prev.filter((d) => !n.has(d)).sort(),
    kept: next.filter((d) => p.has(d)).sort(),
  };
}

/** 서명 성명 대조 — 공백만 무시한다 */
export function signatureNameMatches(typed: string, name: string): boolean {
  const n = (s: string) => (s ?? "").replace(/\s+/g, "");
  return n(typed).length > 0 && n(typed) === n(name);
}

/** 선택 내용 지문 — 서명 화면이 보여 준 내용과 제출 시점 내용이 같은지 본다 */
export function choicesKey(choices: Choices): string {
  return Object.keys(choices)
    .sort()
    .map((d) => `${d}=${choices[d]}`)
    .join(",");
}

/* ============================== 제출 원문 ============================== */

export interface SubmissionSnapshot {
  kind: "LEAVE" | "WORK_ONLY";
  docNo: string;
  companyName: string;
  employee: { id: number; name: string; department: string | null; empNo: string | null };
  notice: {
    id: number;
    title: string;
    version: number;
    classOffStart: string;
    classOffEnd: string;
    deadline: string;
    contactName: string;
    body: string[];
    extraNote: string;
  };
  condition: WorkCondition | null;
  rows: { date: string; label: string; hours: string | null; choice: Choice; days: number }[];
  /** 고를 수 없던 날짜 — 사유를 함께 남긴다 */
  skipped: { date: string; label: string; reason: string }[];
  leaveTotal: number;
  balance: BalanceCheck & { basis: string; scheduled: number };
  statement: string[] | null;
  checks: { label: string; checked: boolean }[] | null;
  signature: { method: string; typedName: string; account: string } | null;
  /** 서버가 정한 제출 시각 (ISO, UTC) */
  submittedAt: string;
  supersedesDocNo: string | null;
  afterClose: boolean;
}

export function docNumber(noticeId: number, employeeId: number, seq: number): string {
  return `VW-${noticeId}-${employeeId}-${seq}`;
}

/** 저장 시각(UTC) → 한국 시간 표기 */
export function kstLabel(iso: string | Date): string {
  const d = new Date(typeof iso === "string" ? iso : iso.toISOString());
  const k = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 19)} (KST)`;
}

function esc(s: any): string {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function conditionTable(c: WorkCondition | null): string {
  if (!c) return `<p class="muted">정상근무 조건이 입력되지 않았습니다.</p>`;
  return `<table class="kv"><tbody>${CONDITION_FIELDS.map(
    (f) => `<tr><th>${esc(f.label)}</th><td>${esc(c[f.key])}</td></tr>`
  ).join("")}</tbody></table>`;
}

/**
 * 제출 당시 원문 HTML — **제출 시점에 한 번 만들어 그대로 저장**한다.
 * 나중에 직원 이름·공고가 바뀌어도 이 원문은 다시 만들지 않는다.
 */
export function renderSubmissionHtml(s: SubmissionSnapshot): string {
  const leave = s.kind === "LEAVE";
  const title = leave ? APPLICATION_TITLE : WORK_RECEIPT_TITLE;
  const rows = s.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.date)} ${esc(r.label.replace(/^\S+\s/, ""))}</td><td>${esc(r.hours ?? "-")}</td><td>${
          r.choice === "LEAVE" ? "<b>연차 신청</b>" : "정상근무"
        }</td><td style="text-align:right">${r.choice === "LEAVE" ? `${r.days}일` : "-"}</td></tr>`
    )
    .join("");
  const skipped = s.skipped.length
    ? `<p class="small muted">선택 대상이 아니었던 날짜: ${s.skipped
        .map((x) => `${esc(x.date)}(${esc(x.reason)})`)
        .join(", ")}</p>`
    : "";
  const balance = leave
    ? `<h3>신청 총량 및 잔여</h3>
    <table class="kv"><tbody>
      <tr><th>신청 총량</th><td><b>${s.leaveTotal}일</b></td></tr>
      <tr><th>신청 시점 확정 잔여</th><td>${s.balance.remaining}일</td></tr>
      <tr><th>승인 대기 중인 연차</th><td>${s.balance.pending}일${s.balance.releasing ? ` (이번 변경으로 철회 ${s.balance.releasing}일)` : ""}</td></tr>
      <tr><th>모두 승인 시 예상 잔여</th><td>${s.balance.after}일</td></tr>
      <tr><th>산정 기준</th><td>${esc(s.balance.basis)}${
        s.balance.scheduled > 0 ? `<br/>앞으로 발생 예정 ${s.balance.scheduled}일은 확정분이 아니어서 가용량에 넣지 않았습니다.` : ""
      }</td></tr>
    </tbody></table>`
    : "";
  const statement =
    leave && s.statement
      ? `<div class="avoid"><h3>신청 문구</h3>${s.statement.map((t) => `<p>${esc(t)}</p>`).join("")}
    <ul class="checks">${(s.checks ?? []).map((c) => `<li>${c.checked ? "☑" : "☐"} ${esc(c.label)}</li>`).join("")}</ul></div>`
      : `<p>본인은 위 날짜에 연차를 신청하지 않고 정상근무를 선택했습니다. 이 확인 내역은 선택 결과의 기록이며 동의서가 아닙니다.</p>`;
  const sign = s.signature
    ? `<table class="kv"><tbody>
      <tr><th>서명 방식</th><td>${esc(s.signature.method)}</td></tr>
      <tr><th>성명(직접 입력)</th><td><b>${esc(s.signature.typedName)}</b></td></tr>
      <tr><th>제출 계정</th><td>${esc(s.signature.account)}</td></tr>
      <tr><th>제출 시각</th><td>${esc(kstLabel(s.submittedAt))}</td></tr>
    </tbody></table>`
    : `<table class="kv"><tbody>
      <tr><th>제출 계정</th><td>슬랙 본인 계정</td></tr>
      <tr><th>제출 시각</th><td>${esc(kstLabel(s.submittedAt))}</td></tr>
    </tbody></table>`;

  return `<div class="compact">
  <div class="doc-title">${esc(title)}</div>
  <p class="small" style="text-align:right">문서번호 ${esc(s.docNo)}${
    s.supersedesDocNo ? ` · 이전 제출 ${esc(s.supersedesDocNo)} 을(를) 변경` : ""
  }</p>
  <table class="kv"><tbody>
    <tr><th>사업장명</th><td>${esc(s.companyName)}</td></tr>
    <tr><th>성명 · 소속</th><td>${esc(s.employee.name)} · ${esc(s.employee.department ?? "-")}${
      s.employee.empNo ? ` (사번 ${esc(s.employee.empNo)})` : ""
    }</td></tr>
    <tr><th>공고</th><td>${esc(s.notice.title)} (제${s.notice.version}판)</td></tr>
    <tr><th>수업 미운영 기간</th><td>${esc(s.notice.classOffStart)} ~ ${esc(s.notice.classOffEnd)}</td></tr>
    <tr><th>응답 요청 기한</th><td>${esc(s.notice.deadline)} (근무계획 취합용)${s.afterClose ? " · 공고 마감 후 제출" : ""}</td></tr>
  </tbody></table>

  <h3>안내 내용</h3>
  ${s.notice.body.map((t) => `<p class="small">${esc(t)}</p>`).join("")}
  ${s.notice.extraNote ? `<p class="small">${esc(s.notice.extraNote)}</p>` : ""}

  <h3>정상근무 안내</h3>
  ${conditionTable(s.condition)}

  <h3>날짜별 선택</h3>
  <table class="grid"><thead><tr><th>날짜</th><th>근무표상 근무시간</th><th>선택</th><th>연차 사용량</th></tr></thead>
  <tbody>${rows}</tbody></table>
  ${skipped}
  ${balance}
  ${statement}
  <div class="avoid"><h3>${leave ? "본인 확인 · 서명" : "제출 정보"}</h3>
  ${sign}</div>
  <p class="small muted">이 문서는 제출 시점의 원문입니다. 이후 승인·취소 같은 처리 결과는 원문을 고치지 않고 별도 처리 이력으로 남깁니다.</p>
</div>`;
}

/* ============================== 현황 ============================== */

export type AssignmentState = "NOT_SENT" | "UNOPENED" | "OPENED" | "DRAFT" | "SUBMITTED" | "RECONFIRM" | "REMOVED";

export const ASSIGNMENT_STATE_LABEL: Record<AssignmentState, string> = {
  NOT_SENT: "배포 안 됨(슬랙 미연동·발송 실패)",
  UNOPENED: "미열람",
  OPENED: "열람 · 미응답",
  DRAFT: "임시저장",
  SUBMITTED: "제출",
  RECONFIRM: "변경 안내 · 재확인 필요",
  REMOVED: "대상에서 빠짐",
};

export function assignmentState(a: {
  removed: boolean;
  slackLinked: boolean;
  firstOpenedAt: Date | null;
  draftSavedAt: Date | null;
  hasSubmission: boolean;
  needsReconfirm: boolean;
}): AssignmentState {
  if (a.removed) return "REMOVED";
  if (a.hasSubmission && a.needsReconfirm) return "RECONFIRM";
  if (a.hasSubmission) return "SUBMITTED";
  if (!a.slackLinked) return "NOT_SENT";
  if (a.draftSavedAt) return "DRAFT";
  if (a.firstOpenedAt) return "OPENED";
  return "UNOPENED";
}

/**
 * 확인 알림 대상 — 아직 제출하지 않은 사람뿐. 정상근무를 고른 제출자에게는 보내지 않는다.
 * 발송이 실패했던 사람(NOT_SENT)도 다시 보낼 대상이다 — 슬랙 연동이 있을 때만(부르는 쪽이 거른다).
 */
export function remindable(state: AssignmentState): boolean {
  return state === "UNOPENED" || state === "OPENED" || state === "DRAFT" || state === "NOT_SENT";
}

/**
 * 사후 대조 — 연차일에 근무 기록이 있으면 '사실 확인 필요'. 시스템이 결론을 내리지 않는다.
 */
export function reviewFlagsFor(input: {
  leaveDates: string[];
  workedDates: Map<string, string>;
  workNotProvided: Map<string, string>;
  workDates: string[];
  today: string;
  resolved: Set<string>;
}): { date: string; kind: "LEAVE_WORKED" | "WORK_NOT_PROVIDED"; note: string }[] {
  const out: { date: string; kind: "LEAVE_WORKED" | "WORK_NOT_PROVIDED"; note: string }[] = [];
  for (const d of input.leaveDates) {
    if (d > input.today) continue;
    const w = input.workedDates.get(d);
    if (w && !input.resolved.has(`LEAVE_WORKED:${d}`))
      out.push({ date: d, kind: "LEAVE_WORKED", note: `연차일에 근무 기록이 있습니다 (${w})` });
  }
  for (const d of input.workDates) {
    const n = input.workNotProvided.get(d);
    if (n && !input.resolved.has(`WORK_NOT_PROVIDED:${d}`))
      out.push({ date: d, kind: "WORK_NOT_PROVIDED", note: `정상근무 제공 불가로 기록된 날입니다 (${n})` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
