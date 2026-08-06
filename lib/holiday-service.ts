// 공휴일 표 — DB 어댑터 + 특일정보 API 호출.
//
// 판정 규칙은 lib/holidays.ts(순수 함수, 테스트 있음)에 있고 여기서는 읽고 쓰고 부르기만 한다.

import { prisma } from "./db";
import { logActivity } from "./activity";
import {
  holidayApiUrl,
  parseHolidayResponse,
  responseError,
  diffHolidays,
  holidayCoverage,
  yearsToSync,
  BUILTIN_HOLIDAYS,
  type HolidayItem,
  type HolidayCoverage,
} from "./holidays";

/** 저장은 `YYYY-MM-DD` 자정 UTC — 앱 전체가 KST 벽시계를 UTC 필드에 담는 규칙 그대로 */
const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);

export async function listHolidays(year?: number): Promise<HolidayItem[]> {
  const where =
    year != null
      ? { date: { gte: toDate(`${year}-01-01`), lt: toDate(`${year + 1}-01-01`) } }
      : undefined;
  const rows = await prisma.holiday.findMany({ where, orderBy: { date: "asc" } });
  return rows.map((h) => ({ date: toYmd(h.date), name: h.name }));
}

/** 화면 경고용 — 지금 필요한 해가 채워져 있는지 */
export async function holidayStatus(now: Date = new Date()): Promise<HolidayCoverage> {
  const all = await listHolidays();
  return holidayCoverage(
    all.map((h) => h.date),
    now
  );
}

/** 인증키가 있는가 — 없으면 동기화 버튼 대신 안내를 띄운다 */
export function holidayApiConfigured(): boolean {
  return !!(process.env.HOLIDAY_API_KEY || "").trim();
}

export interface SyncYearResult {
  year: number;
  added: number;
  renamed: number;
  /** 표에는 있는데 공휴일 목록에 없는 날 — 지우지 않고 알리기만 한다 */
  extra: HolidayItem[];
  /** 못 읽은 항목 수 (0 이 아니면 API 모양이 바뀐 것이다) */
  skipped: number;
  error?: string;
}

/**
 * 한 해치를 받아 표에 반영한다.
 *
 * **연도만으로 한 번 부르고, 0건이면 달별로 12번 다시 부른다** — 특일정보는 `solMonth` 없이도
 * 그해 전체를 주지만 그러지 않는 시기가 있었다. 0건을 그대로 '공휴일이 없는 해' 로 받아들이면
 * 표가 빈 채로 조용히 넘어간다.
 */
export async function syncHolidayYear(year: number): Promise<SyncYearResult> {
  const key = (process.env.HOLIDAY_API_KEY || "").trim();
  if (!key)
    return { year, added: 0, renamed: 0, extra: [], skipped: 0, error: "HOLIDAY_API_KEY 가 설정되지 않았습니다." };

  let incoming: HolidayItem[] = [];
  let skipped = 0;
  try {
    const one = await fetchHolidays(key, year);
    incoming = one.items;
    skipped = one.skipped;
    if (!incoming.length) {
      for (let m = 1; m <= 12; m++) {
        const r = await fetchHolidays(key, year, m);
        incoming.push(...r.items);
        skipped += r.skipped;
      }
    }
  } catch (e: any) {
    return { year, added: 0, renamed: 0, extra: [], skipped, error: String(e?.message ?? e) };
  }

  // 하나도 못 받았으면 **아무것도 하지 않는다** — 표를 지우지는 않지만, '성공' 으로 보이면
  // 사람이 다시 확인할 이유가 없어진다.
  if (!incoming.length)
    return { year, added: 0, renamed: 0, extra: [], skipped, error: `${year}년 공휴일을 한 건도 받지 못했습니다.` };

  const existing = await listHolidays(year);
  const { add, rename, extra } = diffHolidays(existing, incoming);

  for (const h of add)
    await prisma.holiday.upsert({
      where: { date: toDate(h.date) },
      update: { name: h.name },
      create: { date: toDate(h.date), name: h.name },
    });
  for (const r of rename)
    await prisma.holiday.update({ where: { date: toDate(r.date) }, data: { name: r.to } });

  return { year, added: add.length, renamed: rename.length, extra, skipped };
}

async function fetchHolidays(key: string, year: number, month?: number) {
  const res = await fetch(holidayApiUrl(key, year, month), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`특일정보 API 응답 ${res.status}`);
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    // 인증 실패·서버 오류는 JSON 이 아니라 XML 로 오기도 한다
    throw new Error(`응답을 읽을 수 없습니다: ${text.slice(0, 160)}`);
  }
  const err = responseError(json);
  if (err) throw new Error(err);
  return parseHolidayResponse(json);
}

/** 올해·내년을 한 번에. 한 해가 실패해도 나머지는 계속한다 */
export async function syncHolidays(years?: number[], now: Date = new Date()) {
  const list = years?.length ? years : yearsToSync(now);
  const results: SyncYearResult[] = [];
  for (const y of list) results.push(await syncHolidayYear(y));

  const added = results.reduce((a, r) => a + r.added, 0);
  const renamed = results.reduce((a, r) => a + r.renamed, 0);
  const failed = results.filter((r) => r.error);
  await logActivity({
    action: "HOLIDAY_SYNC",
    summary:
      `공휴일 동기화 — ${list.join("·")}년, ${added}일 추가${renamed ? ` · ${renamed}일 이름 정정` : ""}` +
      (failed.length ? ` (실패 ${failed.length}건)` : ""),
    meta: results,
  }).catch(() => {});
  return { results, added, renamed, coverage: await holidayStatus(now) };
}

/**
 * 인증키 없이 표를 채우는 길 — 코드에 들어 있는 초기 표(2025~2027)를 넣는다.
 *
 * 시딩은 새 DB 에서만 도는 게 아니라 공휴일 부분은 늘 upsert 하지만, 운영 DB 에 `npm run seed`
 * 를 돌리는 것은 부담스럽다(다른 것도 함께 건드린다). **이미 있는 날은 건드리지 않고**
 * 빠진 날만 넣으므로, 사람이 고쳐 둔 이름도 그대로 남는다.
 */
export async function applyBuiltinHolidays() {
  const existing = new Set((await listHolidays()).map((h) => h.date));
  const add = BUILTIN_HOLIDAYS.filter((h) => !existing.has(h.date));
  for (const h of add)
    await prisma.holiday.create({ data: { date: toDate(h.date), name: h.name } }).catch(() => {});
  await logActivity({
    action: "HOLIDAY_SYNC",
    summary: `공휴일 초기 표 적용 — ${add.length}일 추가 (인증키 없이)`,
  }).catch(() => {});
  return { added: add.length, coverage: await holidayStatus() };
}

/** 직접 넣기 — 학원 자체 휴무일이나 API 가 아직 안 실은 임시공휴일 */
export async function upsertHoliday(date: string, name: string) {
  const row = await prisma.holiday.upsert({
    where: { date: toDate(date) },
    update: { name },
    create: { date: toDate(date), name },
  });
  await logActivity({ action: "HOLIDAY_EDIT", summary: `공휴일 등록 — ${date} ${name}` }).catch(() => {});
  return { date: toYmd(row.date), name: row.name };
}

export async function deleteHoliday(date: string) {
  await prisma.holiday.delete({ where: { date: toDate(date) } });
  await logActivity({ action: "HOLIDAY_EDIT", summary: `공휴일 삭제 — ${date}` }).catch(() => {});
}
