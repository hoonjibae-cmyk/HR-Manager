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
  newHirePackageGroups,
  bizPayerContractHtml,
  needsBizPayerContract,
  deductsInsurance,
  type DocCompany,
  type DocContract,
  type DocEmployee,
} from "./documents";
import {
  payslipHtml,
  bizIncomeSlipHtml,
  revenueDetailHtml,
  wageCapOf,
  ratioPayTotalOf,
  ratioNonTaxInsideOf,
  ratioHourlyBasisOf,
  type DocPayroll,
} from "./documents-pay";
import { computePayroll, DEFAULT_RATES_2025, type EmployeePayInput } from "./payroll";
import { buildExportRow, buildBizExportRow, reconcileRow, buildPayrollExportWorkbook, type ExportPayrollRecord } from "./payroll-export";
import { buildTransferRows, type TransferPayrollRecord } from "./bank-transfer";
import { severanceBase } from "./severance";
import { DEFAULT_BIZ_PAYER_SERVICE, type BizPayer } from "./ratio-employee";
import type { ScheduleDay } from "./constants";

// 학원 강사 — 주 5일 14:00~22:00, 휴게 30분 → 주 37.5h + 주휴 7.5h → 월 환산 195.525시간
const teacher: ScheduleDay[] = [
  ...(["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({ day, work: true, start: "14:00", end: "22:00", breakH: 0.5 })),
  ...(["sat", "sun"] as const).map((day) => ({ day, work: false, start: "00:00", end: "00:00", breakH: 0 })),
];

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
  service: "",
};
/** 별도 사업장 정보까지 채운 회사 — 상한이 있는 비율제 근로계약의 계약서 세트에 필요하다 */
const companyB: DocCompany = { ...company, bizPayer: payer, bizPayerMissing: [] };

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

  it("식대·차량유지비(비과세)는 제①항의 임금 '안에' 든 금액으로 적는다 — 별도로 지급한다고 적지 않는다(v1.58.2)", () => {
    const h = html({ mealAllow: 200_000 });
    expect(h).toContain("④ 제①항의 임금에는 식대(비과세) 월 200,000원이 포함되어 있다.");
    // '별도로' 라고 적으면 갑이 비율급 위에 식대를 더 주기로 약속한 계약서가 된다
    expect(h).not.toContain("제①항의 임금과 별도로 매월");
    expect(h).not.toContain("식대(비과세) 200,000원을 지급한다");
    // 차량유지비도 같은 줄에 함께 적는다
    expect(html({ mealAllow: 200_000, carAllow: 100_000 })).toContain(
      "④ 제①항의 임금에는 식대(비과세) 월 200,000원 · 차량유지비(비과세) 월 100,000원이 포함되어 있다."
    );
    // 없으면 그 줄이 없다
    expect(html()).not.toContain("포함되어 있다. ⑤");
    expect(html()).not.toContain("식대(비과세)");
  });

  it("직책수당만 비율급과 별도로 얹는다 — 식대와 한 항에 나란히 적되 문장을 가른다", () => {
    expect(html({ positionAllow: 300_000 })).toContain(
      "④ \"갑\"은 제①항의 임금과 별도로 매월 직책수당 300,000원을 지급한다."
    );
    expect(html({ mealAllow: 200_000, positionAllow: 300_000 })).toContain(
      "④ 제①항의 임금에는 식대(비과세) 월 200,000원이 포함되어 있다. \"갑\"은 제①항의 임금과 별도로 매월 직책수당 300,000원을 지급한다. ⑤"
    );
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

  it("함께 받는 확인서 — 비율제 근로자는 이 회사 앞으로 퇴직유보금·개인사업자 지위 확인서가 없다", () => {
    // 상한이 없으면 근로계약서 한 묶음뿐
    const worker = contractGroups({ employee: emp(), contract: ct({ ratioWageCap: null }), company });
    const all = worker.flatMap((g) => g.bodies).map(text).join("\n");
    expect(all).not.toContain("(퇴직유보금)");
    expect(all).not.toContain("개인사업자");
    expect(worker).toHaveLength(1);

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

describe("근로계약서(비율급) — 경업금지 보상금 비율(v1.58)", () => {
  const html = (c: Partial<DocContract> = {}, e: Partial<DocEmployee> = {}) =>
    text(contractHtml({ employee: emp(e), contract: ct(c), company }));

  it("제4조에 비율급과 별도 지급을 적고, 상한은 비율급과 보상금의 합에 건다(v1.58.1)", () => {
    const h = html({ nonCompeteRatio: 0.03 });
    expect(h).toContain(
      "④ \"갑\"은 제①항의 임금과 별도로, 제8조에 따른 경업금지 의무의 대가로 매월 제①항의 수강료 입금액에 3%를 곱한 금액을 경업금지 보상금으로 지급한다."
    );
    // 보상금 항(④) 바로 뒤의 상한 조항(⑤)이 그 번호를 가리켜 '합한 금액' 에 상한을 건다
    expect(h).toContain(
      "⑤ 제①항에 따라 산정한 금액과 제④항의 경업금지 보상금을 합한 금액이 월 5,000,000원을 넘는 경우 그 넘는 부분은 제①항의 금액에서 빼어 이 계약에 따른 임금에 포함하지 아니하며, \"을\"과 별도 사업자(가상아카데미) 사이의 계약에 따라 그 사업자가 지급한다."
    );
    // 공제 문장에는 보상금을 적지 않는다(v1.58.2) — 보상금에서 4대보험·근로소득세를 뗀다고 계약서가 못박지 않게.
    // 보상금이 없는 계약과 같은 문장이다
    expect(h).toContain("그 사업자가 지급한다. 4대보험료와 근로소득세는 이 계약에 따른 임금에 대하여만 공제한다. ⑥");
    expect(h).not.toContain("임금과 경업금지 보상금에 대하여만 공제");
    expect(h).not.toContain("상한과 관계없이");
    // 식대 항이 끼면 보상금 항이 ⑤ 로 밀리고, 상한 조항이 가리키는 번호도 함께 밀린다
    const m = html({ nonCompeteRatio: 0.03, mealAllow: 200_000 });
    expect(m).toContain("⑤ \"갑\"은 제①항의 임금과 별도로, 제8조에 따른");
    expect(m).toContain("⑥ 제①항에 따라 산정한 금액과 제⑤항의 경업금지 보상금을 합한 금액이");
  });

  it("보상금이 없으면 상한 조항은 예전 문구 그대로(비율급에만)", () => {
    const h = html();
    expect(h).toContain(
      "제①항에 따라 산정한 금액 중 월 5,000,000원을 넘는 부분은 이 계약에 따른 임금에 포함하지 아니하며"
    );
    expect(h).not.toContain("합한 금액이");
  });

  it("제8조 「경업금지 및 경업금지 보상금」이 들어가고 기타사항이 제9조로 밀린다", () => {
    const h = html({ nonCompeteRatio: 0.03 });
    expect(h).toContain("제 8조 (경업금지 및 경업금지 보상금)");
    expect(h).toContain("근로계약 종료일로부터 6개월간");
    expect(h).toContain("반경 2km");
    expect(h).toContain(
      "매월 제4조 제①항의 수강료 입금액에 3%를 곱한 금액을 경업금지 보상금으로 제4조의 임금과 구분하여 임금 지급일에 함께 지급한다."
    );
    expect(h).toContain("전액을 \"갑\"의 서면 청구일로부터 30일 이내");
    expect(h).toContain("위약금이나 손해배상액의 예정이 아니며");
    expect(h).toContain("보상금의 비율 및 반환 의무");
    expect(h).toContain("제 9조 (기타사항)");
    expect(h).not.toContain("일할 계산"); // 매출 비례라 일할 문구가 없다(월급제와 다른 점)
  });

  it("상한이 없으면 상한 조항 자체가 없다(보상금 항만)", () => {
    const h = html({ nonCompeteRatio: 0.025, ratioWageCap: null });
    expect(h).toContain("수강료 입금액에 2.5%를 곱한 금액을 경업금지 보상금으로 지급한다.");
    expect(h).not.toContain("합한 금액이");
    expect(h).not.toContain("별도 사업자");
  });

  it("보상금 비율이 없으면 경업금지 조항이 없다 — 기타사항은 제8조", () => {
    const h = html();
    expect(h).not.toContain("경업금지");
    expect(h).toContain("제 8조 (기타사항)");
  });
});

describe("근로계약서(비율급) 제4조 ③ — 통상시급은 갑이 지급하는 임금 기준이고 경업금지 보상금은 넣지 않는다(v1.59.2)", () => {
  const html = (c: Partial<DocContract> = {}) => text(contractHtml({ employee: emp(), contract: ct(c), company }));
  // ③ 은 세 문장이다 — 주휴 포함 · 초과근로는 통상시급으로 별도 · 통상시급의 식. 바뀌는 것은 식의 분자와 끝맺음뿐이다.
  const HEAD =
    "③ 제①항의 임금에는 소정근로와 주휴일(제5조)에 대한 임금이 포함되어 있다. 소정근로시간을 넘는 연장·야간·휴일근로에 대하여는 " +
    "통상시급을 기준으로 근로기준법에 따른 수당을 별도 지급한다. 통상시급은 그 달 \"갑\"이 \"을\"에게 지급하는 ";
  /** 보상금이 없는 계약 */
  const plain = (base: string) => HEAD + base + "을 월 소정근로시간(주휴시간 포함)으로 나누어 산정한다. ④";
  /** 보상금이 있는 계약 — 보상금 항(n)을 가리켜 「포함하지 아니한다」고 못박는다 */
  const withNc = (base: string, n: string) =>
    HEAD +
    base +
    `을 월 소정근로시간(주휴시간 포함)으로 나누어 산정하며, 제${n}항의 경업금지 보상금은 근로의 대가가 아니므로 통상시급의 산정에 포함하지 아니한다. ④`;

  it("식대 + 보상금 + 상한 — 식대를 포함한 임금이 기준이고, 보상금은 포함하지 않는다고 적는다", () => {
    const h = html({ mealAllow: 200_000, nonCompeteRatio: 0.03 });
    expect(h).toContain(withNc("제①항의 임금(제④항의 식대를 포함한다)", "⑤"));
    // ③ 이 가리키는 번호가 실제로 그 항이다
    expect(h).toContain("④ 제①항의 임금에는 식대(비과세) 월 200,000원이 포함되어 있다.");
    expect(h).toContain("⑤ \"갑\"은 제①항의 임금과 별도로, 제8조에 따른 경업금지 의무의 대가로");
    expect(h).toContain("⑥ 제①항에 따라 산정한 금액과 제⑤항의 경업금지 보상금을 합한 금액이 월 5,000,000원을 넘는 경우");
    // 보상금을 통상시급의 기준에 넣는 문구(v1.59.1)는 없다 — 임금(근로소득)의 모양으로 읽히지 않게
    expect(h).not.toContain("경업금지 보상금을 합한 금액을 월 소정근로시간");
    expect(h).not.toContain("경업금지 보상금을 합한 금액(제");
    expect(h).not.toContain("적용되는 달은 월"); // 상한이 걸린 달의 기준은 상한액이 아니라 상한액 − 보상금이다
    expect(h).not.toContain("이 계약에 따른 임금 ÷");
  });

  it("항이 빠지면 가리키는 번호도 당겨진다", () => {
    // 식대 없음 — 보상금 ④
    expect(html({ nonCompeteRatio: 0.03 })).toContain(withNc("제①항의 임금", "④"));
    // 상한 없음 — 식대 ④ · 보상금 ⑤
    expect(html({ mealAllow: 200_000, nonCompeteRatio: 0.03, ratioWageCap: null })).toContain(
      withNc("제①항의 임금(제④항의 식대를 포함한다)", "⑤")
    );
    // 차량유지비도 함께 가리킨다
    expect(html({ mealAllow: 200_000, carAllow: 100_000, positionAllow: 300_000, nonCompeteRatio: 0.03 })).toContain(
      withNc("제①항의 임금(제④항의 식대·차량유지비를 포함한다)", "⑤")
    );
  });

  it("보상금이 없는 계약은 보상금 문장이 없고, 상한이 걸린 달의 기준(상한액)을 적는다", () => {
    // 식대 ④ · 상한 ⑤ (괄호 하나에 함께 적는다)
    const h = html({ mealAllow: 200_000 });
    expect(h).toContain(plain("제①항의 임금(제④항의 식대를 포함하며, 제⑤항이 적용되는 달은 월 5,000,000원)"));
    expect(h).not.toContain("경업금지");
    // 상한만 — 상한 ④
    expect(html()).toContain(plain("제①항의 임금(제④항이 적용되는 달은 월 5,000,000원)"));
    // 아무것도 없으면 제①항의 임금 그대로
    expect(html({ ratioWageCap: null })).toContain(plain("제①항의 임금"));
    // 직책수당만 있으면 ④ 는 직책수당 항이라 식대를 가리키지 않고, 상한은 ⑤ 다 — 직책수당은 기준에 넣지 않는다
    const p = html({ positionAllow: 300_000 });
    expect(p).toContain(plain("제①항의 임금(제⑤항이 적용되는 달은 월 5,000,000원)"));
    expect(p).toContain("④ \"갑\"은 제①항의 임금과 별도로 매월 직책수당 300,000원을 지급한다.");
    const r = computePayroll(
      { ...payInput, schedule: teacher, positionAllow: 300_000 },
      { classRevenue: 15_000_000 },
      DEFAULT_RATES_2025,
      []
    );
    expect(r.positionP).toBe(300_000);
    expect(r.ratioHourlyBasis?.wage).toBe(5_000_000); // 직책수당 30만은 분자에 없다
  });

  it("계약서가 적은 기준과 엔진이 나누는 금액이 같다 — 갑이 지급하는 제①항의 임금(식대 포함), 보상금은 없다", () => {
    const e = { ...payInput, schedule: teacher, mealAllow: 200_000, nonCompeteRatio: 0.03 };
    // 상한이 걸리는 달(매출 × 43% > 500만) — 기준은 상한액이 아니라 **상한액 − 보상금**이다
    for (const revenue of [11_630_000, 15_000_000, 20_000_000, 33_333_333]) {
      const r = computePayroll(e, { classRevenue: revenue }, DEFAULT_RATES_2025, []);
      expect(r.bizIncomeP).toBeGreaterThan(0);
      expect(r.ratioHourlyBasis?.wage).toBe(5_000_000 - r.nonCompeteP);
      // 그 금액은 명세서의 두 줄 — 비율급(근로소득분) + 식대 — 의 합이고, 보상금 줄은 들지 않는다
      expect(r.ratioHourlyBasis?.wage).toBe(r.baseP - r.bizIncomeP + r.mealP);
      expect(r.ratioHourlyBasis?.hours).toBeCloseTo(195.525, 6);
      expect(r.hourlyWage).toBe(Math.round((5_000_000 - r.nonCompeteP) / 195.525));
    }
    // 매출 1,500만 — 비율급 근로분 435만 + 식대 20만 = 455만 → 23,271원 (보상금 45만을 넣던 때는 500만 → 25,572원)
    const mid = computePayroll(e, { classRevenue: 15_000_000 }, DEFAULT_RATES_2025, []);
    expect(mid.ratioHourlyBasis?.wage).toBe(4_550_000);
    expect(mid.hourlyWage).toBe(23_271);
    // 안 걸리는 달 — 매출 1,000만: 비율급 400만(식대 20만 포함). 보상금 30만은 넣지 않는다
    const low = computePayroll(e, { classRevenue: 10_000_000 }, DEFAULT_RATES_2025, []);
    expect(low.bizIncomeP).toBe(0);
    expect(low.nonCompeteP).toBe(300_000);
    expect(low.ratioHourlyBasis?.wage).toBe(4_000_000);
    expect(low.baseP + low.mealP).toBe(4_000_000);
    expect(low.hourlyWage).toBe(Math.round(4_000_000 / 195.525));
    // 보상금이 없는 계약과 통상시급이 같다(같은 매출 · 상한이 안 걸린 달)
    const noNc = computePayroll({ ...e, nonCompeteRatio: null }, { classRevenue: 10_000_000 }, DEFAULT_RATES_2025, []);
    expect(low.hourlyWage).toBe(noNc.hourlyWage);
  });

  it("보상금이 없는 계약 — 「상한 항이 적용되는 달은 월 X원」은 그 말이 정확히 맞는 계약에만 적는다", () => {
    // 상한이 걸린 달의 기준은 정확히 상한액이다
    const e = { ...payInput, schedule: teacher, mealAllow: 200_000 };
    for (const revenue of [12_600_000, 15_000_000, 30_000_000]) {
      const r = computePayroll(e, { classRevenue: revenue }, DEFAULT_RATES_2025, []);
      expect(r.bizIncomeP).toBeGreaterThan(0);
      expect(r.ratioHourlyBasis?.wage).toBe(5_000_000);
      expect(r.hourlyWage).toBe(25_572);
    }
    // 보장급(§47)이 상한보다 높게 잡힌 계약은 보장급으로 올려 준 몫(언제나 이 회사의 임금)만큼 합계가 상한을 넘는 달이
    // 있다 — 그런 계약에는 금액을 적지 않는다. 매출 1,300만 — 산식 520만 > 상한 → 별도 사업장 20만, 보장급 550만
    const high = { ratioMinGuarantee: 5_500_000 };
    expect(html(high)).toContain(plain("제①항의 임금"));
    expect(html(high)).not.toContain("적용되는 달은 월");
    const r = computePayroll({ ...payInput, schedule: teacher, ...high }, { classRevenue: 13_000_000 }, DEFAULT_RATES_2025, []);
    expect(r.bizIncomeP).toBe(200_000);
    expect(r.ratioHourlyBasis?.wage).toBe(5_300_000); // 상한 500만 + 보장급으로 올려 준 30만
    // 보장급이 상한 이하면 적는다(경계 포함)
    expect(html({ ratioMinGuarantee: 2_500_000 })).toContain("(제④항이 적용되는 달은 월 5,000,000원)");
    expect(html({ ratioMinGuarantee: 5_000_000 })).toContain("(제④항이 적용되는 달은 월 5,000,000원)");
    expect(html({ ratioMinGuarantee: 5_000_001 })).not.toContain("적용되는 달은 월");
  });

  it("월급제 근로계약서·강의위탁계약서는 건드리지 않는다", () => {
    const monthly = text(
      contractHtml({
        employee: emp({ payScheme: "MONTHLY", ratioEmployee: false, baseWage: 3_000_000 }),
        contract: ct({ templateKey: "MONTHLY", ratioEmployee: false, ratioPercent: null, ratioWageCap: null, baseWage: 3_000_000 }),
        company,
      })
    );
    expect(monthly).not.toContain("통상시급은 그 달");
    const contractor = text(
      contractHtml({
        employee: emp({ ratioEmployee: false, isContractor: true, incomeType: "FREELANCE" }),
        contract: ct({ ratioEmployee: false, ratioWageCap: null }),
        company,
      })
    );
    expect(contractor).toContain("강의위탁계약서");
    expect(contractor).not.toContain("통상시급");
  });
});

describe("별도 사업장 용역위탁계약서(v1.58)", () => {
  const doc = (c: Partial<DocContract> = {}, p: Partial<BizPayer> = {}) =>
    text(bizPayerContractHtml({ employee: emp(), contract: ct(c), company, payer: { ...payer, ...p } }));

  it("갑은 별도 사업장 — 이 회사 이름·사업자번호가 당사자로 나오지 않는다", () => {
    const h = doc();
    expect(h).toContain("용역위탁계약서");
    expect(h).toContain("가상아카데미 (이하 \"갑\"이라 한다) 과(와) 가상강사 (이하 \"을\"이라 한다)");
    expect(h).toContain("123-45-67890");
    expect(h).toContain("대표 홍길동");
    expect(h).not.toContain("418-86-02289");
    expect(h).not.toContain("유쌤에듀");
  });

  it("수수료 산식은 엔진과 같다 — 수강료 입금액 × 비율 중 상한 초과분", () => {
    const h = doc();
    expect(h).toContain("수강료(가) 입금액에 40%를 곱한 금액 중 월 5,000,000원을 초과하는 금액으로 한다");
    expect(h).toContain("월 5,000,000원 이하인 달에는 용역수수료가 발생하지 아니한다");
    expect(h).toContain("다음 달 7일에 사업소득세(3.0%)와 지방소득세(0.3%)를 공제");
    // 근로계약서 제4조의 상한 문구와 같은 금액을 가리킨다
    expect(text(contractHtml({ employee: emp(), contract: ct(), company }))).toContain(
      "월 5,000,000원을 넘는 부분은 이 계약에 따른 임금에 포함하지 아니하며"
    );
  });

  it("근로계약에 보상금 비율이 있으면 수수료 산식에 함께 넣는다 — 엔진과 같은 식(따로 곱해 합한 금액 중 상한 초과분)", () => {
    const h = doc({ nonCompeteRatio: 0.03 });
    expect(h).toContain(
      "① \"갑\"이 \"을\"에게 지급하는 용역수수료는 매월 1일부터 말일까지 \"을\"이 담당한 원생의 수강료(가) 입금액에 40%를 곱한 금액과 3%를 곱한 금액을 합한 금액 중 월 5,000,000원을 초과하는 금액으로 한다. 그 합한 금액이 월 5,000,000원 이하인 달에는 용역수수료가 발생하지 아니한다. ②"
    );
    // 「× 40% 를 곱한 금액을 넘지 아니한다」 단서는 적지 않는다(v1.59) — 3% 금액만으로 상한을 넘을 때(월 매출
    // 약 1억 6,700만원 초과)에만 작동해 읽는 사람에게 뜻 모를 문장만 남겼다. 엔진의 한도는 그대로다(아래)
    expect(h).not.toContain("넘지 아니한다");
    expect(h).not.toContain("경업금지"); // 이 계약은 경업금지와 무관하다 — 숫자로만 적는다
    expect(h).not.toContain("43%"); // 한 번에 곱한다고 적지 않는다(엔진은 따로 반올림해 더한다)
  });

  it("단서를 뺐어도 닿는 범위에서는 계약서 산식과 엔진이 같은 금액을 낸다 — 엔진의 비율급 한도는 그대로", () => {
    const fee = (rev: number) =>
      computePayroll(
        { ...payInput, nonCompeteRatio: 0.03 },
        { classRevenue: rev },
        DEFAULT_RATES_2025,
        []
      );
    // 계약서 문언: (매출 × 40% + 매출 × 3%) 중 500만원 초과분, 합이 500만원 이하면 없음
    const byContract = (rev: number) => Math.max(Math.round(rev * 0.4) + Math.round(rev * 0.03) - 5_000_000, 0);
    for (const rev of [0, 5_000_000, 11_627_906, 11_627_907, 15_000_000, 30_000_000, 100_000_000, 166_000_000]) {
      expect(fee(rev).bizIncomeP).toBe(byContract(rev));
    }
    // 단서가 작동하던 자리 — 3% 금액만으로 500만원을 넘는 월 매출(약 1억 6,700만원 초과). 엔진은 여전히
    // 별도 사업장 몫을 비율급(40%) 한도로 묶는다(보상금은 이 회사가 주는 돈이라 옮길 수 없다)
    const extreme = fee(200_000_000);
    expect(extreme.bizIncomeP).toBe(80_000_000);
    expect(byContract(200_000_000)).toBe(81_000_000);
  });

  it("서명란의 갑은 '위탁자' — 사용자(근로관계)로 적지 않는다", () => {
    const raw = bizPayerContractHtml({ employee: emp(), contract: ct(), company, payer });
    expect(raw).toContain('"갑" (위탁자)');
    expect(raw).not.toContain("(사용자)");
    expect(raw).toContain('"을" (수탁자)');
  });

  it("근로자 아님·지휘감독 없음을 적고, 경업금지·위약금은 두지 않는다", () => {
    const h = doc();
    expect(h).toContain("지휘·감독을 받지 아니하고");
    expect(h).toContain("근로기준법상 근로자의 지위에 있지 아니하며");
    expect(h).toContain("제 4조 (기밀유지)");
    expect(h).not.toContain("경업금지");
    expect(h).not.toContain("위약금");
  });

  it("위탁 용역은 설정값 — 비우면 기본 문구", () => {
    expect(doc()).toContain(DEFAULT_BIZ_PAYER_SERVICE);
    const custom = doc({}, { service: "온라인 강의 콘텐츠 제작" });
    expect(custom).toContain("위탁 용역온라인 강의 콘텐츠 제작");
    expect(custom).not.toContain(DEFAULT_BIZ_PAYER_SERVICE);
  });

  it("이 회사 인감·로고를 싣지 않는다", () => {
    const raw = bizPayerContractHtml({
      employee: emp(),
      contract: ct(),
      company: { ...company, stamp: "data:image/png;base64,AAAA", logo: "data:image/png;base64,BBBB" },
      payer,
    });
    expect(raw).not.toContain("data:image/png");
  });

  it("작성일자 = min(발급일, 계약 시작일) — 근로계약서와 같다", () => {
    const printedAt = new Date(Date.UTC(2025, 11, 20));
    const h = text(
      bizPayerContractHtml({ employee: emp(), contract: ct(), company, payer, printedAt })
    );
    expect(h).toContain("2025년 12월 20일");
  });
});

describe("계약서 세트 — 상한이 있으면 별도 사업장 용역위탁계약서가 함께 나간다", () => {
  const OPTS = { seamStamp: "data:image/png;base64,SEAM", initials: true, paginate: true, fitPages: 2 };

  it("근로계약서 · 별도 사업장 용역위탁계약서 · 그 사업장 앞 개인사업자 지위 확인서", () => {
    const g = contractGroups({ employee: emp(), contract: ct(), company: companyB, bilateralOpts: OPTS });
    expect(g).toHaveLength(3);
    expect(text(g[0].bodies[0])).toContain("근로계약서 (비율급)");
    expect(text(g[1].bodies[0])).toContain("용역위탁계약서");
    // 남의 계약서에 이 회사 인감으로 간인을 찍지 않는다 — 이니셜란·쪽번호는 그대로, 한 장짜리 서식이라 1장 맞춤
    expect(g[1].opts?.seamStamp).toBeNull();
    expect(g[1].opts?.initials).toBe(true);
    expect(g[1].opts?.fitPages).toBe(1);
    expect(g[0].opts?.seamStamp).toBe("data:image/png;base64,SEAM"); // 근로계약서는 그대로
    const confirm = text(g[2].bodies[0]);
    expect(confirm).toContain("개인사업자 지위 확인서");
    expect(confirm).toContain("위탁 용역을 수행함에 있어서");
    expect(confirm).not.toContain("입사함에 있어서");
    expect(confirm).toContain("가상아카데미 대표 홍길동 귀하");
    expect(confirm).not.toContain("유쌤에듀");
  });

  it("상한이 없거나 위탁 비율제면 붙지 않는다", () => {
    expect(needsBizPayerContract(ct({ ratioWageCap: null }))).toBe(false);
    expect(needsBizPayerContract(ct({ ratioEmployee: false, ratioWageCap: null }))).toBe(false);
    expect(needsBizPayerContract(ct({ templateKey: "MONTHLY", ratioEmployee: false, ratioWageCap: null }))).toBe(false);
    expect(needsBizPayerContract(ct())).toBe(true);
    const g = contractGroups({ employee: emp(), contract: ct({ ratioWageCap: null }), company: companyB });
    expect(g.flatMap((x) => x.bodies).map(text).join("\n")).not.toContain("용역위탁계약서");
  });

  it("별도 사업장 정보가 비면 발급을 막는다 — 지급 근거 없는 근로계약서가 나가지 않게", () => {
    expect(() =>
      contractGroups({
        employee: emp(),
        contract: ct(),
        company: { ...company, bizPayer: null, bizPayerMissing: ["상호", "주소"] },
      })
    ).toThrow(/별도 사업장.*상호·주소.*용역위탁계약서/);
  });

  it("신규입사 패키지에도 같은 묶음이 들어간다", () => {
    const g = newHirePackageGroups({ employee: emp(), contract: ct(), company: companyB });
    const all = g.flatMap((x) => x.bodies).map(text).join("\n");
    expect(all).toContain("용역위탁계약서");
    expect(all).toContain("가상아카데미 대표 홍길동 귀하");
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
    // 근거는 별도 사업장 명의의 용역위탁계약서(근로계약서와 함께 발급) — 그 조항을 가리킨다
    expect(h).toContain("용역위탁계약(제3조)에 따라");
    expect(h).toContain("용역위탁계약에 따른 용역수수료");
  });

  it("경업금지 보상금(비율) — 상한은 비율급과 합쳐 잰다: 임금명세서 지급액 계가 상한 500만 그대로", () => {
    const rr = computePayroll({ ...payInput, nonCompeteRatio: 0.03 }, { classRevenue: 15_000_000 }, DEFAULT_RATES_2025, []);
    expect(rr.bizIncomeP).toBe(1_450_000); // 600만 + 45만 − 500만
    const pr: DocPayroll = {
      ...payroll,
      ...rr,
      // 급여 산정이 남기는 근거 — 각주의 식과 '그 달 상한' 을 그대로 적는다
      breakdown: JSON.stringify({
        nonCompete: { ratio: 0.03, revenue: 15_000_000 },
        wageCap: { cap: 5_000_000, withNonCompete: true },
      }),
    };
    const html = payslipHtml({ employee: emp(), payroll: pr, company, bizPayer: payer });
    const h = text(html);
    expect(h).toContain("근로계약서 제8조의 경업금지 의무에 대한 대가로 비율급과 별도로 지급");
    expect(h).toContain("수강료 입금액 15,000,000원 × 3% = 450,000원");
    // 보상금까지 합쳐 재는 상한을 '근로소득 상한' 이라고 부르지 않고, 통상시급에 넣지 않는다고 밝힌다(v1.59.2)
    expect(h).toContain("근로계약서 제4조의 상한은 비율급과 이 보상금을 합친 금액에 걸리고");
    expect(h).toContain("근로의 대가가 아니므로 통상시급(수당 산정 기준)에 포함하지 않습니다(근로계약서 제4조).");
    expect(h).not.toContain("근로소득 상한");
    // 보상금이 과세인지 비과세인지는 명세서가 단정하지 않는다(v1.58.2 — 세무 처리는 세무대리인 지정값에 따른다)
    expect(h).not.toContain("근로소득으로 과세되고");
    expect(h).not.toContain("4대보험 산정에 포함됩니다");
    expect(h).toContain(
      "이 달 비율급 6,000,000원과 경업금지 보상금 450,000원의 합계 중 근로계약서 제4조의 상한 5,000,000원을 넘는 1,450,000원은 비율급에서 빼어 이 명세서의 임금이 아니며"
    );
    expect(h).not.toContain("강의위탁계약서");
    expect(h).not.toContain("상한과 관계없이");
    // 임금명세서: 비율급(근로소득분) 455만 + 보상금 45만 = 지급액 계 500만(= 상한)
    const c = cells(html);
    expect(c).toContain("비율급(근로소득분) 4,550,000");
    expect(c).toContain("경업금지 보상금 450,000");
    expect(c).toContain("지급액 계 5,000,000");
  });

  it("사업소득 지급명세서·산정 내역서도 '합계 기준' 으로 적는다", () => {
    const rr = computePayroll({ ...payInput, nonCompeteRatio: 0.03 }, { classRevenue: 15_000_000 }, DEFAULT_RATES_2025, []);
    const pr: DocPayroll = {
      ...payroll,
      ...rr,
      breakdown: JSON.stringify({ wageCap: { cap: 5_000_000, withNonCompete: true } }),
    };
    const slip = cells(bizIncomeSlipHtml({ employee: emp(), payroll: pr, payer, company }));
    expect(slip).toContain("사업소득 1,450,000");
    expect(slip).toContain("비율급과 경업금지 보상금의 합계 중 월 5,000,000원을 넘는 부분(비율급에서 지급)");
    expect(slip).toContain("근로계약(제4조)에서 정한 상한(월 5,000,000원 — 비율급과 경업금지 보상금의 합계 기준)을 넘는 비율급");
    expect(slip).not.toContain("근로소득 상한"); // 보상금까지 합쳐 재는 상한 — 보상금을 근로소득으로 적지 않는다
    const detail = text(
      revenueDetailHtml({
        employee: emp(),
        company,
        year: 2026,
        month: 10,
        students: [{ seq: 1, status: "ENROLLED", name: "가상학생", revenue: 15_000_000 } as any],
        percent: 0.4,
        kind: "WAGE",
        wageCap: 5_000_000,
        bizIncome: rr.bizIncomeP,
        wageCapWithNonCompete: true,
      })
    );
    expect(detail).toContain("근로계약서 제4조의 상한(월 5,000,000원 — 경업금지 보상금과 합친 금액 기준)을 넘는 1,450,000원");
    expect(detail).not.toContain("근로소득 상한");
  });

  it("옛 기록(상한 근거가 없는 breakdown)은 비율급 − 별도 사업장 몫으로 상한을 되짚는다", () => {
    expect(wageCapOf({ ...payroll, breakdown: "{}" })).toEqual({ cap: 5_000_000, withNonCompete: false });
    expect(wageCapOf({ ...payroll, bizIncomeP: 0 })).toBeNull();
    expect(
      wageCapOf({ ...payroll, breakdown: JSON.stringify({ wageCap: { cap: 4_000_000, withNonCompete: true } }) })
    ).toEqual({ cap: 4_000_000, withNonCompete: true });
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

/* ───────────── 식대(비과세)는 비율급 안에 (v1.58.2) ───────────── */

describe("식대(비과세)는 비율급 안에 든 금액 — 명세서·내역서·세무 시트·퇴직급여(v1.58.2)", () => {
  // 매출 1,500만 × 40% = 비율급 600만, 보상금 3% = 45만, 상한 500만, 식대 20만
  const rr = computePayroll(
    { ...payInput, mealAllow: 200_000, nonCompeteRatio: 0.03 },
    { classRevenue: 15_000_000 },
    DEFAULT_RATES_2025,
    []
  );
  // 급여 산정(payroll-service)이 남기는 근거 그대로
  const pr: DocPayroll = {
    ...payroll,
    ...rr,
    breakdown: JSON.stringify({
      nonCompete: { ratio: 0.03, revenue: 15_000_000 },
      wageCap: { cap: 5_000_000, withNonCompete: true },
      ratioPay: { total: rr.ratioPayTotal },
    }),
  };

  it("임금명세서 — 비율급(근로소득분) 435만 + 식대 20만 + 보상금 45만 = 지급액 계 500만(상한 그대로)", () => {
    const html = payslipHtml({ employee: emp(), payroll: pr, company, bizPayer: payer });
    const c = cells(html);
    expect(c).toContain("비율급(근로소득분) 4,350,000");
    expect(c).toContain("식대(비과세) 200,000");
    expect(c).toContain("경업금지 보상금 450,000");
    expect(c).toContain("지급액 계 5,000,000"); // 식대만큼 늘지 않는다
    const h = text(html);
    expect(h).toContain(
      "식대(비과세) 200,000원은 근로계약서 제4조에 따라 비율급에 포함된 금액입니다 — 비과세 항목이라 나누어 적었을 뿐 따로 더해 지급하는 돈이 아니며"
    );
    // 상한 각주의 '이 달 비율급' 은 식대를 뗀 나머지(baseP 580만)가 아니라 비율급 전체(600만)다
    expect(h).toContain(
      "이 달 비율급 6,000,000원과 경업금지 보상금 450,000원의 합계 중 근로계약서 제4조의 상한 5,000,000원을 넘는 1,450,000원은 비율급에서 빼어"
    );
    expect(h).not.toContain("이 달 비율급 5,800,000원");
  });

  it("ratioPayTotalOf — 새 기록은 산정이 남긴 비율급 전체, 옛 기록(근거 없음)은 baseP 가 곧 전체", () => {
    expect(pr.baseP).toBe(5_800_000);
    expect(ratioPayTotalOf(pr)).toBe(6_000_000);
    expect(ratioPayTotalOf({ baseP: 6_000_000, breakdown: "{}" })).toBe(6_000_000);
    expect(ratioPayTotalOf({ baseP: 6_000_000, breakdown: null })).toBe(6_000_000);
    expect(ratioPayTotalOf({ baseP: 6_000_000, breakdown: "깨진 값" })).toBe(6_000_000);
    // 상한 근거(breakdown.wageCap)가 없는 새 기록도 비율급 전체에서 되짚는다(식대를 뗀 baseP 가 아니라)
    expect(
      wageCapOf({ ...pr, breakdown: JSON.stringify({ ratioPay: { total: 6_000_000 } }) })
    ).toEqual({ cap: 6_000_000 - 1_450_000, withNonCompete: false });
  });

  it("식대를 비율급 위에 얹던 옛 기록에는 '포함된 금액' 각주를 적지 않는다 — 그때는 실제로 더해 지급했다", () => {
    const old: DocPayroll = { ...pr, breakdown: JSON.stringify({ wageCap: { cap: 5_000_000, withNonCompete: true } }) };
    expect(text(payslipHtml({ employee: emp(), payroll: old, company, bizPayer: payer }))).not.toContain(
      "비율급에 포함된 금액입니다"
    );
    expect(ratioNonTaxInsideOf(old)).toBe(0);
    expect(ratioNonTaxInsideOf(pr)).toBe(200_000);
  });

  it("산정 내역서 — 이 비율급에 식대가 포함되어 있어 명세서에는 나누어 적는다고 밝힌다", () => {
    const base = {
      employee: emp(),
      company,
      year: 2026,
      month: 10,
      students: [{ seq: 1, status: "ENROLLED", name: "가상학생", revenue: 15_000_000 } as any],
      percent: 0.4,
      kind: "WAGE" as const,
      wageCap: 5_000_000,
      bizIncome: rr.bizIncomeP,
      wageCapWithNonCompete: true,
    };
    const withMeal = text(revenueDetailHtml({ ...base, nonTaxInside: ratioNonTaxInsideOf(pr) }));
    expect(withMeal).toContain(
      "이 비율급에는 식대 등 비과세 200,000원이 포함되어 있어, 임금명세서에는 그만큼을 비과세 항목으로 나누어 적습니다."
    );
    expect(text(revenueDetailHtml(base))).not.toContain("식대 등 비과세");
  });

  it("세무 시트 — 총계는 상한 500만 그대로이고, 비고에 그 달 보상금 금액을 적는다", () => {
    const row = buildExportRow(
      {
        ...(rr as any),
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
      },
      "11월 07일"
    );
    expect(row.grossTotal).toBe(5_000_000);
    expect(row.basePay).toBe(5_000_000);
    expect(reconcileRow(row)).toBe(0);
    // 과세 여부는 적지 않고 '얼마가 보상금인지' 만 적는다 — 처리는 세무대리인의 몫
    expect(row.note).toBe("4대보험(근로소득) · 상한 초과분 별도 시트 · 경업금지 보상금 450,000원 포함");
    // 보상금이 없는 달은 비고가 예전 그대로다
    expect(buildExportRow(exportRec(), "11월 07일").note).toBe("4대보험(근로소득) · 상한 초과분 별도 시트");
  });

  it("퇴직급여 산정기준 — 식대를 넣든 빼든 비율급을 두 번 세지 않는다", () => {
    const items = { ...(rr as any), extraHours: 0, overtimeHours: 0, nightHours: 0, holidayHours: 0, holidayOverHours: 0 };
    const b = severanceBase(items);
    // 이 회사가 주는 임금 = 비율급 근로분 435만 + 식대 20만 + 보상금 45만 = 500만
    expect(b.base).toBe(5_000_000);
    expect(b.included).toContainEqual(["기본급", 4_350_000]);
    expect(b.included).toContainEqual(["식대", 200_000]);
    expect(b.excluded.some(([label, amt]) => label.includes("별도 사업장") && amt === 1_450_000)).toBe(true);
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

describe("명세서 — 통상시급 각주는 근로계약서 제4조 ③ 과 같은 식을 금액 그대로 적는다(보상금은 식에 없다 — v1.59.2)", () => {
  /** 급여 산정(payroll-service)이 남기는 근거 그대로 — `ratioPay.hourlyBase`·`hourlyHours` 가 통상시급의 분자·분모 */
  const record = (e: Partial<EmployeePayInput>, revenue: number): DocPayroll => {
    const rr = computePayroll({ ...payInput, schedule: teacher, ...e }, { classRevenue: revenue }, DEFAULT_RATES_2025, []);
    return {
      ...payroll,
      ...rr,
      breakdown: JSON.stringify({
        nonCompete: rr.nonCompeteP ? { ratio: e.nonCompeteRatio, revenue } : null,
        wageCap: rr.bizIncomeP > 0 ? { cap: 5_000_000, withNonCompete: rr.nonCompeteP > 0 } : null,
        ratioPay: {
          total: rr.ratioPayTotal,
          hourlyBase: rr.ratioHourlyBasis!.wage,
          hourlyHours: rr.ratioHourlyBasis!.hours,
        },
      }),
    };
  };
  const slip = (p: DocPayroll) => text(payslipHtml({ employee: emp(), payroll: p, company, bizPayer: payer }));
  const full = { mealAllow: 200_000, nonCompeteRatio: 0.03 };

  it("상한이 걸린 달 — (비율급 435만 + 식대 20만 = 455만) ÷ 195.525시간 = 23,271원. 보상금 45만은 식에 없다", () => {
    const p = record(full, 15_000_000);
    const h = slip(p);
    expect(h).toContain(
      "통상시급 23,271원 = (비율급 4,350,000원 + 식대 200,000원 = 4,550,000원) " +
        "÷ 월 소정근로시간 195.525시간(주휴시간 포함)이며(근로계약서 제4조 · 근로기준법 시행령 §6②6), 연장·휴일·야간수당과 연차수당의 기준입니다."
    );
    // 보상금을 통상시급의 식에 넣거나 임금으로 뭉뚱그려 적지 않는다
    expect(h).not.toContain("+ 경업금지 보상금");
    expect(h).not.toContain("이 회사가 지급한 임금");
    expect(h).not.toContain("그 달 임금 ÷ 월 소정근로시간 환산");
    // 보상금은 따로 지급하는 줄로 남고(지급액 계 500만), 그 각주가 통상시급에 넣지 않는다고 밝힌다
    const c = cells(payslipHtml({ employee: emp(), payroll: p, company, bizPayer: payer }));
    expect(c).toContain("비율급(근로소득분) 4,350,000");
    expect(c).toContain("식대(비과세) 200,000");
    expect(c).toContain("경업금지 보상금 450,000");
    expect(c).toContain("지급액 계 5,000,000");
    expect(h).toContain(
      "수강료 입금액 15,000,000원 × 3% = 450,000원. 근로의 대가가 아니므로 통상시급(수당 산정 기준)에 포함하지 않습니다(근로계약서 제4조)."
    );
  });

  it("보상금까지 합쳐 재는 상한을 '근로소득 상한' 이라고 적지 않는다 — 보상금이 근로소득으로 읽힌다", () => {
    const h = slip(record(full, 15_000_000));
    expect(h).not.toContain("근로소득 상한");
    expect(h).toContain(
      "이 달 비율급 6,000,000원과 경업금지 보상금 450,000원의 합계 중 근로계약서 제4조의 상한 5,000,000원을 넘는 1,450,000원은 비율급에서 빼어"
    );
    expect(h).toContain("근로계약서 제4조의 상한은 비율급과 이 보상금을 합친 금액에 걸리고");
    // 보상금이 없는 계약의 상한은 비율급(임금)에만 걸리므로 예전 이름 그대로다
    const plain = slip(record({ mealAllow: 200_000 }, 15_000_000));
    expect(plain).toContain("이 달 비율급 6,000,000원 중 근로소득 상한 5,000,000원을 넘는 1,000,000원은");
  });

  it("상한이 안 걸린 달 — 그 달 이 회사가 준 비율급(식대 포함)이 기준이고, 보상금 30만은 넣지 않는다", () => {
    // 매출 1,000만 — 비율급 400만(식대 20만 포함) · 보상금 30만
    const h = slip(record(full, 10_000_000));
    expect(h).toContain(
      "통상시급 20,458원 = (비율급 3,800,000원 + 식대 200,000원 = 4,000,000원) ÷ 월 소정근로시간 195.525시간(주휴시간 포함)"
    );
    expect(h).toContain("근로의 대가가 아니므로 통상시급(수당 산정 기준)에 포함하지 않습니다");
    expect(h).not.toContain("상한은 비율급과 이 보상금을 합친 금액에 걸리고"); // 상한이 안 걸린 달
  });

  it("줄이 비율급 하나뿐이면 괄호·합계 없이 그 줄만 적는다(같은 금액을 되풀이할 뿐이다)", () => {
    expect(slip(record({ ratioWageCap: null }, 10_000_000))).toContain(
      "통상시급 20,458원 = 비율급 4,000,000원 ÷ 월 소정근로시간 195.525시간(주휴시간 포함)"
    );
    // 보상금만 있고 식대가 없어도 식에는 비율급 한 줄뿐이다
    expect(slip(record({ ratioWageCap: null, nonCompeteRatio: 0.03 }, 10_000_000))).toContain(
      "통상시급 20,458원 = 비율급 4,000,000원 ÷ 월 소정근로시간 195.525시간(주휴시간 포함)"
    );
  });

  it("수당이 붙은 달 — 수당은 455만 기준 통상시급으로 계산되고, 식에는 수당·보상금 줄이 들지 않는다", () => {
    const rr = computePayroll(
      { ...payInput, schedule: teacher, ...full },
      { classRevenue: 15_000_000, extraHours: 10, holidayHours: 4, unusedLeaveDays: 1 },
      DEFAULT_RATES_2025,
      []
    );
    expect(rr.hourlyWage).toBe(23_271);
    expect(rr.extraP).toBe(10 * 23_271);
    expect(rr.holidayP).toBe(Math.round(4 * 23_271 * 1.5));
    expect(rr.unusedLeaveP).toBe(Math.round(23_271 * 7.5)); // 1일 소정 7.5시간
    const p: DocPayroll = {
      ...payroll,
      ...rr,
      breakdown: JSON.stringify({
        nonCompete: { ratio: 0.03, revenue: 15_000_000 },
        wageCap: { cap: 5_000_000, withNonCompete: true },
        ratioPay: { total: rr.ratioPayTotal, hourlyBase: rr.ratioHourlyBasis!.wage, hourlyHours: rr.ratioHourlyBasis!.hours },
      }),
    };
    const html = payslipHtml({ employee: emp(), payroll: p, company, bizPayer: payer });
    expect(cells(html)).toContain(`지급액 계 ${(5_000_000 + rr.extraP + rr.holidayP + rr.unusedLeaveP).toLocaleString()}`);
    expect(text(html)).toContain(
      "통상시급 23,271원 = (비율급 4,350,000원 + 식대 200,000원 = 4,550,000원) ÷ 월 소정근로시간 195.525시간"
    );
  });

  it("경업금지 보상금을 비과세로 산정한 달도 통상시급 식은 같다 — 표의 줄만 「(비과세)」로 바뀐다", () => {
    const p = record(full, 15_000_000);
    const flagged = { ...p, breakdown: JSON.stringify({ ...JSON.parse(p.breakdown!), nonCompeteNonTax: true }) };
    const html = payslipHtml({ employee: emp(), payroll: flagged, company, bizPayer: payer });
    expect(cells(html)).toContain("경업금지 보상금(비과세) 450,000"); // 표의 줄
    expect(text(html)).toContain("통상시급 23,271원 = (비율급 4,350,000원 + 식대 200,000원 = 4,550,000원) ÷");
  });

  it("근로시간표가 비어 209시간으로 환산한 달은 그 시간을 그대로 적는다", () => {
    const rr = computePayroll(
      { ...payInput, schedule: [], ...full },
      { classRevenue: 15_000_000 },
      DEFAULT_RATES_2025,
      []
    );
    expect(rr.ratioHourlyBasis).toEqual({ wage: 4_550_000, hours: 209 });
    const p: DocPayroll = {
      ...payroll,
      ...rr,
      breakdown: JSON.stringify({ ratioPay: { total: rr.ratioPayTotal, hourlyBase: 4_550_000, hourlyHours: 209 } }),
    };
    expect(slip(p)).toContain(
      "통상시급 21,770원 = (비율급 4,350,000원 + 식대 200,000원 = 4,550,000원) ÷ 월 소정근로시간 209시간(주휴시간 포함)"
    );
  });

  it("산정 근거가 없는 옛 기록(v1.59.0 이하)은 예전 문장 그대로 — 숫자를 지어내지 않는다", () => {
    const p = record(full, 15_000_000);
    // 비율급 전체(total)만 남겼고 통상시급의 분자·분모는 없다. 그때는 보상금을 넣어 500만 기준으로 산정했다
    const old = {
      ...p,
      hourlyWage: 25_572,
      breakdown: JSON.stringify({ ratioPay: { total: JSON.parse(p.breakdown!).ratioPay.total } }),
    };
    const h = slip(old);
    expect(h).toContain(
      "통상시급 25,572원은 그 달 임금 ÷ 월 소정근로시간 환산이며(근로기준법 시행령 §6②6), 연장·휴일·야간수당과 연차수당의 기준입니다."
    );
    expect(h).not.toContain("통상시급 25,572원 =");
    expect(ratioHourlyBasisOf(old)).toBeNull();
    expect(ratioHourlyBasisOf({ breakdown: null })).toBeNull();
    expect(ratioHourlyBasisOf({ breakdown: "깨진 값" })).toBeNull();
    expect(ratioHourlyBasisOf({ breakdown: JSON.stringify({ ratioPay: { total: 1, hourlyBase: 0, hourlyHours: 209 } }) })).toBeNull();
    expect(ratioHourlyBasisOf(p)?.wage).toBe(4_550_000);
  });

  it("보상금을 분자에 넣던 때(v1.59.1) 산정한 기록 — 줄의 합이 분자와 안 맞으므로 분자만 적는다(보상금을 식의 항으로 적지 않는다)", () => {
    const p = record(full, 15_000_000);
    const v1591 = {
      ...p,
      hourlyWage: 25_572,
      breakdown: JSON.stringify({
        ...JSON.parse(p.breakdown!),
        ratioPay: { total: 6_000_000, hourlyBase: 5_000_000, hourlyHours: 195.525 },
      }),
    };
    const h = slip(v1591);
    expect(h).toContain("통상시급 25,572원 = 이 달 산정 기준액 5,000,000원 ÷ 월 소정근로시간 195.525시간(주휴시간 포함)");
    expect(h).not.toContain("+ 경업금지 보상금");
    // 기록이 손으로 고쳐져 줄의 합이 분자와 다른 경우도 같다
    const off = slip({ ...p, mealP: 150_000 });
    expect(off).toContain("통상시급 23,271원 = 이 달 산정 기준액 4,550,000원 ÷ 월 소정근로시간 195.525시간");
    expect(off).not.toContain("식대 150,000원 =");
  });
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
