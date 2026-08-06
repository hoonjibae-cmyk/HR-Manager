// 공휴일 표 — 관공서 공휴일을 **밖에서 받아 온다** (순수 함수, DB 무관)
//
// 왜 계산하지 않고 받아 오는가:
//  - 설날·추석·부처님오신날은 **음력**이라 그레고리력만으로는 못 구한다.
//  - 대체공휴일은 규칙이 종류마다 다르다(명절 연휴는 일요일과 겹칠 때만, 국경일·어린이날은
//    토요일과 겹쳐도 생긴다). 게다가 규칙 자체가 법 개정으로 바뀌어 왔다.
//  - 지방선거·임시공휴일처럼 **그해에 갑자기 지정되는 날**은 어떤 규칙으로도 나오지 않는다
//    (2026-06-03 제9회 전국동시지방선거가 그 예다).
// 그래서 한국천문연구원 「특일 정보」(공공데이터포털)를 원본으로 삼는다. 대체공휴일과
// 임시공휴일이 모두 들어 있고, 정부 발표를 그대로 따른다.
//
// 이 파일에는 **네트워크가 없다** — URL 을 만들고 응답을 읽고 표를 대조하는 것까지만 한다
// (DB·fetch 는 lib/holiday-service.ts).
//
// 공휴일 표가 하는 일: 휴일근로 가산(§56, lib/overtime.ts) · 직전·내신보강 자동 반영 판정 ·
// 시급제 주휴 개근 판정(lib/timesheet.ts) · 연차 분할 기록(주말·공휴일 건너뛰기).
// **표가 비면 조용히 틀린다** — 공휴일 근무가 평일로 잡혀 ×1.5 가 안 붙는다.
// 그래서 표가 얇은 해를 화면이 경고한다(`holidayCoverage`).

/** 특일정보 서비스 — 공휴일 조회 (`getRestDeInfo`) */
const SPCDE_BASE =
  "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";

export interface HolidayItem {
  /** YYYY-MM-DD */
  date: string;
  name: string;
}

/**
 * 인증키 다듬기 — **포털이 키를 두 벌로 주는데 어느 쪽을 넣어도 되게** 한다.
 *
 * 공공데이터포털 화면에는 `일반 인증키(Encoding)` 와 `(Decoding)` 이 나란히 있고,
 * 안내문마저 "구동되는 키를 사용하시기 바랍니다" 라고 적혀 있어 사람이 고를 수가 없다.
 * 그런데 URL 은 `URLSearchParams` 가 한 번 인코딩하므로 **Encoding 키를 넣으면
 * `%2F` 가 `%252F` 로 두 번 인코딩되어 인증이 통째로 실패**한다(실제로 겪었다).
 *
 * 키는 base64(`A-Za-z0-9+/=`)라 **`%` 가 들어 있을 수 없다** — 있으면 인코딩된 쪽이라는
 * 뜻이므로 풀어서 원본으로 되돌린다. 판정이 애매할 여지가 없어서 이 방법을 골랐다.
 */
export function normalizeServiceKey(raw: string): string {
  let k = String(raw ?? "").trim();
  for (let i = 0; i < 3 && /%[0-9A-Fa-f]{2}/.test(k); i++) {
    let next: string;
    try {
      next = decodeURIComponent(k);
    } catch {
      break; // 반쪽짜리 `%` 가 섞여 있으면 건드리지 않는다
    }
    if (next === k) break;
    k = next;
  }
  return k;
}

/**
 * 조회 URL. `solMonth` 를 주면 그 달만, 없으면 그해 전체.
 *
 * `_type=json` 을 달지만 **포털의 데이터포맷 안내는 XML** 이고 실제로 XML 로 오는 때가
 * 있다(특히 인증 실패 응답). 그래서 읽는 쪽이 둘 다 받는다(`parseHolidayPayload`).
 */
export function holidayApiUrl(serviceKey: string, year: number, month?: number): string {
  const p = new URLSearchParams({
    serviceKey: normalizeServiceKey(serviceKey),
    solYear: String(year),
    numOfRows: "100",
    _type: "json",
  });
  if (month) p.set("solMonth", String(month).padStart(2, "0"));
  return `${SPCDE_BASE}?${p.toString()}`;
}

/** `20260817` → `2026-08-17` */
export function locdateToYmd(v: string | number): string | null {
  const s = String(v).trim();
  if (!/^\d{8}$/.test(s)) return null;
  const [y, m, d] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)];
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return null;
  return `${y}-${m}-${d}`;
}

/**
 * 이름 다듬기 — API 는 `1월1일`·`기독탄신일` 처럼 관보 표기를 그대로 준다.
 * 화면에 그대로 두면 달력이 읽히지 않아 흔히 쓰는 이름으로 바꾼다.
 * **모르는 이름은 손대지 않는다** (임시공휴일·선거일이 여기로 온다).
 */
const NAME_ALIAS: Record<string, string> = {
  "1월1일": "신정",
  기독탄신일: "성탄절",
  "부처님오신날": "부처님오신날",
  "석가탄신일": "부처님오신날",
};
export function normalizeHolidayName(dateName: string): string {
  const t = String(dateName ?? "").trim();
  return NAME_ALIAS[t] ?? (t || "공휴일");
}

/**
 * 특일정보 응답에서 **공휴일만** 추려 낸다.
 *
 * 이 API 는 조용히 모양이 바뀐다 — 걸려 본 것들:
 *  - 결과가 **하나면 `item` 이 배열이 아니라 객체**로 온다.
 *  - 결과가 **없으면 `items` 가 빈 문자열**(`""`)이다. `items.item` 을 그냥 읽으면 터진다.
 *  - `locdate` 가 숫자로도 문자열로도 온다.
 *  - 24절기·잡절이 섞여 오는 엔드포인트가 따로 있어 `isHoliday === "Y"` 를 반드시 본다.
 * 그래서 못 읽는 항목은 **버리지 말고 세어**(`skipped`) 호출부가 알아채게 한다.
 */
export function parseHolidayResponse(json: any): { items: HolidayItem[]; skipped: number } {
  const body = json?.response?.body;
  const raw = body?.items?.item ?? body?.items ?? [];
  const list: any[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];

  const items: HolidayItem[] = [];
  let skipped = 0;
  for (const it of list) {
    const ymd = locdateToYmd(it?.locdate);
    if (!ymd) {
      skipped++;
      continue;
    }
    // isHoliday 가 없는 응답도 있어 '있으면 Y 여야 한다' 로 본다
    if (it?.isHoliday != null && String(it.isHoliday).toUpperCase() !== "Y") continue;
    items.push({ date: ymd, name: normalizeHolidayName(it?.dateName) });
  }
  // 같은 날 여러 줄(연휴 이름이 겹칠 때)은 먼저 온 것을 쓴다
  const seen = new Set<string>();
  return { items: items.filter((h) => !seen.has(h.date) && seen.add(h.date)), skipped };
}

/* ───────────── XML 도 받는다 ───────────── */

const unescapeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/** `<locdate>20260101</locdate>` 한 개 꺼내기 */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? unescapeXml(m[1]) : null;
}

/**
 * XML 응답을 JSON 봉투 모양으로 바꾼다 — 그 뒤는 **JSON 과 똑같은 길**을 탄다.
 *
 * 파서를 따로 두지 않는 이유: 판정·이름 다듬기·중복 제거가 두 벌이 되면 언젠가 갈라진다.
 * 응답이 기계가 뱉는 평평한 XML 이라 정규식으로 충분하고, 의존성을 하나 더 들일 일이 아니다.
 */
export function xmlToEnvelope(xml: string): any {
  // 인증 실패는 아예 다른 봉투로 온다
  const cmm = xml.match(/<cmmMsgHeader>([\s\S]*?)<\/cmmMsgHeader>/);
  if (cmm)
    return {
      OpenAPI_ServiceResponse: {
        cmmMsgHeader: {
          errMsg: tag(cmm[1], "errMsg"),
          returnAuthMsg: tag(cmm[1], "returnAuthMsg"),
          returnReasonCode: tag(cmm[1], "returnReasonCode"),
        },
      },
    };

  const head = xml.match(/<header>([\s\S]*?)<\/header>/)?.[1] ?? "";
  const item = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    locdate: tag(m[1], "locdate"),
    dateName: tag(m[1], "dateName"),
    isHoliday: tag(m[1], "isHoliday"),
  }));

  return {
    response: {
      header: { resultCode: tag(head, "resultCode"), resultMsg: tag(head, "resultMsg") },
      // 0건이면 `<items/>` 라 item 이 없다 — 빈 배열이 곧 그 뜻이다
      body: { items: { item } },
    },
  };
}

/**
 * 응답 본문(문자열)을 봉투로. **JSON 이든 XML 이든 받는다.**
 *
 * 포털의 데이터포맷 안내가 XML 이고 `_type=json` 이 안 먹는 때가 있다. 여기서 갈라 두지 않으면
 * `JSON.parse` 가 터지면서 "응답을 읽을 수 없습니다" 로만 남아 원인이 안 보인다.
 */
export function parseHolidayPayload(text: string): any {
  const t = String(text ?? "").trim();
  if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
  if (t.startsWith("<")) return xmlToEnvelope(t);
  // 둘 다 아니면 JSON 으로 한 번 더 시도하고(BOM·공백), 그래도 아니면 던진다
  return JSON.parse(t);
}

/** 응답 헤더가 정상인가 — 인증키가 틀리면 HTTP 200 에 에러코드가 실려 온다 */
export function responseError(json: any): string | null {
  const h = json?.response?.header;
  const code = h?.resultCode != null ? String(h.resultCode) : null;
  if (code == null) {
    // 인증 실패는 아예 다른 봉투(`OpenAPI_ServiceResponse`)로 온다
    const alt = json?.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (alt) return `${alt.returnAuthMsg ?? alt.errMsg ?? "요청이 거부되었습니다"} (${alt.returnReasonCode ?? "?"})`;
    return "응답을 알아볼 수 없습니다 (형식이 바뀌었을 수 있습니다)";
  }
  if (code === "00" || code === "0") return null;
  return `${h?.resultMsg ?? "오류"} (${code})`;
}

/* ───────────── 표 대조 ───────────── */

export interface HolidayDiff {
  /** 표에 없어 새로 넣을 날 */
  add: HolidayItem[];
  /** 날짜는 있는데 이름이 다른 날 */
  rename: { date: string; from: string; to: string }[];
  /** 표에는 있는데 공휴일 목록에 없는 날 — **지우지 않고 알리기만** 한다 */
  extra: HolidayItem[];
}

/**
 * 받아 온 목록과 지금 표를 견준다.
 *
 * **지우지 않는 이유**: 이 표에는 학원이 직접 넣은 휴무일이 섞여 있을 수 있다.
 * 동기화가 조용히 지우면 그날 근무가 휴일근로에서 빠져 수당이 줄어든다.
 * 그래서 남는 날은 `extra` 로 돌려주고 사람이 보고 지운다.
 */
export function diffHolidays(existing: HolidayItem[], incoming: HolidayItem[]): HolidayDiff {
  const have = new Map(existing.map((h) => [h.date, h.name]));
  const want = new Map(incoming.map((h) => [h.date, h.name]));

  const add: HolidayItem[] = [];
  const rename: HolidayDiff["rename"] = [];
  for (const [date, name] of want) {
    const cur = have.get(date);
    if (cur === undefined) add.push({ date, name });
    else if (cur !== name) rename.push({ date, from: cur, to: name });
  }
  const extra = existing.filter((h) => !want.has(h.date));
  return { add, rename, extra };
}

/* ───────────── 표가 얼마나 채워져 있나 ───────────── */

/** 한 해의 관공서 공휴일은 15~20일쯤 된다. 이보다 적으면 빠진 날이 있다고 본다 */
export const MIN_HOLIDAYS_PER_YEAR = 12;

export interface YearCoverage {
  year: number;
  count: number;
  ok: boolean;
}

export interface HolidayCoverage {
  years: YearCoverage[];
  /** 화면에 띄울 한 줄. 모자란 해가 없으면 null */
  warning: string | null;
}

/**
 * **지금 필요한 해가 채워져 있는가.**
 *
 * 올해는 늘 보고, 하반기(7월 이후)부터는 내년도 함께 본다 — 12월 근무를 1월에 정산하는 일이
 * 있고, 이듬해 공휴일은 보통 그 전해 중반이면 확정돼 API 에 올라온다.
 *
 * 표가 얇아도 **막지 않는다** — 공휴일이 빠지면 그날 근무가 평일로 잡혀 가산이 덜 붙을 뿐
 * 계산이 멈추지는 않는다. 조용히 지나가는 것이 문제라서 경고만 띄운다.
 */
export function holidayCoverage(dates: string[], now: Date = new Date()): HolidayCoverage {
  const count = new Map<number, number>();
  for (const d of dates) {
    const y = Number(String(d).slice(0, 4));
    if (Number.isFinite(y)) count.set(y, (count.get(y) ?? 0) + 1);
  }
  const thisYear = now.getUTCFullYear();
  const need = now.getUTCMonth() + 1 >= 7 ? [thisYear, thisYear + 1] : [thisYear];
  const years = need.map((year) => {
    const c = count.get(year) ?? 0;
    return { year, count: c, ok: c >= MIN_HOLIDAYS_PER_YEAR };
  });

  const bad = years.filter((y) => !y.ok);
  if (!bad.length) return { years, warning: null };
  const parts = bad.map((y) => (y.count === 0 ? `${y.year}년 없음` : `${y.year}년 ${y.count}일뿐`));
  return {
    years,
    warning:
      `공휴일 표가 채워져 있지 않습니다 (${parts.join(" · ")}). ` +
      `공휴일이 빠지면 그날 근무가 평일로 잡혀 휴일근로 가산(×1.5)이 붙지 않고, ` +
      `직전·내신보강도 자동 반영되지 않습니다.`,
  };
}

/** 동기화할 해 — 올해와 내년 (하반기가 아니어도 내년 표가 있으면 받아 둔다) */
export function yearsToSync(now: Date = new Date()): number[] {
  const y = now.getUTCFullYear();
  return [y, y + 1];
}

/* ───────────── 초기값 ───────────── */

/**
 * **인증키가 없을 때 쓰는 초기 표** (2025~2027).
 *
 * ⚠ 손으로 적은 표라 해가 바뀌면 반드시 뒤처진다 — 실제로 2026년 한글날·부처님오신날과
 * 대체공휴일 넷이 통째로 빠져 있었다. 진짜 출처는 특일정보 API 이고 이건 시딩·응급용이다.
 * 동기화는 **넣기만 하고 지우지 않으므로** 나중에 API 로 받아도 부딪히지 않는다.
 *
 * 대체공휴일 규칙이 종류마다 다르다는 것이 이 표를 규칙으로 못 만드는 이유다 —
 * 명절 연휴는 **일요일**과 겹칠 때만, 국경일·어린이날은 **토요일**과 겹쳐도 생긴다.
 * (2026 추석 연휴 9/26 은 토요일이지만 명절이라 대체공휴일이 없다.)
 */
export const BUILTIN_HOLIDAYS: HolidayItem[] = [
  { date: "2025-01-01", name: "신정" },
  { date: "2025-01-28", name: "설날연휴" },
  { date: "2025-01-29", name: "설날" },
  { date: "2025-01-30", name: "설날연휴" },
  { date: "2025-03-01", name: "삼일절" },
  { date: "2025-05-05", name: "어린이날" },
  { date: "2025-05-06", name: "부처님오신날(대체)" },
  { date: "2025-06-06", name: "현충일" },
  { date: "2025-08-15", name: "광복절" },
  { date: "2025-10-03", name: "개천절" },
  { date: "2025-10-06", name: "추석연휴" },
  { date: "2025-10-07", name: "추석" },
  { date: "2025-10-08", name: "추석연휴" },
  { date: "2025-10-09", name: "한글날" },
  { date: "2025-12-25", name: "성탄절" },
  { date: "2026-01-01", name: "신정" },
  { date: "2026-02-16", name: "설날연휴" },
  { date: "2026-02-17", name: "설날" },
  { date: "2026-02-18", name: "설날연휴" },
  { date: "2026-03-01", name: "삼일절" },
  { date: "2026-03-02", name: "대체공휴일(삼일절)" },
  { date: "2026-05-05", name: "어린이날" },
  { date: "2026-05-24", name: "부처님오신날" },
  { date: "2026-05-25", name: "대체공휴일(부처님오신날)" },
  { date: "2026-06-03", name: "제9회 전국동시지방선거" },
  { date: "2026-06-06", name: "현충일" },
  { date: "2026-08-15", name: "광복절" },
  { date: "2026-08-17", name: "대체공휴일(광복절)" },
  { date: "2026-09-24", name: "추석연휴" },
  { date: "2026-09-25", name: "추석" },
  { date: "2026-09-26", name: "추석연휴" },
  { date: "2026-10-03", name: "개천절" },
  { date: "2026-10-05", name: "대체공휴일(개천절)" },
  { date: "2026-10-09", name: "한글날" },
  { date: "2026-12-25", name: "성탄절" },
  { date: "2027-01-01", name: "신정" },
  { date: "2027-02-06", name: "설날연휴" },
  { date: "2027-02-07", name: "설날" },
  { date: "2027-02-08", name: "설날연휴" },
  { date: "2027-02-09", name: "대체공휴일(설날)" },
  { date: "2027-03-01", name: "삼일절" },
  { date: "2027-05-05", name: "어린이날" },
  { date: "2027-05-13", name: "부처님오신날" },
  { date: "2027-06-06", name: "현충일" },
  { date: "2027-08-15", name: "광복절" },
  { date: "2027-08-16", name: "대체공휴일(광복절)" },
  { date: "2027-09-14", name: "추석연휴" },
  { date: "2027-09-15", name: "추석" },
  { date: "2027-09-16", name: "추석연휴" },
  { date: "2027-10-03", name: "개천절" },
  { date: "2027-10-04", name: "대체공휴일(개천절)" },
  { date: "2027-10-09", name: "한글날" },
  { date: "2027-10-11", name: "대체공휴일(한글날)" },
  { date: "2027-12-25", name: "성탄절" },
  { date: "2027-12-27", name: "대체공휴일(성탄절)" },];
