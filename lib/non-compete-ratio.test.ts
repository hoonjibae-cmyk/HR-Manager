// 위탁계약(강의위탁계약서 · 완전비율제)의 경업금지 보상금 — 매출 × 보상금 비율
//
// 못박는 것:
//  ① 보상금은 같은 매출에 비율을 곱해 용역수수료와 **별도로** 더한다(수수료 40% + 보상금 3% = 매출의 43%).
//     최저보장은 수수료에만 걸리고, 사업소득 3.3% 원천징수는 보상금에도 함께 걸린다.
//  ② 위탁계약서는 비율이 있을 때만 제5조·제7조에 보상금 조항이 붙는다. 없으면 원문 그대로다.
//  ③ 입력 검사(0~100% 미만, 위탁 비율과 합쳐 100% 이하)는 화면과 서버가 같은 함수를 쓴다.

import { describe, it, expect } from "vitest";
import {
  computePayroll,
  blendWageTerms,
  DEFAULT_RATES_2025,
  type EmployeePayInput,
} from "./payroll";
import {
  nonCompeteRatioApplies,
  nonCompeteRatioRequired,
  nonCompeteRatioError,
  normalizeNonCompeteRatio,
  resolveNonCompeteRatio,
  nonCompeteRatioPreview,
  ratioPctLabel,
  NON_COMPETE_RATIO_REQUIRED_MESSAGE,
} from "./non-compete";
import { contractHtml, type DocCompany, type DocContract, type DocEmployee } from "./documents";
import { payslipHtml, type DocPayroll } from "./documents-pay";

/** 위탁 강사 — 수수료 40% */
const tutor: EmployeePayInput = {
  incomeType: "FREELANCE",
  payScheme: "RATIO",
  isContractor: true,
  baseWage: 0,
  positionAllow: 0,
  mealAllow: 0,
  carAllow: 0,
  dependents: 1,
  schedule: [],
  ratioPercent: 0.4,
};
const R = DEFAULT_RATES_2025;

describe("급여 엔진 — 매출 × 보상금 비율을 수수료와 별도로 더한다", () => {
  const r = computePayroll({ ...tutor, nonCompeteRatio: 0.03 }, { classRevenue: 10_000_000 }, R, []);

  it("수수료 40% + 보상금 3% = 매출의 43%", () => {
    expect(r.baseP).toBe(4_000_000);
    expect(r.nonCompeteP).toBe(300_000);
    expect(r.gross).toBe(4_300_000);
  });

  it("사업소득 3.3% 는 보상금까지 합친 지급액에 걸린다", () => {
    expect(r.incomeTaxD).toBe(129_000);
    expect(r.localTaxD).toBe(12_900);
    expect(r.net).toBe(4_300_000 - 141_900);
  });

  it("산출 근거에 매출 × 비율이 남는다", () => {
    expect(r.notes.some((n) => n.includes("경업금지 보상금: 매출 10,000,000원 × 3.0% = 300,000원"))).toBe(true);
  });

  it("비율이 없으면 예전 결과 그대로 (null · 0 · 생략)", () => {
    const base = computePayroll(tutor, { classRevenue: 10_000_000 }, R, []);
    expect(base.nonCompeteP).toBe(0);
    expect(base.gross).toBe(4_000_000);
    for (const v of [null, undefined, 0]) {
      expect(computePayroll({ ...tutor, nonCompeteRatio: v }, { classRevenue: 10_000_000 }, R, [])).toEqual(base);
    }
  });

  it("최저보장은 수수료에만 걸린다 — 보상금은 언제나 매출 × 비율", () => {
    const g = computePayroll(
      { ...tutor, ratioMinGuarantee: 2_500_000, nonCompeteRatio: 0.03 },
      { classRevenue: 5_000_000 },
      R,
      []
    );
    expect(g.baseP).toBe(2_500_000);
    expect(g.nonCompeteP).toBe(150_000);
    expect(g.gross).toBe(2_650_000);
  });

  it("매출이 없으면 보상금도 0", () => {
    expect(computePayroll({ ...tutor, nonCompeteRatio: 0.03 }, {}, R, []).nonCompeteP).toBe(0);
  });

  it("근로계약(월급제)에는 비율이 남아 있어도 싣지 않는다", () => {
    const m = computePayroll(
      {
        ...tutor,
        incomeType: "EMPLOYEE",
        payScheme: "MONTHLY",
        isContractor: false,
        baseWage: 3_000_000,
        ratioPercent: null,
        nonCompeteRatio: 0.03,
      },
      { classRevenue: 10_000_000 },
      R,
      []
    );
    expect(m.nonCompeteP).toBe(0);
    expect(m.gross).toBe(3_000_000);
  });
});

describe("blendWageTerms — 월중 갱신으로 보상금 비율이 생긴 달", () => {
  const seg = (days: number, ncr?: number | null) => ({
    days,
    baseWage: 0,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    ratioPercent: 0.4,
    nonCompeteRatio: ncr,
  });
  it("위탁 비율처럼 역일수로 가중한다", () => {
    expect(blendWageTerms([seg(15, null), seg(15, 0.03)])!.nonCompeteRatio).toBeCloseTo(0.015, 10);
  });
  it("어느 구간에도 없으면 null", () => {
    expect(blendWageTerms([seg(15), seg(16)])!.nonCompeteRatio).toBeNull();
  });
});

describe("판정·검사 — 화면과 서버가 같은 함수", () => {
  it("강의위탁계약서(완전비율제)만 대상이고 새 계약마다 필수", () => {
    expect(nonCompeteRatioApplies({ payScheme: "RATIO" })).toBe(true);
    expect(nonCompeteRatioApplies({ payScheme: "MONTHLY" })).toBe(false);
    expect(nonCompeteRatioApplies({ payScheme: "HOURLY" })).toBe(false);
    expect(nonCompeteRatioRequired({ payScheme: "RATIO" })).toBe(true);
    expect(nonCompeteRatioRequired({ payScheme: "INCENTIVE" })).toBe(false);
  });

  it("0% 이상 100% 미만 — 빈칸·0 은 '보상금 없음' 이라 오류가 아니다", () => {
    expect(nonCompeteRatioError(null, 0.4)).toBeNull();
    expect(nonCompeteRatioError("", 0.4)).toBeNull();
    expect(nonCompeteRatioError(0, 0.4)).toBeNull();
    expect(nonCompeteRatioError(0.03, 0.4)).toBeNull();
    expect(nonCompeteRatioError(-0.01, 0.4)).toContain("0% 이상 100% 미만");
    expect(nonCompeteRatioError(1, 0)).toContain("0% 이상 100% 미만");
    expect(nonCompeteRatioError(3, 0.4)).toContain("0% 이상 100% 미만"); // 3 을 % 로 착각해 그대로 보낸 경우
    expect(nonCompeteRatioError("abc", 0.4)).toContain("0% 이상 100% 미만");
  });

  it("위탁 비율과 합쳐 매출의 100% 를 넘으면 거른다", () => {
    expect(nonCompeteRatioError(0.6, 0.4)).toBeNull();
    expect(nonCompeteRatioError(0.61, 0.4)).toContain("100%를 넘습니다");
  });

  it("저장값 다듬기 — 0.01% 단위, 빈칸·0 은 null, 대상이 아니면 지운다", () => {
    expect(normalizeNonCompeteRatio(0.0312345, true)).toBe(0.0312);
    expect(normalizeNonCompeteRatio(0, true)).toBeNull();
    expect(normalizeNonCompeteRatio("", true)).toBeNull();
    expect(normalizeNonCompeteRatio(0.03, false)).toBeNull();
  });

  it("resolve — 요청에 없으면 카드 값, 위탁이 아니면 지운다, 넘치면 오류", () => {
    const base = { payScheme: "RATIO", ratioPercent: 0.4 };
    expect(resolveNonCompeteRatio({ ...base, raw: undefined, fallback: 0.03 })).toEqual({ value: 0.03, error: null });
    expect(resolveNonCompeteRatio({ ...base, raw: null, fallback: 0.03 })).toEqual({ value: null, error: null });
    expect(resolveNonCompeteRatio({ ...base, raw: 0.05, fallback: 0.03 })).toEqual({ value: 0.05, error: null });
    expect(resolveNonCompeteRatio({ ...base, payScheme: "MONTHLY", raw: 0.03, fallback: null })).toEqual({
      value: null,
      error: null,
    });
    expect(resolveNonCompeteRatio({ ...base, raw: 0.7, fallback: null }).error).toContain("100%");
  });

  it("표기 · 미리보기", () => {
    expect(ratioPctLabel(0.03)).toBe("3%");
    expect(ratioPctLabel(0.025)).toBe("2.5%");
    expect(ratioPctLabel(0.4)).toBe("40%");
    expect(ratioPctLabel(0.1234)).toBe("12.34%");
    const p = nonCompeteRatioPreview(0.4, 0.03);
    expect([p.revenue, p.fee, p.comp, p.total]).toEqual([10_000_000, 4_000_000, 300_000, 4_300_000]);
    expect(p.totalRatio).toBeCloseTo(0.43, 10); // 0.4 + 0.03 = 0.43000000000000005
    expect(ratioPctLabel(p.totalRatio)).toBe("43%"); // 표기에서는 잔차가 사라진다
    expect(NON_COMPETE_RATIO_REQUIRED_MESSAGE).toContain("보상금을 두지 않음");
  });
});

/* ───────────────────────── 위탁계약서 ───────────────────────── */

const company: DocCompany = {
  name: "주식회사 테스트학원",
  ceo: "홍길동",
  bizNo: "000-00-00000",
  phone: "02-000-0000",
  address: "서울특별시 어딘가 1",
  payday: 7,
  stamp: null,
};
const emp = {
  name: "가상위탁강사",
  department: "교수부",
  position: "강사",
  duty: "강의",
  hireDate: new Date(Date.UTC(2026, 0, 2)),
  resignDate: null,
  incomeType: "FREELANCE",
  payScheme: "RATIO",
  baseWage: 0,
  positionAllow: 0,
  mealAllow: 0,
  carAllow: 0,
  schedule: "[]",
} as unknown as DocEmployee;
const ct = (over: Partial<DocContract> = {}): DocContract =>
  ({
    stage: "RENEWAL_1",
    templateKey: "RATIO",
    startDate: new Date(Date.UTC(2026, 11, 1)),
    endDate: new Date(Date.UTC(2027, 10, 30)),
    isProbation: false,
    probationMonths: 2,
    baseWage: 0,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    ratioPercent: 0.4,
    isContractor: true,
    ...over,
  }) as DocContract;
const printedAt = new Date(Date.UTC(2026, 10, 5));
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

describe("강의위탁계약서 — 보상금 비율이 있으면 제5조·제7조에 덧붙인다", () => {
  const t = text(contractHtml({ employee: emp, contract: ct({ nonCompeteRatio: 0.03 }), company, printedAt }));

  it("제5조 — 수수료와 별도로 매출의 3%를 보상금으로, 지급·3.3% 공제·'외 금품' 문구가 보상금도 가리킨다", () => {
    expect(t).toContain("② \"을\"의 수수료는 수강료 입금액에서 (월) 40%를 적용한다.");
    expect(t).toContain(
      "③ \"갑\"은 제②항의 수수료와 별도로, 제7조 제②항·제③항에 따른 경업금지 의무의 대가로 수강료 입금액의 (월) 3%를 「경업금지 보상금」으로 \"을\"에게 지급한다."
    );
    expect(t).toContain("④ \"갑\"은 매월 01일부터 말일까지의 용역위탁수수료 및 경업금지 보상금을 다음 달 7일에 사업소득세(3.0%)와 주민세(0.3%)를 공제한 후");
    expect(t).toContain("본 계약에 따른 용역위탁수수료 및 경업금지 보상금 외 수당, 퇴직금 등을");
  });

  it("제7조 — 원문 ①~④ 는 그대로, ⑤ 전액 반환 ⑥ 위약금과 별개·법적 조치 ⑦ 동의", () => {
    expect(t).toContain("계약 종료 직후 6개월 간 하남시 미사지구에서");
    expect(t).toContain("위약금과 위약벌로 \"갑\"에게 3,000만원을 지급하여야 한다.");
    expect(t).toContain("⑤ \"을\"이 제②항 또는 제③항을 위반한 경우 \"을\"은 그때까지 지급받은 경업금지 보상금 전액을");
    expect(t).toContain("서면 청구일로부터 30일 이내");
    expect(t).toContain("제④항의 위약금·위약벌과 별개이며");
    expect(t).toContain("위반행위의 금지 청구(가처분 포함)");
    expect(t).toContain("⑦ \"을\"은 본 조의 경업금지 범위와 경업금지 보상금의 비율 및 반환 의무에 관하여 충분히 설명을 듣고 이해하였으며, 이에 동의한다.");
    const art7 = t.slice(t.indexOf("제 7조"), t.indexOf("제 8조"));
    expect(art7).toContain("동 의 자 :");
  });

  it("조항 번호는 그대로다 — 기타사항은 여전히 제8조", () => {
    expect(t).toContain("제 8조 (기타사항)");
    expect(t).not.toContain("제 9조");
  });
});

describe("강의위탁계약서 — 비율이 없으면 원문 그대로", () => {
  const plain = contractHtml({ employee: emp, contract: ct(), company, printedAt });

  it("보상금 문구가 없고 원문 제5조 ③④ 가 그대로", () => {
    expect(plain).not.toContain("경업금지 보상금");
    const t = text(plain);
    expect(t).toContain("③ \"갑\"은 매월 01일부터 말일까지의 용역위탁수수료를 다음 달 7일에 사업소득세(3.0%)와 주민세(0.3%)를 공제한 후 \"을\"에게 지급한다.");
    expect(t).toContain("④ \"을\"은 독립된 자격으로 강의용역을 제공하는 것이므로 본 계약에 따른 용역위탁수수료 외 수당, 퇴직금 등을");
  });

  it("서명란의 갑은 '위탁자'(v1.58.1) — 위탁계약에 '사용자' 는 근로관계의 말이다", () => {
    expect(plain).toContain('"갑" (위탁자)');
    expect(plain).toContain('"을" (수탁자)');
    expect(plain).not.toContain("(사용자)");
  });

  it("null · 0 · 생략이 모두 같은 문서", () => {
    for (const v of [null, 0, undefined]) {
      expect(contractHtml({ employee: emp, contract: ct({ nonCompeteRatio: v }), company, printedAt })).toBe(plain);
    }
  });

  it("근로계약서에는 비율이 남아 있어도 넣지 않는다", () => {
    const monthly = contractHtml({
      employee: { ...emp, incomeType: "EMPLOYEE", payScheme: "MONTHLY", baseWage: 3_000_000 } as DocEmployee,
      contract: ct({ templateKey: "MONTHLY", isContractor: false, baseWage: 3_000_000, ratioPercent: null, nonCompeteRatio: 0.03 }),
      company,
      printedAt,
    });
    expect(monthly).not.toContain("경업금지 보상금");
    // 근로계약서의 갑은 그대로 '사용자'
    expect(monthly).toContain('"갑" (사용자)');
  });
});

/* ───────────────────────── 사업소득 지급명세서 ───────────────────────── */

const payroll: DocPayroll = {
  year: 2026,
  month: 12,
  incomeType: "FREELANCE",
  payScheme: "RATIO",
  baseP: 4_000_000,
  extraP: 0,
  overtimeP: 0,
  nightP: 0,
  holidayP: 0,
  weeklyHolidayP: 0,
  positionP: 0,
  mealP: 0,
  carP: 0,
  nonCompeteP: 300_000,
  incentiveP: 0,
  bonusP: 0,
  unusedLeaveP: 0,
  gross: 4_300_000,
  pensionD: 0,
  employmentD: 0,
  healthD: 0,
  longTermD: 0,
  incomeTaxD: 129_000,
  localTaxD: 12_900,
  retentionD: 0,
  parkingD: 0,
  expenseD: 0,
  otherD: 0,
  totalDeduct: 141_900,
  net: 4_158_100,
  hourlyWage: 0,
  breakdown: JSON.stringify({ notes: [], nonCompete: { ratio: 0.03, revenue: 10_000_000 } }),
};

describe("사업소득 지급명세서 — 위탁 보상금 각주", () => {
  it("근거 조항·매출 × 비율·3.3%·반환 의무를 적는다", () => {
    const t = text(payslipHtml({ employee: emp, payroll, company }));
    expect(t).toContain("사업소득 지급명세서");
    expect(t).toContain("강의위탁계약서 제5조·제7조에 따라 경업금지 의무의 대가로 용역수수료와 별도로 지급하는 금액입니다");
    expect(t).toContain("수강료 입금액 10,000,000원 × 3% = 300,000원");
    expect(t).toContain("사업소득세(3.3%)를 원천징수");
    expect(t).toContain("지급받은 보상금 전액을 반환");
    expect(t).not.toContain("근로계약서 제8조");
  });

  it("산출 근거가 없는 옛 기록이면 식만 빼고 적는다", () => {
    const t = text(payslipHtml({ employee: emp, payroll: { ...payroll, breakdown: null }, company }));
    expect(t).toContain("용역수수료와 별도로 지급하는 금액입니다. 수수료와 함께");
    expect(t).not.toContain("× 3%");
  });
});
