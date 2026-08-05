// 명세서 뒤에 붙는 산정 내역서 — 매출 기준(사업소득·인센티브) / 인원 기준
import { describe, it, expect } from "vitest";
import { revenueDetailHtml, rosterDetailHtml } from "./documents-pay";
import type { DocCompany, DocEmployee } from "./documents";
import type { RosterStudent } from "./incentive";

const company: DocCompany = {
  name: "주식회사 유쌤에듀",
  ceo: "유은정",
  bizNo: "418-86-02289",
  phone: "031-794-3306",
  address: "경기도 하남시 미사강변대로 216",
  payday: 7,
  stamp: null,
};

const employee: DocEmployee = {
  name: "김은진",
  empNo: "E010",
  birth: "1990-01-01",
  address: "경기도 하남시",
  phone: "010-0000-0000",
  department: "교수부",
  position: "강사",
  duty: "강의",
  hireDate: new Date(Date.UTC(2023, 2, 1)),
  resignDate: null,
  incomeType: "FREELANCE",
  payScheme: "RATIO",
  baseWage: 0,
  positionAllow: 0,
  mealAllow: 0,
  carAllow: 0,
  dependents: 1,
  schedule: [],
} as unknown as DocEmployee;

const revRoster: RosterStudent[] = [
  { seq: 1, status: "ENROLLED", name: "강세훈", className: "블루라벨 월금", revenue: 380_000 },
  {
    seq: 2,
    status: "NEW",
    name: "김예랑",
    className: "구문분석",
    revenue: 266_000,
    sessions: 6,
    enrollDate: new Date(Date.UTC(2026, 6, 6)),
  },
  {
    seq: null,
    status: "WITHDRAWN",
    name: "손인호",
    className: "블루라벨 화목",
    revenue: 0,
    sessions: 0,
    withdrawDate: new Date(Date.UTC(2026, 6, 2)),
  },
];

const headRoster: RosterStudent[] = [
  { seq: 1, status: "ENROLLED", name: "곽승윤", sessions: null },
  { seq: 2, status: "NEW", name: "박상미", sessions: 7 },
];

function render(over: Parameters<typeof revenueDetailHtml>[0] extends infer T ? Partial<T> : never) {
  return revenueDetailHtml({
    employee,
    company,
    year: 2026,
    month: 7,
    students: revRoster,
    percent: 0.45,
    kind: "BUSINESS",
    ...over,
  } as Parameters<typeof revenueDetailHtml>[0]);
}

describe("revenueDetailHtml — 매출 기준 산정 내역서", () => {
  it("완전비율제는 「사업소득 산정 내역서」", () => {
    const html = render({});
    expect(html).toContain("사업소득 산정 내역서");
    expect(html).toContain("2026년 7월");
    expect(html).toContain("김은진");
  });

  it("월급+인센티브는 「인센티브 산정 내역서」로 같은 양식을 쓴다", () => {
    const html = render({ kind: "INCENTIVE", percent: 0.15 });
    expect(html).toContain("인센티브 산정 내역서");
    expect(html).not.toContain("사업소득 산정 내역서");
  });

  it("매출 합계와 배분액을 적는다", () => {
    const html = render({});
    expect(html).toContain("646,000"); // 380,000 + 266,000
    expect(html).toContain("290,700"); // × 45%
    expect(html).toContain("45%");
  });

  it("학생별로 매출과 배분액이 한 줄씩 들어간다", () => {
    const html = render({});
    expect(html).toContain("강세훈");
    expect(html).toContain("171,000"); // 380,000 × 45%
    expect(html).toContain("김예랑");
    expect(html).toContain("119,700"); // 266,000 × 45%
  });

  it("그 달 수업이 없던 학생은 흐리게, 금액은 '-' 로 남긴다", () => {
    const html = render({});
    expect(html).toContain("손인호");
    expect(html).toMatch(/class="dim"/);
  });

  it("명단의 배분율이 계약과 다르면 경고를 적고 계약 기준으로 계산한다", () => {
    const html = render({ percent: 0.45, sheetPercent: 0.4 });
    expect(html).toContain("명단에 적힌 배분율");
    expect(html).toContain("290,700"); // 계약 45% 기준
  });

  it("배분율이 같으면 경고가 없다", () => {
    expect(render({ percent: 0.45, sheetPercent: 0.45 })).not.toContain("명단에 적힌 배분율");
  });

  it("퇴직유보금이 있으면 지급액을 함께 적는다 (인센티브 계약자)", () => {
    const html = render({ kind: "INCENTIVE", percent: 0.15, retention: 17_685 });
    expect(html).toContain("퇴직유보금");
    expect(html).toContain("인센티브 지급액");
  });

  it("위탁계약(사업소득)이면 근로기준법 미적용을 명시한다", () => {
    expect(render({})).toContain("주휴·연차·퇴직금·4대보험은 적용되지 않습니다");
  });

  it("실제 관리시트 재현 — 25,887,500 × 45% = 11,649,375", () => {
    const html = render({
      students: [{ seq: 1, status: "ENROLLED", name: "합계학생", revenue: 25_887_500 }],
    });
    expect(html).toContain("11,649,375");
  });
});

describe("rosterDetailHtml — 명단 모양에 맞는 내역서를 고른다", () => {
  const base = { employee, company, year: 2026, month: 7 } as const;

  it("매출 열이 있으면 매출 기준", () => {
    const html = rosterDetailHtml({
      ...base,
      students: revRoster,
      kind: "BUSINESS",
      percent: 0.45,
    });
    expect(html).toContain("사업소득 산정 내역서");
  });

  it("매출 열이 없으면 인원 기준 내역서", () => {
    const html = rosterDetailHtml({
      ...base,
      students: headRoster,
      kind: "INCENTIVE",
      threshold: 1,
      perStudent: 100_000,
    });
    expect(html).toContain("인센티브 산정 내역서");
    expect(html).toContain("기준 인원수");
  });

  it("명단이 없으면 첨부하지 않는다 — 명세서만 나간다", () => {
    expect(rosterDetailHtml({ ...base, students: [], kind: "INCENTIVE" })).toBeNull();
  });

  it("매출 명단인데 계약에 배분율이 없으면 첨부하지 않는다 (0원짜리 내역서를 붙이지 않는다)", () => {
    expect(
      rosterDetailHtml({ ...base, students: revRoster, kind: "BUSINESS", percent: null })
    ).toBeNull();
  });
});
