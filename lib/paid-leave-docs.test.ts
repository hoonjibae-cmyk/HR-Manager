// 유급휴직·휴업이 급여 밖으로 나가는 자리 — 명세서(지급 항목·산출 근거), 세무사무소 제출자료,
// 대시보드 추이, 퇴직급여 산정기준. 계산 자체는 lib/paid-leave.test.ts 가 지킨다.

import { describe, it, expect } from "vitest";
import { payslipHtml, type DocPayroll } from "./documents-pay";
import type { DocCompany, DocEmployee } from "./documents";
import { buildExportRow, reconcileRow, type ExportPayrollRecord } from "./payroll-export";
import { buildPayrollTrend, grossOf, TREND_ITEM_LABEL, type TrendRecord } from "./payroll-trend";
import { severanceBase, type SeverancePayItems } from "./severance";
import {
  monthPayDays,
  settleLeavePay,
  unpaidLeaveMetaOf,
  LEAVE_WORKDAY_PAYSLIP_NOTE,
  type UnpaidLeaveSpan,
} from "./unpaid-leave";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const HIRE = d("2025-03-04");
const leave = (a: string, b: string, over: Partial<UnpaidLeaveSpan> = {}): UnpaidLeaveSpan => ({
  startDate: d(a),
  endDate: d(b),
  ...over,
});
const shutdown = (a: string, b: string, payRate: number) => leave(a, b, { kind: "SHUTDOWN", payRate });
const paidAmount = (a: string, b: string, payAmount: number) => leave(a, b, { kind: "PAID", payAmount });

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
    hireDate: HIRE,
    incomeType: "EMPLOYEE",
    payScheme: "MONTHLY",
    schedule: [],
    ...over,
  }) as unknown as DocEmployee;

/** 급여 서비스가 남기는 근거 그대로 — 원급여 월 300만 */
const settledOf = (leaves: UnpaidLeaveSpan[], monthly = 3_000_000) => {
  const pd = settleLeavePay(monthPayDays(2026, 11, HIRE, null, leaves), [], monthly);
  return { pd, meta: unpaidLeaveMetaOf(pd)! };
};
const breakdownOf = (leaves: UnpaidLeaveSpan[], extra: Record<string, unknown> = {}) => {
  const { pd, meta } = settledOf(leaves);
  return {
    ratio: pd.ratio,
    leavePay: pd.leavePay,
    json: JSON.stringify({ notes: [], baseApplied: 3_000_000, blend: null, unpaidLeave: meta, ...extra }),
  };
};

/** 2026년 11월 · 월급 300만(식대 20만 포함) · 11/16~11/30 을 쉰 달의 정상 급여(50%) */
const payroll = (over: Partial<DocPayroll> = {}): DocPayroll => ({
  year: 2026,
  month: 11,
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseP: 1_400_000,
  extraP: 0,
  overtimeP: 0,
  nightP: 0,
  holidayP: 0,
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
  totalDeduct: 0,
  net: 1_500_000,
  hourlyWage: 15_343,
  prorationRatio: 0.5,
  ...over,
});

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

describe("명세서 — 휴업수당·유급휴직 급여", () => {
  it("★ 휴업 70% — 지급 항목에 「휴업수당」 줄이 서고, 산출 근거에 식이 적힌다", () => {
    const b = breakdownOf([shutdown("2026-11-16", "2026-11-30", 0.7)]);
    expect(b.leavePay).toBe(1_050_000);
    const html = text(
      payslipHtml({
        employee: employee(),
        payroll: payroll({ leavePayP: b.leavePay, gross: 2_550_000, net: 2_550_000, prorationRatio: b.ratio, breakdown: b.json }),
        company,
      })
    );
    // 표의 칸은 태그를 걷어 내면 이름과 금액이 붙는다
    expect(html).toContain("기본급1,400,000 휴업수당1,050,000 식대(비과세)100,000 지급액 계2,550,000");
    expect(html).toContain("휴업 일할계산 — 휴업 11월 16일 ~ 11월 30일(15일)을 뺀 지급 대상 (15일/30일)");
    expect(html).toContain("월 급여총액 3,000,000원 × 15/30 = 1,500,000원");
    expect(html).toContain("휴업 기간의 기본급·수당은 달력의 날 수(역일수)로 일할해 빼고(월중 입·퇴사와 같은 방식), 그 기간의 급여는 아래와 같이 따로 지급합니다.");
    expect(html).toContain("휴업수당 — 11월 16일 ~ 11월 30일(15일): 원급여 1,500,000원(월 3,000,000원 × 15/30일) × 70% = 1,050,000원");
    // 무급휴직이 아니다 — 그 말이 찍히면 급여가 없는 달로 읽힌다
    expect(html).not.toContain("무급휴직");
  });

  it("유급휴직(금액 지정) — 「유급휴직 급여」 줄과 지정한 금액", () => {
    const b = breakdownOf([paidAmount("2026-11-16", "2026-11-30", 800_000)]);
    const html = text(
      payslipHtml({
        employee: employee(),
        payroll: payroll({ leavePayP: b.leavePay, gross: 2_300_000, net: 2_300_000, breakdown: b.json }),
        company,
      })
    );
    expect(html).toContain("기본급1,400,000 유급휴직 급여800,000 식대(비과세)100,000 지급액 계2,300,000");
    expect(html).toContain("유급휴직 일할계산");
    expect(html).toContain("유급휴직 급여 — 11월 16일 ~ 11월 30일(15일): 800,000원(지정한 금액)");
  });

  it("★ 구분이 섞인 달 — 구분마다 기간을 가르고, 지급 항목도 따로 선다", () => {
    const b = breakdownOf([
      leave("2026-11-03", "2026-11-03"),
      paidAmount("2026-11-10", "2026-11-14", 400_000),
      shutdown("2026-11-23", "2026-11-30", 0.7),
    ]);
    // 휴업 8일: 300만 × 8/30 = 80만 × 70% = 56만
    expect(b.leavePay).toBe(960_000);
    const html = text(
      payslipHtml({
        employee: employee(),
        payroll: payroll({
          baseP: 1_493_333,
          mealP: 106_667,
          leavePayP: b.leavePay,
          gross: 1_600_000 + 960_000,
          net: 1_600_000 + 960_000,
          prorationRatio: b.ratio,
          breakdown: b.json,
        }),
        company,
      })
    );
    expect(html).toContain("기본급1,493,333 유급휴직 급여400,000 휴업수당560,000 식대(비과세)106,667 지급액 계2,560,000");
    expect(html).toContain(
      "휴직·휴업 일할계산 — 무급휴직 11월 3일(1일), 유급휴직 11월 10일 ~ 11월 14일(5일), 휴업 11월 23일 ~ 11월 30일(8일)을 뺀 지급 대상 (16일/30일)"
    );
    expect(html).toContain("무급휴직 기간에는 급여가 없으며 유급휴직·휴업 기간의 급여는 아래와 같이 따로 지급합니다.");
  });

  it("★ 근거와 지급액이 맞지 않으면 지어내 가르지 않고 한 줄로 적는다", () => {
    const b = breakdownOf([shutdown("2026-11-16", "2026-11-30", 0.7)]);
    const html = text(
      payslipHtml({
        employee: employee(),
        // 기록의 금액(100만)이 근거의 합(105만)과 다르다
        payroll: payroll({ leavePayP: 1_000_000, gross: 2_500_000, net: 2_500_000, breakdown: b.json }),
        company,
      })
    );
    expect(html).toContain("기본급1,400,000 휴업수당·유급휴직 급여1,000,000 식대(비과세)100,000");
  });

  it("완전비율제(근로) — 비율급은 일할하지 않고 휴업수당만 따로 선다", () => {
    const pd = settleLeavePay(
      monthPayDays(2026, 11, HIRE, null, [leave("2026-11-16", "2026-11-30", { kind: "SHUTDOWN", payAmount: 500_000 })]),
      [],
      0
    );
    const html = text(
      payslipHtml({
        employee: employee({ payScheme: "RATIO" } as any),
        payroll: payroll({
          payScheme: "RATIO",
          ratioEmployee: true,
          baseP: 4_000_000,
          mealP: 0,
          leavePayP: 500_000,
          gross: 4_500_000,
          net: 4_500_000,
          hourlyWage: 20_000,
          prorationRatio: 1,
          breakdown: JSON.stringify({ notes: [], baseApplied: 0, ratioPay: { total: 4_000_000 }, unpaidLeave: unpaidLeaveMetaOf(pd) }),
        }),
        company,
      })
    );
    expect(html).toContain("비율급4,000,000 휴업수당500,000 지급액 계4,500,000");
    expect(html).toContain("비율급은 그 달 수강료 입금액을 기준으로 산정하므로 일할하지 않습니다. 그 기간의 급여는 아래와 같이 따로 지급합니다.");
    expect(html).toContain("휴업수당 — 11월 16일 ~ 11월 30일(15일): 500,000원(지정한 금액)");
  });

  it("시급제 — 실근로 지급 설명 뒤에 휴업수당의 식이 붙는다", () => {
    const b = breakdownOf([shutdown("2026-11-16", "2026-11-30", 0.7)]);
    const html = text(
      payslipHtml({
        employee: employee({ payScheme: "HOURLY" } as any),
        payroll: payroll({
          payScheme: "HOURLY",
          workedHours: 60,
          baseP: 720_000,
          mealP: 0,
          leavePayP: b.leavePay,
          gross: 720_000 + b.leavePay,
          net: 720_000 + b.leavePay,
          hourlyWage: 12_000,
          breakdown: b.json,
        }),
        company,
      })
    );
    expect(html).toContain("휴업 — 휴업 11월 16일 ~ 11월 30일(15일). 시급제는 실제 근로시간으로 지급");
    expect(html).toContain("그 기간의 급여는 아래와 같이 따로 지급합니다.");
    expect(html).toContain("× 70% = 1,050,000원");
  });

  it("★ 무급휴직만인 달의 명세서는 v1.63 문구 그대로다", () => {
    const b = breakdownOf([leave("2026-11-16", "2026-11-30")]);
    const html = text(payslipHtml({ employee: employee(), payroll: payroll({ breakdown: b.json }), company }));
    expect(html).toContain("무급휴직 일할계산 — 무급휴직 11월 16일 ~ 11월 30일(15일)을 뺀 지급 대상 (15일/30일)");
    expect(html).toContain("무급휴직 기간에는 급여가 지급되지 않으며, 달력의 날 수(역일수)로 일할합니다 — 월중 입·퇴사와 같은 방식입니다.");
    expect(html).not.toContain("휴업수당");
    expect(html).not.toContain("유급휴직");
  });

  it("사유는 명세서에 싣지 않는다 — 근거에 사유 자체가 없다", () => {
    const { meta } = settledOf([shutdown("2026-11-16", "2026-11-30", 0.7)]);
    expect(JSON.stringify(meta)).not.toContain("reason");
  });
});

describe("세무사무소 제출자료 — 휴업수당은 세전급여에 들고 비고에 금액을 적는다", () => {
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
    gross: 2_550_000,
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
    net: 2_550_000,
    employee: { name: "가상직원", empNo: "VT-1", rrn: "000000-0000000" },
    ...over,
  });

  it("★ 세전급여 = 정상 급여 + 휴업수당, 비고에 기간·금액·비율", () => {
    const row = buildExportRow(rec({ breakdown: breakdownOf([shutdown("2026-11-16", "2026-11-30", 0.7)]).json }), "12월 07일");
    expect(row.basePay).toBe(2_550_000);
    expect(row.grossTotal).toBe(2_550_000);
    expect(row.note).toBe("4대보험(근로소득) · 휴업 11/16~11/30(15일) 휴업수당 1,050,000원(70%)");
    // 열 관계가 그대로 맞는다
    expect(reconcileRow(row)).toBe(0);
  });

  it("금액 지정은 「금액 지정」이라고 적는다", () => {
    const row = buildExportRow(
      rec({ gross: 2_300_000, net: 2_300_000, breakdown: breakdownOf([paidAmount("2026-11-16", "2026-11-30", 800_000)]).json }),
      "12월 07일"
    );
    expect(row.note).toBe("4대보험(근로소득) · 유급휴직 11/16~11/30(15일) 유급휴직 급여 800,000원(금액 지정)");
  });
});

describe("대시보드 추이 — 휴업수당은 따로 서는 계열이고 합계는 지급액 계와 같다", () => {
  const rec = (over: Partial<TrendRecord> = {}): TrendRecord => ({
    year: 2026,
    month: 11,
    department: "교육운영팀",
    payScheme: "MONTHLY",
    baseP: 1_400_000,
    weeklyHolidayP: 0,
    positionP: 0,
    mealP: 100_000,
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

  it("★ 지급액 계에 들어간다", () => {
    expect(grossOf(rec({ leavePayP: 1_050_000 }))).toBe(2_550_000);
    expect(grossOf(rec())).toBe(1_500_000);
  });

  it("★ 항목별로 봐도 월 합계가 같다 — 계약 기본급에 섞지 않고 따로 선다", () => {
    const records = [rec({ leavePayP: 1_050_000 }), rec({ baseP: 2_800_000, mealP: 200_000 })];
    const t = buildPayrollTrend(records, "ITEM");
    const m = t.months[0];
    expect(m.total).toBe(2_550_000 + 3_000_000);
    expect(Object.values(m.values).reduce((a, v) => a + v, 0)).toBe(m.total);
    expect(m.values.LEAVE_PAY).toBe(1_050_000);
    expect(m.values.BASE).toBe(1_500_000 + 3_000_000);
    expect(t.series.find((s) => s.key === "LEAVE_PAY")?.label).toBe(TREND_ITEM_LABEL.LEAVE_PAY);
  });

  it("휴업수당이 없는 기간에는 계열 자체가 생기지 않는다", () => {
    const t = buildPayrollTrend([rec(), rec({ month: 12 })], "ITEM");
    expect(t.series.some((s) => s.key === "LEAVE_PAY")).toBe(false);
  });
});

describe("퇴직급여 산정기준 — 유급휴직 급여·휴업수당은 임금이라 넣는다", () => {
  const items = (over: Partial<SeverancePayItems> = {}): SeverancePayItems => ({
    baseP: 1_400_000,
    weeklyHolidayP: 0,
    positionP: 0,
    mealP: 100_000,
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
    hourlyWage: 15_343,
    ...over,
  });

  it("★ 산정기준 = 정상 급여 + 휴업수당 — 무엇을 넣었는지 목록에 남는다", () => {
    const b = severanceBase(items({ leavePayP: 1_050_000 }));
    expect(b.base).toBe(2_550_000);
    expect(b.included).toContainEqual(["휴업수당·유급휴직 급여", 1_050_000]);
  });

  it("비율 100% 유급휴직이면 산정기준이 휴직 없는 달과 같다", () => {
    const full = severanceBase(items({ baseP: 2_800_000, mealP: 200_000 }));
    const onLeave = severanceBase(items({ leavePayP: 1_500_000 }));
    expect(onLeave.base).toBe(full.base);
  });

  it("없던 기록(필드 없음)은 예전과 같다", () => {
    const b = severanceBase(items());
    expect(b.base).toBe(1_500_000);
    expect(b.included.some(([label]) => label.includes("휴업수당"))).toBe(false);
  });
});

/* ───────────── 소정근로일 기준 (v1.65) ───────────── */

describe("소정근로일 기준 — 명세서와 세무 자료가 기준·평일 수·식을 그대로 적는다", () => {
  // 2026-11 협의 건 — 월 3,200,000원 · 월 유급 93.852시간 · 1일 3.6시간 · 11/7~11/30 휴업 70%
  const terms = { monthly: 3_200_000, hourlyBase: 3_200_000, hourlyHours: 93.852, dailyHours: 3.6 };
  const workday = leave("2026-11-07", "2026-11-30", { kind: "SHUTDOWN", payRate: 0.7, payBasis: "WORKDAY" });
  const pd = settleLeavePay(monthPayDays(2026, 11, HIRE, null, [workday]), [], terms);
  const json = JSON.stringify({ notes: [], baseApplied: 3_200_000, blend: null, unpaidLeave: unpaidLeaveMetaOf(pd) });

  it("★ 명세서 — 「휴업수당」 줄, 손으로 다시 계산되는 식, 통상임금 풀이", () => {
    expect(pd.leavePay).toBe(1_374_760);
    const html = text(
      payslipHtml({
        employee: employee(),
        payroll: payroll({
          baseP: 640_000,
          mealP: 0,
          leavePayP: pd.leavePay,
          gross: 2_014_760,
          net: 2_014_760,
          hourlyWage: 34_096,
          prorationRatio: pd.ratio,
          breakdown: json,
        }),
        company,
      })
    );
    expect(html).toContain("기본급640,000 휴업수당1,374,760 지급액 계2,014,760");
    // 정상 급여의 일할은 기준과 무관하게 역일수다
    expect(html).toContain("휴업 일할계산 — 휴업 11월 7일 ~ 11월 30일(24일)을 뺀 지급 대상 (6일/30일)");
    expect(html).toContain("기본급 3,200,000원 × 6/30 = 640,000원");
    expect(html).toContain(
      "휴업수당 — 11월 7일 ~ 11월 30일(24일): 통상임금 1,963,943원" +
        "(월 3,200,000원 ÷ 93.852시간 × 1일 3.6시간 × 평일 16일) × 70% = 1,374,760원"
    );
    expect(html).toContain(LEAVE_WORKDAY_PAYSLIP_NOTE);
  });

  it("역일수 기준 명세서에는 통상임금 풀이가 붙지 않는다 — v1.64 문구 그대로", () => {
    const b = breakdownOf([shutdown("2026-11-16", "2026-11-30", 0.7)]);
    const html = text(
      payslipHtml({
        employee: employee(),
        payroll: payroll({ leavePayP: b.leavePay, gross: 2_550_000, net: 2_550_000, prorationRatio: b.ratio, breakdown: b.json }),
        company,
      })
    );
    expect(html).not.toContain(LEAVE_WORKDAY_PAYSLIP_NOTE);
    expect(html).not.toContain("통상임금");
  });

  it("★ 세무 자료 비고 — 금액과 함께 기준(통상임금의 70%)·평일 수를 적는다", () => {
    const row = buildExportRow(
      {
        incomeType: "EMPLOYEE",
        baseP: 640_000,
        extraP: 0,
        overtimeP: 0,
        nightP: 0,
        holidayP: 0,
        extraHours: 0,
        overtimeHours: 0,
        nightHours: 0,
        holidayHours: 0,
        holidayOverHours: 0,
        hourlyWage: 34_096,
        weeklyHolidayP: 0,
        positionP: 0,
        mealP: 0,
        carP: 0,
        incentiveP: 0,
        bonusP: 0,
        unusedLeaveP: 0,
        gross: 2_014_760,
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
        net: 2_014_760,
        employee: { name: "가상직원", empNo: "VT-1", rrn: "000000-0000000" },
        breakdown: json,
      } as ExportPayrollRecord,
      "12월 07일"
    );
    expect(row.basePay).toBe(2_014_760);
    expect(row.note).toBe("4대보험(근로소득) · 휴업 11/7~11/30(24일) 휴업수당 1,374,760원(통상임금의 70% · 평일 16일)");
    expect(reconcileRow(row)).toBe(0);
  });
});
