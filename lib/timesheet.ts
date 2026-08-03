// 시급제 시간기록표(엑셀) 파서 및 급여 산정용 집계
//
// 양식: 직원별 5열 블록이 가로·세로로 반복
//   [이름행]  예: "김하연 조교_퇴직"
//   [헤더행]  날짜 | 출근 | 퇴근 | 근무시간
//   [데이터]  날짜(일자) | 시각 | 시각 | 근무시간(h:mm:ss)
//   마지막의 합계(날짜 없는 행)는 무시한다.
//
// 유쌤에듀 규칙:
//  - 기록표 근무시간은 출퇴근 기준이며, 직원별 계약에 따라
//    휴게 30분 유급(breakPaid=true → 그대로 인정) / 무급(false → 근무일마다 0.5h 차감)
//
// 주휴수당 (근로기준법 §55①, §18③) — **1주 단위로, 그 주 실근로시간만 보고 판정한다**.
//
//  이 학원의 시급제는 계약서의 '주당 근로일' 이 문서화용 형식일 뿐이고, **매월 말에 학원이 다음 달
//  근로계획표를 짜서 공지하는 것이 그 달의 소정근로**다. 계획표는 달마다 바뀌고 주마다 다르다.
//  그래서 계약서 주 근무일수로 개근을 따지면 실제와 어긋나고, 4주 평균을 내면 특정 주에
//  많이 일한 사실이 묻힌다. **그 주에 실제로 몇 시간 일했는지가 그 주의 소정근로시간**이다.
//
//  ㉠ 그 주 소정(=실)근로 **15시간 이상** (§18③ — 15시간 '미만' 이 제외이므로 15시간 정각은 대상)
//     한 주라도 15시간을 채우면 **그 주에 한해** 주휴가 발생한다. 다른 주가 미달이어도 상관없다.
//     계획표대로 나온 결과가 실근로이므로 실근로 충족 자체가 개근을 겸한다 —
//     별도의 '근무일수 개근' 판정을 두지 않는다(요일·일수가 매달 바뀌어 판정이 불가능하다).
//     · 연차 사용일은 1일 소정근로시간을 채운 것으로 세고 · 지각·조퇴는 시간만큼만 줄어든다
//  ㉡ 그 주(월~일) 내내 **근로관계 존속** — 주휴일 전에 퇴사하거나 주 중간에 입사하면 미발생
//     (2021.8.4. 임금근로시간과-1736 로 행정해석이 바뀌어, 주휴일까지만 재직하면 8일째
//      근로관계가 없어도 발생한다. '퇴사 주는 무조건 미지급' 은 옛 해석이라 체불이 될 수 있다.)
//  주휴시간 = min(그 주 근로시간 / 5, 8) — 통상근로자 주 소정근로일수(5일)로 나눈 1일분.
//
//  **시급제에는 연장·휴일 가산을 따로 붙이지 않는다.** 주 15시간을 넘긴 주마다 주휴를 인정해 주는
//  것이 그 자리를 대신해 온 구조이고, 1일 4.5시간 내외·주 20시간 안쪽이라 법정 가산 요건
//  (1일 8시간·주 40시간 초과)에 애초에 닿지 않는다. 보강 오버타임(lib/overtime.ts)만 별도 산정한다.
//
//  근로시간표(Employee.schedule)는 이제 주휴 판정에 쓰지 않는다 — **연차를 쓴 날 몇 시간을
//  채운 것으로 볼지**(1일 소정근로시간) 계산에만 쓴다.
//
// 연차(유급휴가): 연차를 쓴 날은 기록표가 비지만 **1일 소정근로시간을 채운 것으로 본다**.
//  그만큼 급여 산정시간에 더하고 개근에도 출근으로 센다. 반차는 0.5일로 비례한다.
//
// 시간 구분 — 명세서가 셋을 나눠 보여준다.
//  체류시간(stay)   기록표의 출근~퇴근 그대로
//  휴게시간(break)  근무일마다 30분 (Employee.breakPaid 로 유급/무급)
//  순 근로시간(net) 체류 − 휴게
//  급여 산정시간    휴게 유급이면 체류, 무급이면 순 근로 (+ 연차 유급시간)

import * as XLSX from "xlsx";
import type { ScheduleDay } from "./constants";

export interface TimesheetEntry {
  date: string; // YYYY-MM-DD
  hours: number; // 그날 근무시간 (기록표 원본, 시간 단위 소수)
}

export interface TimesheetPerson {
  rawName: string; // 시트에 적힌 원문 (예: "김하연 조교_퇴직")
  name: string; // 정규화된 이름 (예: "김하연")
  entries: TimesheetEntry[];
  /**
   * 날짜는 읽었는데 근무시간을 못 읽어 버린 행 수.
   * 이런 날은 '결근' 으로 잡혀 주휴가 날아가므로 **조용히 넘기지 않고 화면에 알린다**.
   */
  skipped: number;
}

/** "김하연 조교_퇴직" → "김하연" (공백 제거, _접미사 제거, 직책어 제거) */
export function normalizeName(raw: string): string {
  return String(raw)
    .replace(/_.*$/, "")
    .replace(/\s+/g, "")
    .replace(/(조교장|조교|강사|주임|팀장|실장|선생님|쌤)$/g, "")
    .trim();
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // 1899-12-30

function serialToYmd(serial: number): string {
  const ms = EXCEL_EPOCH_MS + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 근무시간 셀 → 시간(소수). 못 읽으면 null.
 *
 * 이 열은 보통 `퇴근−출근` 수식이라 엑셀 시간값(하루 = 1)으로 들어오지만,
 * 사람이 손으로 고친 칸은 **그냥 숫자(5)** 나 **문자("5:00")** 로 들어온다.
 * 예전에는 그런 칸을 통째로 버려서 그날이 결근으로 잡혔고, 그 주 주휴가 사라졌다.
 */
export function parseHourCell(v: unknown): number | null {
  let h: number | null = null;
  if (typeof v === "number") {
    if (!isFinite(v) || v <= 0) return null;
    // 1 미만이면 엑셀 시간값(하루 비율), 그 이상이면 사람이 적은 '시간' 으로 본다
    h = v < 1 ? v * 24 : v;
  } else if (v instanceof Date) {
    h = v.getUTCHours() + v.getUTCMinutes() / 60 + v.getUTCSeconds() / 3600;
  } else if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const hm = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/); // 5:00 / 5:00:00
    if (hm) h = +hm[1] + +hm[2] / 60 + (+(hm[3] ?? 0)) / 3600;
    else {
      const kr = s.match(/^(\d+(?:\.\d+)?)\s*시간?\s*(?:(\d+)\s*분)?$/); // 5시간 30분
      if (kr) h = +kr[1] + (+(kr[2] ?? 0)) / 60;
      else if (/^\d+(\.\d+)?$/.test(s)) h = +s;
    }
  }
  if (h === null || !isFinite(h) || h <= 0 || h > 24) return null; // 합계행(>24h)·이상치 제외
  return h;
}

/** 날짜 셀 → YYYY-MM-DD. 못 읽으면 null. 연도가 없는 표기(7/20)는 나중에 채운다. */
export function parseDateCell(v: unknown): { date?: string; month?: number; day?: number } | null {
  if (typeof v === "number") {
    if (!isFinite(v) || v < 36526) return null; // 2000-01-01 미만 = 날짜가 아닌 숫자(일자만 적힌 칸 등)
    return { date: serialToYmd(v) };
  }
  if (v instanceof Date) return { date: new Date(v).toISOString().slice(0, 10) };
  if (typeof v !== "string") return null;
  const s = v.trim();
  const full = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (full)
    return { date: `${full[1]}-${String(+full[2]).padStart(2, "0")}-${String(+full[3]).padStart(2, "0")}` };
  const md = s.match(/^(\d{1,2})[-./](\d{1,2})$/) ?? s.match(/^(\d{1,2})월\s*(\d{1,2})일/);
  if (md) return { month: +md[1], day: +md[2] };
  return null;
}

/** 엑셀 버퍼 → 직원별 일자/근무시간 목록 (모든 시트 스캔) */
export function parseTimesheetWorkbook(buf: Buffer | Uint8Array): TimesheetPerson[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const people: TimesheetPerson[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const ref = ws["!ref"];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell || cell.v !== "날짜") continue;
        const next = ws[XLSX.utils.encode_cell({ r, c: c + 1 })];
        if (!next || String(next.v).trim() !== "출근") continue;

        // 이름: 헤더 위쪽 1~2행에서 같은 열 부근의 문자열 탐색
        let rawName = "";
        outer: for (let nr = r - 1; nr >= Math.max(range.s.r, r - 2); nr--) {
          for (let nc = c; nc <= c + 3; nc++) {
            const ncell = ws[XLSX.utils.encode_cell({ r: nr, c: nc })];
            if (ncell && typeof ncell.v === "string" && ncell.v.trim() && ncell.v !== "날짜") {
              rawName = ncell.v.trim();
              break outer;
            }
          }
        }
        if (!rawName) continue;

        const entries: TimesheetEntry[] = [];
        const partials: { month: number; day: number; hours: number }[] = []; // 연도 없는 날짜(7/20)
        let skipped = 0;
        for (let dr = r + 1; dr <= range.e.r; dr++) {
          const dCell = ws[XLSX.utils.encode_cell({ r: dr, c })];
          // 다음 표의 시작(다시 '날짜' 헤더)이나 새 이름을 만나면 종료
          if (dCell && dCell.v === "날짜") break;
          const parsedDate = dCell ? parseDateCell(dCell.v) : null;
          if (!parsedDate) {
            // 날짜 없는 행: 합계/빈행 — 계속 스캔하되 연속 6행 비면 종료
            let empty = 0;
            for (let k = dr; k < dr + 6 && k <= range.e.r; k++) {
              const kd = ws[XLSX.utils.encode_cell({ r: k, c })];
              if (!kd || !parseDateCell(kd.v)) empty++;
              else break;
            }
            if (empty >= 6) break;
            continue;
          }
          const hCell = ws[XLSX.utils.encode_cell({ r: dr, c: c + 3 })];
          const hours = parseHourCell(hCell?.v);
          if (hours === null) {
            skipped++; // 날짜는 있는데 근무시간을 못 읽음 — 결근으로 오인되지 않게 보고한다
            continue;
          }
          if (parsedDate.date) entries.push({ date: parsedDate.date, hours });
          else partials.push({ month: parsedDate.month!, day: parsedDate.day!, hours });
        }

        // 연도 없는 날짜는 같은 표의 온전한 날짜에서 연도를 빌려 온다
        if (partials.length > 0) {
          const years = entries.map((e) => Number(e.date.slice(0, 4)));
          const year = years.length ? years[0] : null;
          for (const p of partials) {
            if (year === null) {
              skipped++;
              continue;
            }
            entries.push({
              date: `${year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
              hours: p.hours,
            });
          }
        }

        if (entries.length > 0 || skipped > 0) {
          people.push({ rawName, name: normalizeName(rawName), entries, skipped });
        }
      }
    }
  }

  // 같은 이름이 여러 표에 나뉘어 있으면 병합
  const merged = new Map<string, TimesheetPerson>();
  for (const p of people) {
    const ex = merged.get(p.name);
    if (ex) {
      ex.entries.push(...p.entries);
      ex.skipped += p.skipped;
    } else merged.set(p.name, { ...p, entries: [...p.entries] });
  }
  return [...merged.values()].filter((p) => p.entries.length > 0 || p.skipped > 0);
}

/** 기록표 전체에서 가장 많이 등장하는 연·월 감지 (화면 선택과 무관하게 파일 기준) */
export function dominantPeriod(
  people: TimesheetPerson[]
): { year: number; month: number } | null {
  const count = new Map<string, number>();
  for (const p of people)
    for (const e of p.entries) {
      const k = e.date.slice(0, 7); // YYYY-MM
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of count)
    if (c > n) {
      best = k;
      n = c;
    }
  if (!best) return null;
  return { year: Number(best.slice(0, 4)), month: Number(best.slice(5, 7)) };
}

/**
 * 기록표 이름 → 직원 매칭.
 * 1) 정규화(직책어·_접미사 제거) 후 완전 일치
 * 2) 실패 시 포함 검색: 원문에 직원 이름이 들어있으면 매칭
 *    (후보가 여럿이면 더 긴 이름 우선, 그래도 모호하면 ambiguous 반환)
 */
export function matchEmployee<T extends { name: string }>(
  rawName: string,
  employees: T[]
): { emp?: T; ambiguous?: T[] } {
  const norm = normalizeName(rawName);
  const exact = employees.filter((e) => normalizeName(e.name) === norm);
  if (exact.length === 1) return { emp: exact[0] };
  if (exact.length > 1) return { ambiguous: exact };

  const rawCompact = String(rawName).replace(/\s+/g, "");
  const contains = employees.filter((e) => {
    const n = e.name.replace(/\s+/g, "");
    return n.length >= 2 && rawCompact.includes(n);
  });
  if (contains.length === 1) return { emp: contains[0] };
  if (contains.length > 1) {
    const sorted = [...contains].sort((a, b) => b.name.length - a.name.length);
    if (sorted[0].name.length > sorted[1].name.length) return { emp: sorted[0] };
    return { ambiguous: contains };
  }
  return {};
}

export interface WeekSummary {
  weekStart: string; // 해당 주 월요일 (YYYY-MM-DD)
  weekEnd: string; // 해당 주 일요일 = 주휴일
  hours: number; // 주 실근로(휴게 차감 후)
  /** 그 주 소정근로시간 (계약 근로시간표 기준). 시간표가 없으면 실근로로 갈음 */
  contractualHours: number;
  /** 그 주에 채워야 할 근무일수 (계약 주 근무일수 − 그 주 공휴일수) */
  requiredDays: number;
  /** 실제로 센 근무일수 (출근 기록 + 연차 사용일) */
  attendedDays: number;
  /** 그 주 연차 사용일수 */
  leaveDays: number;
  /** 출근·연차로 센 날짜들 (왜 개근/결근인지 화면에서 바로 보이게) */
  attendedDates: string[];
  /** 기록이 없는 구간이 걸쳐 있어 판정이 불완전한 주 */
  partial: boolean;
  /**
   * 그 주 소정(=실)근로시간 — 달 경계를 넘어 주 전체. 휴게는 `breakPaid` 기준으로 차감하고
   * 연차 사용일은 1일 소정근로시간을 채운 것으로 본다. **주휴 판정의 유일한 근거**.
   */
  actualHours: number;
  eligible: boolean; // ㉠ 그 주 소정(=실)근로 15시간 이상
  employedWholeWeek: boolean; // ㉡ 주 내내 근로관계 존속
  qualified: boolean; // 둘 다 충족
  holidayHours: number; // 부여 주휴시간 = 그 주 근로시간 ÷ 5 (상한 8h)
  /** 미발생 사유 (화면·명세서 설명용) */
  reason?: string;
}

export interface MonthlyTimesheetResult {
  /** 학원 체류시간 — 기록표의 출근~퇴근 그대로 */
  stayHours: number;
  /** 차감한 휴게시간 합계 (근무일 × 0.5h) */
  breakHours: number;
  /** 순 근로시간 = 체류 − 휴게 */
  netHours: number;
  /** 연차 사용으로 유급 인정한 시간 */
  leaveHours: number;
  /** 연차 사용일수 */
  leaveDays: number;
  /** 급여 산정 기준 시간 = (휴게 유급이면 체류, 무급이면 순 근로) + 연차 유급시간 */
  paidHours: number;
  workedDays: number; // 출근 기록이 있는 날 수
  weeklyHolidayHours: number; // 월 주휴시간 합계
  weeks: WeekSummary[];
  /** 근로시간표가 없어 옛 방식(실근로 기준)으로 갈음했는가 */
  noSchedule: boolean;
  /** 1일 소정근로시간 (연차 환산 기준) = 계약 주 근로시간 ÷ 주 근무일수 */
  dailyContractual: number;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(s + "T00:00:00Z");
/** 사람이 읽을 시간 — 소수 첫째 자리 */
const r1 = (n: number) => Math.round(n * 10) / 10;

function mondayOf(dateStr: string): string {
  const d = day(dateStr);
  const dow = d.getUTCDay(); // 0=일
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return ymd(d);
}

function addDays(dateStr: string, n: number): string {
  const d = day(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

const DOW_KEY: ScheduleDay["day"][] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "HH:MM" → 시(소수) */
function hhmm(s: string): number {
  const [h, m] = String(s || "0:00").split(":").map((n) => parseInt(n, 10));
  return (h || 0) + (m || 0) / 60;
}

/** 그 요일의 소정근로시간 (휴게 제외). 근무일이 아니면 0 */
function scheduledHoursOn(schedule: ScheduleDay[], dow: number): number {
  const d = schedule.find((x) => x.day === DOW_KEY[dow]);
  if (!d?.work) return 0;
  let dur = hhmm(d.end) - hhmm(d.start);
  if (dur <= 0) dur += 24;
  return Math.max(dur - (d.breakH || 0), 0);
}

export interface LeaveUse {
  date: string; // YYYY-MM-DD
  days: number; // 1=종일, 0.5=반차
}

export interface MonthlyOptions {
  year: number;
  month: number;
  /** 휴게 30분 유급 여부 (false 면 근무일마다 0.5h 차감) */
  breakPaid: boolean;
  /** 계약 근로시간표 — 주 소정근로시간·주 근무일수의 근거. 없으면 옛 방식으로 갈음 */
  schedule?: ScheduleDay[];
  /** 공휴일 (YYYY-MM-DD) — 그 주에 채워야 할 근무일수를 그만큼 줄인다 */
  holidays?: string[];
  /** 연차·유급휴가 사용 — 출근으로 세고, 1일 소정근로시간만큼 유급 인정 */
  leaveUses?: LeaveUse[];
  /** 연차를 유급으로 인정할 직원인가 (초단시간 등 연차 미적용이면 false) */
  leavePaid?: boolean;
  /** 입사일 — 주 중간 입사면 그 주 주휴 미발생 */
  hireDate?: string | null;
  /** 퇴사일 — 주휴일 전에 퇴사하면 그 주 주휴 미발생 */
  resignDate?: string | null;
  /**
   * 이 직원의 기록이 존재하는 가장 이른 날짜 (YYYY-MM-DD).
   * 이보다 앞선 날은 '결근' 이 아니라 '기록 없음' 이므로 개근 판정에서 빼고 partial 로 표시한다.
   * (첫 업로드 달의 첫 주처럼 앞달 기록이 아예 없는 경우)
   */
  knownFrom?: string | null;
}

/** 계약 근로시간표에서 주 소정근로시간·주 근무일수를 뽑는다 */
function weeklyPlan(schedule: ScheduleDay[]) {
  let hours = 0;
  let days = 0;
  for (let dow = 0; dow < 7; dow++) {
    const h = scheduledHoursOn(schedule, dow);
    if (h <= 0) continue;
    hours += h;
    days++;
  }
  return { hours, days };
}

/**
 * 한 직원의 월 집계 (시간 구분 + 주휴수당).
 *
 * 개근은 **근무일수**로 본다 — 계약 주3일이면 그 주에 3일 이상 나왔는지만 보고 요일은 따지지
 * 않는다. 근무 요일이 학원 사정으로 매달 바뀌기 때문(월수 → 월목 → 화수).
 * 달을 걸친 주는 **주휴일(일요일)이 속한 달**에서 한 번만 센다 — 양쪽 달에서 각각 세면
 * 이중 지급이 되고, 어느 쪽에서도 안 세면 누락된다.
 */
export function computeMonthlyFromEntries(
  entries: TimesheetEntry[],
  opts: MonthlyOptions
): MonthlyTimesheetResult {
  const prefix = `${opts.year}-${String(opts.month).padStart(2, "0")}-`;
  const schedule = opts.schedule ?? [];
  const plan = weeklyPlan(schedule);
  const hasSchedule = plan.days > 0;
  const holidays = new Set(opts.holidays ?? []);
  const dailyContractual = hasSchedule ? plan.hours / plan.days : 0;

  // 연차 사용 — 같은 날 중복은 합산하고 1일을 넘지 않게 자른다
  const leaveByDate = new Map<string, number>();
  for (const l of opts.leaveUses ?? []) {
    const d = Math.min(Math.abs(l.days), 1);
    if (d <= 0) continue;
    leaveByDate.set(l.date, Math.min((leaveByDate.get(l.date) ?? 0) + d, 1));
  }
  const leavePaid = opts.leavePaid !== false && hasSchedule;

  // 출근 기록 — 개근 판정에는 달 밖의 기록도 쓴다 (달을 걸친 주 때문에)
  const allDaily = new Map<string, number>();
  for (const e of entries) allDaily.set(e.date, (allDaily.get(e.date) ?? 0) + e.hours);

  // ── 월 합계 (대상 월 기록만) ──
  let stayHours = 0;
  let breakHours = 0;
  let workedDays = 0;
  const weekNet = new Map<string, number>();
  for (const [date, raw] of allDaily) {
    if (!date.startsWith(prefix) || raw <= 0) continue;
    const brk = Math.min(0.5, raw); // 근무가 30분보다 짧으면 그만큼만
    stayHours += raw;
    breakHours += brk;
    workedDays++;
    const net = Math.max(raw - brk, 0);
    const wk = mondayOf(date);
    weekNet.set(wk, (weekNet.get(wk) ?? 0) + (opts.breakPaid ? raw : net));
  }
  const netHours = Math.max(stayHours - breakHours, 0);

  let leaveDays = 0;
  for (const [date, d] of leaveByDate) if (date.startsWith(prefix)) leaveDays += d;
  const leaveHours = leavePaid ? leaveDays * dailyContractual : 0;

  // 급여 산정 기준 = (휴게 유급이면 체류, 무급이면 순 근로) + 연차 유급시간
  const paidHours = (opts.breakPaid ? stayHours : netHours) + leaveHours;

  // ── 주휴 판정 ──
  // 주휴일(일요일)이 이 달에 있는 주 전부를 훑는다. 기록이 없는 주도 '결근으로 미발생' 이라는
  // 사실을 남겨야 하므로 함께 본다.
  const monthEnd = new Date(Date.UTC(opts.year, opts.month, 0));
  const weekStarts: string[] = [];
  for (let d = 1; d <= monthEnd.getUTCDate(); d++) {
    const date = `${prefix}${String(d).padStart(2, "0")}`;
    if (day(date).getUTCDay() !== 0) continue; // 일요일만
    weekStarts.push(mondayOf(date));
  }
  for (const wk of weekNet.keys()) if (!weekStarts.includes(wk)) weekStarts.push(wk);
  weekStarts.sort();

  /**
   * 그 주(월~일) 실근로시간 — 달 경계를 넘어 전 기간.
   * 휴게 차감은 급여 산정과 같은 기준(`breakPaid`)을 쓴다 — 유급휴게는 근로시간에 산입되므로
   * 여기서만 따로 빼면 계약 소정시간과 견줄 수 없다. 연차는 1일 소정시간을 채운 것으로 본다.
   */
  const actualWeek = (ws: string) => {
    let h = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(ws, i);
      const raw = allDaily.get(date) ?? 0;
      if (raw > 0) h += opts.breakPaid ? raw : Math.max(raw - Math.min(0.5, raw), 0);
      h += (leaveByDate.get(date) ?? 0) * dailyContractual;
    }
    return h;
  };

  const weeks: WeekSummary[] = weekStarts.map((weekStart) => {
    const weekEnd = addDays(weekStart, 6);
    const hours = weekNet.get(weekStart) ?? 0;

    // ㉢ 1주 내내 근로관계 존속 (주 중간 입사·주휴일 전 퇴사면 불충족)
    const employedWholeWeek =
      (!opts.hireDate || opts.hireDate <= weekStart) &&
      (!opts.resignDate || opts.resignDate >= weekEnd);

    // 그 주의 출근일수·연차일수·공휴일수
    const attendedDates: string[] = [];
    let weekLeave = 0;
    let weekHolidays = 0;
    let unknownDays = 0; // 기록이 아예 없는 구간 (앞달을 안 올린 경우)
    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i);
      const worked = (allDaily.get(date) ?? 0) > 0;
      const lv = leaveByDate.get(date) ?? 0;
      if (worked || lv > 0) attendedDates.push(date); // 연차는 출근으로 본다
      if (lv > 0) weekLeave += lv;
      // 일요일 공휴일은 원래 휴무라 근무일수를 줄이지 않는다
      if (holidays.has(date) && day(date).getUTCDay() !== 0) weekHolidays++;
      if (opts.knownFrom && date < opts.knownFrom && !worked && lv <= 0) unknownDays++;
    }
    const attendedDays = attendedDates.length;
    const partial = unknownDays > 0;
    // 그 달 소정근로시간 = 그 주 실근로시간. 학원이 매월 짜 주는 근로계획표대로 나온 결과이므로
    // 실근로가 곧 그 주의 소정근로다.
    const actualHours = actualWeek(weekStart);

    // ㉠ 그 주 소정(=실)근로 15시간 이상 (§18③ '미만' 이 제외 → 15시간 정각은 대상)
    const eligible = actualHours >= 15;
    // 기록이 없는 날이 걸쳐 있으면 그 주 근로시간을 다 알 수 없다 —
    // 모르는 날을 0으로 깔면 15시간에 못 미쳐 주휴가 부당하게 빠지므로 **보류하고 사람이 본다**.
    const qualified = eligible && employedWholeWeek && !partial;

    return {
      weekStart,
      weekEnd,
      hours,
      contractualHours: hasSchedule ? plan.hours : hours,
      requiredDays: hasSchedule ? plan.days : 0,
      attendedDays,
      leaveDays: weekLeave,
      attendedDates,
      partial,
      actualHours: r1(actualHours),
      eligible,
      employedWholeWeek,
      qualified,
      // 주휴시간 = 그 주 소정근로시간 ÷ 통상근로자 주 소정근로일수(5), 상한 8시간
      holidayHours: qualified ? Math.min(actualHours / 5, 8) : 0,
      reason: qualified
        ? undefined
        : partial
        ? `앞달 기록 ${unknownDays}일이 없어 판정 보류 (확인된 근로 ${r1(actualHours)}시간 / 15시간)`
        : !employedWholeWeek
        ? opts.resignDate && opts.resignDate < weekEnd
          ? `퇴사일(${opts.resignDate})이 주휴일(${weekEnd}) 이전`
          : `입사일(${opts.hireDate})이 주 시작(${weekStart}) 이후`
        : `주 근로 ${r1(actualHours)}시간 (15시간 미만 — §18③)`,
    };
  });

  // 주휴는 '주휴일이 이 달에 있는 주' 만 이 달에 싣는다 (달을 걸친 주의 이중 지급 방지)
  const weeklyHolidayHours = weeks
    .filter((w) => w.weekEnd.startsWith(prefix))
    .reduce((s, w) => s + w.holidayHours, 0);

  const r2 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    stayHours: r2(stayHours),
    breakHours: r2(breakHours),
    netHours: r2(netHours),
    leaveHours: r2(leaveHours),
    leaveDays: r2(leaveDays),
    paidHours: r2(paidHours),
    workedDays,
    weeklyHolidayHours: r2(weeklyHolidayHours),
    weeks,
    noSchedule: !hasSchedule,
    dailyContractual: r2(dailyContractual),
  };
}
