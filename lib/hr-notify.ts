// 경영지원 알림 — 계약 만료 예고 · 생일 (순수 함수, DB·슬랙 무관)
//
// 둘 다 "그날이 되면 알려 준다" 인데 **성질이 정반대**라 판정 방식을 다르게 두었다.
//
//  - **계약 만료**는 놓치면 안 되는 일이다. 재계약서를 준비할 시간이 필요하고, 종료일을 넘기면
//    무기계약 전환·계약 공백 같은 되돌리기 어려운 문제가 된다. 그래서 '오늘이 딱 60일 전인가' 가
//    아니라 **'남은 기간이 예고 창 안에 들었는데 아직 안 알렸는가'** 로 본다.
//    크론이 하루 걸러도, 예고 창 안에서 계약을 새로 만들어도, 예고 일수를 늘려도 반드시 한 번은 나간다.
//    대신 **한 번 알린 계약은 다시 알리지 않는다**(`notifiedAt`) — 매일 같은 알림이 오면 안 읽게 된다.
//  - **생일**은 지나면 뜻이 없다. 하루 늦은 축하는 안 하느니만 못하므로 **그날만** 본다.
//    놓친 날을 따라잡지 않는다.
//
// 시각 판단은 모두 한국시간(KST) 기준 — `lib/scheduler.ts` 의 `kstParts` 를 쓴다.

import { kstParts, sameKstDay, type KstParts } from "./scheduler";
import { probationTimeline } from "./probation";
// 근무일 판정은 **급여명세서 예약 발송과 같은 함수**를 쓴다 — 각자 두면 언젠가 갈라진다
import { isWorkday } from "./holidays";

export { isWorkday };

/* ───────────── 설정 ───────────── */

export interface NotifyTiming {
  enabled: boolean;
  /** 며칠 전에 알릴지 — 계약은 기본 60일(≈2개월), 생일은 0(당일) */
  leadDays: number;
  hour: number;
  minute: number;
  lastRunAt?: Date | null;
}

export const DEFAULT_CONTRACT_TIMING: NotifyTiming = {
  enabled: true,
  leadDays: 60,
  hour: 12,
  minute: 0,
};
export const DEFAULT_BIRTHDAY_TIMING: NotifyTiming = {
  enabled: true,
  leadDays: 0,
  hour: 12,
  minute: 0,
};

/** 기본 수신 부서 — 재계약·경조사 실무를 맡는 곳 */
export const DEFAULT_NOTIFY_DEPARTMENT = "경영지원";

/**
 * 지금 보낼 시각인가.
 *
 * **예정 시각을 지났으면 보낸다**(정각에 못 맞춰도 그날 안에 나간다) — 크론이 매시 정각에만
 * 돌기 때문이다. 같은 한국 날짜에 이미 보냈으면 건너뛴다.
 */
export function notifyDue(
  t: NotifyTiming,
  now: Date,
  opts: { force?: boolean } = {}
): { due: boolean; reason: string } {
  if (opts.force) return { due: true, reason: "강제 실행" };
  if (!t.enabled) return { due: false, reason: "알림 꺼짐" };
  if (t.lastRunAt && sameKstDay(t.lastRunAt, now)) return { due: false, reason: "오늘 이미 보냄" };

  const k = kstParts(now);
  const nowMin = k.hour * 60 + k.minute;
  const wantMin = t.hour * 60 + t.minute;
  if (nowMin < wantMin)
    return {
      due: false,
      reason: `예정 시각 이전 (${hhmm(t)} KST)`,
    };
  return { due: true, reason: "조건 충족" };
}

export function hhmm(t: { hour: number; minute: number }): string {
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

/* ───────────── 날짜 도구 ───────────── */

const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, "0");

/** 한국 날짜 오늘 (YYYY-MM-DD) */
export function kstToday(now: Date): string {
  const k = kstParts(now);
  return `${k.year}-${pad(k.month)}-${pad(k.day)}`;
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return new Date(d.getTime() + n * DAY).toISOString().slice(0, 10);
}

/** 남은 일수 (오늘=0, 내일=1) */
export function daysUntil(target: string, today: string): number {
  return Math.round((new Date(`${target}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY);
}

/**
 * **오늘 함께 안내할 날들** — 오늘 + 뒤이어 붙은 비근무일(다음 근무일 직전까지).
 *
 * 생일이 토·일·공휴일이면 **그 전 마지막 평일**에 알린다. 그 규칙을 뒤집어 보면
 * "오늘이 마지막 평일인 날들" 이 곧 이 창이다 — 금요일에 서면 금·토·일이 함께 잡히고,
 * 광복절이 토요일이면 금·토·일에 더해 대체공휴일인 월요일까지 잡힌다.
 *
 * **오늘이 비근무일이면 빈 배열**이다 — 그날 몫은 이미 지난 금요일에 나갔다.
 * 뒤로 걸어가며 "내가 마지막 평일인가" 를 묻지 않고 앞으로 걷는 이유가 이것이다.
 * 뒤로 걸으면 토요일에 크론이 돌 때 금요일 몫을 한 번 더 보내게 된다.
 *
 * 연휴가 아무리 길어도 멈추도록 상한(14일)을 둔다 — 공휴일 표가 잘못 채워져 있어도
 * 무한히 걷지 않는다.
 */
export function announceWindow(today: string, holidays: string[]): string[] {
  const set = new Set(holidays);
  if (!isWorkday(today, set)) return [];
  const out = [today];
  for (let i = 1; i <= 14; i++) {
    const d = addDays(today, i);
    if (isWorkday(d, set)) break;
    out.push(d);
  }
  return out;
}

/* ───────────── 계약 만료 예고 ───────────── */

export interface ContractRow {
  id: number;
  employeeId: number;
  name: string;
  department: string | null;
  position: string | null;
  stage: string;
  /** YYYY-MM-DD */
  endDate: string | null;
  /** 이미 예고한 계약이면 그 시각 */
  notifiedAt?: Date | null;
  /** ACTIVE | EXPIRED | ... — 끝난 계약은 알리지 않는다 */
  status?: string | null;
}

export interface ContractAlert extends ContractRow {
  endDate: string;
  /** 종료까지 남은 일수 */
  dDay: number;
}

/**
 * 알려야 할 계약.
 *
 * **'딱 N일 전' 이 아니라 '창 안에 들었는가'** 로 본다(머리말 참조). 이미 알린 계약과
 * 종료일이 지난 계약은 뺀다 — 지난 계약은 예고가 아니라 사고이고, 그건 계약 화면의
 * `contractIssues()` 가 맡는다.
 */
export function contractsToAnnounce(
  rows: ContractRow[],
  now: Date,
  leadDays: number
): ContractAlert[] {
  const today = kstToday(now);
  const until = addDays(today, Math.max(0, leadDays));
  return rows
    .filter((c) => !!c.endDate && !c.notifiedAt)
    .filter((c) => c.status !== "TERMINATED")
    .filter((c) => c.endDate! >= today && c.endDate! <= until)
    .map((c) => ({ ...c, endDate: c.endDate!, dDay: daysUntil(c.endDate!, today) }))
    .sort((a, b) => a.dDay - b.dDay || a.name.localeCompare(b.name, "ko"));
}

/* ───────────── 수습 종료 — 본채용 판단 ───────────── */
//
// 계약 만료 예고와 같은 성질이다 — **놓치면 돈이 드는 기한**이라 '딱 그날' 이 아니라
// **'창 안에 들었는데 아직 안 알렸는가'** 로 보고, 한 계약에 한 번만 알린다(`notifiedAt`).
//
// 기준일이 수습 종료일이 아니라 **본채용 거부 통지 기한**(종료 30일 전)인 이유: 3개월 수습은
// 끝나는 날 근속이 3개월이라 근로기준법 §26 의 예고 예외(계속근로 3개월 미만)에 들지 않는다.
// 종료일에 맞춰 알리면 이미 30일 예고를 채울 수 없어 해고예고수당(30일분 통상임금)이 생긴다
// (lib/probation.ts 머리말). 3개월 미만 수습(2026-11 이전의 2개월)은 예외라 종료일이 기준이다.

export const DEFAULT_PROBATION_TIMING: NotifyTiming = {
  enabled: true,
  leadDays: 7,
  hour: 12,
  minute: 0,
};
/** 수습 종료 알림을 올릴 채널(2026-11 지정). 비우면 위의 경영지원 받는 곳(채널 또는 부서 DM)으로 간다 */
export const DEFAULT_PROBATION_CHANNEL = "C057NN63VFT";

export interface ProbationRow {
  /** 계약 id — 한 계약에 한 번만 알린다 */
  id: number;
  employeeId: number;
  name: string;
  department: string | null;
  position: string | null;
  /** 수습이 시작되는 날 = 계약 시작일 (YYYY-MM-DD). 화면·계약서와 같은 기준이다 */
  startDate: string;
  /** 계약 종료일 (YYYY-MM-DD, 기한 없음이면 null) */
  endDate: string | null;
  isProbation: boolean;
  probationMonths: number;
  /** 위탁계약 — 위탁계약서에는 수습 조항이 없다 */
  contractor?: boolean;
  active?: boolean;
  /** 퇴사(예정)일 YYYY-MM-DD */
  resignDate?: string | null;
  status?: string | null;
  /** 이미 알린 계약이면 그 시각 */
  notifiedAt?: Date | null;
}

export interface ProbationAlert extends ProbationRow {
  /** 수습 마지막 날 (민법 §160) */
  probationEnd: string;
  /** 본채용 거부 통지 기한(종료 30일 전) — 수습이 3개월 미만이면 null(§26 예고 예외) */
  noticeBy: string | null;
  /** 판단 기준일 = 통지 기한, 없으면 수습 마지막 날 */
  decideBy: string;
  /** 판단 기준일까지 남은 일수 — 음수면 지났다 */
  dDay: number;
  /** 통지 기한이 지났다 — 지금 거부하면 해고예고수당이 생긴다 */
  overdue: boolean;
}

/**
 * 알려야 할 수습 계약 — 창은 **판단 기준일 `leadDays` 전 ~ 수습 마지막 날**.
 *
 * 통지 기한이 지났어도 수습이 안 끝났으면 알린다(`overdue`) — 늦게 등록한 계약이나 크론이
 * 빠진 날도 놓치지 않게. 수습이 끝난 뒤에는 판단할 것이 없으므로 내지 않는다(그때는 본채용이다).
 *
 * 빼는 것: 위탁계약(수습 조항이 없다), 퇴사자·수습 종료 전에 나가는 사람, 그리고 **계약이
 * 수습 종료일 이전에 끝나는 경우** — 그때는 기간 만료로 끝나는 것이라 계약 종료 예고가 맡는다
 * (본채용 거부 = 해고 틀로 적으면 해고예고가 필요한 것처럼 잘못 읽힌다).
 */
export function probationsToAnnounce(
  rows: ProbationRow[],
  now: Date,
  leadDays: number
): ProbationAlert[] {
  const today = kstToday(now);
  const lead = Math.max(0, leadDays);
  const out: ProbationAlert[] = [];
  for (const r of rows) {
    if (!r.isProbation || r.notifiedAt || r.contractor) continue;
    if (r.active === false || r.status === "TERMINATED") continue;
    const t = probationTimeline(r.startDate, r.probationMonths);
    if (!t) continue;
    if (r.resignDate && r.resignDate <= t.endYmd) continue;
    if (r.endDate && r.endDate <= t.endYmd) continue;
    const decideBy = t.noticeByYmd ?? t.endYmd;
    if (today < addDays(decideBy, -lead) || today > t.endYmd) continue;
    const dDay = daysUntil(decideBy, today);
    out.push({
      ...r,
      probationEnd: t.endYmd,
      noticeBy: t.noticeByYmd,
      decideBy,
      dDay,
      overdue: !!t.noticeByYmd && dDay < 0,
    });
  }
  return out.sort((a, b) => a.decideBy.localeCompare(b.decideBy) || a.name.localeCompare(b.name, "ko"));
}

/**
 * 슬랙이 돌려준 오류 코드 → 할 일. 코드만 띄우면(`not_in_channel`) 무엇을 고칠지 모른다.
 * 앱은 `chat:write.public` 이 있어 공개 채널에는 초대 없이 올리지만, 비공개 채널은 초대가 필요하다.
 */
export function slackErrorHint(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === "not_in_channel" || code === "channel_not_found")
    return "채널을 찾지 못했거나 앱이 그 채널에 없습니다 — 채널 ID(C…)를 확인하고, 비공개 채널이면 채널에서 앱을 먼저 초대해 주세요.";
  if (code === "is_archived") return "보관된 채널입니다 — 다른 채널 ID 를 넣어 주세요.";
  if (code === "invalid_auth" || code === "not_authed" || code === "token_revoked")
    return "슬랙 앱 토큰이 맞지 않습니다(SLACK_BOT_TOKEN).";
  return `슬랙 오류: ${code}`;
}

/* ───────────── 생일 ───────────── */

export interface BirthdayRow {
  id: number;
  name: string;
  department: string | null;
  position: string | null;
  /** YYYY-MM-DD (없거나 모양이 다르면 건너뛴다) */
  birth: string | null;
  hireDate?: string | null;
}

export interface BirthdayAlert extends BirthdayRow {
  /** 축하할 날 = 그 사람의 실제 생일 (leadDays 를 반영한 날) */
  date: string;
  /** 만 나이 — 생년을 모르면 null */
  age: number | null;
  /**
   * 생일이 토·일·공휴일이라 **앞당겨** 알리는가.
   * 문구가 "오늘이 생일" 이라고 적으면 안 되는 날이라 표시가 필요하다.
   */
  shifted: boolean;
}

/** `1990-03-15` · `900315` · `1990.03.15` 을 모두 `MM-DD` 로 */
export function birthMonthDay(birth: string | null | undefined): string | null {
  const s = String(birth ?? "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})$/);
  if (iso) return `${iso[2]}-${iso[3]}`;
  const short = s.match(/^(\d{2})(\d{2})(\d{2})$/); // YYMMDD
  if (short) return `${short[2]}-${short[3]}`;
  return null;
}

/**
 * 생년 — **온전한 날짜일 때만** 읽는다.
 *
 * `900810`(YYMMDD) 의 앞 네 자리를 연도로 집으면 9008년생이 되어 나이가 음수로 나간다
 * (테스트가 잡았다). 두 자리 연도는 세기를 알 수 없으므로 — 90년생인지 1990년인지 2090년인지 —
 * **추측하지 않고 나이를 비운다**. 알림에는 이름·부서가 있으면 충분하다.
 */
function birthYear(birth: string | null | undefined): number | null {
  const m = String(birth ?? "").match(/^(\d{4})[-./]?\d{2}[-./]?\d{2}$/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1900 && y <= 2100 ? y : null;
}

const leapYear = (yy: number) => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;

/**
 * 그 날짜가 챙겨야 할 `MM-DD` 들.
 *
 * **2월 29일생은 평년에 2월 28일로 본다** — 3월 1일로 미루면 생일이 지난 뒤에 축하하게 된다.
 * 어차피 관행이 갈리는 자리라, 늦는 쪽보다 하루 이른 쪽을 골랐다.
 */
function monthDaysFor(date: string): string[] {
  const [y, m, d] = date.split("-").map(Number);
  const md = `${pad(m)}-${pad(d)}`;
  if (m === 2 && d === 28 && !leapYear(y)) return [md, "02-29"];
  return [md];
}

/**
 * **오늘 알려야 할 생일** — 오늘이 생일인 사람 + 생일이 토·일·공휴일이라 앞당겨 알릴 사람.
 *
 * 생일이 주말·공휴일이면 **그 전 마지막 평일**에 알린다. 지나고 나서 하는 축하는 안 하느니만
 * 못하고, 쉬는 날 슬랙으로 축하해 봐야 아무도 안 읽는다. 그래서 늦추지 않고 **앞당긴다**.
 *
 * 구현은 뒤로 걷지 않고 `announceWindow()` 로 **앞으로** 본다 — "오늘이 마지막 평일인 날들"
 * 을 모아 그 날짜의 생일을 함께 낸다. 뒤로 걸으면 토요일 크론이 금요일 몫을 다시 보낸다.
 *
 * `leadDays` 는 창 전체를 그만큼 뒤로 민다 — 알리는 날이 앞당겨지는 것이지 '며칠 전에
 * 알린다' 는 설정이 무시되는 것이 아니다.
 *
 * ⚠ **공휴일 표를 반드시 넘긴다**(기본값을 두지 않은 이유). 안 넘기면 공휴일 생일이
 * 평일로 잡혀 쉬는 날 알림이 나가고, 그 사실이 조용히 묻힌다.
 */
/**
 * **1주일 내 생일** — 오늘부터 `days`일 안(오늘 포함)에 생일인 재직자. 대시보드 카드용.
 *
 * 슬랙 생일 알림(`birthdaysOn`)과 달리 **평일 앞당김을 하지 않는다** — 알림은 쉬는 날
 * 보내면 안 읽혀서 앞당기지만, 대시보드는 사람이 열어 보는 화면이라 실제 생일 날짜
 * 그대로가 맞다. 2월 29일생을 평년에 2월 28일로 보는 규칙(`monthDaysFor`)은 같이 쓴다 —
 * 두 자리를 따로 두면 언젠가 한쪽만 고쳐 갈라진다. 연말(12월 말)에는 창이 해를 넘어
 * 1월 초 생일도 잡는다(`addDays` 가 해 넘김을 처리한다).
 */
export function upcomingBirthdays(
  rows: Array<Pick<BirthdayRow, "name" | "department" | "birth">>,
  today: string,
  days = 7
): Array<{ name: string; department: string | null; date: string; isToday: boolean }> {
  const out: Array<{ name: string; department: string | null; date: string; isToday: boolean }> = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(today, i);
    const mds = monthDaysFor(d);
    for (const r of rows) {
      const md = birthMonthDay(r.birth);
      if (md && mds.includes(md))
        out.push({ name: r.name, department: r.department ?? null, date: d, isToday: i === 0 });
    }
  }
  return out;
}

export function birthdaysOn(
  rows: BirthdayRow[],
  now: Date,
  leadDays: number,
  holidays: string[]
): BirthdayAlert[] {
  const lead = Math.max(0, leadDays);
  // 창은 '알리는 날' 기준이고, 챙기는 생일은 거기서 leadDays 뒤다
  const targets = announceWindow(kstToday(now), holidays).map((d) => addDays(d, lead));
  if (!targets.length) return [];

  // MM-DD → 그 생일이 실제로 있는 날. 앞선 날이 이긴다(같은 MM-DD 가 창에 두 번 들 일은 없다)
  const byMd = new Map<string, string>();
  for (const t of targets) for (const md of monthDaysFor(t)) if (!byMd.has(md)) byMd.set(md, t);

  return rows
    .map((e) => {
      const b = birthMonthDay(e.birth);
      const date = b ? byMd.get(b) : undefined;
      if (!date) return null;
      const by = birthYear(e.birth);
      return {
        ...e,
        date,
        age: by ? Number(date.slice(0, 4)) - by : null,
        shifted: date !== targets[0],
      };
    })
    .filter((x): x is BirthdayAlert => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ko"));
}

/* ───────────── 슬랙 문구 ───────────── */

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
export function dateLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`;
}

const who = (r: { name: string; department: string | null; position: string | null }) =>
  `*${r.name}* (${[r.department, r.position].filter(Boolean).join(" · ") || "소속 미지정"})`;

/**
 * 계약 만료 예고 문구.
 *
 * **무엇을 해야 하는지까지 적는다** — '만료 예정' 만 던지면 받은 사람이 다시 찾아봐야 한다.
 * 남은 일수를 앞에 세워 급한 순으로 읽히게 한다.
 */
export function contractAlertText(
  alerts: ContractAlert[],
  opts: { stageLabel?: Record<string, string>; appUrl?: string | null } = {}
): { text: string; blocks: any[] } {
  const label = (s: string) => opts.stageLabel?.[s] ?? s;
  const head = `📄 *계약 종료 예정 안내* — ${alerts.length}명`;
  const lines = alerts.map((c) => {
    const d = c.dDay === 0 ? "*오늘 종료*" : `*D-${c.dDay}*`;
    return `• ${d} · ${who(c)}\n   ${label(c.stage)} · 종료 ${dateLabel(c.endDate)}`;
  });
  const tail =
    `\n재계약 여부를 확인하고, 이어 갈 계약이면 *신규 계약 작성*(발효일 = 종료 다음 날)으로 ` +
    `기간에 빈틈이 생기지 않게 해 주세요.`;
  const text = [head, "", ...lines, tail].join("\n");

  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: head } },
    ...alerts.map((c) => ({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${c.dDay === 0 ? "*오늘 종료*" : `*D-${c.dDay}*`} · ${who(c)}\n${label(c.stage)} · 종료 ${dateLabel(c.endDate)}`,
      },
      ...(opts.appUrl
        ? {
            accessory: {
              type: "button",
              text: { type: "plain_text", text: "직원 카드", emoji: true },
              url: `${opts.appUrl.replace(/\/$/, "")}/employees/${c.employeeId}`,
            },
          }
        : {}),
    })),
    { type: "context", elements: [{ type: "mrkdwn", text: tail.trim() }] },
  ];
  return { text, blocks };
}

/**
 * 수습 종료 알림 문구 — **할 일과 기한**을 앞에 세운다.
 *
 * 줄마다 판단 기준일까지 남은 날을 먼저 적고(급한 순), 3개월 수습은 통지 기한을 요일까지
 * 적는다(토·일이면 그 전 평일에 건네야 한다). 기한이 지난 건은 무엇이 생기는지까지 적는다 —
 * '지났다' 만 적으면 그래서 어떻게 되는지를 다시 찾아봐야 한다.
 */
export function probationAlertText(
  alerts: ProbationAlert[],
  opts: { appUrl?: string | null } = {}
): { text: string; blocks: any[] } {
  const head = `⏳ *수습 종료 예정 — 본채용 여부 확인* — ${alerts.length}명`;
  const tag = (a: ProbationAlert) =>
    a.overdue
      ? "⚠️ *통지 기한 지남*"
      : a.noticeBy
        ? a.dDay === 0
          ? "*통지 기한 오늘*"
          : `*통지 기한 D-${a.dDay}*`
        : a.dDay === 0
          ? "*수습 종료 오늘*"
          : `*수습 종료 D-${a.dDay}*`;
  const detail = (a: ProbationAlert) => {
    const base = `수습 ${a.probationMonths}개월 · ${a.startDate} ~ ${a.probationEnd}`;
    if (a.overdue)
      return `${base}\n통지 기한(${dateLabel(a.noticeBy!)})이 지났습니다 — 지금 본채용을 거부하면 30일분 통상임금(해고예고수당)이 생깁니다.`;
    if (a.noticeBy)
      return `${base}\n본채용을 하지 않으려면 *${dateLabel(a.noticeBy)}* 까지 사유·종료일을 적어 서면 통지`;
    return `${base}\n근속 3개월 전에 끝나 해고예고 예외 — 본채용을 하지 않으면 종료일 전에 서면 통지`;
  };
  const tail =
    "본채용이면 따로 할 일은 없습니다. 본채용을 하지 않을 때는 사유와 종료일을 적어 *서면*으로 알려야 " +
    "효력이 있고(근로기준법 §27), 근속 3개월부터는 수습 중이어도 30일 전에 예고해야 합니다(§26).";
  const lines = alerts.map((a) => `• ${tag(a)} · ${who(a)}\n   ${detail(a).replace(/\n/g, "\n   ")}`);
  const text = [head, "", ...lines, "", tail].join("\n");

  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: head } },
    ...alerts.map((a) => ({
      type: "section",
      text: { type: "mrkdwn", text: `${tag(a)} · ${who(a)}\n${detail(a)}` },
      ...(opts.appUrl
        ? {
            accessory: {
              type: "button",
              text: { type: "plain_text", text: "직원 카드", emoji: true },
              url: `${opts.appUrl.replace(/\/$/, "")}/employees/${a.employeeId}`,
            },
          }
        : {}),
    })),
    { type: "context", elements: [{ type: "mrkdwn", text: tail }] },
  ];
  return { text, blocks };
}

/**
 * 생일 안내 문구 — 짧게. 여기에 할 일을 길게 붙이면 축하가 업무 지시로 읽힌다.
 *
 * **앞당겨 알리는 사람이 섞이면 날짜를 적는다.** 주말 생일을 금요일에 알리면서 "오늘이
 * 생일" 이라고 쓰면 틀린 말이 되고, 받은 사람이 그날 축하해 버린다. 왜 미리 오는지도
 * 한 줄 붙인다 — 안 적으면 알림이 하루 일찍 잘못 온 것으로 읽힌다.
 */
export function birthdayAlertText(
  alerts: BirthdayAlert[],
  opts: { today?: boolean } = {}
): { text: string; blocks: any[] } {
  const mixed = alerts.some((e) => e.shifted) || alerts.some((e) => e.date !== alerts[0]?.date);
  const when = opts.today === false ? dateLabel(alerts[0]?.date ?? "") : "오늘";
  const head = mixed
    ? `🎂 *생일 안내* — ${alerts.length}명`
    : `🎂 *${when}이 생일인 직원* — ${alerts.length}명`;
  const lines = alerts.map(
    (e) =>
      `• ${who(e)}${e.age != null ? ` · 만 ${e.age}세` : ""}` +
      (mixed ? `\n   🗓 ${dateLabel(e.date)}${e.shifted ? " — 쉬는 날이라 미리 알립니다" : ""}` : "")
  );
  const tail = alerts.some((e) => e.shifted)
    ? "생일이 주말·공휴일인 분은 그 전 마지막 평일인 오늘 함께 안내합니다."
    : null;
  const text = [head, "", ...lines, ...(tail ? ["", tail] : [])].join("\n");
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: head } },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      ...(tail ? [{ type: "context", elements: [{ type: "mrkdwn", text: tail }] }] : []),
    ],
  };
}

/** 알림을 못 보낸 이유를 화면에 그대로 띄우려고 쓴다 */
export function recipientWarning(
  department: string,
  total: number,
  linked: number
): string | null {
  if (total === 0)
    return `‘${department}’ 소속으로 등록된 재직 직원이 없습니다 — 알림이 아무에게도 가지 않습니다.`;
  if (linked === 0)
    return `‘${department}’ 소속 ${total}명 모두 슬랙 계정이 연결되어 있지 않습니다 — 알림이 가지 않습니다. 직원 정보에서 슬랙 계정을 연결해 주세요.`;
  if (linked < total)
    return `‘${department}’ ${total}명 중 ${linked}명만 슬랙 계정이 연결되어 있습니다 — 나머지에게는 가지 않습니다.`;
  return null;
}
