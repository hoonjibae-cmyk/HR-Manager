import { describe, it, expect } from "vitest";
import { leaveBalanceText, modalPeriod, leaveBlockNotice } from "./leave-slack";
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

describe("연차 미적용 직원이 슬랙에서 보는 안내", () => {
  const hire = d("2024-03-01");
  const asOf = d("2026-07-27");
  const off = summarizeLeave(hire, asOf, [], { eligible: false });
  const noComp = summarizeComp([], asOf);

  const byHours = { eligible: false, weeklyHours: 13.5, forcedOff: false };
  const byContract = { eligible: false, weeklyHours: 40, forcedOff: true };

  it("주 15시간 미만이면 실제 시간과 법 근거를 함께 알려준다", () => {
    const t = leaveBalanceText("서지안", off, noComp, byHours);
    expect(t).toContain("1주 소정근로시간이 13.5시간(15시간 미만)");
    expect(t).toContain("근로기준법 제18조 제3항");
    expect(t).toContain("관리자에게 문의");
    // 없는 연차를 있는 것처럼 말하지 않는다
    expect(t).not.toContain("잔여 0일");
    expect(t).not.toContain("사용기한");
  });

  it("계약상 미적용이면 근로시간을 근거로 대지 않는다", () => {
    const t = leaveBalanceText("홍길동", off, noComp, byContract);
    expect(t).toContain("계약상 연차휴가가 적용되지 않는 근무형태");
    expect(t).not.toContain("15시간");
  });

  it("관리자가 부여한 잔여가 있으면 그 일수와 신청 방법을 알려준다", () => {
    const granted = summarizeLeave(hire, asOf, [{ date: d("2026-05-01"), days: 3, type: "ADJUST" }], {
      eligible: false,
    });
    const t = leaveBalanceText("서지안", granted, noComp, byHours);
    expect(t).toContain("관리자가 따로 부여한 연차 잔여 *3일*");
    expect(t).toContain("`/연차 신청`");
  });

  it("적용 대상이면 종전 문구 그대로", () => {
    const on = summarizeLeave(hire, asOf, []);
    const t = leaveBalanceText("김지연", on, noComp, { eligible: true, weeklyHours: 32.5, forcedOff: false });
    expect(t).toContain("*이번 연차기간*");
    expect(t).not.toContain("근로기준법 제18조");
  });
});

describe("leaveBlockNotice — 신청을 막을지 판단", () => {
  const hire = d("2024-03-01");
  const asOf = d("2026-07-27");
  const e = { eligible: false, weeklyHours: 9, forcedOff: false };

  it("적용 대상은 막지 않는다", () => {
    const on = summarizeLeave(hire, asOf, []);
    expect(leaveBlockNotice(on, summarizeComp([], asOf), { ...e, eligible: true })).toBeNull();
  });

  it("미적용이고 쓸 잔여도 없으면 사유와 함께 막는다", () => {
    const off = summarizeLeave(hire, asOf, [], { eligible: false });
    const msg = leaveBlockNotice(off, summarizeComp([], asOf), e);
    expect(msg).toContain("1주 소정근로시간이 9.0시간");
    expect(msg).toContain("신청할 수 있는 연차·대휴가 없습니다");
  });

  it("관리자 부여분이나 대휴가 남아 있으면 신청을 막지 않는다", () => {
    const granted = summarizeLeave(hire, asOf, [{ date: d("2026-05-01"), days: 2, type: "ADJUST" }], {
      eligible: false,
    });
    expect(leaveBlockNotice(granted, summarizeComp([], asOf), e)).toBeNull();

    const off = summarizeLeave(hire, asOf, [], { eligible: false });
    const withComp = summarizeComp(
      [{ date: d("2026-06-01"), days: 1, type: "GRANT", category: "COMP" }],
      asOf
    );
    expect(leaveBlockNotice(off, withComp, e)).toBeNull();
  });
});
