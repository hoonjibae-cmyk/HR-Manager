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
  /** 축하할 날 (오늘 또는 leadDays 뒤) */
  date: string;
  /** 만 나이 — 생년을 모르면 null */
  age: number | null;
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

/**
 * 오늘(또는 `leadDays` 뒤)이 생일인 사람.
 *
 * **2월 29일생은 평년에 2월 28일로 본다** — 3월 1일로 미루면 생일이 지난 뒤에 축하하게 된다.
 * 어차피 관행이 갈리는 자리라, 늦는 쪽보다 하루 이른 쪽을 골랐다.
 */
export function birthdaysOn(rows: BirthdayRow[], now: Date, leadDays = 0): BirthdayAlert[] {
  const date = addDays(kstToday(now), Math.max(0, leadDays));
  const [y, m, d] = date.split("-").map(Number);
  const isFeb28 = m === 2 && d === 28;
  const leap = (yy: number) => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
  const md = `${pad(m)}-${pad(d)}`;

  return rows
    .filter((e) => {
      const b = birthMonthDay(e.birth);
      if (!b) return false;
      if (b === md) return true;
      // 평년의 2월 28일에는 2월 29일생도 함께 본다
      return isFeb28 && !leap(y) && b === "02-29";
    })
    .map((e) => {
      const by = birthYear(e.birth);
      return { ...e, date, age: by ? y - by : null };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
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

/** 생일 안내 문구 — 짧게. 여기에 할 일을 길게 붙이면 축하가 업무 지시로 읽힌다 */
export function birthdayAlertText(
  alerts: BirthdayAlert[],
  opts: { today?: boolean } = {}
): { text: string; blocks: any[] } {
  const when = opts.today === false ? dateLabel(alerts[0]?.date ?? "") : "오늘";
  const head = `🎂 *${when}이 생일인 직원* — ${alerts.length}명`;
  const lines = alerts.map((e) => `• ${who(e)}${e.age != null ? ` · 만 ${e.age}세` : ""}`);
  const text = [head, "", ...lines].join("\n");
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: head } },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
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
