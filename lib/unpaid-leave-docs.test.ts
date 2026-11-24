// 무급휴직이 문서에 찍히는 자리 — 명세서의 「기본급 산출 근거」, 세무사무소 제출자료의 비고
import { describe, it, expect } from "vitest";
import { payslipHtml, type DocPayroll } from "./documents-pay";
import type { DocCompany, DocEmployee } from "./documents";
import { buildExportRow, type ExportPayrollRecord } from "./payroll-export";
import { monthPayDays, unpaidLeaveMetaOf } from "./unpaid-leave";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const leave = (a: string, b: string) => ({ startDate: d(a), endDate: d(b) });

const company: DocCompany = {
  name: "주식회사 가상학원",
  ceo: "가상대표",
  bizNo: "000-00-00000",
  phone: "000-000-0000",
  address: "가상시 가상로 1",
  payday: 7,
  stamp: null,
};

const employee = (over: Partial<DocEmployee> = {}) =>
  ({
    name: "가상직원",
    empNo: "VT-1",
    department: "교육운영팀",
    position: "사원",
    hireDate: d("2025-03-04"),
    incomeType: "EMPLOYEE",
    payScheme: "MONTHLY",
    schedule: [],
    ...over,
  }) as unknown as DocEmployee;

/** 2026년 11월 · 월급 300만(식대 20만 포함) */
const payroll = (over: Partial<DocPayroll> = {}): DocPayroll => ({
  year: 2026,
  month: 11,
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseP: 2_800_000,
  extraP: 0,
  overtimeP: 0,
  nightP: 0,
  holidayP: 0,
  weeklyHolidayP: 0,
  positionP: 0,
  mealP: 200_000,
  carP: 0,
  incentiveP: 0,
  bonusP: 0,
  unusedLeaveP: 0,
  gross: 3_000_000,
  pensionD: 0,
  employmentD: 0,
  healthD: 0,
  longTermD: 0,
  incomeTaxD: 0,
  localTaxD: 0,
  retentionD: 0,
  parkingD: 0,
  expenseD: 0,
  otherD: 0,
  totalDeduct: 0,
  net: 3_000_000,
  hourlyWage: 15_343,
  prorationRatio: 1,
  ...over,
});

/** 급여 서비스가 남기는 근거 그대로 */
const breakdownOf = (
  leaves: ReturnType<typeof leave>[],
  extra: Record<string, unknown> = {},
  hire = d("2025-03-04")
) => {
  const pd = monthPayDays(2026, 11, hire, null, leaves);
  return {
    ratio: pd.ratio,
    json: JSON.stringify({ notes: [], baseApplied: 3_000_000, blend: null, unpaidLeave: unpaidLeaveMetaOf(pd), ...extra }),
  };
};

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

describe("명세서 — 무급휴직 일할의 근거", () => {
  it("★ 기간·일수와 일할 식을 그대로 적는다 (11/16~11/30 → 300만 × 15/30)", () => {
    const b = breakdownOf([leave("2026-11-16", "2026-11-30")]);
    const html = text(
      payslipHtml({
        employee: employee(),
        payroll: payroll({ baseP: 1_400_000, mealP: 100_000, gross: 1_500_000, net: 1_500_000, prorationRatio: b.ratio, breakdown: b.json }),
        company,
      })
    );
    expect(html).toContain("무급휴직 일할계산");
    expect(html).toContain("무급휴직 11월 16일 ~ 11월 30일(15일)을 뺀 지급 대상 (15일/30일)");
    expect(html).toContain("월 급여총액 3,000,000원 × 15/30 = 1,500,000원");
    expect(html).toContain("잔액이 기본급 1,400,000원");
    expect(html).toContain("동일 비율(15/30)로 일할 지급");
    expect(html).toContain("달력의 날 수(역일수)로 일할합니다");
    // 재직은 했으므로 '월중 입·퇴사' 로 적지 않는다
    expect(html).not.toContain("월중 입·퇴사 일할계산");
    expect(html).not.toContain("재직비율");
  });

  it("가를 항목이 없으면 한 줄로 적는다 (식대 없는 계약)", () => {
    const b = breakdownOf([leave("2026-11-21", "2026-11-30")]); // 20/30
    const html = text(
      payslipHtml({
        employee: employee(),
        payroll: payroll({ baseP: 2_000_000, mealP: 0, gross: 2_000_000, net: 2_000_000, prorationRatio: b.ratio, breakdown: b.json }),
        company,
      })
    );
    expect(html).toContain("지급 대상 (20일/30일): 기본급 3,000,000원 × 20/30 = 2,000,000원");
  });

  it("월중 입사와 겹친 달은 재직일수를 함께 적는다", () => {
    // 11/10 입사(재직 21일) · 11/20~11/25 무급(6일) → 15/30
    const hire = d("2026-11-10");
    const b = breakdownOf([leave("2026-11-20", "2026-11-25")], {}, hire);
    const html = text(
      payslipHtml({
        employee: employee({ hireDate: hire } as any),
        payroll: payroll({ baseP: 1_400_000, mealP: 100_000, gross: 1_500_000, net: 1_500_000, prorationRatio: b.ratio, breakdown: b.json }),
        company,
      })
    );
    expect(html).toContain("이 달 재직 21일 중 무급휴직 11월 20일 ~ 11월 25일(6일)을 뺀 지급 대상 (15일/30일)");
  });

  it("한 달을 통째로 쉰 달 — 0원이 왜 0원인지 적힌다", () => {
    const b = breakdownOf([leave("2026-11-01", "2026-11-30")]);
    const html = text(
      payslipHtml({
        employee: employee(),
        payroll: payroll({ baseP: 0, mealP: 0, gross: 0, net: 0, prorationRatio: b.ratio, breakdown: b.json }),
        company,
      })
    );
    expect(html).toContain("무급휴직 11월 1일 ~ 11월 30일(30일)을 뺀 지급 대상 (0일/30일)");
    expect(html).toContain("× 0/30 = 0원");
  });

  it("월중 계약 변경과 겹치면 가중 식의 일수가 '급여가 지급된 날' 임을 밝힌다", () => {
    const b = breakdownOf([leave("2026-11-20", "2026-11-30")], {
      baseApplied: 3_210_526,
      blend: { totalDays: 19, segments: [{ days: 15, baseWage: 3_000_000 }, { days: 4, baseWage: 4_000_000 }], baseWage: 3_210_526 },
    });
    const html = text(
      payslipHtml({
        employee: employee(),
        payroll: payroll({ baseP: 1_906_666, mealP: 126_667, gross: 2_033_333, net: 2_033_333, prorationRatio: b.ratio, breakdown: b.json }),
        company,
      })
    );
    expect(html).toContain("( 15일 × 3,000,000원 + 4일 × 4,000,000원 ) ÷ 19일 = 3,210,526원");
    expect(html).toContain("무급휴직일을 뺀, 급여가 지급된 날 기준");
    expect(html).toContain("적용 월 급여총액 3,210,526원 × 19/30 = 2,033,333원");
  });

  it("사유는 싣지 않는다 — 내부 기록이다", () => {
    const b = breakdownOf([leave("2026-11-16", "2026-11-30")]);
    const html = payslipHtml({
      employee: employee(),
      payroll: payroll({ baseP: 1_400_000, mealP: 100_000, gross: 1_500_000, net: 1_500_000, prorationRatio: b.ratio, breakdown: b.json }),
      company,
    });
    expect(html).not.toContain("개인 사정");
    expect(html).not.toContain("사유");
  });

  it("시급제 — 실제 근로시간으로 지급한다는 것과 수당의 일할 비율을 적는다", () => {
    const b = breakdownOf([leave("2026-11-16", "2026-11-30")], { baseApplied: 12_000 });
    const html = text(
      payslipHtml({
        employee: employee({ payScheme: "HOURLY" } as any),
        payroll: payroll({
          payScheme: "HOURLY",
          workedHours: 60,
          baseP: 720_000,
          mealP: 50_000,
          weeklyHolidayP: 0,
          gross: 770_000,
          net: 770_000,
          hourlyWage: 12_000,
          prorationRatio: b.ratio,
          breakdown: b.json,
        }),
        company,
      })
    );
    expect(html).toContain("무급휴직 — 무급휴직 11월 16일 ~ 11월 30일(15일)");
    expect(html).toContain("실제 근로시간으로 지급");
    expect(html).toContain("15/30 로 일할 지급");
    expect(html).not.toContain("무급휴직 일할계산");
  });

  it("완전비율제(근로계약) — 일할하지 않는다고 적는다", () => {
    const b = breakdownOf([leave("2026-11-16", "2026-11-30")], { baseApplied: 0, ratioPay: { total: 4_000_000 } });
    const html = text(
      payslipHtml({
        employee: employee({ payScheme: "RATIO" } as any),
        payroll: payroll({
          payScheme: "RATIO",
          ratioEmployee: true,
          baseP: 4_000_000,
          mealP: 0,
          gross: 4_000_000,
          net: 4_000_000,
          hourlyWage: 20_000,
          prorationRatio: 1,
          breakdown: b.json,
        }),
        company,
      })
    );
    expect(html).toContain("비율급은 그 달 수강료 입금액을 기준으로 산정하므로 일할하지 않습니다");
  });

  it("무급휴직이 없는 달의 명세서에는 아무것도 붙지 않는다", () => {
    const html = payslipHtml({ employee: employee(), payroll: payroll(), company });
    expect(html).not.toContain("무급휴직");
  });

  it("월중 입·퇴사만 있는 달은 예전 문구 그대로다", () => {
    // 11/16 입사 → 15/30
    const html = text(
      payslipHtml({
        employee: employee({ hireDate: d("2026-11-16") } as any),
        payroll: payroll({
          baseP: 1_400_000,
          mealP: 100_000,
          gross: 1_500_000,
          net: 1_500_000,
          prorationRatio: 0.5,
          breakdown: JSON.stringify({ notes: [], baseApplied: 3_000_000, blend: null }),
        }),
        company,
      })
    );
    expect(html).toContain("월중 입·퇴사 일할계산 — 재직 11월 16일 ~ 11월 30일 (15일/30일): 월 급여총액 3,000,000원 × 15/30 = 1,500,000원");
    expect(html).not.toContain("무급휴직");
  });
});

describe("세무사무소 제출자료 — 비고에 무급휴직 기간", () => {
  const rec = (over: Partial<ExportPayrollRecord> = {}): ExportPayrollRecord => ({
    incomeType: "EMPLOYEE",
    baseP: 1_400_000,
    extraP: 0,
    overtimeP: 0,
    nightP: 0,
    holidayP: 0,
    extraHours: 0,
    overtimeHours: 0,
    nightHours: 0,
    holidayHours: 0,
    holidayOverHours: 0,
    hourlyWage: 15_343,
    weeklyHolidayP: 0,
    positionP: 0,
    mealP: 100_000,
    carP: 0,
    incentiveP: 0,
    bonusP: 0,
    unusedLeaveP: 0,
    gross: 1_500_000,
    pensionD: 0,
    employmentD: 0,
    healthD: 0,
    longTermD: 0,
    incomeTaxD: 0,
    localTaxD: 0,
    retentionD: 0,
    parkingD: 0,
    expenseD: 0,
    otherD: 0,
    net: 1_500_000,
    employee: { name: "가상직원", empNo: "VT-1", rrn: "000000-0000000" },
    ...over,
  });

  it("★ 그 달 산정에 쓴 기간과 일수를 적는다 — 세전급여가 왜 줄었는지 시트에 남는다", () => {
    const row = buildExportRow(rec({ breakdown: breakdownOf([leave("2026-11-16", "2026-11-30")]).json }), "12월 07일");
    expect(row.note).toBe("4대보험(근로소득) · 무급휴직 11/16~11/30(15일)");
    expect(row.grossTotal).toBe(1_500_000);
  });

  it("경업금지 보상금 비고와 함께 붙는다", () => {
    const row = buildExportRow(
      rec({ nonCompeteP: 150_000, breakdown: breakdownOf([leave("2026-11-16", "2026-11-30")]).json }),
      "12월 07일"
    );
    expect(row.note).toBe("4대보험(근로소득) · 경업금지 보상금 150,000원 포함 · 무급휴직 11/16~11/30(15일)");
  });

  it("무급휴직이 없는 달의 비고는 예전 그대로다", () => {
    expect(buildExportRow(rec(), "12월 07일").note).toBe("4대보험(근로소득)");
    expect(buildExportRow(rec({ breakdown: JSON.stringify({ notes: [] }) }), "12월 07일").note).toBe("4대보험(근로소득)");
  });
});
