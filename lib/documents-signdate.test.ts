// 계약서 서명란 위 **작성일자** — min(발급일, 계약 시작일).
//
// 미래 시작 계약(내년 1/1 발효)을 미리 뽑으면 실제로 서명하는 날(발급일)이 찍혀야 하고,
// 이미 시작된 계약을 재발급하면 원래 계약일이 그대로 찍혀야 한다(서명본 원본과 날짜가
// 달라지면 다른 계약서처럼 보인다). 제1조 계약기간·별지 제2조 약정기간의 시작일 표기는 불변.

import { describe, it, expect } from "vitest";
import {
  contractSignDate,
  contractHtml,
  incentiveContractHtml,
  type DocCompany,
  type DocContract,
  type DocEmployee,
} from "./documents";

const company: DocCompany = {
  name: "주식회사 유쌤에듀",
  ceo: "유은정",
  bizNo: "418-86-02289",
  phone: "031-794-3306",
  address: "경기도 하남시 미사강변대로 216",
  payday: 7,
  stamp: null,
};

const emp = (over: Partial<DocEmployee> = {}) =>
  ({
    name: "김서준",
    department: "교수부",
    position: "강사",
    hireDate: new Date(Date.UTC(2024, 2, 1)),
    incomeType: "EMPLOYEE",
    payScheme: "MONTHLY",
    baseWage: 3_400_000,
    positionAllow: 0,
    mealAllow: 200_000,
    carAllow: 0,
    schedule: "[]",
    ...over,
  }) as DocEmployee;

const ct = (over: Partial<DocContract> = {}): DocContract =>
  ({
    stage: "NEW",
    templateKey: "MONTHLY",
    startDate: new Date(Date.UTC(2027, 0, 1)), // 미래 시작
    endDate: null,
    isProbation: false,
    probationMonths: 2,
    baseWage: 3_400_000,
    positionAllow: 0,
    mealAllow: 200_000,
    carAllow: 0,
    ...over,
  }) as DocContract;

const PRINTED = new Date(Date.UTC(2026, 8, 15)); // 발급일 2026-09-15

const dateCenter = (html: string): string => {
  const m = html.match(/<div class="date-center">([^<]*)<\/div>/);
  return m ? m[1] : "";
};

describe("contractSignDate — min(발급일, 시작일)", () => {
  const start = new Date(Date.UTC(2027, 0, 1));

  it("발급일이 시작일보다 앞이면(미래 계약 선발급) 발급일", () => {
    expect(contractSignDate(start, PRINTED)).toEqual(PRINTED);
  });

  it("발급일이 시작일보다 뒤면(재발급) 계약 시작일", () => {
    const late = new Date(Date.UTC(2027, 5, 10));
    expect(contractSignDate(start, late)).toEqual(start);
  });

  it("같은 날이면 그대로", () => {
    expect(contractSignDate(start, start)).toEqual(start);
  });
});

describe("근로계약서 작성일자", () => {
  it("미래 시작 계약을 지금 뽑으면 작성일자는 발급일 — 제1조 시작일은 그대로", () => {
    const html = contractHtml({ employee: emp(), contract: ct(), company, printedAt: PRINTED });
    expect(dateCenter(html)).toBe("2026년 9월 15일");
    expect(html).toContain("<b>2027년 1월 1일</b> 부터"); // 제1조 계약기간
  });

  it("이미 시작된 계약을 재발급하면 작성일자는 계약 시작일", () => {
    const html = contractHtml({
      employee: emp(),
      contract: ct({ startDate: new Date(Date.UTC(2026, 2, 1)) }),
      company,
      printedAt: PRINTED,
    });
    expect(dateCenter(html)).toBe("2026년 3월 1일");
  });

  it("printedAt 을 안 넘기면 오늘 기준으로 동작한다 (미래 계약이 시작일로 찍히지 않는다)", () => {
    const html = contractHtml({
      employee: emp(),
      contract: ct({ startDate: new Date(Date.UTC(2100, 0, 1)) }),
      company,
    });
    expect(dateCenter(html)).not.toBe("2100년 1월 1일");
  });
});

describe("강의위탁계약서(비율제) 작성일자", () => {
  const ratioEmp = emp({ payScheme: "RATIO" });
  const ratioCt = (over: Partial<DocContract> = {}) =>
    ct({ templateKey: "RATIO", ratioPercent: 0.5, ...over });

  it("미래 시작 → 발급일 / 재발급 → 계약 시작일", () => {
    const future = contractHtml({
      employee: ratioEmp,
      contract: ratioCt(),
      company,
      printedAt: PRINTED,
    });
    expect(dateCenter(future)).toBe("2026년 9월 15일");
    expect(future).toContain("<b>2027년 1월 1일</b> 부터"); // 제1조 위탁계약기간

    const reissue = contractHtml({
      employee: ratioEmp,
      contract: ratioCt({ startDate: new Date(Date.UTC(2026, 2, 1)) }),
      company,
      printedAt: PRINTED,
    });
    expect(dateCenter(reissue)).toBe("2026년 3월 1일");
  });
});

describe("별지 인센티브 산정 계약서 작성일자", () => {
  const incEmp = emp({ payScheme: "INCENTIVE" });
  const incCt = (over: Partial<DocContract> = {}) =>
    ct({ templateKey: "INCENTIVE", incThreshold: 600, incPerStudent: 20_000, ...over });

  it("미래 시작 → 발급일이 찍히고, 제2조 약정 기간의 시작일은 그대로", () => {
    const html = incentiveContractHtml({
      employee: incEmp,
      contract: incCt(),
      company,
      printedAt: PRINTED,
    });
    expect(dateCenter(html)).toBe("2026년 9월 15일");
    expect(html).toContain("<b>2027년 1월 1일</b> 부터 신규 계약 체결일"); // 제2조
  });

  it("재발급 → 계약 시작일", () => {
    const html = incentiveContractHtml({
      employee: incEmp,
      contract: incCt({ startDate: new Date(Date.UTC(2026, 2, 1)) }),
      company,
      printedAt: PRINTED,
    });
    expect(dateCenter(html)).toBe("2026년 3월 1일");
  });
});
