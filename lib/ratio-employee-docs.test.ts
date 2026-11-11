// 비율제 근로계약(4대보험)과 근로소득 상한 — 문서·제출자료·이체 파일이 **지급처별로** 갈리는지.
//
//  · 근로계약서: 강의위탁계약서가 아니라 근로계약서(비율급)가 나가고, 상한이 있으면 그 사실을 적는다
//  · 명세서: 이 회사 임금명세서에는 근로분만, 초과분은 별도 사업장 명의의 사업소득 지급명세서
//  · 세무 시트: 본표(근로소득)에서 초과분을 빼고 별도 시트로
//  · 이체 파일: 이 회사 파일에서 초과분을 빼고, 별도 사업장 파일에만 싣는다
//  · 퇴직급여: 산정기준 임금에서 초과분을 뺀다

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  contractHtml,
  contractGroups,
  deductsInsurance,
  type DocCompany,
  type DocContract,
  type DocEmployee,
} from "./documents";
import { payslipHtml, bizIncomeSlipHtml, revenueDetailHtml, type DocPayroll } from "./documents-pay";
import { computePayroll, DEFAULT_RATES_2025, type EmployeePayInput } from "./payroll";
import { buildExportRow, buildBizExportRow, reconcileRow, buildPayrollExportWorkbook, type ExportPayrollRecord } from "./payroll-export";
import { buildTransferRows, type TransferPayrollRecord } from "./bank-transfer";
import { severanceBase } from "./severance";
import type { BizPayer } from "./ratio-employee";

const company: DocCompany = {
  name: "주식회사 유쌤에듀",
  ceo: "유은정",
  bizNo: "418-86-02289",
  phone: "031-794-3306",
  address: "경기도 하남시 미사강변대로 216",
  payday: 7,
  stamp: null,
  bizPayerName: "가상아카데미",
};
const payer: BizPayer = {
  name: "가상아카데미",
  bizNo: "123-45-67890",
  ceo: "홍길동",
  address: "경기도 하남시 가상로 1",
  phone: "",
  alias: "가상A",
};

const emp = (over: Partial<DocEmployee> = {}): DocEmployee =>
  ({
    name: "가상강사",
    birth: "1990-01-01",
    department: "교수부",
    position: "강사",
    duty: "강의",
    address: "경기도 하남시",
    phone: "010-0000-0000",
    hireDate: new Date(Date.UTC(2026, 0, 2)),
    resignDate: null,
    incomeType: "EMPLOYEE",
    payScheme: "RATIO",
    ratioEmployee: true,
    baseWage: 0,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    schedule: "[]",
    ...over,
  }) as DocEmployee;

const ct = (over: Partial<DocContract> = {}): DocContract =>
  ({
    stage: "SHORT_TERM_1",
    templateKey: "RATIO",
    startDate: new Date(Date.UTC(2026, 0, 2)),
    endDate: null,
    isProbation: true,
    probationMonths: 3,
    baseWage: 0,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    ratioPercent: 0.4,
    ratioEmployee: true,
    ratioWageCap: 5_000_000,
    ...over,
  }) as DocContract;

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
/** 표 칸 사이를 띄워 읽는다 — '항목 금액' 처럼 같은 줄의 칸을 함께 찾을 때 */
const cells = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("근로계약서 — 비율급 근로계약", () => {
  const html = (c: Partial<DocContract> = {}, e: Partial<DocEmployee> = {}) =>
    text(contractHtml({ employee: emp(e), contract: ct(c), company }));

  it("강의위탁계약서가 아니라 근로계약서(비율급)가 나간다", () => {
    const h = html();
    expect(h).toContain("근 로 계 약 서");
    expect(h).toContain("근로계약서 (비율급)");
    expect(h).not.toContain("강의위탁계약서");
    expect(h).toContain("수강료(가) 입금액에 40%를 곱하여 산정하는 비율급(성과급)");
    expect(h).toContain("최저임금 이상");
    expect(h).toContain("주휴일(제5조)에 대한 임금이 포함");
    expect(h).toContain("연차유급휴가"); // 근로자 조항(제6조)이 그대로 있다
  });

  it("근로소득 상한을 적는다 — 넘는 부분은 별도 사업자(상호)가 지급", () => {
    const h = html();
    expect(h).toContain("월 5,000,000원을 넘는 부분은 이 계약에 따른 임금에 포함하지 아니하며");
    expect(h).toContain("별도 사업자(가상아카데미)");
    expect(h).toContain("4대보험료와 근로소득세는 이 계약에 따른 임금에 대하여만 공제한다");
  });

  it("상한이 없으면 그 조항이 없다(비율급 전액이 임금)", () => {
    const h = html({ ratioWageCap: null });
    expect(h).not.toContain("넘는 부분은 이 계약에 따른 임금에 포함하지");
    expect(h).not.toContain("별도 사업자");
  });

  it("정액 수당이 있으면 비율급과 별도로 적는다(없으면 그 줄이 없다)", () => {
    expect(html({ mealAllow: 200_000 })).toContain("제①항의 임금과 별도로 매월 식대(비과세) 200,000원을 지급한다");
    expect(html()).not.toContain("제①항의 임금과 별도로 매월");
  });

  it("보장급이 있으면 §47 로 적는다", () => {
    expect(html({ ratioMinGuarantee: 2_500_000 })).toContain("근로기준법 제47조에 따라");
    expect(html({ ratioMinGuarantee: 2_500_000 })).toContain("월 2,500,000원");
  });

  it("위탁 비율제는 그대로 강의위탁계약서다", () => {
    const h = html({ ratioEmployee: false, ratioWageCap: null }, { ratioEmployee: false, incomeType: "FREELANCE" });
    expect(h).toContain("강의위탁계약서");
    expect(h).not.toContain("근로계약서 (비율급)");
  });

  it("함께 받는 확인서 — 비율제 근로자는 퇴직유보금·개인사업자 지위 확인서가 없다", () => {
    const worker = contractGroups({ employee: emp(), contract: ct(), company });
    const all = worker.flatMap((g) => g.bodies).map(text).join("\n");
    expect(all).not.toContain("(퇴직유보금)");
    expect(all).not.toContain("개인사업자");
    expect(worker).toHaveLength(1); // 근로계약서 한 묶음뿐

    const contractor = contractGroups({
      employee: emp({ ratioEmployee: false, incomeType: "FREELANCE" }),
      contract: ct({ ratioEmployee: false, ratioWageCap: null }),
      company,
    });
    const all2 = contractor.flatMap((g) => g.bodies).map(text).join("\n");
    expect(all2).toContain("(퇴직유보금)");
    expect(all2).toContain("개인사업자");
  });

  it("임금공제 동의서 — 비율제 근로자는 4대보험을 적는다(위탁 비율제는 아니다)", () => {
    expect(deductsInsurance(emp())).toBe(true);
    expect(deductsInsurance(emp({ ratioEmployee: false, incomeType: "FREELANCE" }))).toBe(false);
    // 세무구분이 남아 있어도 위탁이면 4대보험을 적지 않는다(기존 규칙 그대로)
    expect(deductsInsurance(emp({ ratioEmployee: false, incomeType: "EMPLOYEE" }))).toBe(false);
    // 시급제 위탁 — 문서용 직원 정보에 위탁 표시가 실려 이제 바르게 가린다
    expect(deductsInsurance(emp({ payScheme: "HOURLY", ratioEmployee: false, isContractor: true }))).toBe(false);
  });
});

/* ───────────── 명세서 ───────────── */

const payInput: EmployeePayInput = {
  incomeType: "EMPLOYEE",
  payScheme: "RATIO",
  ratioEmployee: true,
  ratioWageCap: 5_000_000,
  baseWage: 0,
  positionAllow: 0,
  mealAllow: 0,
  carAllow: 0,
  dependents: 1,
  schedule: [],
  ratioPercent: 0.4,
};
const r = computePayroll(payInput, { classRevenue: 15_000_000 }, DEFAULT_RATES_2025, []);
const payroll: DocPayroll = {
  year: 2026,
  month: 10,
  incomeType: "EMPLOYEE",
  payScheme: "RATIO",
  ratioEmployee: true,
  ...r,
  parkingD: 0,
  expenseD: 0,
  breakdown: "{}",
};

describe("명세서 — 지급처별로 가른다", () => {
  it("이 회사 임금명세서에는 근로분만 — 합계도 근로분", () => {
    const html = payslipHtml({ employee: emp(), payroll, company, bizPayer: payer });
    const c = cells(html);
    expect(c).toContain("임금명세서");
    expect(c).toContain("비율급(근로소득분) 5,000,000");
    expect(c).toContain("지급액 계 5,000,000");
    expect(c).not.toContain("소득세(3%)"); // 사업소득세가 임금명세서 공제에 끼지 않는다
    // 공제액 계 = 4대보험 + 근로소득세(간이세액표 없음 → 0) — 사업소득세는 여기 없다
    const wageDeduct = r.pensionD + r.employmentD + r.healthD + r.longTermD + r.incomeTaxD + r.localTaxD;
    expect(c).toContain(`공제액 계 ${wageDeduct.toLocaleString()}`);
    expect(c).toContain(`실수령액 ${(5_000_000 - wageDeduct).toLocaleString()}`);
    expect(text(html)).toContain("1,000,000원은 이 명세서의 임금이 아니며, 별도 사업장(가상아카데미)이 사업소득으로 지급");
  });

  it("별도 사업장 명의의 사업소득 지급명세서 — 초과분과 3.3%", () => {
    const h = cells(bizIncomeSlipHtml({ employee: emp(), payroll, payer, company }));
    expect(h).toContain("사업소득 지급명세서");
    expect(h).toContain("가상아카데미");
    expect(h).toContain("123-45-67890");
    expect(h).not.toContain("418-86-02289"); // 이 회사 사업자번호가 지급자로 찍히지 않는다
    expect(h).toContain("사업소득 1,000,000");
    expect(h).toContain("소득세(3%) 30,000");
    expect(h).toContain("지방소득세(0.3%) 3,000");
    expect(h).toContain("차인지급액 967,000");
    expect(h).toContain("월 5,000,000원을 넘는 부분");
    // 조사가 이름의 받침에 맞는다 — '유쌤에듀와', '가상아카데미가'
    expect(h).toContain("주식회사 유쌤에듀와의 근로계약");
    expect(h).toContain("가상아카데미가 지급합니다");
  });

  it("상한을 넘지 않은 달은 예전 명세서와 같다(사업소득 안내가 없다)", () => {
    const small = computePayroll(payInput, { classRevenue: 10_000_000 }, DEFAULT_RATES_2025, []);
    const h = cells(
      payslipHtml({
        employee: emp(),
        payroll: { ...payroll, ...small },
        company,
        bizPayer: payer,
      })
    );
    expect(h).toContain("비율급 4,000,000");
    expect(h).not.toContain("별도 사업장");
  });

  it("산정 내역서(비율급) — 상한 초과분이 별도 사업장으로 간다고 적는다", () => {
    const h = text(
      revenueDetailHtml({
        employee: emp(),
        company,
        year: 2026,
        month: 10,
        students: [
          { seq: 1, status: "ENROLLED", name: "가상학생", revenue: 15_000_000 } as any,
        ],
        percent: 0.4,
        kind: "WAGE",
        wageCap: 5_000_000,
      })
    );
    expect(h).toContain("비율급 산정 내역서");
    expect(h).toContain("임금명세서의 비율급(근로계약서 제4조) 산출 근거");
    expect(h).toContain("1,000,000원은 별도 사업장");
    expect(h).not.toContain("위탁계약이므로");
  });
});

/* ───────────── 세무 시트 · 이체 파일 · 퇴직급여 ───────────── */

const exportRec = (): ExportPayrollRecord => ({
  ...(r as any),
  incomeType: "EMPLOYEE",
  payScheme: "RATIO",
  extraHours: 0,
  overtimeHours: 0,
  nightHours: 0,
  holidayHours: 0,
  holidayOverHours: 0,
  parkingD: 0,
  expenseD: 0,
  employee: { name: "가상강사", empNo: "E900", rrn: "900101-1234567" },
});

describe("세무사무소 제출자료 — 본표는 근로소득, 초과분은 별도 시트", () => {
  it("본표 행은 근로분만이고 합계가 맞는다", () => {
    const row = buildExportRow(exportRec(), "11월 07일");
    expect(row.grossTotal).toBe(5_000_000);
    expect(row.basePay).toBe(5_000_000);
    expect(row.netPay).toBe(5_000_000 - row.deduction);
    expect(reconcileRow(row)).toBe(0);
    expect(row.note).toContain("별도 시트");
  });

  it("별도 시트 행 — 지급액·3%·0.3%·차인지급액", () => {
    expect(buildBizExportRow(exportRec(), "11월 07일")).toEqual({
      name: "가상강사선생님",
      payDate: "11월 07일",
      amount: 1_000_000,
      tax: 30_000,
      local: 3_000,
      net: 967_000,
      id: "900101-1234567",
    });
  });

  it("워크북에 '별도 사업장 사업소득' 시트가 붙는다(초과분이 있을 때만)", () => {
    const out = buildPayrollExportWorkbook({
      year: 2026,
      month: 10,
      payday: 7,
      companyName: "주식회사 유쌤에듀",
      records: [exportRec()],
      bizPayerName: "가상아카데미",
    });
    const wb = XLSX.read(out.buffer, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["2026년 10월", "별도 사업장 사업소득"]);
    const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["별도 사업장 사업소득"], { header: 1 });
    expect(String(aoa[0][0])).toContain("가상아카데미");
    expect(aoa[2].slice(0, 6)).toEqual(["가상강사선생님", "11월 07일", 1_000_000, 30_000, 3_000, 967_000]);
    expect(out.mismatches).toEqual([]);

    const plain = buildPayrollExportWorkbook({
      year: 2026,
      month: 10,
      payday: 7,
      companyName: "주식회사 유쌤에듀",
      records: [{ ...exportRec(), bizIncomeP: 0, bizTaxD: 0, bizLocalTaxD: 0 }],
    });
    expect(XLSX.read(plain.buffer, { type: "buffer" }).SheetNames).toEqual(["2026년 10월"]);
  });
});

describe("은행 이체 파일 — 출금 계좌가 다른 두 파일", () => {
  const rec: TransferPayrollRecord = {
    net: r.net,
    retentionD: 0,
    incomeType: "EMPLOYEE",
    payScheme: "RATIO",
    ratioEmployee: true,
    bizIncomeP: r.bizIncomeP,
    bizTaxD: r.bizTaxD,
    bizLocalTaxD: r.bizLocalTaxD,
    employee: { name: "가상강사", empNo: "E900", bankName: "신한", bankAccount: "110-503-740850" },
  };

  it("이 회사 파일 — 근로분 실수령만, 통장 표시는 '급여'", () => {
    const plan = buildTransferRows({ year: 2026, month: 10, alias: "유쌤", records: [rec] });
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].amount).toBe(r.net - 967_000);
    expect(plan.rows[0].depositMemo).toBe("유쌤_10월급여");
    expect(plan.bizExcluded).toEqual(["가상강사"]);
  });

  it("별도 사업장 파일 — 초과분 차인지급액만, 그 사업장 약칭으로 '사업소득'", () => {
    const plan = buildTransferRows({ year: 2026, month: 10, alias: "가상A", records: [rec], payer: "BIZ" });
    expect(plan.rows).toEqual([
      expect.objectContaining({ amount: 967_000, depositMemo: "가상A_10월사업소득", account: "110503740850" }),
    ]);
  });

  it("두 파일을 더하면 그 사람의 실수령 전체다", () => {
    const a = buildTransferRows({ year: 2026, month: 10, alias: "유쌤", records: [rec] }).total;
    const b = buildTransferRows({ year: 2026, month: 10, alias: "가상A", records: [rec], payer: "BIZ" }).total;
    expect(a + b).toBe(r.net);
  });

  it("상한을 넘지 않은 사람은 별도 사업장 파일에 없다", () => {
    const plan = buildTransferRows({
      year: 2026,
      month: 10,
      alias: "가상A",
      records: [{ ...rec, bizIncomeP: 0, bizTaxD: 0, bizLocalTaxD: 0 }],
      payer: "BIZ",
    });
    expect(plan.rows).toEqual([]);
  });
});

describe("퇴직급여 산정기준 — 별도 사업장 몫은 이 회사의 임금이 아니다", () => {
  it("기본급(비율급)에서 초과분을 빼고, 뺀 사실을 남긴다", () => {
    const b = severanceBase({ ...(r as any), extraHours: 0, overtimeHours: 0, nightHours: 0, holidayHours: 0, holidayOverHours: 0 });
    expect(b.base).toBe(5_000_000);
    expect(b.excluded.some(([label, amt]) => label.includes("별도 사업장") && amt === 1_000_000)).toBe(true);
  });
});
