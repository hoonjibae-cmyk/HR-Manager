// 월별 산정 + 누계 — 엔진이 아니라 **조립**이 맞는지 본다.
// 특히 충당금 누계는 'DC 전환 때 소급 납입할 몫' 이라 한 달이라도 새면 그대로 미납이 된다.

import { describe, it, expect, vi, beforeEach } from "vitest";

const employees: any[] = [];
const payrolls: any[] = [];
const bases: any[] = [];
let policyRow: any;

vi.mock("./db", () => ({
  prisma: {
    employee: { findMany: async () => employees },
    payrollRecord: { findMany: async () => payrolls },
    severanceMonthlyBase: { findMany: async () => bases },
    severancePolicy: { upsert: async () => policyRow },
  },
}));

const { severanceMonth } = await import("./severance-service");

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** 주 37.5시간 (14~22시 · 휴게 0.5, 월~금) */
const FULL_SCHEDULE = JSON.stringify(
  ["mon", "tue", "wed", "thu", "fri"].map((day) => ({
    day,
    work: true,
    start: "14:00",
    end: "22:00",
    breakH: 0.5,
  }))
);
/** 주 12시간 (월·수·금 4시간) */
const SHORT_SCHEDULE = JSON.stringify(
  ["mon", "wed", "fri"].map((day) => ({ day, work: true, start: "18:00", end: "22:00", breakH: 0 }))
);

const emp = (over: any = {}) => ({
  id: 1,
  empNo: "2025-001",
  name: "김직원",
  department: "교수부",
  payScheme: "MONTHLY",
  isContractor: false,
  hireDate: d("2025-03-01"),
  resignDate: null,
  schedule: FULL_SCHEDULE,
  ...over,
});

const rec = (year: number, month: number, over: any = {}) => ({
  employeeId: 1,
  year,
  month,
  baseP: 3_000_000,
  weeklyHolidayP: 0,
  positionP: 200_000,
  mealP: 200_000,
  carP: 0,
  unusedLeaveP: 0,
  incentiveP: 0,
  bonusP: 0,
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
  retentionD: 0,
  status: "DRAFT",
  ...over,
});

/** 월별 산정기준 임금 (관리자 지정 또는 계약 추산) */
const base = (year: number, month: number, over: any = {}) => ({
  employeeId: 1,
  year,
  month,
  base: 3_000_000,
  source: "ESTIMATED",
  note: "계약 추산",
  ...over,
});

beforeEach(() => {
  employees.length = 0;
  payrolls.length = 0;
  bases.length = 0;
  policyRow = {
    id: 1,
    dcAfterMonths: 12,
    divisor: 12,
    minWeeklyHours: 15,
    includeBonus: false,
    includeIncentive: false,
    includeFixedOvertime: true,
    includeOvertime: false,
    includeUnusedLeave: true,
    includeMealCar: true,
  };
});

describe("severanceMonth — 단계 판정", () => {
  it("근속 1년 전이면 충당금", async () => {
    employees.push(emp());
    payrolls.push(rec(2025, 6));
    const { rows } = await severanceMonth(2025, 6);
    expect(rows[0].status).toBe("PROVISION");
    expect(rows[0].amount).toBe(283_333); // 3,400,000 / 12
  });

  it("근속 1년이 지나면 DC 부담금", async () => {
    employees.push(emp());
    payrolls.push(rec(2026, 6));
    const { rows } = await severanceMonth(2026, 6);
    expect(rows[0].status).toBe("DC");
    expect(rows[0].dcStartsAt).toBe("2026-03-01");
  });

  it("주 15시간 미만은 제외 — 금액이 0이다", async () => {
    employees.push(emp({ schedule: SHORT_SCHEDULE }));
    payrolls.push(rec(2026, 6, { baseP: 900_000, positionP: 0, mealP: 0 }));
    const { rows } = await severanceMonth(2026, 6);
    expect(rows[0].status).toBe("EXCLUDED");
    expect(rows[0].amount).toBe(0);
    expect(rows[0].cumulative).toBe(0);
  });

  it("위탁계약은 제외", async () => {
    employees.push(emp({ isContractor: true }));
    payrolls.push(rec(2026, 6));
    expect((await severanceMonth(2026, 6)).rows[0].status).toBe("EXCLUDED");
  });

  it("완전비율제는 위탁 체크가 없어도 제외다", async () => {
    employees.push(emp({ payScheme: "RATIO", isContractor: false }));
    payrolls.push(rec(2026, 6));
    expect((await severanceMonth(2026, 6)).rows[0].status).toBe("EXCLUDED");
  });

  it("근로시간표가 비면 '판정 보류' 로 남기고 경고에 센다", async () => {
    employees.push(emp({ schedule: "[]" }));
    payrolls.push(rec(2026, 6));
    const { rows, totals } = await severanceMonth(2026, 6);
    expect(rows[0].status).toBe("UNKNOWN");
    expect(totals.unknownCount).toBe(1);
  });
});

describe("누계 — DC 전환 시 소급 납입할 몫", () => {
  it("충당금 누계는 근속 1년 전 달만 더한다", async () => {
    employees.push(emp());
    // 2025-03 ~ 2026-02 = 12개월 충당, 2026-03 부터 DC
    for (let m = 3; m <= 12; m++) payrolls.push(rec(2025, m));
    for (let m = 1; m <= 6; m++) payrolls.push(rec(2026, m));

    const { rows } = await severanceMonth(2026, 6);
    const r = rows[0];
    expect(r.status).toBe("DC");
    // 2025-03~2026-02 = 12개월
    expect(r.cumulativeProvision).toBe(283_333 * 12);
    // 2026-03~06 = 4개월
    expect(r.cumulativeDc).toBe(283_333 * 4);
    expect(r.cumulative).toBe(283_333 * 16);
  });

  it("이 달보다 뒤의 급여는 누계에 넣지 않는다", async () => {
    employees.push(emp());
    payrolls.push(rec(2025, 4), rec(2025, 5), rec(2025, 6));
    expect((await severanceMonth(2025, 5)).rows[0].cumulative).toBe(283_333 * 2);
  });

  it("달마다 급여가 다르면 그 달 금액으로 각각 쌓는다", async () => {
    employees.push(emp());
    payrolls.push(
      rec(2025, 4),
      rec(2025, 5, { baseP: 1_500_000, positionP: 0, mealP: 0 }) // 일할계산된 달
    );
    const r = (await severanceMonth(2025, 5)).rows[0];
    expect(r.cumulative).toBe(283_333 + 125_000);
  });

  it("대상이 아닌 사람은 과거분도 쌓지 않는다", async () => {
    // 판정이 바뀌었다면 화면에서 보고 사람이 처리할 일이지, 조용히 소급할 일이 아니다
    employees.push(emp({ isContractor: true }));
    payrolls.push(rec(2025, 4), rec(2025, 5));
    expect((await severanceMonth(2025, 5)).rows[0].cumulative).toBe(0);
  });
});

describe("산입 범위", () => {
  it("상여·인센티브는 기본으로 빠진다", async () => {
    employees.push(emp());
    payrolls.push(rec(2026, 6, { bonusP: 2_000_000, incentiveP: 600_000 }));
    const r = (await severanceMonth(2026, 6)).rows[0];
    expect(r.base).toBe(3_400_000);
    expect(r.amount).toBe(283_333);
  });

  it("포괄임금 약정분은 들어가고 그 달 발생분만 빠진다", async () => {
    // 계약 월 급여 = 기본 300만 + 식대 20만 + 직책 20만 + 약정 시간외 30만 = 370만.
    // 이 달은 보강 연장 4시간(=120,000)이 그 위에 더 붙었다.
    employees.push(emp());
    payrolls.push(
      rec(2026, 6, { overtimeP: 420_000, overtimeHours: 4, hourlyWage: 20_000 })
    );
    const r = (await severanceMonth(2026, 6)).rows[0];
    expect(r.base).toBe(3_700_000);
    expect(r.amount).toBe(308_333); // 3,700,000 / 12
    expect(r.included.map(([k]) => k)).toContain("포괄임금 약정 시간외·야간");
    expect(Object.fromEntries(r.excluded.map(([k, v]) => [k, v]))).toEqual({
      "오버타임 수당(그 달 발생분)": 120_000,
    });
  });

  it("약정분만 있는 달은 경고하지 않는다 — 계약 월 급여와 산정기준이 같다", async () => {
    employees.push(emp());
    payrolls.push(rec(2026, 6, { overtimeP: 300_000, hourlyWage: 20_000 }));
    const { rows, warnings } = await severanceMonth(2026, 6);
    expect(rows[0].base).toBe(3_700_000);
    expect(rows[0].warning).toBeNull();
    expect(warnings).toHaveLength(0);
  });

  it("그 달 발생분이 있는 달은 법정 하한 경고가 붙는다", async () => {
    employees.push(emp());
    payrolls.push(rec(2026, 6, { overtimeP: 420_000, overtimeHours: 4, hourlyWage: 20_000 }));
    const { rows, warnings } = await severanceMonth(2026, 6);
    expect(rows[0].warning).toContain("§20①");
    expect(warnings[0]).toContain("김직원");
  });

  it("설정을 켜면 그대로 반영된다", async () => {
    policyRow.includeOvertime = true;
    policyRow.includeIncentive = true;
    employees.push(emp());
    payrolls.push(
      rec(2026, 6, { incentiveP: 600_000, overtimeP: 420_000, overtimeHours: 4, hourlyWage: 20_000 })
    );
    const r = (await severanceMonth(2026, 6)).rows[0];
    expect(r.base).toBe(3_400_000 + 600_000 + 420_000);
    expect(r.warning).toBeNull();
  });

  it("인센티브 유보금은 뺀 금액과 별개로 나란히 보여준다", async () => {
    employees.push(emp({ payScheme: "INCENTIVE" }));
    payrolls.push(rec(2026, 6, { incentiveP: 600_000, retentionD: 50_000 }));
    const { rows, totals } = await severanceMonth(2026, 6);
    expect(rows[0].retention).toBe(50_000);
    expect(totals.retention).toBe(50_000);
  });
});

describe("급여가 아직 없는 달", () => {
  it("대상자여도 금액은 0이고 '급여 미산정' 으로 표시한다", async () => {
    employees.push(emp());
    const { rows, totals } = await severanceMonth(2026, 6);
    expect(rows[0].noPayroll).toBe(true);
    expect(rows[0].amount).toBe(0);
    expect(totals.noPayrollCount).toBe(1);
  });

  it("제외 대상은 급여가 없어도 '급여 미산정' 으로 세지 않는다", async () => {
    employees.push(emp({ isContractor: true }));
    expect((await severanceMonth(2026, 6)).totals.noPayrollCount).toBe(0);
  });
});

describe("합계", () => {
  it("DC 와 충당금을 따로 센다", async () => {
    employees.push(
      emp({ id: 1, name: "고참", hireDate: d("2024-01-01") }),
      emp({ id: 2, name: "신입", empNo: "2026-002", hireDate: d("2026-04-01") })
    );
    payrolls.push(rec(2026, 6, { employeeId: 1 }), rec(2026, 6, { employeeId: 2 }));
    const { totals } = await severanceMonth(2026, 6);
    expect(totals.dcCount).toBe(1);
    expect(totals.provisionCount).toBe(1);
    expect(totals.dc).toBe(283_333);
    expect(totals.provision).toBe(283_333);
  });
});

describe("산정기준 임금의 출처 — MANUAL > 급여 레코드 > ESTIMATED", () => {
  it("급여가 없으면 추산값을 쓴다 (도입 이전 달)", async () => {
    employees.push(emp());
    bases.push(base(2026, 6, { base: 3_000_000 }));
    const r = (await severanceMonth(2026, 6)).rows[0];
    expect(r.baseSource).toBe("ESTIMATED");
    expect(r.base).toBe(3_000_000);
    expect(r.amount).toBe(250_000);
    expect(r.noPayroll).toBe(false); // 메워졌으니 '미산정' 이 아니다
  });

  it("급여가 있으면 추산보다 급여가 이긴다", async () => {
    // 추산은 '급여가 없을 때 메우는 값' 이라 실제 급여를 이기면 안 된다
    employees.push(emp());
    payrolls.push(rec(2026, 6));
    bases.push(base(2026, 6, { base: 9_000_000 }));
    const r = (await severanceMonth(2026, 6)).rows[0];
    expect(r.baseSource).toBe("PAYROLL");
    expect(r.base).toBe(3_400_000);
  });

  it("관리자가 지정하면 급여 레코드도 이긴다", async () => {
    employees.push(emp());
    payrolls.push(rec(2026, 6));
    bases.push(base(2026, 6, { base: 5_000_000, source: "MANUAL", note: "세무사 확인분" }));
    const r = (await severanceMonth(2026, 6)).rows[0];
    expect(r.baseSource).toBe("MANUAL");
    expect(r.base).toBe(5_000_000);
    expect(r.baseNote).toBe("세무사 확인분");
    expect(r.amount).toBe(416_667);
  });

  it("아무것도 없으면 '급여 미산정' 이다", async () => {
    employees.push(emp());
    const r = (await severanceMonth(2026, 6)).rows[0];
    expect(r.baseSource).toBe("NONE");
    expect(r.noPayroll).toBe(true);
    expect(r.amount).toBe(0);
  });

  it("지정·추산값에는 항목별 내역이 없어 법정 하한 경고를 띄우지 않는다", async () => {
    employees.push(emp());
    bases.push(base(2026, 6, { source: "MANUAL" }));
    expect((await severanceMonth(2026, 6)).rows[0].warning).toBeNull();
  });

  it("합계가 출처별 인원을 센다", async () => {
    employees.push(
      emp({ id: 1, name: "급여있음" }),
      emp({ id: 2, empNo: "b", name: "추산" }),
      emp({ id: 3, empNo: "c", name: "지정" })
    );
    payrolls.push(rec(2026, 6, { employeeId: 1 }));
    bases.push(
      base(2026, 6, { employeeId: 2 }),
      base(2026, 6, { employeeId: 3, source: "MANUAL" })
    );
    const { totals } = await severanceMonth(2026, 6);
    expect(totals.estimatedCount).toBe(1);
    expect(totals.manualCount).toBe(1);
    expect(totals.noPayrollCount).toBe(0);
  });
});

describe("누계에 추산으로 메운 달이 함께 잡힌다", () => {
  it("급여 레코드가 없던 달도 누계에 들어간다", async () => {
    // 급여 레코드만 훑던 예전 방식은 도입 이전 달을 통째로 빠뜨렸다
    employees.push(emp()); // 입사 2025-03
    for (let m = 3; m <= 12; m++) bases.push(base(2025, m, { base: 3_600_000 }));
    for (let m = 1; m <= 5; m++) bases.push(base(2026, m, { base: 3_600_000 }));
    payrolls.push(rec(2026, 6)); // 도입 후 첫 급여

    const r = (await severanceMonth(2026, 6)).rows[0];
    // 2025-03~2026-02 = 12개월 충당 (전부 추산 300,000원)
    expect(r.cumulativeProvision).toBe(300_000 * 12);
    // 2026-03~05 추산 3개월 + 2026-06 급여 1개월
    expect(r.cumulativeDc).toBe(300_000 * 3 + 283_333);
    expect(r.estimatedMonths).toBe(15);
  });

  it("입사 전 달은 세지 않는다", async () => {
    employees.push(emp()); // 입사 2025-03
    bases.push(base(2025, 1), base(2025, 2), base(2025, 3));
    const r = (await severanceMonth(2025, 3)).rows[0];
    expect(r.cumulative).toBe(250_000); // 3월 한 달만
    expect(r.estimatedMonths).toBe(1);
  });

  it("대상이 아닌 사람은 추산값이 있어도 쌓지 않는다", async () => {
    employees.push(emp({ isContractor: true }));
    bases.push(base(2026, 5), base(2026, 6));
    const r = (await severanceMonth(2026, 6)).rows[0];
    expect(r.status).toBe("EXCLUDED");
    expect(r.cumulative).toBe(0);
  });
});
