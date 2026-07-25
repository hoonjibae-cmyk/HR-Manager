// 인센티브 산정 (월급+인센티브 강사) — 학생 명단 기반
//
// 유쌤에듀 실제 산정 방식 (엑셀 '인센티브 계산' 양식 재현):
//  - 기준 인원수를 초과하는 학생 1명당 기준금액을 지급하되, 학생은 월 중간에
//    입학·전출·퇴원하므로 인원수가 정수 1이 아니라 0~1 사이 값(재원계수)이 된다.
//  - 재원계수 = 해당 월 실제 수업 회차 ÷ 월 표준 회차(8회), 최대 1.0
//    → 1회당 단가 = 기준금액 ÷ 8  (예: 기준금액 100,000원 → 회당 12,500원)
//    → 만근(8회) = 기준금액 전액, 7회 = 87,500원, 0회 = 0원
//  - 인센티브 = (Σ 재원계수 − 기준 인원수) × 기준금액
//  - 명세서 표기용 배분: 만근 학생이 기준 인원을 먼저 채우고, 기준을 넘는
//    가중치분에 대해서만 학생별 인센티브가 계산된다(엑셀 양식과 동일).

import * as XLSX from "xlsx";

/** 월 표준 수업 회차 (주 2회 × 4주). 만근 기준. */
export const STANDARD_SESSIONS = 8;

export type StudentStatus = "ENROLLED" | "TRANSFERRED" | "WITHDRAWN";

export const STUDENT_STATUS_LABEL: Record<string, string> = {
  ENROLLED: "재원",
  TRANSFERRED: "전출",
  WITHDRAWN: "퇴원",
};

export interface RosterStudent {
  seq?: number | null;
  status: StudentStatus;
  name: string;
  className?: string | null;
  school?: string | null;
  enrollDate?: Date | null; // 월중 입학일
  withdrawDate?: Date | null; // 월중 전출·퇴원일
  /** 해당 월 실제 수업 회차. null = 만근(표준 회차) */
  sessions?: number | null;
  /** 월 표준 회차 (기본 8) */
  fullSessions?: number | null;
}

export interface IncentiveRow extends RosterStudent {
  weight: number; // 재원계수 0~1
  amount: number; // 이 학생에게 배분된 인센티브(원)
}

export interface IncentiveSummary {
  rows: IncentiveRow[];
  threshold: number; // 기준 인원수
  perStudent: number; // 1인당 기준금액
  perSession: number; // 1회당 단가 = 기준금액 ÷ 표준회차
  standardSessions: number;
  units: number; // 가중 인원 합계 (Σ 재원계수)
  over: number; // 기준 초과분
  amount: number; // 인센티브 총액
  fullCount: number; // 만근 인원
  partialCount: number; // 중도 입학·전출·퇴원 인원
  totalCount: number;
}

/** 학생 1명의 재원계수 (0~1) */
export function studentWeight(s: RosterStudent): number {
  const full = s.fullSessions && s.fullSessions > 0 ? s.fullSessions : STANDARD_SESSIONS;
  if (s.sessions == null) return 1; // 회차 미기재 = 만근
  const w = s.sessions / full;
  return Math.min(Math.max(w, 0), 1);
}

/**
 * 명단 → 인센티브 산정.
 * 총액은 (Σ계수 − 기준인원) × 기준금액이며, 학생별 배분은 만근 학생이
 * 기준 인원을 먼저 채우는 순서로 계산한다(엑셀 양식의 인센티브 열과 동일).
 */
export function summarizeIncentive(
  students: RosterStudent[],
  opts: { threshold: number; perStudent: number; standardSessions?: number }
): IncentiveSummary {
  const std = opts.standardSessions ?? STANDARD_SESSIONS;
  const threshold = opts.threshold || 0;
  const perStudent = opts.perStudent || 0;

  const rows: IncentiveRow[] = students.map((s) => ({
    ...s,
    weight: studentWeight({ ...s, fullSessions: s.fullSessions ?? std }),
    amount: 0,
  }));

  const units = rows.reduce((a, r) => a + r.weight, 0);
  const over = Math.max(units - threshold, 0);
  const amount = Math.round(over * perStudent);

  // 배분: 가중치 1(만근) 학생부터 기준 인원을 채우고, 초과분만 인센티브 대상
  const order = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.weight - a.r.weight || a.i - b.i);
  let running = 0;
  for (const { r } of order) {
    const start = running;
    const end = running + r.weight;
    const billable = Math.max(0, end - Math.max(threshold, start));
    r.amount = Math.round(billable * perStudent);
    running = end;
  }
  // 반올림 오차를 마지막 대상 학생에서 보정 (Σ학생별 = 총액 보장)
  const diff = amount - rows.reduce((a, r) => a + r.amount, 0);
  if (diff !== 0) {
    for (let i = order.length - 1; i >= 0; i--) {
      if (order[i].r.amount > 0) {
        order[i].r.amount += diff;
        break;
      }
    }
  }

  return {
    rows,
    threshold,
    perStudent,
    perSession: std > 0 ? Math.round(perStudent / std) : 0,
    standardSessions: std,
    units,
    over,
    amount,
    fullCount: rows.filter((r) => r.weight >= 1).length,
    partialCount: rows.filter((r) => r.weight < 1).length,
    totalCount: rows.length,
  };
}

/* ============================ 엑셀 명단 파서 ============================ */

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * 날짜·회차 셀 파싱. "7/17(4회)" · "6/30(8회)" · 날짜값 · 엑셀serial · "(2회)" 지원.
 */
export function parseDateSessionCell(
  v: any,
  year: number
): { date: Date | null; sessions: number | null } {
  if (v == null || v === "") return { date: null, sessions: null };
  if (v instanceof Date) return { date: v, sessions: null };
  if (typeof v === "number") {
    // 엑셀 날짜 serial (합리적 범위) 이면 날짜, 아니면 회차 숫자로 간주
    if (v > 20000 && v < 80000) {
      return { date: new Date(EXCEL_EPOCH_MS + Math.round(v) * 86400000), sessions: null };
    }
    return { date: null, sessions: v };
  }
  const s = String(v).trim();
  if (!s) return { date: null, sessions: null };
  let date: Date | null = null;
  let sessions: number | null = null;
  const md = s.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/);
  if (md) {
    const mo = Number(md[1]);
    const d = Number(md[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) date = new Date(Date.UTC(year, mo - 1, d));
  }
  const cnt = s.match(/\(?\s*(\d+(?:\.\d+)?)\s*회\s*\)?/);
  if (cnt) sessions = Number(cnt[1]);
  return { date, sessions };
}

function statusOf(raw: any): StudentStatus | null {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (!s) return null;
  if (s.includes("전출")) return "TRANSFERRED";
  if (s.includes("퇴원") || s.includes("퇴소")) return "WITHDRAWN";
  if (s.includes("재원") || s.includes("재적") || s.includes("휴원")) return "ENROLLED";
  return null;
}

export interface ParsedRoster {
  teacherName: string | null;
  year: number | null;
  month: number | null;
  monthlyPay: number | null; // 시트에 적힌 월급여 (교차확인용)
  students: RosterStudent[];
}

const LABELS = {
  seq: ["번호", "no", "NO"],
  status: ["상태", "구분"],
  name: ["이름", "성명", "학생명"],
  className: ["반", "반명", "수업"],
  school: ["학교/학년", "학교", "학년", "학교/학년 "],
  enroll: ["입학일", "입회일", "등록일"],
  withdraw: ["퇴원일", "전출일", "퇴소일"],
  pay: ["월급여", "급여"],
  incentive: ["인센티브"],
};

function labelKey(v: any): keyof typeof LABELS | null {
  const s = String(v ?? "").replace(/\s+/g, "");
  if (!s) return null;
  for (const [k, list] of Object.entries(LABELS)) {
    if (list.some((l) => l.replace(/\s+/g, "") === s)) return k as keyof typeof LABELS;
  }
  return null;
}

/** 요약행(급여+인센티브, 세금, 지급액 …) 판별 */
function isSummaryText(v: any): boolean {
  const s = String(v ?? "").replace(/\s+/g, "");
  return /인센티브|지급액|세금|합계|유보액|급여\+/.test(s);
}

/** 엑셀 버퍼 → 강사 1명의 월 학생 명단 */
export function parseIncentiveWorkbook(buf: Buffer | Uint8Array): ParsedRoster {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const out: ParsedRoster = {
    teacherName: null,
    year: null,
    month: null,
    monthlyPay: null,
    students: [],
  };

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws["!ref"]) continue;
    const grid: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    if (!grid.length) continue;

    // 1) 제목행에서 연·월, 강사명 추출 (상단 6행 스캔)
    for (let r = 0; r < Math.min(grid.length, 6); r++) {
      for (const cell of grid[r] ?? []) {
        const s = String(cell ?? "");
        if (!s) continue;
        const ym = s.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월/);
        if (ym && out.year == null) {
          let y = Number(ym[1]);
          if (y < 100) y += 2000;
          out.year = y;
          out.month = Number(ym[2]);
        }
        const t = s.match(/^(.+?)\s*선생님\s*$/);
        if (t && !out.teacherName) out.teacherName = t[1].trim();
      }
    }

    // 2) 헤더행 탐색 — '이름' 과 ('반' 또는 '퇴원일') 이 함께 있는 행
    let headerRow = -1;
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const keys = (grid[r] ?? []).map(labelKey);
      if (keys.includes("name") && (keys.includes("className") || keys.includes("withdraw"))) {
        headerRow = r;
        break;
      }
    }
    if (headerRow < 0) continue;

    // 3) 블록 분할 — '이름' 열 위치를 기준으로 좌/우 블록 경계 설정
    const header = grid[headerRow] ?? [];
    const nameCols: number[] = [];
    header.forEach((v, c) => {
      if (labelKey(v) === "name") nameCols.push(c);
    });
    if (!nameCols.length) continue;

    const blocks = nameCols.map((nc, i) => {
      const lo = i === 0 ? 0 : Math.floor((nameCols[i - 1] + nc) / 2);
      const hi = i === nameCols.length - 1 ? header.length : Math.floor((nc + nameCols[i + 1]) / 2);
      const cols: Partial<Record<keyof typeof LABELS, number>> = {};
      for (let c = lo; c < hi; c++) {
        const k = labelKey(header[c]);
        if (k && cols[k] == null) cols[k] = c;
      }
      return cols;
    });

    // 4) 데이터행 수집
    const year = out.year ?? new Date().getUTCFullYear();
    for (const cols of blocks) {
      if (cols.name == null) continue;
      for (let r = headerRow + 1; r < grid.length; r++) {
        const row = grid[r] ?? [];
        const rawName = row[cols.name];
        const name = String(rawName ?? "").trim();
        if (!name || isSummaryText(name)) continue;
        if (/^(번호|이름|상태)$/.test(name)) continue; // 반복 헤더

        // 월급여 (교차확인용) — 좌측 블록의 병합 셀
        if (cols.pay != null && out.monthlyPay == null) {
          const pv = row[cols.pay];
          if (typeof pv === "number" && pv > 100000) out.monthlyPay = pv;
        }

        const seqRaw = cols.seq != null ? row[cols.seq] : null;
        const status =
          (cols.status != null ? statusOf(row[cols.status]) : null) ??
          statusOf(seqRaw) ??
          "ENROLLED";

        const enroll =
          cols.enroll != null ? parseDateSessionCell(row[cols.enroll], year) : { date: null, sessions: null };
        const withdraw =
          cols.withdraw != null ? parseDateSessionCell(row[cols.withdraw], year) : { date: null, sessions: null };

        const sessList = [enroll.sessions, withdraw.sessions].filter(
          (v): v is number => v != null
        );
        const sessions = sessList.length ? Math.min(...sessList) : null;

        out.students.push({
          seq: typeof seqRaw === "number" ? seqRaw : null,
          status,
          name,
          className: cols.className != null ? String(row[cols.className] ?? "").trim() || null : null,
          school: cols.school != null ? String(row[cols.school] ?? "").trim() || null : null,
          enrollDate: enroll.date,
          withdrawDate: withdraw.date,
          sessions,
          fullSessions: STANDARD_SESSIONS,
        });
      }
    }
    if (out.students.length) break; // 첫 유효 시트만 사용
  }
  return out;
}
