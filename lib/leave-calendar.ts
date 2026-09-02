// 연차 달력 — '누가 언제 쉬는가' 를 날짜 축으로 펼친다 (순수 함수, DB 무관)
//
// **왜 트랜잭션만으로는 안 되는가**: 연차 원장(`LeaveTransaction`)은 들어오는 길이 둘인데
// 모양이 다르다.
//   ① 슬랙 신청 승인 → `approveLeaveRequest()` 가 **시작일 하나에 총 일수**로 한 줄 남긴다
//      (lib/leave-service.ts). 그래서 3일 휴가가 원장에는 `8/10 · -3일` 한 줄뿐이다.
//   ② 관리자 직접 반영 → `/api/leave/adjust` 가 `businessDaysFrom()` 으로 **하루씩 쪼개** 남긴다.
// 원장만 그리면 ①이 첫날 한 칸으로 뭉쳐 나와 "8/11·8/12 에 누가 자리에 없는지" 를 못 본다.
//
// 그래서 **신청서(기간)와 원장(날짜)을 합쳐서** 그린다:
//   - 신청서는 시작~종료를 날짜별로 펼친다 (주말·공휴일은 건너뛴다 — 반영 경로와 같은 규칙)
//   - 원장은 **신청서에 매이지 않은 줄만**(`requestId == null`) 쓴다.
//     매인 줄은 신청서의 그림자라 함께 그리면 같은 날이 두 번 나온다.
//
// 달력에는 **사용분만** 낸다 — 부여(+)는 '그날 쉬었다' 가 아니라 원장 사건이다(`/leave/[id]`).

/* ───────────── 입력 ───────────── */

export interface LeaveRequestInput {
  id: number;
  employeeId: number;
  name: string;
  department: string | null;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  days: number;
  leaveType: string; // ANNUAL | HALF | COMP | SICK | SPECIAL
  status: string; // PENDING | APPROVED | REJECTED | CANCEL_PENDING | CANCELED
  reason?: string | null;
  source?: string | null;
}

export interface LeaveTxnInput {
  id: number;
  employeeId: number;
  name: string;
  department: string | null;
  /** YYYY-MM-DD */
  date: string;
  /** +부여 / −사용 */
  days: number;
  category: string; // STATUTORY | COMP
  note?: string | null;
  requestId?: number | null;
}

/**
 * 평일 휴무 — 구글 캘린더의 `(휴무)김수민` 에서 온다(lib/dayoff.ts).
 * **연차 원장과 아예 다른 표**라 따로 받는다.
 */
export interface DayOffInput {
  id: number;
  employeeId: number;
  name: string;
  department: string | null;
  /** YYYY-MM-DD */
  date: string;
  title?: string | null;
}

export interface LeaveCalendarInput {
  requests: LeaveRequestInput[];
  txns: LeaveTxnInput[];
  dayOffs?: DayOffInput[];
  /** 공휴일 YYYY-MM-DD — 신청 기간을 펼칠 때 건너뛴다 */
  holidays?: string[];
}

/* ───────────── 출력 ───────────── */

/** 달력 한 칸에 들어가는 '어떤 사람의 그날 휴가' */
export interface LeaveDay {
  /** 달력 렌더용 고유 키 */
  key: string;
  date: string;
  employeeId: number;
  name: string;
  department: string | null;
  /** 그날 쓴 일수 — 반차면 0.5 */
  days: number;
  /** 어느 주머니에서 나갔나 (연차/대휴/무차감) */
  pool: LeavePool;
  leaveType: string;
  status: LeaveStatus;
  requestId: number | null;
  note: string | null;
  /** 여러 날짜리의 몇째 날인지 — 툴팁에 쓴다 */
  span: { index: number; total: number } | null;
}

/**
 * 달력 색을 가르는 축 — 연차 주머니에서 깎이는지가 실무에서 가장 먼저 궁금하다.
 *
 * `DAYOFF` 는 **연차가 아니다** — 운영팀이 그 주 토요일 당번 근무 대신 평일 하루를 쉬는 것으로,
 * 근로시간을 옮긴 것이라 잔여에서 깎지 않는다. 달력에는 나오지만 **'이 달 사용' 합계에서는 빠진다**.
 */
export type LeavePool = "ANNUAL" | "COMP" | "UNPAID_POOL" | "DAYOFF";
/** `RECORDED` = 신청서 없이 관리자가 원장에 바로 반영한 것 */
export type LeaveStatus = "PENDING" | "APPROVED" | "CANCEL_PENDING" | "RECORDED";

/** 연차 잔여를 깎는 주머니인가 — 합계·차감 표시를 가르는 하나뿐인 판정 */
export function deductsFromBalance(pool: LeavePool): boolean {
  return pool === "ANNUAL" || pool === "COMP";
}

/** 연차 잔여에서 깎지 않는 종류 (lib/leave-service.ts 의 NON_DEDUCTIBLE_TYPES 와 같은 뜻) */
const NON_DEDUCTIBLE = new Set(["SICK", "SPECIAL"]);

export function poolOf(leaveType: string, category?: string): LeavePool {
  if (NON_DEDUCTIBLE.has(leaveType)) return "UNPAID_POOL";
  if (leaveType === "COMP" || category === "COMP") return "COMP";
  return "ANNUAL";
}

export const POOL_LABEL: Record<LeavePool, string> = {
  ANNUAL: "연차",
  COMP: "대휴",
  UNPAID_POOL: "병가·경조",
  DAYOFF: "휴무",
};

export const LEAVE_DAY_STATUS_LABEL: Record<LeaveStatus, string> = {
  PENDING: "승인 대기",
  APPROVED: "승인",
  CANCEL_PENDING: "취소 요청",
  RECORDED: "관리자 반영",
};

/* ───────────── 펼치기 ───────────── */

const DAY = 86400000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);

/**
 * 시작~종료를 **근무일만** 늘어놓는다. 주말·공휴일은 건너뛴다 —
 * 관리자 반영 경로(`businessDaysFrom`)와 같은 규칙이라야 두 경로가 같은 그림을 그린다.
 *
 * 상한을 두는 이유: 잘못 들어온 종료일(예: 2099년) 하나가 달력을 통째로 멈추게 하면 안 된다.
 */
export function spreadWorkdays(start: string, end: string, holidays: Set<string>): string[] {
  const s = toDate(start);
  const e = toDate(end);
  const last = e.getTime() < s.getTime() ? s : e;
  const out: string[] = [];
  for (let t = s.getTime(); t <= last.getTime() && out.length < 120; t += DAY) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    const key = ymd(d);
    if (dow !== 0 && dow !== 6 && !holidays.has(key)) out.push(key);
  }
  // 하루짜리인데 그날이 주말·공휴일이면 빈손이 된다 — 그래도 **신청은 있었다**.
  // 조용히 지우면 화면에서 사라져 관리자가 못 본다. 그날 그대로 낸다.
  return out.length ? out : [ymd(s)];
}

/** 반차인가 — 종류가 HALF 이거나 0.5일이면 */
function isHalf(leaveType: string, days: number): boolean {
  return leaveType === "HALF" || Math.abs(days) === 0.5;
}

/**
 * 신청서 + 원장 → 날짜별 휴가 목록.
 *
 * **반려·취소된 신청은 빼고**(그날 쉬지 않았다), **부여(+)도 뺀다**(그날 쉰 게 아니다).
 */
export function buildLeaveCalendar(input: LeaveCalendarInput): LeaveDay[] {
  const holidays = new Set(input.holidays ?? []);
  const out: LeaveDay[] = [];

  for (const r of input.requests) {
    if (r.status === "REJECTED" || r.status === "CANCELED") continue;
    // 중간결재 대기(PRE_PENDING)도 달력에서는 승인 대기와 같은 노랑 ⚠ 이다 — 아직 확정 아님
    const status: LeaveStatus =
      r.status === "PENDING" || r.status === "PRE_PENDING"
        ? "PENDING"
        : r.status === "CANCEL_PENDING"
          ? "CANCEL_PENDING"
          : "APPROVED";
    const half = isHalf(r.leaveType, r.days);
    // 반차는 언제나 하루다 — 기간을 펼치면 안 된다
    const dates = half ? [r.startDate] : spreadWorkdays(r.startDate, r.endDate, holidays);
    dates.forEach((date, i) =>
      out.push({
        key: `req-${r.id}-${date}`,
        date,
        employeeId: r.employeeId,
        name: r.name,
        department: r.department,
        days: half ? 0.5 : 1,
        pool: poolOf(r.leaveType),
        leaveType: r.leaveType,
        status,
        requestId: r.id,
        note: r.reason ?? null,
        span: dates.length > 1 ? { index: i + 1, total: dates.length } : null,
      })
    );
  }

  for (const t of input.txns) {
    if (t.days >= 0) continue; // 부여·조정(+)은 달력에 낼 것이 아니다
    if (t.requestId != null) continue; // 신청서의 그림자 — 위에서 이미 그렸다
    const n = Math.abs(t.days);
    out.push({
      key: `txn-${t.id}`,
      date: t.date,
      employeeId: t.employeeId,
      name: t.name,
      department: t.department,
      days: n,
      pool: poolOf("ANNUAL", t.category),
      leaveType: t.category === "COMP" ? "COMP" : "ANNUAL",
      status: "RECORDED",
      requestId: null,
      note: t.note ?? null,
      span: null,
    });
  }

  // 평일 휴무 — 이미 날짜별로 한 줄씩이라 펼칠 것이 없다.
  // **연차가 아니므로** 신청서·원장과 겹칠 일도 없다(다른 표에서 온다).
  for (const d of input.dayOffs ?? [])
    out.push({
      key: `off-${d.id}`,
      date: d.date,
      employeeId: d.employeeId,
      name: d.name,
      department: d.department,
      days: 1,
      pool: "DAYOFF",
      leaveType: "DAYOFF",
      status: "RECORDED",
      requestId: null,
      note: d.title ?? null,
      span: null,
    });

  return sortLeaveDays(out);
}

/** 날짜 → 이름 순. 같은 날 칩이 매번 다른 자리에 뜨면 눈으로 못 좇는다 */
export function sortLeaveDays(days: LeaveDay[]): LeaveDay[] {
  return [...days].sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ko") || a.key.localeCompare(b.key)
  );
}

export function leaveDaysByDate(days: LeaveDay[]): Map<string, LeaveDay[]> {
  const m = new Map<string, LeaveDay[]>();
  for (const d of days) {
    const list = m.get(d.date);
    if (list) list.push(d);
    else m.set(d.date, [d]);
  }
  return m;
}

/* ───────────── 다가오는 휴가 (대시보드) ───────────── */

/** 연달아 붙은 며칠을 한 줄로 묶은 것 */
export interface LeaveBlock {
  key: string;
  employeeId: number;
  name: string;
  department: string | null;
  start: string;
  end: string;
  /** 묶인 날짜 수가 아니라 **일수 합** — 반차가 섞이면 다르다 */
  days: number;
  dates: string[];
  pool: LeavePool;
  leaveType: string;
  status: LeaveStatus;
  note: string | null;
}

/**
 * **연달아 붙은 날을 한 줄로 묶는다** — 같은 사람·같은 주머니·같은 상태이고 날짜가 이어질 때만.
 *
 * 사흘 휴가가 대시보드에 세 줄로 서면 목록이 한 사람으로 다 차서 다른 사람이 안 보인다.
 * '이어짐' 판정은 **근무일 기준**이라 금요일 다음은 월요일이다 — 주말을 낀 휴가가
 * 두 토막으로 갈라지면 실제와 다르게 읽힌다.
 */
export function groupConsecutive(days: LeaveDay[], holidays: string[] = []): LeaveBlock[] {
  const holidaySet = new Set(holidays);
  /** d 다음 근무일 (주말·공휴일 건너뜀) */
  const nextWorkday = (d: string): string => {
    let t = toDate(d).getTime() + DAY;
    for (let i = 0; i < 30; i++) {
      const x = new Date(t);
      const dow = x.getUTCDay();
      if (dow !== 0 && dow !== 6 && !holidaySet.has(ymd(x))) return ymd(x);
      t += DAY;
    }
    return ymd(new Date(t));
  };

  const out: LeaveBlock[] = [];
  for (const d of sortLeaveDays(days)) {
    const prev = out.find(
      (b) =>
        b.employeeId === d.employeeId &&
        b.pool === d.pool &&
        b.status === d.status &&
        (b.end === d.date || nextWorkday(b.end) === d.date)
    );
    if (prev && prev.end !== d.date) {
      prev.end = d.date;
      prev.days += d.days;
      prev.dates.push(d.date);
    } else if (!prev) {
      out.push({
        key: d.key,
        employeeId: d.employeeId,
        name: d.name,
        department: d.department,
        start: d.date,
        end: d.date,
        days: d.days,
        dates: [d.date],
        pool: d.pool,
        leaveType: d.leaveType,
        status: d.status,
        note: d.note,
      });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name, "ko"));
}

/**
 * **오늘부터 N일 안에 잡힌 휴가.** 오늘을 넣는 이유: '지금 자리에 없는 사람' 이
 * '내일 없을 사람' 만큼이나 알고 싶은 정보다.
 *
 * 승인분만이 아니라 **승인 대기도 함께** 낸다 — 모레 시작인데 아직 결재가 안 된 건이
 * 가장 급한 건이고, 그건 승인 대기 목록(생성일 순)에서는 눈에 안 띈다.
 */
export function upcomingLeave(
  days: LeaveDay[],
  now: Date,
  opts: { withinDays?: number; holidays?: string[] } = {}
): LeaveBlock[] {
  const within = opts.withinDays ?? 7;
  const today = ymd(now);
  const until = ymd(new Date(toDate(today).getTime() + (within - 1) * DAY));
  const inWindow = days.filter((d) => d.date >= today && d.date <= until);
  return groupConsecutive(inWindow, opts.holidays);
}

/**
 * "연차 3일" · "반차" — **종류와 일수가 같은 말이면 한 번만** 적는다.
 * 그냥 이어 붙이면 반차가 `반차 반차` 로 나온다(실제로 그랬다).
 */
export function leaveAmountLabel(leaveType: string, days: number, typeLabel: string): string {
  const amount = days === 0.5 ? "반차" : `${days}일`;
  return typeLabel === amount ? amount : `${typeLabel} ${amount}`;
}

/** "오늘" · "내일" · "8월 12일 (수)" — 가까운 날은 요일보다 이 말이 빨리 읽힌다 */
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
export function relativeDayLabel(date: string, now: Date): string {
  const today = ymd(now);
  const diff = Math.round((toDate(date).getTime() - toDate(today).getTime()) / DAY);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff === 2) return "모레";
  const d = toDate(date);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`;
}

/** 한 줄 요약 — "8월 10일 (월) ~ 8월 12일 (수) · 3일" */
export function blockRangeLabel(b: LeaveBlock, now: Date): string {
  const head = relativeDayLabel(b.start, now);
  if (b.start === b.end) return head;
  const e = toDate(b.end);
  return `${head} ~ ${e.getUTCMonth() + 1}월 ${e.getUTCDate()}일 (${WEEK[e.getUTCDay()]})`;
}
