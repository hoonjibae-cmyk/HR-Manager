import { describe, it, expect } from "vitest";
import {
  contractHtml,
  consentDeductionHtml,
  consentPrivacyHtml,
  pledgeServiceHtml,
  stampImg,
  type DocCompany,
  type DocContract,
  type DocEmployee,
} from "./documents";
import { certCareerHtml, certEmploymentHtml } from "./documents-pay";

const STAMP = "data:image/png;base64,iVBORw0KGgo=";

const company = (stamp: string | null = null): DocCompany => ({
  name: "주식회사 유쌤에듀",
  ceo: "유은정",
  bizNo: "418-86-02289",
  phone: "031-794-3306",
  address: "경기도 하남시 미사강변대로 216",
  payday: 7,
  stamp,
});

const employee: DocEmployee = {
  name: "이지우",
  empNo: "E001",
  birth: "1990-01-01",
  address: "서울시 강남구",
  phone: "010-0000-0000",
  department: "교수부",
  position: "선임강사",
  duty: "강의(학급관리)",
  hireDate: new Date(Date.UTC(2020, 8, 1)),
  resignDate: null,
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseWage: 3_000_000,
  positionAllow: 0,
  mealAllow: 200_000,
  carAllow: 0,
  schedule: [],
} as any;

const contract: DocContract = {
  stage: "SHORT_TERM_1",
  templateKey: "MONTHLY",
  startDate: new Date(Date.UTC(2020, 8, 1)),
  endDate: null,
  isProbation: true,
  probationMonths: 2,
} as any;

/** `(인)`·`(직인)` 처럼 손도장을 찍을 자리로 남는 글자 */
const sealMarks = (html: string) => (html.match(/class="seal"/g) ?? []).length;
const stamps = (html: string) => (html.match(/class="stamp-anchor"/g) ?? []).length;

describe("stampImg", () => {
  it("인감이 없으면 아무것도 내보내지 않는다", () => {
    expect(stampImg(company())).toBe("");
  });
  it("인감이 있으면 자리를 차지하지 않는 앵커로 감싸 내보낸다", () => {
    const html = stampImg(company(STAMP));
    expect(html).toContain("stamp-anchor");
    expect(html).toContain(`src="${STAMP}"`);
  });
});

describe("계약서 — '갑'(회사) 자리에만 찍는다", () => {
  it("인감이 없으면 예전처럼 (인) 글자만 남는다", () => {
    const html = contractHtml({ employee, company: company(), contract });
    expect(stamps(html)).toBe(0);
    expect(html).toContain("(인)");
  });

  it("인감이 있으면 '갑' 대표자에 도장이 찍힌다", () => {
    const html = contractHtml({ employee, company: company(STAMP), contract });
    expect(stamps(html)).toBe(1);
  });

  it("'을'(직원) 성명 옆은 여전히 (인) — 본인이 직접 날인할 자리다", () => {
    const withStamp = contractHtml({ employee, company: company(STAMP), contract });
    const without = contractHtml({ employee, company: company(), contract });
    // 회사 몫 한 자리만 도장으로 바뀌고 나머지 (인) 은 그대로다
    expect(sealMarks(withStamp)).toBe(sealMarks(without) - 1);
    expect(withStamp).toContain(employee.name);
    expect(withStamp).toMatch(/이지우<\/b> <span class="seal">\(인\)<\/span>/);
  });
});

describe("증명서 — 대표이사 옆 (직인) 자리", () => {
  it("재직증명서", () => {
    expect(certEmploymentHtml({ employee, company: company() })).toContain("(직인)");
    const html = certEmploymentHtml({ employee, company: company(STAMP) });
    expect(stamps(html)).toBe(1);
    expect(html).not.toContain("(직인)");
  });

  it("경력증명서", () => {
    expect(certCareerHtml({ employee, company: company() })).toContain("(직인)");
    expect(stamps(certCareerHtml({ employee, company: company(STAMP) }))).toBe(1);
  });
});

describe("서약서·동의서에는 회사 도장을 찍지 않는다 — 직원이 회사에 내는 문서다", () => {
  for (const [name, fn] of [
    ["복무서약서", pledgeServiceHtml],
    ["개인정보 동의서", consentPrivacyHtml],
    ["임금공제 동의서", consentDeductionHtml],
  ] as const) {
    it(name, () => {
      const html = fn({ employee, company: company(STAMP) });
      expect(stamps(html)).toBe(0);
    });
  }
});
