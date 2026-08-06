// 월별 급여 추이 — 대시보드 그래프의 집계부 (순수 함수, DB 무관, 테스트 있음).
//
// **급여 레코드가 있는 달만** 낸다. 없는 달을 0으로 채우면 아직 산정하지 않은 달이
// '급여가 0원이었던 달' 로 읽힌다 — 실제로는 그냥 데이터가 없는 것이다.
//
// 분류는 네 갈래이고, **어느 갈래로 보든 그 달 합계는 같다**(= 지급액 계).
// 항목별 분해가 총계와 어긋나면 그래프를 믿을 수 없게 되므로 테스트로 못박아 둔다.

import { fixedOvertimeOf, variableOvertimeOf } from "./payroll";
import { PAY_SCHEME_LABEL } from "./constants";

/** 그래프가 보는 급여 레코드 — 필요한 필드만 */
export interface TrendRecord {
  year: number;
  month: number;
  department: string | null;
  payScheme: string;

  baseP: number;
  weeklyHolidayP: number;
  positionP: number;
  mealP: number;
  carP: number;
  incentiveP: number;
  bonusP: number;
  unusedLeaveP: number;
  extraP: number;
  overtimeP: number;
  nightP: number;
  holidayP: number;

  // 포괄임금 약정분 ↔ 그 달 변동분을 가르는 재료
  extraHours: number;
  overtimeHours: number;
  nightHours: number;
  holidayHours: number;
  holidayOverHours: number;
  hourlyWage: number;
}

/** 무엇으로 갈라 볼 것인가 */
export type TrendMode = "TOTAL" | "ITEM" | "SCHEME" | "DEPARTMENT";

export const TREND_MODE_LABEL: Record<TrendMode, string> = {
  TOTAL: "월 총계",
  ITEM: "지급항목별",
  SCHEME: "급여형태별",
  DEPARTMENT: "부서별",
};

/** 지급항목 갈래 — 다 더하면 지급액 계가 된다 */
export const TREND_ITEM_LABEL: Record<string, string> = {
  BASE: "계약 기본급",
  INCENTIVE: "인센티브",
  OVERTIME: "오버타임수당",
  BONUS: "상여",
  UNUSED_LEAVE: "연차미사용수당",
};

/** 부서가 비어 있는 사람을 담는 자리 */
export const NO_DEPARTMENT = "__none";

/**
 * **계약 기본급** — 계약서에 적힌 월 급여로 매달 같게 나가는 몫.
 *
 * 기본급에 더해 **포괄임금 약정 시간외·야간**(계약서 제4조에 이미 들어 있는 고정분)과
 * 직책수당·식대·차량유지비·주휴수당(시급제)을 함께 싣는다. 그 달 새로 생긴 오버타임은
 * 여기가 아니라 `overtimeOf` 로 빠진다 — 판정은 세무 시트·퇴직급여와 **같은 함수**를 쓴다.
 */
export function contractBaseOf(r: TrendRecord): number {
  return (
    r.baseP + r.weeklyHolidayP + r.positionP + r.mealP + r.carP + fixedOvertimeOf(r)
  );
}

/** 그 달 새로 생긴 오버타임 수당 (보강 확정분·수기 입력분) */
export function overtimeOf(r: TrendRecord): number {
  return variableOvertimeOf(r);
}

/** 지급액 계 — 항목 분해의 합이 이 값과 같아야 한다 */
export function grossOf(r: TrendRecord): number {
  return (
    r.baseP +
    r.weeklyHolidayP +
    r.positionP +
    r.mealP +
    r.carP +
    r.extraP +
    r.overtimeP +
    r.nightP +
    r.holidayP +
    r.incentiveP +
    r.bonusP +
    r.unusedLeaveP
  );
}

/** 한 레코드를 고른 갈래의 계열키로 (여러 계열에 나눠 실리기도 한다) */
function splitOf(r: TrendRecord, mode: TrendMode): Array<[string, number]> {
  switch (mode) {
    case "ITEM":
      return [
        ["BASE", contractBaseOf(r)],
        ["INCENTIVE", r.incentiveP],
        ["OVERTIME", overtimeOf(r)],
        ["BONUS", r.bonusP],
        ["UNUSED_LEAVE", r.unusedLeaveP],
      ];
    case "SCHEME":
      return [[r.payScheme, grossOf(r)]];
    case "DEPARTMENT":
      return [[r.department || NO_DEPARTMENT, grossOf(r)]];
    default:
      return [["TOTAL", grossOf(r)]];
  }
}

export interface TrendMonth {
  /** "2026-06" — 정렬·키 */
  ym: string;
  year: number;
  month: number;
  /** "26.6" — 축에 적을 짧은 이름 */
  label: string;
  /** 계열키 → 금액 */
  values: Record<string, number>;
  /** 그 달 지급액 계 (갈래와 무관하게 같다) */
  total: number;
  /** 그 달 급여 레코드 수 — 인원이 늘어 총액이 는 것인지 볼 수 있게 */
  count: number;
}

export interface TrendSeries {
  key: string;
  label: string;
  /** 기간 전체 합 — 범례에 적고, 큰 것부터 줄 세운다 */
  total: number;
}

export interface PayrollTrend {
  months: TrendMonth[];
  series: TrendSeries[];
  /** 기간 전체 지급액 계 */
  grandTotal: number;
}

const labelOf = (mode: TrendMode, key: string): string => {
  if (mode === "ITEM") return TREND_ITEM_LABEL[key] ?? key;
  if (mode === "SCHEME") return PAY_SCHEME_LABEL[key] ?? key;
  if (mode === "DEPARTMENT") return key === NO_DEPARTMENT ? "(부서 미지정)" : key;
  return "지급액 계";
};

/**
 * 월별 추이를 만든다.
 *
 * `only` 로 계열을 좁힐 수 있다(부서 몇 개만 보기). 좁혀도 **월 합계(`total`)는
 * 그 달 전체**를 그대로 둔다 — 화면을 걸렀다고 총액이 줄어들면 안 되기 때문이다
 * (급여 화면의 합계 카드와 같은 원칙).
 */
export function buildPayrollTrend(
  records: TrendRecord[],
  mode: TrendMode = "TOTAL",
  only: string[] = []
): PayrollTrend {
  const byMonth = new Map<string, TrendMonth>();
  const seriesTotal = new Map<string, number>();
  const keep = (k: string) => !only.length || only.includes(k);

  for (const r of records) {
    const ym = `${r.year}-${String(r.month).padStart(2, "0")}`;
    let m = byMonth.get(ym);
    if (!m) {
      m = {
        ym,
        year: r.year,
        month: r.month,
        label: `${String(r.year).slice(2)}.${r.month}`,
        values: {},
        total: 0,
        count: 0,
      };
      byMonth.set(ym, m);
    }
    m.total += grossOf(r);
    m.count += 1;

    for (const [key, amount] of splitOf(r, mode)) {
      // 0원 항목은 계열로 만들지 않는다 — 늘 0인 선이 범례를 차지한다
      if (!amount) continue;
      if (!keep(key)) continue;
      m.values[key] = (m.values[key] ?? 0) + amount;
      seriesTotal.set(key, (seriesTotal.get(key) ?? 0) + amount);
    }
  }

  const months = Array.from(byMonth.values()).sort((a, b) => a.ym.localeCompare(b.ym));
  // 계열이 없는 달도 그래프에는 0으로 찍어야 선이 끊기지 않는다
  const keys = Array.from(seriesTotal.keys());
  for (const m of months) for (const k of keys) m.values[k] = m.values[k] ?? 0;

  const series = keys
    .map((key) => ({ key, label: labelOf(mode, key), total: seriesTotal.get(key)! }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "ko"));

  return {
    months,
    series,
    grandTotal: months.reduce((a, m) => a + m.total, 0),
  };
}

/** 고를 수 있는 계열 목록 (필터 상자를 채운다) — 금액과 무관하게 그 갈래의 전체 후보 */
export function trendChoices(records: TrendRecord[], mode: TrendMode): TrendSeries[] {
  if (mode === "TOTAL") return [];
  return buildPayrollTrend(records, mode).series;
}

/* ───────────── 그래프 좌표 ───────────── */

export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * 값 → SVG 좌표. 세로 눈금의 위끝은 **0 에서 시작**한다 —
 * 최솟값에 맞춰 자르면 5% 차이가 절벽처럼 보여 추이를 잘못 읽는다.
 */
export function chartPoints(
  values: number[],
  max: number,
  w: number,
  h: number
): ChartPoint[] {
  const n = values.length;
  if (!n) return [];
  const top = max > 0 ? max : 1;
  // 점이 하나면 가운데에 찍는다 (0으로 나누지 않기 위함이기도 하다)
  const step = n > 1 ? w / (n - 1) : 0;
  return values.map((v, i) => ({
    x: n > 1 ? i * step : w / 2,
    y: h - (v / top) * h,
  }));
}

/**
 * 세로 눈금의 위끝 — 데이터 최댓값보다 **조금 위의 깔끔한 수**로 올린다.
 *
 * 최댓값을 그대로 위끝으로 쓰면 두 가지가 나쁘다: ① 가장 높은 점이 천장에 딱 붙어
 * 선이 테두리와 겹치고 ② 눈금이 `1,734만 / 1,301만 / 867만` 처럼 읽을 수 없는 수가 된다.
 * 1·2·2.5·5 × 10ⁿ 중에서 눈금 간격을 골라 `500만 / 1,000만 / …` 이 되게 한다.
 */
export function niceMax(max: number, count = 4): number {
  if (max <= 0) return 1;
  const rough = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return Math.ceil(max / step) * step;
}

/** 눈금 값 — 0 부터 위끝까지 고르게 나눈다 */
export function chartTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i));
}

/** 금액을 축에 짧게 — 1,234만 / 12억 */
export function shortWon(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${Math.round(n / 1e7) / 10}억`;
  if (abs >= 1e4) return `${Math.round(n / 1e4).toLocaleString("ko-KR")}만`;
  return String(Math.round(n));
}
