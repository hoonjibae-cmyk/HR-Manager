// 인센티브·사업소득 산정 (월급+인센티브 / 완전비율제 강사) — 학생 명단 기반
//
// 명단은 두 갈래이고 산정식이 아예 다르다. 어느 쪽인지는 **매출 열의 유무**로 갈린다.
//
// ① 인원 기준(HEADCOUNT) — 「26년 7월」 양식. 기준 인원수를 넘는 학생 1명당 기준금액.
//    학생이 월 중간에 입학·전출·퇴원하므로 인원수가 정수 1이 아니라 0~1 사이 값(재원계수)이 된다.
//    - 재원계수 = 해당 월 실제 수업 회차 ÷ 월 표준 회차(8회), 최대 1.0
//      → 1회당 단가 = 기준금액 ÷ 8  (예: 기준금액 100,000원 → 회당 12,500원)
//      → 만근(8회) = 기준금액 전액, 7회 = 87,500원, 0회 = 0원
//    - 인센티브 = (Σ 재원계수 − 기준 인원수) × 기준금액
//    - 명세서 표기용 배분: 만근 학생이 기준 인원을 먼저 채우고, 기준을 넘는
//      가중치분에 대해서만 학생별 인센티브가 계산된다(엑셀 양식과 동일).
//
// ② 매출 기준(REVENUE) — 「사업소득 상세 내역 - 26년 7월」·「인센티브 상세 내역 - …」 양식.
//    학생별 수강료 매출에 배분율을 곱한다. **월중 입·퇴원 비례는 매출 금액에 이미 반영**돼
//    있으므로(신규 6회 → 380,000 이 아니라 266,000) 재원계수를 따로 곱하지 않는다.
//    - 배분액 = Σ 매출 × 배분율.  완전비율제는 사업소득(계약 ratioPercent),
//      월급+인센티브는 매출비율 인센티브(계약 incRevenuePercent).
//    배분율은 **명단이 아니라 계약**에서 온다 — 명단에 적힌 율은 대조용으로만 읽는다
//    (보수조건은 계약만 고친다는 규칙).

import * as XLSX from "xlsx";

/** 월 표준 수업 회차 (주 2회 × 4주). 만근 기준. */
export const STANDARD_SESSIONS = 8;

export type StudentStatus =
  | "ENROLLED" // 재원
  | "NEW" // 신규 (그 달 입학)
  | "RETURNED" // 복귀
  | "TRANSFERRED_IN" // 전입 (다른 반에서 옮겨 옴)
  | "ON_LEAVE" // 휴원
  | "TRANSFERRED" // 전출
  | "WITHDRAWN"; // 퇴원

export const STUDENT_STATUS_LABEL: Record<string, string> = {
  ENROLLED: "재원",
  NEW: "신규",
  RETURNED: "복귀",
  TRANSFERRED_IN: "전입",
  ON_LEAVE: "휴원",
  TRANSFERRED: "전출",
  WITHDRAWN: "퇴원",
};

/**
 * 그 달 수업이 끝난 학생 — 회차가 안 적혀 있으면 **만근이 아니라 0회**로 본다.
 * 재원 학생의 빈 회차 칸은 '만근이라 적을 게 없다' 는 뜻이지만,
 * 퇴원·휴원 학생의 빈 칸은 '그 달에 나온 수업이 없다' 는 뜻이다.
 */
const CLOSED_STATUS: StudentStatus[] = ["WITHDRAWN", "TRANSFERRED", "ON_LEAVE"];

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
  /** ① 그 달 이 학생의 수강료 매출(원). null = 인원 기준 명단이라 매출 열이 없다 */
  revenue?: number | null;
  /** 명단에 적혀 있던 배분율(0.45). 계산은 계약 값으로 하고 이 값은 대조용 */
  sharePercent?: number | null;
}

/** 명단이 매출 기준인지 — 매출이 적힌 학생이 하나라도 있으면 매출 기준이다 */
export function isRevenueRoster(students: RosterStudent[]): boolean {
  return students.some((s) => s.revenue != null);
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

/* ====================== 매출 기준 산정 (사업소득 · 매출비율 인센티브) ====================== */

export interface RevenueShareRow extends RosterStudent {
  revenue: number;
  amount: number; // 이 학생 매출에서 나온 배분액(원)
}

export interface RevenueShareSummary {
  rows: RevenueShareRow[];
  percent: number; // 배분율 (0.45)
  revenue: number; // Σ 수강료 매출
  amount: number; // 배분액 총액
  totalCount: number;
  activeCount: number; // 매출이 잡힌 학생 (그 달 수업이 있었던 학생)
  zeroCount: number; // 매출 0 (월초 퇴원 등으로 수업이 없던 학생)
}

/**
 * 학생별 수강료 매출 × 배분율.
 *
 * 총액은 **Σ매출에 배분율을 곱해 한 번 반올림**한다 — 급여 엔진의 비율제 산식
 * (`round0(매출 × 비율)`)과 같은 자리에서 반올림해야 명세서와 첨부 내역서가 어긋나지 않는다.
 * 학생별 금액은 각자 반올림하되 **잔차를 마지막 학생이 흡수**해 Σ학생별 = 총액을 보장한다
 * (인원 기준 산정과 같은 방식).
 */
export function summarizeRevenueShare(
  students: RosterStudent[],
  opts: { percent: number }
): RevenueShareSummary {
  const percent = opts.percent || 0;
  const rows: RevenueShareRow[] = students.map((s) => ({
    ...s,
    revenue: Math.round(s.revenue ?? 0),
    amount: 0,
  }));

  const revenue = rows.reduce((a, r) => a + r.revenue, 0);
  const amount = Math.round(revenue * percent);

  for (const r of rows) r.amount = Math.round(r.revenue * percent);
  const diff = amount - rows.reduce((a, r) => a + r.amount, 0);
  if (diff !== 0) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].amount > 0) {
        rows[i].amount += diff;
        break;
      }
    }
  }

  return {
    rows,
    percent,
    revenue,
    amount,
    totalCount: rows.length,
    activeCount: rows.filter((r) => r.revenue > 0).length,
    zeroCount: rows.filter((r) => r.revenue <= 0).length,
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
  // 전입/전출은 글자가 한 자만 달라 순서가 중요하다 — 전입을 먼저 본다
  if (s.includes("전입")) return "TRANSFERRED_IN";
  if (s.includes("전출")) return "TRANSFERRED";
  if (s.includes("퇴원") || s.includes("퇴소")) return "WITHDRAWN";
  if (s.includes("휴원")) return "ON_LEAVE";
  if (s.includes("신규") || s.includes("입학")) return "NEW";
  if (s.includes("복귀") || s.includes("재등록")) return "RETURNED";
  if (s.includes("재원") || s.includes("재적")) return "ENROLLED";
  return null;
}

export interface ParsedRoster {
  teacherName: string | null;
  year: number | null;
  month: number | null;
  monthlyPay: number | null; // 시트에 적힌 월급여 (교차확인용)
  students: RosterStudent[];
  /** 매출 기준 명단이면 명단에 적혀 있던 배분율 (0.45). 인원 기준이면 null */
  sharePercent?: number | null;
  /** 제목이 「사업소득 상세 내역」인지 「인센티브 상세 내역」인지 — 대조용 */
  titleKind?: "BUSINESS" | "INCENTIVE" | null;
  /** 시트 TOTAL 행의 값 (검산용). 없으면 null */
  sheetTotalRevenue?: number | null;
  sheetTotalAmount?: number | null;
}

/** 시트 한 장의 월 블록 하나 = 강사 1명 × 1개월 */
export interface ParsedRosterBlock extends ParsedRoster {
  sheetName: string;
  year: number;
  month: number;
  teacherName: string;
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
  note: ["비고"],
};

function labelKey(v: any): keyof typeof LABELS | null {
  const s = String(v ?? "").replace(/\s+/g, "");
  if (!s) return null;
  for (const [k, list] of Object.entries(LABELS)) {
    if (list.some((l) => l.replace(/\s+/g, "") === s)) return k as keyof typeof LABELS;
  }
  return null;
}

/**
 * 매출 기준 명단의 두 금액 열. 제목이 「① 수강료 매출(+)」·「② 사업소득(45%) = ①x45%」처럼
 * 기호와 산식을 달고 있어 정확히 일치하지 않으므로 낱말로 알아본다.
 */
function moneyKey(v: any): "revenue" | "share" | null {
  const s = String(v ?? "").replace(/\s+/g, "");
  if (!s) return null;
  if (/수강료|매출/.test(s)) return "revenue";
  // 배분 열은 반드시 율(%)을 달고 있다 — 인원 기준 명단의 '인센티브' 열과 이 점이 다르다
  if (/사업소득|인센티브/.test(s) && s.includes("%")) return "share";
  return null;
}

/** 「② 사업소득(45%) = ①x45%」 → 0.45 */
export function parsePercentLabel(v: any): number | null {
  const m = String(v ?? "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const pct = Number(m[1]) / 100;
  return pct > 0 && pct <= 1 ? pct : null;
}

function numOf(v: any): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/[,\s원]/g, "");
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** 요약행(급여+인센티브, 세금, 지급액 …) 판별 */
function isSummaryText(v: any): boolean {
  const s = String(v ?? "").replace(/\s+/g, "");
  return /인센티브|지급액|세금|합계|유보액|급여\+/.test(s);
}

/** 엑셀 버퍼 → 강사 1명의 월 학생 명단 */
export function parseIncentiveWorkbook(buf: Buffer | Uint8Array): ParsedRoster {
  const blocks = parseRosterWorkbook(buf);
  const first = blocks[0];
  if (!first)
    return { teacherName: null, year: null, month: null, monthlyPay: null, students: [] };
  return first;
}

/* --------------------------- 월 블록 찾기 --------------------------- */

/** 제목 셀 하나 — 「사업소득 상세 내역 - 26년7월」 / 「26년 7월」 */
interface BlockTitle {
  row: number;
  col: number;
  year: number;
  month: number;
  kind: "BUSINESS" | "INCENTIVE" | null;
}

function titleAt(v: any, row: number, col: number): BlockTitle | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const ym = s.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월/);
  if (!ym) return null;
  let year = Number(ym[1]);
  if (year < 100) year += 2000;
  const month = Number(ym[2]);
  if (month < 1 || month > 12) return null;
  const kind = s.includes("사업소득") ? "BUSINESS" : s.includes("인센티브") ? "INCENTIVE" : null;
  return { row, col, year, month, kind };
}

/**
 * 한 시트 안에 가로로 늘어선 월 블록들의 열 범위를 찾는다.
 *
 * 관리시트는 한 강사의 여러 달을 **오른쪽으로 이어 붙여** 쓴다(3월 A:P, 4월 R:AG, …).
 * 제목이 있는 열이 그 블록의 왼쪽 끝이고, 다음 제목 직전까지가 그 블록이다.
 * 제목 줄의 위치는 시트마다 다르므로(1행 또는 2행) **제목이 가장 많이 잡힌 줄**을 제목 줄로 본다.
 */
export function findMonthBlocks(grid: any[][]): Array<BlockTitle & { c0: number; c1: number }> {
  const byRow = new Map<number, BlockTitle[]>();
  for (let r = 0; r < Math.min(grid.length, 6); r++) {
    const found: BlockTitle[] = [];
    (grid[r] ?? []).forEach((v, c) => {
      const t = titleAt(v, r, c);
      if (t) found.push(t);
    });
    if (found.length) byRow.set(r, found);
  }
  if (!byRow.size) return [];

  // 제목이 가장 많은 줄. 같으면 위쪽 줄
  let titles: BlockTitle[] = [];
  for (const [, list] of [...byRow.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])) {
    titles = list;
    break;
  }
  titles.sort((a, b) => a.col - b.col);

  const width = Math.max(...grid.map((r) => (r ?? []).length), 0);
  return titles.map((t, i) => ({
    ...t,
    c0: t.col,
    c1: i + 1 < titles.length ? titles[i + 1].col - 1 : Math.max(width - 1, t.col),
  }));
}

/* --------------------------- 블록 하나 읽기 --------------------------- */

function parseBlock(
  grid: any[][],
  sheetName: string,
  b: { year: number; month: number; kind: BlockTitle["kind"]; c0: number; c1: number }
): ParsedRosterBlock | null {
  const inRange = (c: number) => c >= b.c0 && c <= b.c1;

  // 1) 헤더행 — 블록 열 범위 안에 '이름' 과 ('반' 또는 '퇴원일') 이 함께 있는 줄
  let headerRow = -1;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const keys = (grid[r] ?? []).map((v, c) => (inRange(c) ? labelKey(v) : null));
    if (keys.includes("name") && (keys.includes("className") || keys.includes("withdraw"))) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) return null;
  const header = grid[headerRow] ?? [];

  // 2) 강사명 — 블록 안의 「○○○ 선생님」. 없으면 시트 이름(탭 = 강사명)을 쓴다
  let teacherName: string | null = null;
  for (let r = 0; r < headerRow && !teacherName; r++) {
    (grid[r] ?? []).forEach((v, c) => {
      if (teacherName || !inRange(c)) return;
      const m = String(v ?? "").trim().match(/^(.+?)\s*선생님\s*$/);
      if (m) teacherName = m[1].trim();
    });
  }
  if (!teacherName) teacherName = sheetName.trim() || null;
  if (!teacherName) return null;

  // 3) 좌/우 반복 블록 — 인원 기준 양식은 같은 표(번호~인센티브)를 좌우로 두 벌 늘어놓는다.
  //    **이미 나온 열 제목이 다시 나오면 거기서부터 다음 벌**로 끊는다.
  //    '이름' 열 사이의 중간 지점으로 끊으면 앞 벌의 퇴원일·인센티브 열이 뒤 벌 범위에 들어가
  //    뒤 벌이 앞 벌의 퇴원일을 자기 것으로 집어 든다(뒤 벌 학생의 퇴원 회차가 통째로 사라진다).
  type ColKey = keyof typeof LABELS | "revenue" | "share";
  type Cols = Partial<Record<ColKey, number>>;
  const subBlocks: Cols[] = [];
  let cur: Cols = {};
  for (let c = b.c0; c <= b.c1; c++) {
    const k = (labelKey(header[c]) ?? moneyKey(header[c])) as ColKey | null;
    if (!k) continue;
    if (cur[k] != null) {
      if (cur.name != null) subBlocks.push(cur);
      cur = {};
    }
    cur[k] = c;
  }
  if (cur.name != null) subBlocks.push(cur);
  if (!subBlocks.length) return null;

  // 4) 배분율 — 「② 사업소득(45%) = ①x45%」 제목에서 읽는다 (대조용)
  let sharePercent: number | null = null;
  for (const cols of subBlocks) {
    if (cols.share == null) continue;
    const p = parsePercentLabel(header[cols.share]);
    if (p != null) {
      sharePercent = p;
      break;
    }
  }

  const out: ParsedRosterBlock = {
    sheetName,
    teacherName,
    year: b.year,
    month: b.month,
    monthlyPay: null,
    students: [],
    sharePercent,
    titleKind: b.kind,
    sheetTotalRevenue: null,
    sheetTotalAmount: null,
  };

  // 5) 데이터행
  for (const cols of subBlocks) {
    if (cols.name == null) continue;
    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r] ?? [];
      const seqRaw = cols.seq != null ? row[cols.seq] : null;

      // 시트가 스스로 낸 합계 — 우리 산정과 대조해 어긋나면 알린다
      if (/^\s*(TOTAL|합\s*계)\s*$/i.test(String(seqRaw ?? ""))) {
        if (cols.revenue != null) out.sheetTotalRevenue = numOf(row[cols.revenue]);
        if (cols.share != null) out.sheetTotalAmount = numOf(row[cols.share]);
        continue;
      }

      const name = String(row[cols.name] ?? "").trim();
      if (!name || isSummaryText(name)) continue;
      if (/^(번호|이름|상태)$/.test(name)) continue; // 반복 헤더

      // 월급여 (교차확인용) — 좌측 블록의 병합 셀
      if (cols.pay != null && out.monthlyPay == null) {
        const pv = row[cols.pay];
        if (typeof pv === "number" && pv > 100000) out.monthlyPay = pv;
      }

      const status =
        (cols.status != null ? statusOf(row[cols.status]) : null) ?? statusOf(seqRaw) ?? "ENROLLED";

      const enroll =
        cols.enroll != null
          ? parseDateSessionCell(row[cols.enroll], b.year)
          : { date: null, sessions: null };
      const withdraw =
        cols.withdraw != null
          ? parseDateSessionCell(row[cols.withdraw], b.year)
          : { date: null, sessions: null };

      // 입학·퇴원 칸에 회차가 둘 다 적혀 있으면 **큰 쪽**이 그 달 실제 수업 회차다.
      // (「입학 7/16(0회) · 퇴원 7/21(1회)」 → 1회. 작은 쪽을 쓰면 관리시트가 인정한
      //  회차가 0 으로 깎여 그 학생 몫이 통째로 빠진다.)
      const sessList = [enroll.sessions, withdraw.sessions].filter((v): v is number => v != null);
      const sessions = sessList.length
        ? Math.max(...sessList)
        : CLOSED_STATUS.includes(status)
          ? 0 // 퇴원·휴원인데 회차가 없다 = 그 달 수업 없음 (만근이 아니다)
          : null;

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
        revenue: cols.revenue != null ? numOf(row[cols.revenue]) : null,
        sharePercent,
      });
    }
  }

  return out.students.length ? out : null;
}

/**
 * 엑셀 버퍼 → 모든 시트·모든 달의 명단 블록.
 *
 * 관리시트는 **탭 하나가 강사 한 명**이고 그 안에서 달이 오른쪽으로 이어진다.
 * 어느 달을 쓸지는 부르는 쪽이 `year`/`month` 로 고른다 — 파일에는 늘 여러 달이 들어 있어
 * '파일에서 자동 감지' 로는 어느 달인지 정할 수 없다.
 */
export function parseRosterWorkbook(buf: Buffer | Uint8Array): ParsedRosterBlock[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const out: ParsedRosterBlock[] = [];

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

    const blocks = findMonthBlocks(grid);
    if (!blocks.length) continue;
    for (const b of blocks) {
      const parsed = parseBlock(grid, sheetName, b);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

/** 특정 연·월의 블록만 (강사별 1개) */
export function rostersForMonth(
  blocks: ParsedRosterBlock[],
  year: number,
  month: number
): ParsedRosterBlock[] {
  return blocks.filter((b) => b.year === year && b.month === month);
}
