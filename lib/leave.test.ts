import { describe, it, expect } from "vitest";
import {
  annualLeaveDays,
  completedServiceYears,
  generateGrants,
  summarizeLeave,
  summarizeComp,
  usedInPeriod,
  countLeaveDays,
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
