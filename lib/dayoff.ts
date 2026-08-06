// 평일 휴무 — 구글 캘린더의 `(휴무)김수민` 일정을 읽어 온다 (순수 함수, DB·네트워크 무관)
//
// **연차가 아니다.** 운영팀은 그 주 토요일에 당번 근무를 하고 대신 그 주 평일 하루를 쉰다.
// 근로시간을 옮겨 놓은 것이라 연차 잔여에서 깎지 않는다. 그래서 `LeaveTransaction`(연차 원장)에
// 넣지 않고 **따로 둔다** — 원장에 넣으면 `summarizeLeave` 가 훑어 잔여가 조용히 줄어든다.
// 여기서 하는 일은 '그날 누가 자리에 없나' 를 달력에 함께 보여 주는 것뿐이다.
//
// 원본은 **연차 캘린더(`GOOGLE_CALENDAR_ID`)** 이고, 사람이 손으로 넣어 온 일정이다.
// 그래서 시스템이 쓰는 게 아니라 **읽기만** 한다 — 캘린더가 진실이고 우리 표는 그 사본이다.

/* ───────────── 제목 읽기 ───────────── */

/**
 * `(휴무)김수민` 에서 이름을 뽑는다.
 *
 * 사람이 손으로 적는 제목이라 모양이 흔들린다. 실제로 있을 법한 것들을 다 받는다:
 *   `(휴무)김수민` · `(휴무) 김수민` · `[휴무] 김수민` · `휴무 - 김수민` · `김수민 (휴무)`
 *   `(휴무)김수민, 이영희` (한 일정에 여럿)
 *
 * **`휴무` 가 없는 제목은 건드리지 않는다** — 이 캘린더에는 앱이 자동으로 올리는 연차 일정
 * (`김서준 연차`)도 함께 있어서, 아무 제목이나 집으면 연차를 휴무로 두 번 세게 된다.
 */
const MARK = /[(\[【]?\s*휴\s*무\s*[)\]】]?/;

export function parseDayOffTitle(title: string): string[] {
  const raw = String(title ?? "").trim();
  if (!raw) return [];
  // '휴무' 가 들어 있지 않으면 우리 것이 아니다
  if (!/휴\s*무/.test(raw)) return [];
  // '휴무' 표시를 지우고 남는 것을 이름으로 본다 (앞에 있든 뒤에 있든)
  const rest = raw
    .replace(MARK, " ")
    .replace(/^[\s\-–—·:]+|[\s\-–—·:]+$/g, "")
    .trim();
  if (!rest) return [];
  return rest
    .split(/[,、·/]|\s{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 12);
}

/* ───────────── 일정 → 날짜 ───────────── */

export interface CalendarEvent {
  id: string;
  summary?: string | null;
  /** 종일 일정 */
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
  status?: string | null;
}

const DAY = 86400000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * 일정이 걸친 날짜들.
 *
 * 구글 **종일 일정의 `end.date` 는 배타적**이다 — 하루짜리 8/12 일정은 `start 8/12, end 8/13`
 * 으로 온다. 그대로 훑으면 8/13 까지 쉬는 것으로 잡힌다(하루씩 더 쉬게 된다).
 */
export function eventDates(e: CalendarEvent): string[] {
  const s = e.start?.date ?? (e.start?.dateTime ? e.start.dateTime.slice(0, 10) : null);
  if (!s) return [];
  const rawEnd = e.end?.date ?? (e.end?.dateTime ? e.end.dateTime.slice(0, 10) : null);
  const startMs = new Date(`${s}T00:00:00Z`).getTime();
  // 종일 일정만 배타적이다. 시각이 있는 일정은 끝나는 날도 그날 쉰 것이다
  const exclusive = !!e.end?.date;
  const endMs = rawEnd
    ? new Date(`${rawEnd}T00:00:00Z`).getTime() - (exclusive ? DAY : 0)
    : startMs;

  const out: string[] = [];
  for (let t = startMs; t <= Math.max(startMs, endMs) && out.length < 31; t += DAY)
    out.push(ymd(new Date(t)));
  return out;
}

/* ───────────── 캘린더 → 휴무 목록 ───────────── */

export interface DayOffRow {
  /** YYYY-MM-DD */
  date: string;
  /** 캘린더 제목 원문 — 사람이 대조할 수 있게 그대로 남긴다 */
  title: string;
  /** 제목에서 읽은 이름 */
  rawName: string;
  gcalEventId: string;
}

export interface DayOffParseResult {
  rows: DayOffRow[];
  /** `휴무` 는 들어 있는데 이름을 못 읽은 일정 — 버리지 않고 세어 화면에 띄운다 */
  unreadable: Array<{ id: string; title: string }>;
}

/**
 * 캘린더 일정 목록 → 휴무 줄.
 *
 * 취소된 일정(`status === "cancelled"`)은 뺀다 — 구글이 지워진 일정도 함께 돌려주는 때가 있다.
 */
export function parseDayOffEvents(events: CalendarEvent[]): DayOffParseResult {
  const rows: DayOffRow[] = [];
  const unreadable: Array<{ id: string; title: string }> = [];

  for (const e of events) {
    if (e.status === "cancelled") continue;
    const title = String(e.summary ?? "").trim();
    if (!/휴\s*무/.test(title)) continue;

    const names = parseDayOffTitle(title);
    if (!names.length) {
      unreadable.push({ id: e.id, title });
      continue;
    }
    const dates = eventDates(e);
    if (!dates.length) {
      unreadable.push({ id: e.id, title });
      continue;
    }
    for (const name of names)
      for (const date of dates) rows.push({ date, title, rawName: name, gcalEventId: e.id });
  }
  return { rows, unreadable };
}

/* ───────────── 직원 붙이기 ───────────── */

export interface ResolvedDayOff extends DayOffRow {
  employeeId: number;
  name: string;
  department: string | null;
}

export interface DayOffPlan {
  resolved: ResolvedDayOff[];
  /** 캘린더에는 있는데 직원 명단에서 못 찾은 이름 — 퇴사자이거나 오타다 */
  unmatched: Array<{ date: string; rawName: string; title: string }>;
  unreadable: Array<{ id: string; title: string }>;
}

/**
 * 이름 → 직원. 못 찾은 것은 **버리지 않고 돌려준다** — 조용히 사라지면 휴무가 달력에서
 * 빠진 것을 아무도 모른다. 퇴사자이거나 캘린더 오타이므로 사람이 봐야 한다.
 */
export function planDayOffs(
  parsed: DayOffParseResult,
  employees: Array<{ id: number; name: string; department: string | null }>,
  match: (name: string, list: any[]) => { emp?: any; ambiguous?: any[] }
): DayOffPlan {
  const resolved: ResolvedDayOff[] = [];
  const unmatched: DayOffPlan["unmatched"] = [];
  const seen = new Set<string>();

  for (const r of parsed.rows) {
    const { emp } = match(r.rawName, employees);
    if (!emp) {
      unmatched.push({ date: r.date, rawName: r.rawName, title: r.title });
      continue;
    }
    // 같은 사람·같은 날이 두 번 오면(일정이 겹치게 등록됐으면) 한 줄만 남긴다
    const key = `${emp.id}|${r.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({ ...r, employeeId: emp.id, name: emp.name, department: emp.department ?? null });
  }
  resolved.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ko"));
  return { resolved, unmatched, unreadable: parsed.unreadable };
}

/* ───────────── 표 맞추기 ───────────── */

export interface StoredDayOff {
  id: number;
  employeeId: number;
  date: string;
  gcalEventId: string | null;
  source: string;
}

export interface DayOffDiff {
  add: ResolvedDayOff[];
  /** 캘린더에서 사라진 줄 — **지운다** */
  remove: StoredDayOff[];
}

/**
 * **캘린더가 진실이다.** 공휴일 표와 반대로, 여기서는 캘린더에서 사라진 줄을 지운다 —
 * 사람이 캘린더에서 휴무를 옮기거나 취소했는데 우리 표에 남아 있으면 달력이 거짓말을 한다.
 *
 * 다만 **가져온 창(window) 안에서, 캘린더에서 온 줄만** 건드린다. 창 밖의 지난 기록과
 * 관리자가 직접 넣은 줄(`source !== "GCAL"`)은 그대로 둔다.
 */
export function diffDayOffs(
  stored: StoredDayOff[],
  resolved: ResolvedDayOff[],
  window: { from: string; to: string }
): DayOffDiff {
  const want = new Set(resolved.map((r) => `${r.employeeId}|${r.date}`));
  const have = new Set(stored.map((s) => `${s.employeeId}|${s.date}`));

  return {
    add: resolved.filter((r) => !have.has(`${r.employeeId}|${r.date}`)),
    remove: stored.filter(
      (s) =>
        s.source === "GCAL" &&
        s.date >= window.from &&
        s.date <= window.to &&
        !want.has(`${s.employeeId}|${s.date}`)
    ),
  };
}

/** 가져올 기간 — 지난 기록도 달력에서 뒤로 넘겨 볼 수 있게 앞뒤로 넉넉히 */
export function syncWindow(now: Date, opts: { back?: number; ahead?: number } = {}) {
  const today = ymd(now);
  const back = opts.back ?? 90;
  const ahead = opts.ahead ?? 120;
  const shift = (n: number) => ymd(new Date(new Date(`${today}T00:00:00Z`).getTime() + n * DAY));
  return { from: shift(-back), to: shift(ahead) };
}

/** 화면 안내 — 무엇이 안 들어왔는지 한 줄로 */
export function dayOffWarning(plan: DayOffPlan): string | null {
  const parts: string[] = [];
  if (plan.unmatched.length) {
    const names = Array.from(new Set(plan.unmatched.map((u) => u.rawName))).slice(0, 5);
    parts.push(`직원 명단에서 못 찾은 이름 ${plan.unmatched.length}건 (${names.join(", ")})`);
  }
  if (plan.unreadable.length)
    parts.push(`이름을 읽지 못한 일정 ${plan.unreadable.length}건`);
  if (!parts.length) return null;
  return `${parts.join(" · ")} — 캘린더 제목이 «(휴무)홍길동» 모양인지, 퇴사자는 아닌지 확인해 주세요.`;
}
