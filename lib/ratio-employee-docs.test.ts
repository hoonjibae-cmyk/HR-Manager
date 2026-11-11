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
import { payslipHtml, bizIncomeSlipHtml, revenueDetailHtml, type DocPayroll } from "./documents-pay";
import { computePayroll, DEFAULT_RATES_2025, type EmployeePayInput } from "./payroll";
import { buildExportRow, buildBizExportRow, reconcileRow, buildPayrollExportWorkbook, type ExportPayrollRecord } from "./payroll-export";
import { buildTransferRows, type TransferPayrollRecord } from "./bank-transfer";
import { severanceBase } from "./severance";
import { DEFAULT_BIZ_PAYER_SERVICE, type BizPayer } from "./ratio-employee";

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

  it("제4조에 비율급과 별도 지급을 적고, 상한과 관계없이 갑이 준다고 적는다", () => {
    const h = html({ nonCompeteRatio: 0.03 });
    expect(h).toContain(
      "제①항의 임금과 별도로, 제8조에 따른 경업금지 의무의 대가로 매월 제①항의 수강료 입금액에 3%를 곱한 금액을 경업금지 보상금으로 지급한다."
    );
    // 상한 조항이 ④(정액 수당 없음) — 그 번호를 가리킨다
    expect(h).toContain("경업금지 보상금은 제④항의 상한과 관계없이 \"갑\"이 지급하며, 4대보험료와 근로소득세 공제 대상에 포함한다.");
    // 정액 수당이 끼면 상한 조항이 ⑤ 로 밀리고, 가리키는 번호도 함께 밀린다
    expect(html({ nonCompeteRatio: 0.03, mealAllow: 200_000 })).toContain("제⑤항의 상한과 관계없이");
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

  it("상한이 없으면 '상한과 관계없이' 문구가 없다", () => {
    const h = html({ nonCompeteRatio: 0.025, ratioWageCap: null });
    expect(h).toContain("수강료 입금액에 2.5%를 곱한 금액을 경업금지 보상금으로 지급한다.");
    expect(h).not.toContain("상한과 관계없이");
  });

  it("보상금 비율이 없으면 경업금지 조항이 없다 — 기타사항은 제8조", () => {
    const h = html();
    expect(h).not.toContain("경업금지");
    expect(h).toContain("제 8조 (기타사항)");
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

  it("경업금지 보상금(비율) 각주 — 근로계약서 제8조 · 근로소득 · 상한과 무관", () => {
    const rr = computePayroll({ ...payInput, nonCompeteRatio: 0.03 }, { classRevenue: 15_000_000 }, DEFAULT_RATES_2025, []);
    const h = text(
      payslipHtml({
        employee: emp(),
        payroll: {
          ...payroll,
          ...rr,
          breakdown: JSON.stringify({ nonCompete: { ratio: 0.03, revenue: 15_000_000 } }),
        },
        company,
        bizPayer: payer,
      })
    );
    expect(h).toContain("근로계약서 제8조의 경업금지 의무에 대한 대가로 비율급과 별도로 지급");
    expect(h).toContain("수강료 입금액 15,000,000원 × 3% = 450,000원");
    expect(h).toContain("근로소득 상한과 관계없이 이 회사가 지급");
    expect(h).not.toContain("강의위탁계약서");
    // 임금명세서의 지급액 계 = 근로분 비율급 500만 + 보상금 45만(별도 사업장 몫 100만은 빠진다)
    expect(cells(payslipHtml({ employee: emp(), payroll: { ...payroll, ...rr }, company, bizPayer: payer }))).toContain(
      "지급액 계 5,450,000"
    );
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
