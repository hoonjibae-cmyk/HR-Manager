// 별지 「인센티브 산정 계약서」 — 산정 대상(incScope)에 따라 제1·3조가 갈린다.
//
// **강사(기본)용 원문은 실제 서명된 계약서를 재현하는 문구**라 한 글자도 달라지면 안 되고,
// 교수부장(ACADEMY)용은 담당 원생이 아니라 **학원 전체 재원생** 기준이라 문구가 다르다.
// 잘못 갈리면 사람이 서명한 뒤에야 드러난다.

import { describe, it, expect } from "vitest";
import {
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

const emp = {
  name: "박채영",
  department: "교수부",
  position: "교수부장",
  hireDate: new Date(Date.UTC(2024, 2, 1)),
  incomeType: "EMPLOYEE",
  payScheme: "INCENTIVE",
  baseWage: 4_000_000,
  positionAllow: 0,
  mealAllow: 0,
  carAllow: 0,
  schedule: "[]",
} as DocEmployee;

const ct = (over: Partial<DocContract> = {}): DocContract =>
  ({
    stage: "RENEWAL_1",
    templateKey: "INCENTIVE",
    startDate: new Date(Date.UTC(2026, 8, 1)),
    endDate: null,
    isProbation: false,
    probationMonths: 2,
    baseWage: 4_000_000,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    incThreshold: 600,
    incPerStudent: 20_000,
    ...over,
  }) as DocContract;

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

describe("강사(기본) — 서명된 원문 그대로", () => {
  const t = text(incentiveContractHtml({ employee: emp, contract: ct(), company }));

  it("제3조 ①이 '을이 담당한 원생' 기준이다", () => {
    expect(t).toContain(`"을"이 담당한 원생 중`);
    expect(t).not.toContain("전체 재원생");
  });

  it("교수부장용 조항(15일 기준·환산·정규반·동반성장)이 붙지 않는다", () => {
    expect(t).not.toContain("매월 15일");
    expect(t).not.toContain("0.5명");
    expect(t).not.toContain("정규반");
    expect(t).not.toContain("동반성장");
  });

  it("매출 배분율이 없으면 제3조는 ①② 로 끝난다", () => {
    const art3 = t.slice(t.indexOf("제 3조"), t.indexOf("제 4조"));
    expect(art3).toContain("②");
    expect(art3).not.toContain("③");
  });
});

describe("교수부장(ACADEMY) — 학원 전체 재원생 기준", () => {
  const html = (over: Partial<DocContract> = {}) =>
    text(
      incentiveContractHtml({
        employee: emp,
        contract: ct({ incScope: "ACADEMY", incCountMethod: "SNAPSHOT15", ...over }),
        company,
      })
    );

  it("제3조 ①이 학원 전체 재원생 기준으로 갈린다 (담당 원생 한정 아님을 명시)", () => {
    const t = html();
    expect(t).toContain("전체 재원생 수");
    expect(t).toContain(`"을"이 담당한 원생에 한정하지 아니하고`);
    expect(t).toContain("기준 인원수600명"); // 표 셀이라 태그를 걷으면 붙는다
    expect(t).toContain("20,000원");
  });

  it("예시 한 줄이 계약값에서 계산된다 — 700명이면 200만원", () => {
    const t = html();
    expect(t).toContain("재원생 700명");
    expect(t).toContain("(700 − 600) × 20,000원 = 2,000,000원");
  });

  it("매월 15일 기준(SNAPSHOT15) 조항", () => {
    const t = html();
    expect(t).toContain("매월 15일 현재");
    expect(t).not.toContain("가중 인원");
  });

  it("가중인원(WEIGHTED) 조항 — 15일 문구와 상호배타", () => {
    const t = html({ incCountMethod: "WEIGHTED" });
    expect(t).toContain("수업 회차에 비례한 가중 인원");
    expect(t).not.toContain("매월 15일");
  });

  it("주2회=1명·주1회=0.5명 환산 조항", () => {
    const t = html();
    expect(t).toContain("주 2회 수업을 수강하는 원생은 1명");
    expect(t).toContain("주 1회 수업을 수강하는 원생은 0.5명");
  });

  it("담임 배정 정규반만 산정하고 특강은 뺀다", () => {
    const t = html();
    expect(t).toContain("담임이 배정된 정규반");
    expect(t).toContain("특강 수강생은 산정에 포함하지 아니한다");
  });

  it("제1조에 동반성장 취지 조항이 붙는다 (①②)", () => {
    const t = html();
    const art1 = t.slice(t.indexOf("제 1조"), t.indexOf("제 2조"));
    expect(art1).toContain("동반성장");
    expect(art1).toContain("①");
    expect(art1).toContain("②");
  });

  it("번호가 이어진다 — 매출 배분율이 없으면 ①~⑤, 있으면 ⑥까지 밀린다", () => {
    const no = html();
    const art3 = no.slice(no.indexOf("제 3조"), no.indexOf("제 4조"));
    for (const n of ["①", "②", "③", "④", "⑤"]) expect(art3).toContain(n);
    expect(art3).not.toContain("⑥");

    const withRev = html({ incRevenuePercent: 0.05 });
    const art3r = withRev.slice(withRev.indexOf("제 3조"), withRev.indexOf("제 4조"));
    expect(art3r).toContain("⑥");
    expect(art3r).toContain("매출 배분율5%"); // 표 셀이라 태그를 걷으면 붙는다
  });

  it("제4조 이후(지급방법·비밀유지·퇴직유보금)는 강사용과 같다", () => {
    const t = html();
    expect(t).toContain("제 4조 (인센티브의 지급방법)");
    expect(t).toContain("제 6조 (퇴직유보금)");
    expect(t).toContain("8.3%");
  });
});
