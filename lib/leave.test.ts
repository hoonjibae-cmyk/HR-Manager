import { describe, it, expect } from "vitest";
import {
  annualLeaveDays,
  completedServiceYears,
  generateGrants,
  summarizeLeave,
  summarizeComp,
  usedInPeriod,
  countLeaveDays,
  isLeaveEligible,
  type LeaveTxn,
} from "./leave";

const d = (s: string) => new Date(s + "T00:00:00Z");

describe("annualLeaveDays — 근로기준법 제60조 발생표", () => {
  it("근속연수별 발생일수", () => {
    expect(annualLeaveDays(0)).toBe(0); // 1년 미만은 월단위(별도)
    expect(annualLeaveDays(1)).toBe(15);
    expect(annualLeaveDays(2)).toBe(15);
    expect(annualLeaveDays(3)).toBe(16);
    expect(annualLeaveDays(4)).toBe(16);
    expect(annualLeaveDays(5)).toBe(17);
    expect(annualLeaveDays(10)).toBe(19);
    expect(annualLeaveDays(15)).toBe(22);
    expect(annualLeaveDays(21)).toBe(25);
    expect(annualLeaveDays(30)).toBe(25); // 상한 25
  });
});

describe("completedServiceYears", () => {
  it("입사기념일 경과 수", () => {
    expect(completedServiceYears(d("2020-03-01"), d("2020-06-01"))).toBe(0);
    expect(completedServiceYears(d("2020-03-01"), d("2021-03-01"))).toBe(1);
    expect(completedServiceYears(d("2020-03-01"), d("2023-05-01"))).toBe(3);
  });
});

describe("generateGrants — 1년 미만 월차", () => {
  it("6개월 근무 시 5회 발생(1~5개월차)", () => {
    // 3/1 입사, 8/15 기준 → 4/1,5/1,6/1,7/1,8/1 = 5일
    const lots = generateGrants(d("2025-03-01"), d("2025-08-15"));
    const monthly = lots.filter((l) => l.source === "MONTHLY");
    expect(monthly.length).toBe(5);
    expect(monthly.every((l) => l.days === 1)).toBe(true);
  });

  it("1년 미만 월차는 최대 11일", () => {
    const lots = generateGrants(d("2025-03-01"), d("2026-02-28"));
    const monthly = lots.filter((l) => l.source === "MONTHLY");
    expect(monthly.length).toBe(11);
  });

  it("1년 시점에 15일 연차 발생", () => {
    const lots = generateGrants(d("2025-03-01"), d("2026-03-02"));
    const annual = lots.filter((l) => l.source === "ANNUAL");
    expect(annual.length).toBe(1);
    expect(annual[0].days).toBe(15);
  });
});

describe("summarizeLeave — 발생/사용/잔여/소멸", () => {
  it("신입: 5개월차, 1일 사용 → 잔여 4일", () => {
    const txns: LeaveTxn[] = [
      { date: d("2025-07-10"), days: -1, type: "USE" },
    ];
    const s = summarizeLeave(d("2025-03-01"), d("2025-08-15"), txns);
    expect(s.granted).toBe(5);
    expect(s.used).toBe(1);
    expect(s.remaining).toBe(4);
  });

  it("3년차 직원의 누적 발생/잔여", () => {
    // 2022-03-01 입사, 2025-06-01 기준
    // 발생: 월차 11(1년내) + 1년차15 + 2년차15 + 3년차16 = 57
    const s = summarizeLeave(d("2022-03-01"), d("2025-06-01"), []);
    expect(s.granted).toBe(11 + 15 + 15 + 16);
    expect(s.serviceYears).toBe(3);
  });

  it("소멸: 만료된 lot 의 미사용분은 remaining 에서 빠진다", () => {
    // 2022-03-01 입사, 2024-06-01 기준.
    // 월차 11일은 2023-03-01 소멸, 1년차 15일은 2024-03-01 소멸.
    const s = summarizeLeave(d("2022-03-01"), d("2024-06-01"), []);
    // 발생 = 11 + 15(1년) + 15(2년) = 41, 소멸 = 11 + 15 = 26, 잔여 = 15(2년차분)
    expect(s.granted).toBe(41);
    expect(s.expired).toBe(26);
    expect(s.remaining).toBe(15);
  });

  it("FIFO: 사용은 오래된 연차부터 차감", () => {
    // 2023-03-01 입사, 2024-05-01 기준. 월차11 + 1년차15 = 26 발생.
    // 2024-04-10 에 3일 사용 → 월차(2023 발생, 2024-03-01 소멸) 는 이미 만료.
    // 따라서 1년차 연차에서 3일 차감.
    const txns: LeaveTxn[] = [{ date: d("2024-04-10"), days: -3, type: "USE" }];
    const s = summarizeLeave(d("2023-03-01"), d("2024-05-01"), txns);
    expect(s.used).toBe(3);
    // 월차 11일 소멸, 1년차 15일 중 3일 사용 → 잔여 12
    expect(s.remaining).toBe(12);
    expect(s.expired).toBe(11);
  });

  it("다음 발생 예정 안내", () => {
    const s = summarizeLeave(d("2022-03-01"), d("2025-06-01"), []);
    expect(s.nextGrantDate?.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(s.nextGrantDays).toBe(annualLeaveDays(4)); // 16
  });
});

describe("대휴보상연차 (COMP) — 본래 연차와 분리 집계", () => {
  it("summarizeComp: 부여/사용/음수조정 집계", () => {
    const txns: LeaveTxn[] = [
      { date: d("2026-05-06"), days: 1, type: "GRANT", category: "COMP", note: "5/5 근무" },
      { date: d("2026-06-07"), days: 1, type: "GRANT", category: "COMP", note: "6/6 근무" },
      { date: d("2026-06-20"), days: -1, type: "USE", category: "COMP" },
      { date: d("2026-07-01"), days: -0.5, type: "ADJUST", category: "COMP", note: "정정" },
    ];
    const c = summarizeComp(txns);
    expect(c.granted).toBe(1.5); // 1 + 1 - 0.5(조정)
    expect(c.used).toBe(1);
    expect(c.remaining).toBe(0.5);
  });

  it("summarizeLeave 는 COMP 트랜잭션을 무시한다 (본래 연차 오염 방지)", () => {
    const txns: LeaveTxn[] = [
      { date: d("2026-05-06"), days: 2, type: "GRANT", category: "COMP" },
      { date: d("2026-06-20"), days: -2, type: "USE", category: "COMP" },
      { date: d("2026-04-10"), days: -1, type: "USE" }, // 본래 연차 사용
    ];
    // 2024-03-01 입사, 2026-06-30 기준: 월차11 + 1년차15 + 2년차15 = 41 발생
    const s = summarizeLeave(d("2024-03-01"), d("2026-06-30"), txns);
    expect(s.used).toBe(1); // COMP 사용 2일은 제외
    expect(s.granted).toBe(41);
  });

  it("usedInPeriod: 기간 내 사용을 연차/대휴로 구분", () => {
    const txns: LeaveTxn[] = [
      { date: d("2026-03-10"), days: -1, type: "USE" },
      { date: d("2026-05-10"), days: -2, type: "USE" },
      { date: d("2026-05-15"), days: -1, type: "USE", category: "COMP" },
      { date: d("2026-09-01"), days: -1, type: "USE" }, // 기간 밖
      { date: d("2026-05-01"), days: 3, type: "GRANT", category: "COMP" }, // 부여는 미집계
    ];
    const p = usedInPeriod(txns, d("2026-04-01"), d("2026-06-30"));
    expect(p.statutory).toBe(2);
    expect(p.comp).toBe(1);
  });
});

describe("countLeaveDays", () => {
  it("주말 제외 근무일수", () => {
    // 2025-08-11(월) ~ 2025-08-15(금) = 5일 (단 8/15 광복절 공휴일 제외 시 4일)
    expect(countLeaveDays(d("2025-08-11"), d("2025-08-15"))).toBe(5);
    expect(
      countLeaveDays(d("2025-08-11"), d("2025-08-15"), {
        holidays: [d("2025-08-15")],
      })
    ).toBe(4);
  });
  it("반차는 0.5", () => {
    expect(countLeaveDays(d("2025-08-11"), d("2025-08-11"), { half: true })).toBe(0.5);
  });
});

describe("period — 이번 연차기간 기준 현황", () => {
  it("장기근속자: 누계가 아니라 이번 기간 발생분만 보여준다", () => {
    // 2021-01-01 입사 → 2026-07-26 기준 = 6년차 (2026-01-01 ~ 2026-12-31), 발생 17일
    const s = summarizeLeave(d("2021-01-01"), d("2026-07-26"), []);
    expect(s.granted).toBe(90); // 누계 11+15+15+16+16+17
    expect(s.period.serviceYear).toBe(6);
    expect(s.period.start.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(s.period.end.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(s.period.granted).toBe(17);
    expect(s.period.used).toBe(0);
    expect(s.period.remaining).toBe(17);
    expect(s.period.carriedOver).toBe(0);
  });

  it("이번 기간 사용분만 집계 (지난 기간 사용은 제외)", () => {
    const txns: LeaveTxn[] = [
      { date: d("2025-05-02"), days: 3, type: "USE" }, // 5년차 기간
      { date: d("2026-03-10"), days: 2, type: "USE" }, // 이번 기간
      { date: d("2026-09-01"), days: 1, type: "USE" }, // 이번 기간(승인된 미래 휴가)
    ];
    const s = summarizeLeave(d("2021-01-01"), d("2026-07-26"), txns);
    expect(s.used).toBe(6); // 누계
    expect(s.period.used).toBe(3); // 이번 기간만
    expect(s.period.granted).toBe(17);
    expect(s.period.remaining).toBe(14);
  });

  it("발생 − 사용 = 잔여 가 이번 기간 안에서 맞아떨어진다", () => {
    const txns: LeaveTxn[] = [{ date: d("2026-04-01"), days: 4.5, type: "USE" }];
    const s = summarizeLeave(d("2021-01-01"), d("2026-07-26"), txns);
    expect(s.period.granted + s.period.carriedOver - s.period.used).toBe(s.period.remaining);
  });

  it("입사 1년 미만: 기간은 입사일~1주년, 월 개근분과 남은 예정분", () => {
    // 2026-03-01 입사, 2026-07-26 기준 → 4/1,5/1,6/1,7/1 = 4일 발생
    const s = summarizeLeave(d("2026-03-01"), d("2026-07-26"), []);
    expect(s.period.serviceYear).toBe(1);
    expect(s.period.start.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(s.period.end.toISOString().slice(0, 10)).toBe("2027-02-28");
    expect(s.period.granted).toBe(4);
    expect(s.period.scheduled).toBe(7); // 최대 11일까지 7일 더
    expect(s.period.remaining).toBe(4);
  });

  it("입사기념일 직후에는 이전 기간 미사용분이 소멸되어 잔여가 새 발생분과 같다", () => {
    const txns: LeaveTxn[] = [{ date: d("2025-06-01"), days: 2, type: "USE" }];
    const s = summarizeLeave(d("2021-01-01"), d("2026-01-02"), txns);
    expect(s.period.granted).toBe(17);
    expect(s.period.used).toBe(0);
    expect(s.period.remaining).toBe(17);
    expect(s.expired).toBeGreaterThan(0); // 지난 기간 미사용분은 소멸
  });

  it("수동 조정(ADJUST)으로 넘어온 잔여는 이월로 잡힌다", () => {
    // 2025-07-01 조정 +3일 → 2026-06-30 까지 유효, 이번 기간(2026-01-01~) 으로 이월
    const txns: LeaveTxn[] = [{ date: d("2025-07-01"), days: 3, type: "ADJUST" }];
    const s = summarizeLeave(d("2021-01-01"), d("2026-03-01"), txns);
    expect(s.period.granted).toBe(17);
    expect(s.period.carriedOver).toBe(3);
    expect(s.period.remaining).toBe(20);
  });
});

describe("발생분이 없는데 사용한 경우 — 사용 내역이 사라지면 안 된다", () => {
  // 입사 한 달이 안 돼 발생(lot)이 하나도 없는 상태에서 미리 쓴 경우.
  // 예전에는 배분할 lot 이 없어 사용분이 통째로 버려졌다.
  const hire = d("2026-06-29");
  const asOf = d("2026-07-27");
  const txns: LeaveTxn[] = [
    { date: d("2026-07-10"), days: -1, type: "USE" },
    { date: d("2026-07-20"), days: -1, type: "USE" },
  ];

  it("사용 누계와 잔여에 반영된다", () => {
    const s = summarizeLeave(hire, asOf, txns);
    expect(s.granted).toBe(0);
    expect(s.used).toBe(2);
    expect(s.remaining).toBe(-2);
  });

  it("이번 연차기간 집계에도 잡힌다", () => {
    const s = summarizeLeave(hire, asOf, txns);
    expect(s.period.used).toBe(2);
    expect(s.period.granted).toBe(0);
  });

  it("발생이 생긴 뒤에는 종전대로 lot 에서 차감한다", () => {
    // 입사 1개월 경과 → 개근 1일 발생
    const s = summarizeLeave(hire, d("2026-08-05"), txns);
    expect(s.granted).toBe(1);
    expect(s.used).toBe(2);
    expect(s.remaining).toBe(-1);
  });
});

describe("연차 발생 대상 판정 — 근로기준법 §18③ 초단시간근로자", () => {
  it("주 15시간 미만은 미적용, 15시간 이상은 적용", () => {
    expect(isLeaveEligible(9)).toBe(false);
    expect(isLeaveEligible(14.9)).toBe(false);
    expect(isLeaveEligible(15)).toBe(true);
    expect(isLeaveEligible(32.5)).toBe(true);
  });

  it("계약상 별도로 정했으면 근로시간과 무관하게 그 값을 따른다", () => {
    expect(isLeaveEligible(9, true)).toBe(true); // 주 9시간이어도 계약상 적용
    expect(isLeaveEligible(40, false)).toBe(false); // 주 40시간이어도 계약상 미적용
    expect(isLeaveEligible(40, null)).toBe(true); // null = 자동
  });
});

describe("summarizeLeave — 미적용 직원", () => {
  const hire = d("2023-03-01");
  const asOf = d("2026-07-27");

  it("법정 발생분이 하나도 생기지 않는다", () => {
    const s = summarizeLeave(hire, asOf, [], { eligible: false });
    expect(s.eligible).toBe(false);
    expect(s.granted).toBe(0);
    expect(s.remaining).toBe(0);
    expect(s.period.granted).toBe(0);
    expect(s.nextGrantDate).toBeNull();
    expect(s.period.scheduled).toBe(0);
  });

  it("같은 조건이라도 적용 대상이면 발생한다", () => {
    const s = summarizeLeave(hire, asOf, []);
    expect(s.eligible).toBe(true);
    expect(s.granted).toBeGreaterThan(0);
  });

  it("관리자가 직접 부여한 분은 미적용이어도 살아 있다", () => {
    const txns: LeaveTxn[] = [
      { date: d("2026-03-01"), days: 3, type: "ADJUST", note: "계약상 약정휴가" },
      { date: d("2026-04-10"), days: -1, type: "USE" },
    ];
    const s = summarizeLeave(hire, asOf, txns, { eligible: false });
    expect(s.granted).toBe(3);
    expect(s.used).toBe(1);
    expect(s.remaining).toBe(2);
  });

  it("미적용인데 사용만 있으면 마이너스로 드러난다", () => {
    const txns: LeaveTxn[] = [{ date: d("2026-04-10"), days: -2, type: "USE" }];
    const s = summarizeLeave(hire, asOf, txns, { eligible: false });
    expect(s.granted).toBe(0);
    expect(s.used).toBe(2);
    expect(s.remaining).toBe(-2);
  });
});
