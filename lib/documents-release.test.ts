// 해촉증명서 — 위탁계약(프리랜서) 종료 증명.
//
// 여기서 틀리면 ① 근로자에게 해촉증명서가 나가 회사가 근로자를 위탁으로 취급한 기록이 되거나
// ② 공단 제출용인데 주민등록번호가 빠져 반려되거나 ③ 해촉일 없이 '끝났다' 는 증명이 나간다.

import { describe, it, expect } from "vitest";
import { certReleaseHtml } from "./documents-pay";
import type { DocCompany, DocEmployee } from "./documents";

const company = (stamp: string | null = null): DocCompany =>
  ({
    name: "주식회사 유쌤에듀",
    ceo: "김대표",
    address: "서울시 강남구",
    phone: "02-000-0000",
    bizNo: "000-00-00000",
    logo: null,
    stamp,
  }) as any;

const emp = (over: Partial<DocEmployee> = {}): DocEmployee =>
  ({
    name: "박강사",
    rrn: "900101-1234567",
    birth: "1990-01-01",
    department: "교수부",
    position: "강사",
    duty: "수학 강의",
    address: "서울시 서초구",
    hireDate: new Date("2025-03-01T00:00:00Z"),
    resignDate: new Date("2026-07-31T00:00:00Z"),
    incomeType: "FREELANCE",
    payScheme: "RATIO",
    baseWage: 0,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    schedule: "",
    ...over,
  }) as any;

describe("해촉증명서", () => {
  it("제목·위촉 기간·해촉일이 실린다", () => {
    const html = certReleaseHtml({ employee: emp(), company: company() });
    expect(html).toContain("해 촉 증 명 서");
    expect(html).toContain("2025.03.01 ~ 2026.07.31"); // 재직·경력증명서와 같은 날짜 표기
    expect(html).toContain("해촉되었음을 증명합니다");
    expect(html).toContain("2026년 7월 31일"); // 해촉일자를 본문 문장에도 적는다
  });

  // 건강보험공단이 대조하는 값이라 마스킹하면 반려된다
  it("**주민등록번호를 그대로 싣는다**", () => {
    expect(certReleaseHtml({ employee: emp(), company: company() })).toContain("900101-1234567");
  });

  it("해촉 사유 기본값은 '계약기간 만료', 지정하면 그대로", () => {
    expect(certReleaseHtml({ employee: emp(), company: company() })).toContain("계약기간 만료");
    expect(
      certReleaseHtml({ employee: emp(), company: company(), reason: "당사자 합의 해지" })
    ).toContain("당사자 합의 해지");
  });

  it("인감이 없으면 (직인), 있으면 도장 이미지", () => {
    expect(certReleaseHtml({ employee: emp(), company: company() })).toContain("(직인)");
    const html = certReleaseHtml({
      employee: emp(),
      company: company("data:image/png;base64,AAAA"),
    });
    expect(html).toContain("stamp-anchor");
    expect(html).not.toContain("(직인)");
  });

  it("용도를 적는다 (없으면 '제출용')", () => {
    expect(certReleaseHtml({ employee: emp(), company: company() })).toContain("제출용");
    expect(
      certReleaseHtml({ employee: emp(), company: company(), purpose: "건강보험공단 제출" })
    ).toContain("건강보험공단 제출");
  });
});
