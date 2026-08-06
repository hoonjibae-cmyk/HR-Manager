import { describe, it, expect } from "vitest";
import {
  buildPayrollTrend,
  contractBaseOf,
  overtimeOf,
  grossOf,
  chartPoints,
  chartTicks,
  niceMax,
  shortWon,
  trendChoices,
  NO_DEPARTMENT,
  type TrendRecord,
} from "./payroll-trend";

const rec = (over: Partial<TrendRecord> = {}): TrendRecord => ({
  year: 2026,
  month: 6,
  department: "교수부",
  payScheme: "MONTHLY",
  baseP: 3_000_000,
  weeklyHolidayP: 0,
  positionP: 200_000,
  mealP: 200_000,
  carP: 0,
  incentiveP: 0,
  bonusP: 0,
  unusedLeaveP: 0,
  extraP: 0,
  overtimeP: 0,
  nightP: 0,
  holidayP: 0,
  extraHours: 0,
  overtimeHours: 0,
  nightHours: 0,
  holidayHours: 0,
  holidayOverHours: 0,
  hourlyWage: 0,
  ...over,
});

/** 포괄임금 계약자 — 약정 시간외 30만이 baseWage 안에 있고, 이 달 변동 4시간이 더 붙었다 */
const inclusive = (over: Partial<TrendRecord> = {}) =>
  rec({ overtimeP: 420_000, overtimeHours: 4, hourlyWage: 20_000, ...over });

describe("항목 분해 — 계약 기본급 / 오버타임", () => {
  it("계약 기본급에 포괄임금 약정분과 직책수당·식대가 들어간다", () => {
    // 기본 300만 + 직책 20만 + 식대 20만 + 약정 시간외 30만
    expect(contractBaseOf(inclusive())).toBe(3_700_000);
  });

  it("그 달 새로 생긴 오버타임만 오버타임수당으로 뺀다", () => {
    expect(overtimeOf(inclusive())).toBe(120_000); // 4h × 20,000 × 1.5
  });

  it("포괄임금이 아니면 오버타임이 통째로 변동분이다", () => {
    const r = rec({ overtimeP: 120_000, overtimeHours: 4, hourlyWage: 20_000 });
    expect(contractBaseOf(r)).toBe(3_400_000);
    expect(overtimeOf(r)).toBe(120_000);
  });

  it("시급제의 주휴수당은 계약 기본급에 들어간다", () => {
    const r = rec({ baseP: 1_200_000, positionP: 0, mealP: 0, weeklyHolidayP: 240_000 });
    expect(contractBaseOf(r)).toBe(1_440_000);
  });
});

describe("buildPayrollTrend — 갈래가 달라도 월 합계는 같다", () => {
  const records = [
    inclusive({ incentiveP: 600_000, bonusP: 100_000, unusedLeaveP: 50_000 }),
    rec({ department: "조교팀", payScheme: "HOURLY", baseP: 1_200_000, positionP: 0, mealP: 0, weeklyHolidayP: 240_000 }),
  ];

  it("**항목별 분해의 합이 지급액 계와 정확히 맞는다**", () => {
    // 여기가 어긋나면 그래프를 믿을 수 없게 된다
    const t = buildPayrollTrend(records, "ITEM");
    const m = t.months[0];
    const sum = Object.values(m.values).reduce((a, b) => a + b, 0);
    expect(sum).toBe(m.total);
    expect(m.total).toBe(records.reduce((a, r) => a + grossOf(r), 0));
  });

  it("급여형태별·부서별·총계도 같은 합계가 나온다", () => {
    const total = buildPayrollTrend(records, "TOTAL").months[0].total;
    for (const mode of ["ITEM", "SCHEME", "DEPARTMENT"] as const) {
      const m = buildPayrollTrend(records, mode).months[0];
      expect(m.total).toBe(total);
      expect(Object.values(m.values).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("항목별 계열이 이름을 갖는다", () => {
    const t = buildPayrollTrend(records, "ITEM");
    expect(t.series.map((s) => s.label)).toContain("계약 기본급");
    expect(t.series.map((s) => s.label)).toContain("오버타임수당");
  });

  it("급여형태는 라벨로 나온다", () => {
    const t = buildPayrollTrend(records, "SCHEME");
    expect(t.series.map((s) => s.label).sort()).toEqual(["시급제", "월급제"]);
  });
});

describe("급여 레코드가 있는 달만 낸다", () => {
  it("빈 달을 0으로 채우지 않는다", () => {
    // 없는 달을 0으로 그리면 '아직 산정 안 한 달' 이 '0원이었던 달' 로 읽힌다
    const t = buildPayrollTrend([rec({ month: 3 }), rec({ month: 6 })], "TOTAL");
    expect(t.months.map((m) => m.ym)).toEqual(["2026-03", "2026-06"]);
  });

  it("달을 시간순으로 줄 세운다 (해를 넘겨도)", () => {
    const t = buildPayrollTrend(
      [rec({ year: 2026, month: 1 }), rec({ year: 2025, month: 12 }), rec({ year: 2025, month: 2 })],
      "TOTAL"
    );
    expect(t.months.map((m) => m.ym)).toEqual(["2025-02", "2025-12", "2026-01"]);
  });

  it("같은 달의 여러 사람을 합치고 인원수를 센다", () => {
    const t = buildPayrollTrend([rec(), rec({ department: "조교팀" })], "TOTAL");
    expect(t.months).toHaveLength(1);
    expect(t.months[0].count).toBe(2);
    expect(t.months[0].total).toBe(3_400_000 * 2);
  });

  it("레코드가 없으면 빈 결과", () => {
    const t = buildPayrollTrend([], "TOTAL");
    expect(t.months).toEqual([]);
    expect(t.series).toEqual([]);
    expect(t.grandTotal).toBe(0);
  });
});

describe("계열", () => {
  it("한 계열에만 있는 달도 0으로 찍어 선이 끊기지 않게 한다", () => {
    const t = buildPayrollTrend(
      [rec({ month: 5, department: "교수부" }), rec({ month: 6, department: "조교팀" })],
      "DEPARTMENT"
    );
    expect(t.months[0].values["조교팀"]).toBe(0);
    expect(t.months[1].values["교수부"]).toBe(0);
  });

  it("늘 0인 항목은 계열로 만들지 않는다 — 범례만 차지한다", () => {
    const t = buildPayrollTrend([rec()], "ITEM");
    expect(t.series.map((s) => s.key)).toEqual(["BASE"]);
  });

  it("큰 것부터 줄 세운다", () => {
    const t = buildPayrollTrend(
      [rec({ incentiveP: 5_000_000, bonusP: 100_000 })],
      "ITEM"
    );
    expect(t.series.map((s) => s.key)).toEqual(["INCENTIVE", "BASE", "BONUS"]);
  });

  it("부서가 비면 '(부서 미지정)' 으로 묶는다", () => {
    const t = buildPayrollTrend([rec({ department: null })], "DEPARTMENT");
    expect(t.series[0].key).toBe(NO_DEPARTMENT);
    expect(t.series[0].label).toBe("(부서 미지정)");
  });

  it("계열을 좁혀도 **월 합계는 그 달 전체** 그대로다", () => {
    // 화면을 걸렀다고 총액이 줄어들면 안 된다 (급여 화면 합계 카드와 같은 원칙)
    const records = [rec({ department: "교수부" }), rec({ department: "조교팀" })];
    const t = buildPayrollTrend(records, "DEPARTMENT", ["교수부"]);
    expect(t.months[0].total).toBe(3_400_000 * 2);
    expect(Object.keys(t.months[0].values)).toEqual(["교수부"]);
  });
});

describe("trendChoices — 필터 상자를 채운다", () => {
  it("총계 갈래는 고를 것이 없다", () => {
    expect(trendChoices([rec()], "TOTAL")).toEqual([]);
  });

  it("부서 목록을 낸다", () => {
    const c = trendChoices([rec({ department: "교수부" }), rec({ department: "조교팀" })], "DEPARTMENT");
    expect(c.map((x) => x.key).sort()).toEqual(["교수부", "조교팀"]);
  });
});

describe("chartPoints — 좌표", () => {
  it("0 을 바닥으로 잡는다 — 최솟값에 맞춰 자르면 추이를 잘못 읽는다", () => {
    const p = chartPoints([0, 50, 100], 100, 200, 80);
    expect(p[0].y).toBe(80); // 0 → 바닥
    expect(p[2].y).toBe(0); // 최댓값 → 천장
    expect(p[1].y).toBe(40);
  });

  it("가로로 고르게 편다", () => {
    const p = chartPoints([1, 2, 3], 3, 200, 80);
    expect(p.map((x) => x.x)).toEqual([0, 100, 200]);
  });

  it("점이 하나면 가운데 (0으로 나누지 않는다)", () => {
    expect(chartPoints([5], 5, 200, 80)).toEqual([{ x: 100, y: 0 }]);
  });

  it("값이 없거나 최댓값이 0이어도 터지지 않는다", () => {
    expect(chartPoints([], 0, 200, 80)).toEqual([]);
    expect(chartPoints([0, 0], 0, 200, 80).every((p) => p.y === 80)).toBe(true);
  });
});

describe("niceMax — 눈금 위끝", () => {
  it("최댓값보다 조금 위의 깔끔한 수로 올린다", () => {
    // 그대로 쓰면 가장 높은 점이 천장에 붙고 눈금이 '1,734만' 처럼 읽을 수 없게 된다
    expect(niceMax(17_340_000)).toBe(20_000_000);
    expect(chartTicks(niceMax(17_340_000))).toEqual([
      0, 5_000_000, 10_000_000, 15_000_000, 20_000_000,
    ]);
  });

  it("자릿수가 달라도 깔끔한 간격을 고른다", () => {
    // 간격은 1·2·2.5·5 × 10ⁿ 중에서만 고른다 — 그래야 눈금이 읽히는 수가 된다
    expect(niceMax(87)).toBe(100); // 간격 25
    expect(niceMax(1_100)).toBe(1_500); // 간격 500
    expect(niceMax(4_800_000)).toBe(6_000_000); // 간격 150만
  });

  it("이미 딱 떨어지면 그대로 둔다 — 괜히 한 칸 더 올리지 않는다", () => {
    expect(niceMax(20_000_000)).toBe(20_000_000);
  });

  it("0 이하는 1 로 (0으로 나누지 않기 위함)", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
  });
});

describe("chartTicks / shortWon", () => {
  it("0 부터 고르게", () => {
    expect(chartTicks(100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(chartTicks(0)).toEqual([0]);
  });

  it("금액을 짧게", () => {
    expect(shortWon(3_400_000)).toBe("340만");
    expect(shortWon(123_000_000)).toBe("1.2억"); // 1억 = 1e8
    expect(shortWon(1_234_000_000)).toBe("12.3억");
    expect(shortWon(10_000)).toBe("1만");
    // 1만 미만은 만으로 접지 않는다 — 5,000 을 '1만' 이라 적으면 두 배로 읽힌다
    expect(shortWon(5_000)).toBe("5000");
    expect(shortWon(900)).toBe("900");
    expect(shortWon(0)).toBe("0");
  });
});
