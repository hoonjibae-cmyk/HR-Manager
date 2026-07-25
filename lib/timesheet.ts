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
//  - 주휴수당: 1주(월~일) 실근로시간(휴게 차감 후)이 15시간을 "초과"하면 지급.
//    계약상 소정근로가 15시간 미만이어도 실근로 기준으로 판단.
//    주휴시간 = min(주 실근로 / 5, 8) — 초과분에 대한 별도 가산수당은 없음(시급 100%).

import * as XLSX from "xlsx";

export interface TimesheetEntry {
  date: string; // YYYY-MM-DD
  hours: number; // 그날 근무시간 (기록표 원본, 시간 단위 소수)
}

export interface TimesheetPerson {
  rawName: string; // 시트에 적힌 원문 (예: "김하연 조교_퇴직")
  name: string; // 정규화된 이름 (예: "김하연")
  entries: TimesheetEntry[];
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
        for (let dr = r + 1; dr <= range.e.r; dr++) {
          const dCell = ws[XLSX.utils.encode_cell({ r: dr, c })];
          // 다음 표의 시작(다시 '날짜' 헤더)이나 새 이름을 만나면 종료
          if (dCell && dCell.v === "날짜") break;
          const hCell = ws[XLSX.utils.encode_cell({ r: dr, c: c + 3 })];
          const isDate =
            dCell && (typeof dCell.v === "number" || dCell.v instanceof Date);
          if (!isDate) {
            // 날짜 없는 행: 합계/빈행 — 계속 스캔하되 연속 6행 비면 종료
            let empty = 0;
            for (let k = dr; k < dr + 6 && k <= range.e.r; k++) {
              const kd = ws[XLSX.utils.encode_cell({ r: k, c })];
              if (!kd || (typeof kd.v !== "number" && !(kd.v instanceof Date))) empty++;
              else break;
            }
            if (empty >= 6) break;
            continue;
          }
          if (!hCell || typeof hCell.v !== "number" || hCell.v <= 0) continue;

          const dateStr =
            typeof dCell.v === "number"
              ? serialToYmd(dCell.v)
              : new Date(dCell.v as Date).toISOString().slice(0, 10);
          const hours = (hCell.v as number) * 24; // 엑셀 시간값(일 비율) → 시간
          if (hours <= 0 || hours > 24) continue; // 합계(>24h)나 이상치 제외
          entries.push({ date: dateStr, hours });
        }

        if (entries.length > 0) {
          people.push({ rawName, name: normalizeName(rawName), entries });
        }
      }
    }
  }

  // 같은 이름이 여러 표에 나뉘어 있으면 병합
  const merged = new Map<string, TimesheetPerson>();
  for (const p of people) {
    const ex = merged.get(p.name);
    if (ex) ex.entries.push(...p.entries);
    else merged.set(p.name, { ...p, entries: [...p.entries] });
  }
  return [...merged.values()];
}

export interface WeekSummary {
  weekStart: string; // 해당 주 월요일 (YYYY-MM-DD)
  hours: number; // 주 실근로(휴게 차감 후)
  qualified: boolean; // 15시간 초과 여부
  holidayHours: number; // 부여 주휴시간
}

export interface MonthlyTimesheetResult {
  workHours: number; // 월 실근로 합계 (휴게 차감 후)
  workedDays: number;
  weeklyHolidayHours: number; // 월 주휴시간 합계
  weeks: WeekSummary[];
}

function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0=일
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * 한 직원의 월 집계.
 * @param entries 기록표 일별 시간
 * @param opts.year/month 대상 연·월 (그 달의 기록만 집계)
 * @param opts.breakPaid 휴게 30분 유급 여부 (false 면 근무일마다 0.5h 차감)
 */
export function computeMonthlyFromEntries(
  entries: TimesheetEntry[],
  opts: { year: number; month: number; breakPaid: boolean }
): MonthlyTimesheetResult {
  const prefix = `${opts.year}-${String(opts.month).padStart(2, "0")}-`;
  const daily = new Map<string, number>(); // 같은 날 중복 기록은 합산
  for (const e of entries) {
    if (!e.date.startsWith(prefix)) continue;
    daily.set(e.date, (daily.get(e.date) ?? 0) + e.hours);
  }

  let workHours = 0;
  let workedDays = 0;
  const byWeek = new Map<string, number>();
  for (const [date, raw] of daily) {
    const adj = Math.max(raw - (opts.breakPaid ? 0 : 0.5), 0);
    if (adj <= 0) continue;
    workHours += adj;
    workedDays++;
    const wk = mondayOf(date);
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + adj);
  }

  const weeks: WeekSummary[] = [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, hours]) => {
      const qualified = hours > 15; // 15시간 '초과' 시 지급
      const holidayHours = qualified ? Math.min(hours / 5, 8) : 0;
      return { weekStart, hours, qualified, holidayHours };
    });

  const weeklyHolidayHours = weeks.reduce((s, w) => s + w.holidayHours, 0);
  return { workHours, workedDays, weeklyHolidayHours, weeks };
}
