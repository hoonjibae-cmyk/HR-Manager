import { describe, it, expect } from "vitest";
import { leaveBalanceText, modalPeriod } from "./leave-slack";
import { summarizeLeave, summarizeComp, type LeaveTxn } from "./leave";

const d = (s: string) => new Date(s + "T00:00:00Z");

describe("leaveBalanceText — 직원에게 보여줄 연차 현황", () => {
  const hire = d("2021-01-01");
  const asOf = d("2026-07-26");
  const txns: LeaveTxn[] = [
    { date: d("2025-05-02"), days: 3, type: "USE" }, // 지난 기간
    { date: d("2026-03-10"), days: 2, type: "USE" }, // 이번 기간
  ];

  const s = summarizeLeave(hire, asOf, txns);
  const text = leaveBalanceText("배지훈", s, summarizeComp(txns, asOf));

  it("이번 연차기간의 발생·사용·잔여를 앞세운다", () => {
    expect(text).toContain("*이번 연차기간* 2026.01.01 ~ 2026.12.31 · 6년차");
    expect(text).toContain("발생 17 · 사용 2 · *잔여 15일*");
  });

  it("사용기한과 다음 발생일을 안내한다", () => {
    expect(text).toContain("사용기한 2026.12.31");
    expect(text).toContain("다음 발생 2027.01.01 (17일)");
  });

  it("입사 후 누계(발생 90 · 소멸분)는 직원 화면에 노출하지 않는다", () => {
    expect(text).not.toContain("90");
    expect(text).not.toContain("누계");
    expect(text).not.toContain("소멸분");
  });

  it("대휴 잔여가 없으면 대휴 줄을 넣지 않는다", () => {
    expect(text).not.toContain("대휴보상연차");
  });

  it("대휴가 있으면 별도 줄로 표기", () => {
    const comp: LeaveTxn[] = [
      { date: d("2026-02-01"), days: 2, type: "GRANT", category: "COMP" },
    ];
    const t = leaveBalanceText(
      "배지훈",
      summarizeLeave(hire, asOf, comp),
      summarizeComp(comp, asOf)
    );
    expect(t).toContain("대휴보상연차: 발생 2 · 사용 0 · *잔여 2일*");
  });

  it("1년 미만 직원은 앞으로 발생할 일수를 함께 안내", () => {
    const t = leaveBalanceText(
      "신입",
      summarizeLeave(d("2026-03-01"), asOf, []),
      summarizeComp([], asOf)
    );
    expect(t).toContain("발생 4 · 사용 0 · *잔여 4일*");
    expect(t).toContain("앞으로 7일 더 발생 예정");
  });
});

describe("modalPeriod — 모달 헤더용 요약", () => {
  it("이월분은 발생에 합산해 보여준다", () => {
    const txns: LeaveTxn[] = [{ date: d("2025-07-01"), days: 3, type: "ADJUST" }];
    const p = modalPeriod(summarizeLeave(d("2021-01-01"), d("2026-03-01"), txns));
    expect(p).toEqual({ start: "2026.01.01", end: "2026.12.31", granted: 20, used: 0 });
  });
});
