// 수습기간 — 신규 3개월(2026-11~), 옛 계약 2개월 유지, 종료일(민법 §160)·본채용 거부 예고 기한(§26)
import { describe, it, expect } from "vitest";
import {
  PROBATION_MONTHS,
  LEGACY_PROBATION_MONTHS,
  probationEndYmd,
  probationNoticeByYmd,
  probationTimeline,
  parseProbationMonths,
  probationMonthOptions,
  probationOptionLabel,
} from "./probation";
import { contractHtml, type DocCompany, type DocContract, type DocEmployee } from "./documents";

describe("신규 입사자 수습기간", () => {
  it("새 계약의 기본값은 3개월, 옛 기준은 2개월", () => {
    expect(PROBATION_MONTHS).toBe(3);
    expect(LEGACY_PROBATION_MONTHS).toBe(2);
  });
});

describe("probationEndYmd — 민법 §160", () => {
  it("마지막 달의 개시일 해당일 **전일**에 끝난다 (11/6 개시 → 2/5)", () => {
    expect(probationEndYmd("2026-11-06", 3)).toBe("2027-02-05");
    expect(probationEndYmd("2026-11-06", 2)).toBe("2027-01-05");
  });

  it("1일 개시면 앞달 말일에 끝난다 (12/1 → 2/28, 윤년 2/29)", () => {
    expect(probationEndYmd("2026-12-01", 3)).toBe("2027-02-28");
    expect(probationEndYmd("2027-12-01", 3)).toBe("2028-02-29");
  });

  it("마지막 달에 해당일이 없으면 그 달 말일 (11/30 → 2/28) — addMonths−1일(2/27)과 다르다", () => {
    expect(probationEndYmd("2026-11-30", 3)).toBe("2027-02-28");
    expect(probationEndYmd("2027-11-30", 3)).toBe("2028-02-29");
    expect(probationEndYmd("2026-03-31", 3)).toBe("2026-06-30");
  });

  it("해당일이 있으면 그 전일 (윤년 2/29 해당 → 2/28)", () => {
    expect(probationEndYmd("2027-11-29", 3)).toBe("2028-02-28");
  });

  it("해를 넘긴다", () => {
    expect(probationEndYmd("2026-10-15", 3)).toBe("2027-01-14");
  });

  it("못 읽는 날짜·개월이면 null", () => {
    expect(probationEndYmd("", 3)).toBeNull();
    expect(probationEndYmd("2026-02-30", 3)).toBeNull();
    expect(probationEndYmd("2026-13-01", 3)).toBeNull();
    expect(probationEndYmd("2026-11-06", 0)).toBeNull();
    expect(probationEndYmd("2026-11-06", 2.5)).toBeNull();
  });
});

describe("본채용 거부 예고 기한 — 근로기준법 §26", () => {
  it("수습 마지막 날의 30일 전 (2/5 → 1/6)", () => {
    expect(probationNoticeByYmd("2027-02-05")).toBe("2027-01-06");
    expect(probationNoticeByYmd("2027-03-01")).toBe("2027-01-30");
  });

  it("3개월 수습은 끝나는 날 근속이 3개월이라 예고 대상 — 기한을 준다", () => {
    expect(probationTimeline("2026-11-06", 3)).toEqual({ endYmd: "2027-02-05", noticeByYmd: "2027-01-06" });
  });

  it("2개월 수습은 근속 3개월 미만이라 예고 예외 — 기한을 주지 않는다", () => {
    expect(probationTimeline("2026-11-06", 2)).toEqual({ endYmd: "2027-01-05", noticeByYmd: null });
  });

  it("못 읽으면 null", () => {
    expect(probationTimeline("", 3)).toBeNull();
  });
});

describe("parseProbationMonths — API 입력", () => {
  it("비어 있으면 기본값", () => {
    expect(parseProbationMonths(undefined, 3)).toEqual({ value: 3, error: null });
    expect(parseProbationMonths(null, 2)).toEqual({ value: 2, error: null });
    expect(parseProbationMonths("", 3)).toEqual({ value: 3, error: null });
  });

  it("1~6 의 정수만 받는다", () => {
    expect(parseProbationMonths(3, 2)).toEqual({ value: 3, error: null });
    expect(parseProbationMonths("2", 3)).toEqual({ value: 2, error: null });
    for (const bad of [0, 7, 2.5, -1, "abc"]) expect(parseProbationMonths(bad, 3).error).toBeTruthy();
  });
});

describe("조건 수정의 선택지", () => {
  it("현행 3개월과 옛 기준 2개월을 늘 둔다", () => {
    expect(probationMonthOptions(3)).toEqual([3, 2]);
    expect(probationMonthOptions(2)).toEqual([3, 2]);
    expect(probationMonthOptions(null)).toEqual([3, 2]);
  });

  it("저장값이 그 밖이면 함께 둔다 — 고르지 않고 저장해도 바뀌지 않게", () => {
    expect(probationMonthOptions(6)).toEqual([3, 2, 6]);
  });

  it("라벨이 현행·옛 기준을 가른다", () => {
    expect(probationOptionLabel(3)).toBe("수습 3개월 (현행)");
    expect(probationOptionLabel(2)).toBe("수습 2개월 (2026-11 이전 기준)");
    expect(probationOptionLabel(6)).toBe("수습 6개월");
  });
});

// ── 계약서 제1조 — 저장된 개월을 찍는다 (상수가 아니라) ──
const company: DocCompany = {
  name: "주식회사 가상학원",
  ceo: "홍길동",
  bizNo: "000-00-00000",
  phone: "02-000-0000",
  address: "서울시 어딘가",
  payday: 7,
  stamp: null,
};
const emp = {
  name: "가상직원",
  rrn: "900101-1234567",
  birth: "1990-01-01",
  department: "교육운영팀",
  position: "매니저",
  duty: "운영",
  address: "서울시",
  phone: "010-0000-0000",
  email: "v@example.test",
  hireDate: new Date(Date.UTC(2026, 10, 9)),
  resignDate: null,
  incomeType: "EMPLOYEE",
  payScheme: "MONTHLY",
  baseWage: 3_000_000,
  positionAllow: 0,
  mealAllow: 0,
  carAllow: 0,
  schedule: "[]",
} as unknown as DocEmployee;
const ct = (over: Partial<DocContract>): DocContract =>
  ({
    stage: "SHORT_TERM_1",
    templateKey: "MONTHLY",
    startDate: new Date(Date.UTC(2026, 10, 9)),
    endDate: new Date(Date.UTC(2027, 10, 8)),
    isProbation: true,
    probationMonths: PROBATION_MONTHS,
    baseWage: 3_000_000,
    positionAllow: 0,
    mealAllow: 0,
    carAllow: 0,
    ...over,
  }) as DocContract;
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

describe("계약서 제1조의 수습 조항", () => {
  it("새 계약(3개월)은 '3개월간' 을 찍는다", () => {
    const t = text(contractHtml({ employee: emp, contract: ct({}), company }));
    expect(t).toContain("최초 근로 개시일로부터 3개월간 수습기간으로 하며");
    expect(t).toContain("수습기간 중 급여는 100% 지급한다");
  });

  it("2개월로 서명한 옛 계약은 다시 뽑아도 '2개월간' 그대로다", () => {
    const t = text(contractHtml({ employee: emp, contract: ct({ probationMonths: 2 }), company }));
    expect(t).toContain("최초 근로 개시일로부터 2개월간 수습기간으로 하며");
    expect(t).not.toContain("3개월간 수습기간");
  });

  it("수습이 아니면 조항이 없다", () => {
    const t = text(contractHtml({ employee: emp, contract: ct({ isProbation: false }), company }));
    expect(t).not.toContain("수습기간");
  });
});
