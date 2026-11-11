// 경업금지 조항 · 경업금지 보상금 — 교수부 근로계약서(월급제 · 월급+인센티브)
//
// 못박는 것:
//  ① 보상금은 월 지급 총액 **안에서** 떼는 몫이다 — 지급계·과세표준·공제·통상시급은 그대로, 기본급만 준다.
//  ② 계약서에는 보상금이 있을 때만 제8조가 들어가고 기타사항이 제9조로 밀린다. 없으면 예전과 한 글자도 다르지 않다.
//  ③ 명세서·퇴직급여·대시보드 추이가 같은 돈을 같은 자리에 센다.
//  ④ 교수부 필수 판정·입력 검사는 화면과 서버가 같은 함수를 쓴다.

import { describe, it, expect } from "vitest";
import {
  computePayroll,
  inclusiveWageBreakdown,
  blendWageTerms,
  DEFAULT_RATES_2025,
  type EmployeePayInput,
  type TaxBracketRow,
} from "./payroll";
import type { ScheduleDay } from "./constants";
import {
  NON_COMPETE_MONTHS,
  NON_COMPETE_RADIUS_KM,
  NON_COMPETE_REQUIRED_MESSAGE,
  nonCompetePayApplies,
  nonCompeteRequired,
  normalizeNonCompetePay,
  nonCompetePayError,
  nonCompetePreview,
  resolveNonCompetePay,
} from "./non-compete";
import {
  contractHtml,
  pledgeSecurityHtml,
  type DocCompany,
  type DocContract,
  type DocEmployee,
} from "./documents";
import { payslipHtml, type DocPayroll } from "./documents-pay";
import { severanceBase, type SeverancePayItems } from "./severance";
import { contractBaseOf, grossOf, overtimeOf, type TrendRecord } from "./payroll-trend";

// 학원 강사 스케줄 (주 5일 15:00~22:00, 휴게 0.5)
const instructor: ScheduleDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day, i) => ({
  day: day as ScheduleDay["day"],
  work: i < 5,
  start: i < 5 ? "15:00" : "00:00",
  end: i < 5 ? "22:00" : "00:00",
  breakH: i < 5 ? 0.5 : 0,
}));

const taxTable: TaxBracketRow[] = [
  { lo: 0, hi: 2000, tax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { lo: 2000, hi: 3000, tax: [19520, 15330, 8930, 7440, 5960, 4480, 2760, 1130, 0, 0, 0] },
  { lo: 3000, hi: 4000, tax: [84850, 74350, 52250, 46630, 41010, 35390, 29770, 24150, 18530, 12910, 8290] },
  { lo: 4000, hi: null, tax: [200000, 180000, 160000, 140000, 120000, 100000, 90000, 80000, 70000, 60000, 50000] },
];

/** 교수부 월급제 — 총액 350만(식대 20만 포함), 기본급 산정 209시간 */
const prof: EmployeePayInput = {
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseWage: 3_500_000,
  positionAllow: 0,
  mealAllow: 200_000,
  carAllow: 0,
  dependents: 1,
  schedule: instructor,
  fixedBaseHours: 209,
};

describe("급여 엔진 — 보상금은 총액 안에서 떼는 몫", () => {
  const without = computePayroll(prof, {}, DEFAULT_RATES_2025, taxTable);
  const withNc = computePayroll({ ...prof, nonCompetePay: 300_000 }, {}, DEFAULT_RATES_2025, taxTable);

  it("기본급이 보상금만큼 줄고 보상금이 따로 실린다 — 지급계는 그대로", () => {
    expect(without.baseP).toBe(3_300_000);
    expect(withNc.baseP).toBe(3_000_000);
    expect(withNc.nonCompeteP).toBe(300_000);
    expect(withNc.mealP).toBe(200_000);
    expect(withNc.gross).toBe(3_500_000);
    expect(withNc.gross).toBe(without.gross);
  });

  it("통상시급·과세표준·공제·실수령은 보상금이 없을 때와 같다 (과세, 통상시급 총액 기준)", () => {
    expect(withNc.hourlyWage).toBe(without.hourlyWage);
    expect(withNc.hourlyWage).toBe(Math.round(3_500_000 / 209));
    expect(withNc.taxableGross).toBe(without.taxableGross);
    expect(withNc.totalDeduct).toBe(without.totalDeduct);
    expect(withNc.net).toBe(without.net);
  });

  it("보상금이 없는 계약은 nonCompeteP 0 — 예전 결과와 같다", () => {
    expect(without.nonCompeteP).toBe(0);
    for (const v of [null, undefined, 0]) {
      const r = computePayroll({ ...prof, nonCompetePay: v }, {}, DEFAULT_RATES_2025, taxTable);
      expect(r).toEqual(without);
    }
  });

  it("연장수당·연차수당은 줄지 않는다 — 통상시급이 그대로라서", () => {
    const m = { overtimeHours: 10, unusedLeaveDays: 2 };
    const a = computePayroll(prof, m, DEFAULT_RATES_2025, taxTable);
    const b = computePayroll({ ...prof, nonCompetePay: 300_000 }, m, DEFAULT_RATES_2025, taxTable);
    expect(b.overtimeP).toBe(a.overtimeP);
    expect(b.unusedLeaveP).toBe(a.unusedLeaveP);
    expect(b.gross).toBe(a.gross);
  });

  it("포괄임금 약정 시간외·야간은 그대로, 잔액인 기본급에서만 뗀다", () => {
    const incl = { ...prof, baseWage: 5_000_000, mealAllow: 0, fixedOtHours: 21.725, fixedNightHours: 10.8625 };
    const a = computePayroll(incl, {}, DEFAULT_RATES_2025, taxTable);
    const b = computePayroll({ ...incl, nonCompetePay: 500_000 }, {}, DEFAULT_RATES_2025, taxTable);
    expect(a.baseP).toBe(4_230_448); // 김지연 계약서 제4조
    expect(b.baseP).toBe(3_730_448);
    expect(b.overtimeP).toBe(a.overtimeP);
    expect(b.nightP).toBe(a.nightP);
    expect(b.hourlyWage).toBe(20_241);
    expect(b.gross).toBe(5_000_000);
  });

  it("일할계산 — 보상금도 같은 비율로 일할되고 합계는 round(총액 × 비율)", () => {
    const half = computePayroll({ ...prof, nonCompetePay: 300_000 }, { prorationRatio: 0.5 }, DEFAULT_RATES_2025, taxTable);
    expect(half.nonCompeteP).toBe(150_000);
    expect(half.baseP).toBe(1_500_000);
    expect(half.gross).toBe(1_750_000);

    const r = 13 / 30;
    const odd = computePayroll({ ...prof, nonCompetePay: 300_000 }, { prorationRatio: r }, DEFAULT_RATES_2025, taxTable);
    expect(odd.nonCompeteP).toBe(130_000);
    expect(odd.gross).toBe(Math.round(3_500_000 * r));
    expect(odd.baseP + odd.mealP + odd.nonCompeteP).toBe(odd.gross);
  });

  it("월급+인센티브도 같은 규칙 — 퇴직유보금은 여전히 인센티브 원천액만 본다", () => {
    const inc: EmployeePayInput = { ...prof, payScheme: "INCENTIVE", incThreshold: 40, incPerStudent: 20_000 };
    const r = computePayroll({ ...inc, nonCompetePay: 300_000 }, { studentCount: 50 }, DEFAULT_RATES_2025, taxTable);
    expect(r.nonCompeteP).toBe(300_000);
    expect(r.incentiveP).toBe(200_000);
    expect(r.retentionD).toBe(Math.round(200_000 / 12));
    expect(r.gross).toBe(3_500_000 + 200_000);
  });

  it("시급제·완전비율제·위탁계약에는 보상금을 싣지 않는다", () => {
    const hourly = computePayroll(
      { ...prof, payScheme: "HOURLY", baseWage: 15_000, nonCompetePay: 300_000 },
      { workedHours: 100 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(hourly.nonCompeteP).toBe(0);
    const ratio = computePayroll(
      { ...prof, payScheme: "RATIO", ratioPercent: 0.5, nonCompetePay: 300_000 },
      { classRevenue: 4_000_000 },
      DEFAULT_RATES_2025,
      taxTable
    );
    expect(ratio.nonCompeteP).toBe(0);
    const contractor = computePayroll({ ...prof, isContractor: true, nonCompetePay: 300_000 }, {}, DEFAULT_RATES_2025, taxTable);
    expect(contractor.nonCompeteP).toBe(0);
    expect(contractor.baseP).toBe(3_300_000);
  });

  it("보상금이 기본급으로 남는 몫보다 크면 남는 몫까지만 떼고 알린다 — 합계는 총액을 넘지 않는다", () => {
    const r = computePayroll({ ...prof, baseWage: 1_000_000, nonCompetePay: 900_000 }, {}, DEFAULT_RATES_2025, taxTable);
    expect(r.nonCompeteP).toBe(800_000);
    expect(r.baseP).toBe(0);
    expect(r.gross).toBe(1_000_000);
    expect(r.notes.some((n) => n.includes("경업금지 보상금이 기본급으로 남는 금액보다 커서"))).toBe(true);
  });

  it("명세서 산출 근거에 보상금 안내가 남는다", () => {
    expect(withNc.notes.some((n) => n.includes("경업금지 보상금 300,000원"))).toBe(true);
    expect(without.notes.some((n) => n.includes("경업금지"))).toBe(false);
  });
});

describe("inclusiveWageBreakdown — 항목 합계는 언제나 총액", () => {
  it("보상금을 넣어도 기본급 + 비과세 + 약정수당 + 보상금 = target", () => {
    for (const prorate of [1, 0.5, 13 / 30, 17 / 31]) {
      const iw = inclusiveWageBreakdown({
        baseWage: 4_600_000,
        mealAllow: 200_000,
        carAllow: 100_000,
        baseHours: 172.062,
        otHours: 4.345,
        nightHours: 10.8625,
        nonCompetePay: 350_000,
        prorate,
      });
      const nonTaxPaid = Math.round(200_000 * prorate) + Math.round(100_000 * prorate);
      expect(iw.basePay + nonTaxPaid + iw.overtimePay + iw.nightPay + iw.nonCompetePay).toBe(iw.target);
      expect(iw.nonCompetePay).toBe(Math.round(350_000 * prorate));
      expect(iw.nonCompeteCapped).toBe(false);
    }
  });

  it("통상시급은 보상금과 무관하다", () => {
    const a = inclusiveWageBreakdown({ baseWage: 4_000_000, baseHours: 209, otHours: 10 });
    const b = inclusiveWageBreakdown({ baseWage: 4_000_000, baseHours: 209, otHours: 10, nonCompetePay: 400_000 });
    expect(b.hourlyWage).toBe(a.hourlyWage);
    expect(b.overtimePay).toBe(a.overtimePay);
    expect(b.basePay).toBe(a.basePay - 400_000);
  });
});

describe("blendWageTerms — 월중 갱신으로 보상금이 생긴 달", () => {
  it("보상금도 총액처럼 역일수로 가중한다", () => {
    const b = blendWageTerms([
      { days: 15, baseWage: 3_500_000, positionAllow: 0, mealAllow: 200_000, carAllow: 0 },
      { days: 15, baseWage: 3_500_000, positionAllow: 0, mealAllow: 200_000, carAllow: 0, nonCompetePay: 300_000 },
    ])!;
    expect(b.baseWage).toBe(3_500_000);
    expect(b.nonCompetePay).toBe(150_000);
  });
});

describe("판정·검사 — 화면과 서버가 같은 함수", () => {
  it("월급제·인센티브 근로계약에만 둘 수 있다", () => {
    expect(nonCompetePayApplies({ payScheme: "MONTHLY" })).toBe(true);
    expect(nonCompetePayApplies({ payScheme: "INCENTIVE" })).toBe(true);
    expect(nonCompetePayApplies({ payScheme: "HOURLY" })).toBe(false);
    expect(nonCompetePayApplies({ payScheme: "RATIO" })).toBe(false);
    expect(nonCompetePayApplies({ payScheme: "MONTHLY", isContractor: true })).toBe(false);
  });

  it("교수부(이름 부분일치) 월급제·인센티브만 필수", () => {
    expect(nonCompeteRequired("교수부", { payScheme: "MONTHLY" })).toBe(true);
    expect(nonCompeteRequired("교수부(중등)", { payScheme: "INCENTIVE" })).toBe(true);
    expect(nonCompeteRequired("교수부", { payScheme: "HOURLY" })).toBe(false);
    expect(nonCompeteRequired("교수부", { payScheme: "RATIO" })).toBe(false);
    expect(nonCompeteRequired("교육운영팀", { payScheme: "MONTHLY" })).toBe(false);
    expect(nonCompeteRequired(null, { payScheme: "MONTHLY" })).toBe(false);
  });

  it("저장값 다듬기 — 빈칸·0 은 조항 없음(null), 대상이 아니면 지운다", () => {
    expect(normalizeNonCompetePay("300000", true)).toBe(300_000);
    expect(normalizeNonCompetePay(299_999.6, true)).toBe(300_000);
    expect(normalizeNonCompetePay("", true)).toBeNull();
    expect(normalizeNonCompetePay(0, true)).toBeNull();
    expect(normalizeNonCompetePay(300_000, false)).toBeNull();
  });

  const terms = {
    baseWage: 3_500_000,
    positionAllow: 0,
    mealAllow: 200_000,
    carAllow: 0,
    fixedBaseHours: 209,
    schedule: instructor,
  };

  it("음수·숫자 아님은 거른다", () => {
    expect(nonCompetePayError(terms, -1)).toContain("0 이상");
    expect(nonCompetePayError(terms, "abc")).toContain("0 이상");
    expect(nonCompetePayError(terms, "")).toBeNull();
    expect(nonCompetePayError(terms, null)).toBeNull();
    expect(nonCompetePayError(terms, 0)).toBeNull();
  });

  it("떼고 남는 기본급이 없으면 거른다", () => {
    expect(nonCompetePayError(terms, 3_299_999)).toBeNull();
    expect(nonCompetePayError(terms, 3_300_000)).toContain("기본급(3,300,000원)");
    expect(nonCompetePayError(terms, 4_000_000)).toContain("기본급이 남아야");
  });

  it("미리보기 — 기본급 변화·임금/보상금/총액·최저임금 비교 시급", () => {
    const p = nonCompetePreview({ ...terms, positionAllow: 100_000 }, 300_000);
    expect(p.baseHours).toBe(209);
    expect(p.basePayBefore).toBe(3_300_000);
    expect(p.basePayAfter).toBe(3_000_000);
    expect(p.monthlyTotal).toBe(3_600_000);
    expect(p.wageTotal).toBe(3_300_000);
    // (기본급 300만 + 직책 10만 + 식대 20만) ÷ 209
    expect(p.minWageHourly).toBe(Math.round(3_300_000 / 209));
  });

  it("기본급 산정시간을 안 적은 계약은 근로시간표로, 그것도 없으면 209시간(엔진과 같다)", () => {
    expect(nonCompetePreview({ ...terms, fixedBaseHours: null }, 0).baseHours).toBeCloseTo((32.5 + 6.5) * 4.345, 6);
    expect(nonCompetePreview({ ...terms, fixedBaseHours: null, schedule: [] }, 0).baseHours).toBe(209);
  });

  it("resolve — 요청에 없으면 카드 값, 시급제로 바꾸면 지운다, 넘치면 오류", () => {
    const base = { payScheme: "MONTHLY", isContractor: false, terms };
    expect(resolveNonCompetePay({ ...base, raw: undefined, fallback: 300_000 })).toEqual({ value: 300_000, error: null });
    expect(resolveNonCompetePay({ ...base, raw: null, fallback: 300_000 })).toEqual({ value: null, error: null });
    expect(resolveNonCompetePay({ ...base, raw: 250_000, fallback: 300_000 })).toEqual({ value: 250_000, error: null });
    expect(resolveNonCompetePay({ ...base, payScheme: "HOURLY", raw: 300_000, fallback: null })).toEqual({ value: null, error: null });
    expect(resolveNonCompetePay({ ...base, raw: 5_000_000, fallback: null }).error).toContain("기본급");
  });

  it("필수 안내 문구는 무엇을 해야 하는지와 빠져나갈 길을 함께 적는다", () => {
    expect(NON_COMPETE_REQUIRED_MESSAGE).toContain("경업금지 보상금");
    expect(NON_COMPETE_REQUIRED_MESSAGE).toContain("넣지 않음");
  });
});

/* ───────────────────────── 계약서 ───────────────────────── */

const company: DocCompany = {
  name: "주식회사 테스트학원",
  ceo: "홍길동",
  bizNo: "000-00-00000",
  phone: "02-000-0000",
  address: "서울특별시 어딘가 1",
  payday: 7,
  stamp: null,
};

const emp = (over: Partial<DocEmployee> = {}): DocEmployee =>
  ({
    name: "가상강사",
    department: "교수부",
    position: "강사",
    duty: "강의",
    email: "virtual@example.com",
    hireDate: new Date(Date.UTC(2026, 0, 2)),
    resignDate: null,
    incomeType: "EMPLOYEE",
    payScheme: "MONTHLY",
    baseWage: 3_500_000,
    positionAllow: 0,
    mealAllow: 200_000,
    carAllow: 0,
    schedule: JSON.stringify(instructor),
    ...over,
  }) as DocEmployee;

const ct = (over: Partial<DocContract> = {}): DocContract =>
  ({
    stage: "RENEWAL_1",
    templateKey: "MONTHLY",
    startDate: new Date(Date.UTC(2026, 11, 1)),
    endDate: new Date(Date.UTC(2027, 10, 30)),
    isProbation: false,
    probationMonths: 2,
    baseWage: 3_500_000,
    positionAllow: 0,
    mealAllow: 200_000,
    carAllow: 0,
    fixedBaseHours: 209,
    ...over,
  }) as DocContract;

const printedAt = new Date(Date.UTC(2026, 10, 5));
/** 태그를 걷어낸 본문 — `<b>` 로 끊긴 문장도 통째로 찾을 수 있게 */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
/** 표 칸처럼 태그가 경계인 곳은 공백으로 — 칸 내용이 서로 붙지 않게 */
const spaced = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("근로계약서 — 보상금이 있으면 제8조, 기타사항은 제9조", () => {
  const html = contractHtml({ employee: emp(), contract: ct({ nonCompetePay: 300_000 }), company, printedAt });
  const t = text(html);

  it("제4조에 보상금을 임금 항목과 구분해 적고 기준급여(총액)는 그대로 둔다", () => {
    expect(t).toContain(
      "3,500,000원을 기준급여로 하여 아래와 같은 항목으로 포괄하여 지급하며, 이 중 경업금지 보상금 300,000원은 제8조에 따른 경업금지 의무의 대가로서 임금 항목과 구분하여 지급한다."
    );
    expect(html).toContain('class="nc-row"');
    expect(spaced(html)).toContain("경업금지 보상금 (제8조) 300,000원 월 지급 총액 3,500,000원");
    // 기본급 = 350만 − 식대 20만 − 보상금 30만 (명세서와 같은 함수)
    expect(spaced(html)).toContain("기본급 (209시간) 3,000,000원");
  });

  it("제8조 — 범위·대가·반환·별도 법적 조치·동의", () => {
    expect(t).toContain("제 8조 (경업금지 및 경업금지 보상금)");
    expect(t).toContain(`근로계약 종료일로부터 ${NON_COMPETE_MONTHS}개월간`);
    expect(t).toContain(`반경 ${NON_COMPETE_RADIUS_KM}km 이내`);
    expect(t).toContain("원생·학부모 또는 강사를 유인");
    expect(t).toContain("매월 경업금지 보상금 300,000원을 제4조의 임금 항목과 구분하여 임금 지급일에 함께 지급한다");
    expect(t).toContain("그때까지 지급받은 경업금지 보상금 전액을");
    expect(t).toContain("서면 청구일로부터 30일 이내");
    expect(t).toContain("위약금이나 손해배상액의 예정이 아니며");
    expect(t).toContain("손해의 배상 청구, 위반행위의 금지 청구(가처분 포함)");
    expect(t).toContain("충분히 설명을 듣고 이해하였으며, 이에 동의한다");
    // 제8조 안에 동의자 서명란
    const art8 = t.slice(t.indexOf("제 8조"), t.indexOf("제 9조"));
    expect(art8).toContain("동 의 자 :");
  });

  it("기타사항이 제9조로 밀리고 조항 순서가 이어진다", () => {
    expect(t).toContain("제 9조 (기타사항)");
    expect(t).not.toContain("제 8조 (기타사항)");
    expect(t.indexOf("제 7조")).toBeLessThan(t.indexOf("제 8조 (경업금지"));
    expect(t.indexOf("제 8조 (경업금지")).toBeLessThan(t.indexOf("제 9조 (기타사항)"));
  });

  it("보안서약서와 범위가 같다 (6개월 · 반경 2km)", () => {
    const pledge = text(pledgeSecurityHtml({ employee: emp(), company, nonCompete: true }));
    expect(pledge).toContain(`근로계약 종료 후 ${NON_COMPETE_MONTHS}개월`);
    expect(pledge).toContain(`회사 반경 ${NON_COMPETE_RADIUS_KM}km 내에서 동일직종에 취업 또는 경영`);
  });
});

describe("근로계약서 — 보상금이 없으면 예전 그대로", () => {
  const plain = contractHtml({ employee: emp(), contract: ct(), company, printedAt });

  it("경업금지 조항·보상금 행이 없고 기타사항이 제8조", () => {
    expect(plain).not.toContain("경업금지");
    expect(plain).not.toContain("nc-row");
    expect(text(plain)).toContain("제 8조 (기타사항)");
    expect(text(plain)).toContain("3,500,000원을 기준급여로 하여 아래와 같은 임금 항목으로 포괄하여 지급한다.");
  });

  it("null · 0 · 생략이 모두 같은 문서", () => {
    for (const v of [null, 0, undefined]) {
      expect(contractHtml({ employee: emp(), contract: ct({ nonCompetePay: v }), company, printedAt })).toBe(plain);
    }
  });

  it("시급제·위탁계약에는 값이 남아 있어도 넣지 않는다", () => {
    const hourly = contractHtml({
      employee: emp({ payScheme: "HOURLY" }),
      contract: ct({ templateKey: "HOURLY", baseWage: 15_000, nonCompetePay: 300_000 }),
      company,
      printedAt,
    });
    expect(hourly).not.toContain("경업금지 보상금");
    const contractor = contractHtml({
      employee: emp(),
      contract: ct({ isContractor: true, nonCompetePay: 300_000 }),
      company,
      printedAt,
    });
    expect(contractor).not.toContain("경업금지 보상금");
  });
});

/* ───────────────────────── 명세서 ───────────────────────── */

const payroll: DocPayroll = {
  year: 2026,
  month: 12,
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseP: 3_000_000,
  extraP: 0,
  overtimeP: 0,
  nightP: 0,
  holidayP: 0,
  weeklyHolidayP: 0,
  positionP: 0,
  mealP: 200_000,
  carP: 0,
  nonCompeteP: 300_000,
  incentiveP: 0,
  bonusP: 0,
  unusedLeaveP: 0,
  gross: 3_500_000,
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
  net: 3_500_000,
  hourlyWage: 16_746,
};

describe("급여명세서 — 보상금 줄과 각주", () => {
  it("보상금이 있으면 따로 한 줄, 머리글은 '지급 항목', 근거·반환 의무 각주", () => {
    const t = spaced(payslipHtml({ employee: emp(), payroll, company }));
    expect(t).toContain("경업금지 보상금 300,000");
    expect(t).toContain("지급 항목");
    expect(t).not.toContain("임금 항목");
    expect(t).toContain("근로계약서 제8조의 경업금지 의무에 대한 대가");
    expect(t).toContain("지급받은 보상금 전액을 반환");
    // 과세·비과세는 명세서가 단정하지 않는다(v1.58.2) — 세무 처리는 세무대리인 지정값에 따른다
    expect(t).toContain("월 급여 총액 중 기본급과 구분해 지급하는 금액입니다. 경업금지 의무를 위반하면");
    expect(t).not.toContain("금액입니다(과세)");
  });

  it("없으면 예전 명세서 그대로 ('임금 항목', 경업금지 언급 없음)", () => {
    const html = payslipHtml({ employee: emp(), payroll: { ...payroll, nonCompeteP: 0, baseP: 3_300_000 }, company });
    expect(html).toContain("임금 항목");
    expect(html).not.toContain("경업금지");
    // 옛 기록(필드 자체가 없음)도 같다
    const { nonCompeteP: _omit, ...legacy } = payroll;
    expect(payslipHtml({ employee: emp(), payroll: { ...legacy, baseP: 3_300_000 }, company })).toBe(html);
  });
});

/* ───────────────────────── 퇴직급여 · 추이 ───────────────────────── */

describe("퇴직급여 — 보상금은 계약 월 급여의 일부라 언제나 산입", () => {
  it("산정기준 임금 = 계약 월 급여총액 그대로", () => {
    const items: SeverancePayItems = {
      baseP: 3_000_000,
      weeklyHolidayP: 0,
      positionP: 0,
      mealP: 200_000,
      carP: 0,
      nonCompeteP: 300_000,
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
      hourlyWage: 16_746,
      payScheme: "MONTHLY",
    };
    const b = severanceBase(items);
    expect(b.base).toBe(3_500_000);
    expect(b.included).toContainEqual(["경업금지 보상금", 300_000]);
    expect(b.excluded.some(([l]) => l.includes("경업금지"))).toBe(false);
  });
});

describe("대시보드 추이 — 어느 갈래로 보든 합계가 같다", () => {
  it("보상금은 '계약 기본급' 에 들고 지급액 계와 맞는다", () => {
    const r: TrendRecord = {
      year: 2026,
      month: 12,
      department: "교수부",
      payScheme: "MONTHLY",
      baseP: 3_000_000,
      weeklyHolidayP: 0,
      positionP: 0,
      mealP: 200_000,
      carP: 0,
      nonCompeteP: 300_000,
      incentiveP: 50_000,
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
      hourlyWage: 16_746,
    };
    expect(contractBaseOf(r)).toBe(3_500_000);
    expect(grossOf(r)).toBe(3_550_000);
    expect(contractBaseOf(r) + r.incentiveP + overtimeOf(r) + r.bonusP + r.unusedLeaveP).toBe(grossOf(r));
  });
});
