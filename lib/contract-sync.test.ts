import { describe, it, expect } from "vitest";
import { contractTermDiff, termMismatches, templateKeyOf } from "./contract-sync";

const emp = {
  name: "남궁현",
  phone: "010-1111-2222",
  payScheme: "RATIO",
  baseWage: 0,
  positionAllow: 0,
  mealAllow: 0,
  carAllow: 0,
  ratioPercent: 0.5,
  incThreshold: null,
  incPerStudent: null,
};

describe("contractTermDiff — 카드에서 '실제로 바뀐' 조건만 계약에 반영", () => {
  it("위탁비율을 50% → 40% 로 바꾸면 그 항목만 반영", () => {
    const { data, changed } = contractTermDiff({ ...emp, ratioPercent: 0.4 }, emp);
    expect(changed).toEqual(["ratioPercent"]);
    expect(data).toEqual({ ratioPercent: 0.4 });
  });

  it("전화번호만 고쳐 폼이 전체 필드를 보내도 보수조건은 건드리지 않는다", () => {
    // 미래 계약 조건이 카드에 선반영된 상태에서 이게 깨지면 발효 전 임금이 새어 나간다
    const { data, changed } = contractTermDiff({ ...emp, phone: "010-9999-8888" }, emp);
    expect(changed).toEqual([]);
    expect(data).toEqual({});
  });

  it("급여형태가 바뀌면 계약서 서식(templateKey)도 함께 바꾼다", () => {
    const { data, changed } = contractTermDiff({ ...emp, payScheme: "MONTHLY" }, emp);
    expect(changed).toContain("payScheme");
    expect(data.templateKey).toBe("MONTHLY");
  });

  it("요청에 없는 필드는 무시한다 (부분 수정 안전)", () => {
    const { changed } = contractTermDiff({ phone: "010-0000-0000" }, emp);
    expect(changed).toEqual([]);
  });

  it("값을 비우면 null 로 반영", () => {
    const { data, changed } = contractTermDiff({ ...emp, ratioPercent: null }, emp);
    expect(changed).toEqual(["ratioPercent"]);
    expect(data).toEqual({ ratioPercent: null });
  });

  it("null 과 undefined 는 같은 값으로 본다", () => {
    const { changed } = contractTermDiff({ ...emp, incThreshold: undefined }, emp);
    expect(changed).toEqual([]);
  });

  it("여러 항목을 동시에 바꾸면 모두 반영", () => {
    const { changed } = contractTermDiff(
      { ...emp, baseWage: 3_000_000, mealAllow: 200_000 },
      emp
    );
    expect(changed.sort()).toEqual(["baseWage", "mealAllow"]);
  });
});

describe("termMismatches — 카드와 진행 중 계약의 차이", () => {
  it("계약서가 옛 비율(50%)을 들고 있으면 잡아낸다", () => {
    const card = { ...emp, ratioPercent: 0.4 };
    const contract = { ...emp, ratioPercent: 0.5 };
    expect(termMismatches(card, contract)).toEqual(["ratioPercent"]);
  });

  it("일치하면 빈 배열", () => {
    expect(termMismatches(emp, { ...emp })).toEqual([]);
  });

  it("계약이 없으면 경고하지 않는다", () => {
    expect(termMismatches(emp, null)).toEqual([]);
  });
});

describe("templateKeyOf", () => {
  it("급여형태 → 계약서 서식", () => {
    expect(templateKeyOf("RATIO")).toBe("RATIO");
    expect(templateKeyOf("HOURLY")).toBe("HOURLY");
    expect(templateKeyOf("INCENTIVE")).toBe("INCENTIVE");
    expect(templateKeyOf("MONTHLY")).toBe("MONTHLY");
    expect(templateKeyOf("알수없음")).toBe("MONTHLY");
  });
});
