import { describe, it, expect } from "vitest";
import { addYears } from "date-fns";
import {
  annualLeaveDays,
  completedServiceYears,
  currentLeavePeriod,
  generateGrants,
  summarizeLeave,
  summarizeComp,
  usedInPeriod,
  countLeaveDays,
  businessDaysFrom,
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

describe("businessDaysFrom — 시작일부터 N 업무일", () => {
  it("주말을 건너뛰고 평일만 센다", () => {
    // 2026-07-31(금) 부터 3일 → 금, 월, 화
    const days = businessDaysFrom(d("2026-07-31"), 3);
    expect(days.map((x) => x.toISOString().slice(0, 10))).toEqual([
      "2026-07-31",
      "2026-08-03",
      "2026-08-04",
    ]);
  });

  it("공휴일도 건너뛴다", () => {
    const days = businessDaysFrom(d("2026-08-03"), 3, { holidays: [d("2026-08-04")] });
    expect(days.map((x) => x.toISOString().slice(0, 10))).toEqual([
      "2026-08-03",
      "2026-08-05",
      "2026-08-06",
    ]);
  });

  it("시작일이 주말이면 다음 근무일부터 채운다", () => {
    const days = businessDaysFrom(d("2026-08-01"), 2); // 토
    expect(days.map((x) => x.toISOString().slice(0, 10))).toEqual(["2026-08-03", "2026-08-04"]);
  });

  it("1일이면 그날 하루만", () => {
    expect(businessDaysFrom(d("2026-08-03"), 1)).toHaveLength(1);
  });

  it("0 이하면 빈 목록", () => {
    expect(businessDaysFrom(d("2026-08-03"), 0)).toEqual([]);
    expect(businessDaysFrom(d("2026-08-03"), -1)).toEqual([]);
  });
});

describe("지난 연차기간 날짜의 사용 — 이번 기간 잔여에 닿지 않는다", () => {
  // 실제 겪은 혼동: 운영자가 '전년도 초과 사용 연차' 를 지난 기간 마지막 날(4/30) 날짜로
  // 넣었는데 이번 기간 잔여(연차수당 상세 포함)가 그대로였다. 그 사용은 그 날짜에 유효했던
  // 지난 기간 발생분이 흡수하고, 그 잔여는 어차피 기간 만료로 소멸 처리되기 때문 — 버그가
  // 아니라 원장 규칙이다. 그래서 /api/leave/adjust 가 이 경우 경고를 띄운다.
  it("지난 기간 발생분에 잔여가 있으면 그쪽이 흡수한다 — 이번 기간 잔여 불변", () => {
    // 입사 2024-05-01, 기준 2026-08-31 → 이번 기간 2026-05-01~. 지난 기간(3년차 15일) 미사용.
    const base = summarizeLeave(d("2024-05-01"), d("2026-08-31"), []);
    const withPast = summarizeLeave(d("2024-05-01"), d("2026-08-31"), [
      { date: d("2026-04-30"), days: -1.5, type: "USE" },
    ]);
    expect(withPast.period.remaining).toBe(base.period.remaining);
    // 사라진 것이 아니라 소멸분이 그만큼 줄었을 뿐이다
    expect(withPast.expired).toBe(base.expired - 1.5);
  });

  it("지난 기간 발생분을 다 썼으면 초과분은 그 뒤에 발생한 연차(여기서는 이번 기간)에서 깎인다 (진짜 '초과 사용')", () => {
    // 지난 기간 15일을 이미 다 쓴 상태에서 4/30 에 1.5일을 더 쓰면 이번 기간에서 나간다
    const txns = [
      { date: d("2025-06-02"), days: -15, type: "USE" as const },
      { date: d("2026-04-30"), days: -1.5, type: "USE" as const },
    ];
    const s = summarizeLeave(d("2024-05-01"), d("2026-08-31"), txns);
    const clean = summarizeLeave(d("2024-05-01"), d("2026-08-31"), [
      { date: d("2025-06-02"), days: -15, type: "USE" },
    ]);
    expect(s.period.remaining).toBe(clean.period.remaining - 1.5);
  });

  it("이번 기간 날짜로 넣으면 잔여가 그대로 준다 (퇴사일 이후 날짜여도)", () => {
    const base = summarizeLeave(d("2024-05-01"), d("2026-08-31"), []);
    const s = summarizeLeave(d("2024-05-01"), d("2026-08-31"), [
      { date: d("2026-07-10"), days: -1.5, type: "USE" },
    ]);
    expect(s.period.remaining).toBe(base.period.remaining - 1.5);
  });
});

describe("다음 연차기간 날짜로 미리 승인해 둔 휴가 — 이번 기간 잔여에서 빠지지 않는다", () => {
  // 2026-11 박영은: 입사 2021-11-02 → 2025-11-02 에 16일 발생(사용기한 2026-11-01), 2026-11-02 에 17일.
  // 10월에 11/5 연차를 미리 승인하면 그 날짜에 유효한 lot 이 아직 없어 예전엔 '초과사용' 으로
  // 흘러 이번 기간 마지막 lot 에서 빠졌다 — 11/1 기준 잔여가 5일이 아니라 2일로 보였고,
  // 연차수당 상세(기간 만료 정산)가 그 잔여를 읽어 미사용 3일이 조용히 사라졌다.
  const hire = d("2021-11-02");
  const txns: LeaveTxn[] = [
    { date: d("2026-05-04"), days: 11, type: "USE" },
    { date: d("2026-11-05"), days: 3, type: "USE" }, // 다음 기간 날짜 (10월에 승인)
  ];

  it("**기간 마지막 날 기준 잔여는 5일 그대로** — 누계 사용에도 아직 들어가지 않는다", () => {
    const s = summarizeLeave(hire, new Date("2026-11-01T23:59:59Z"), txns);
    expect(s.period.start.toISOString().slice(0, 10)).toBe("2025-11-02");
    expect(s.period.end.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(s.period.used).toBe(11);
    expect(s.period.remaining).toBe(5);
    expect(s.used).toBe(11);
  });

  it("그 기간이 시작되면 새 lot 에서 차감되고 지난 기간 5일은 소멸로 남는다", () => {
    const s = summarizeLeave(hire, d("2026-11-06"), txns);
    expect(s.period.granted).toBe(17);
    expect(s.period.used).toBe(3);
    expect(s.period.remaining).toBe(14);
    const old = s.lots.find((l) => l.grantDate.getTime() === d("2025-11-02").getTime())!;
    expect(old.used).toBe(11);
    expect(old.expiredLost).toBe(5);
  });

  it("이번 기간 안의 미래 휴가는 종전대로 잔여에서 뺀다 (승인된 휴가는 이미 쓴 것으로 본다)", () => {
    const s = summarizeLeave(hire, d("2026-10-20"), [{ date: d("2026-10-28"), days: 2, type: "USE" }]);
    expect(s.period.used).toBe(2);
    expect(s.period.remaining).toBe(14);
  });

  it("1년 미만(월 개근분)도 같다 — 1주년 뒤 날짜의 휴가가 개근분 잔여를 깎지 않는다", () => {
    const s = summarizeLeave(d("2025-11-02"), new Date("2026-11-01T23:59:59Z"), [
      { date: d("2026-07-01"), days: 8, type: "USE" },
      { date: d("2026-11-09"), days: 3, type: "USE" },
    ]);
    expect(s.period.granted).toBe(11);
    expect(s.period.remaining).toBe(3);
  });
});

describe("이월(CARRYOVER) — 지난 기간 미사용분을 수당 대신 다음 기간으로 넘긴다", () => {
  // 입사 2021-11-02. 2025-11-02 발생 16일 중 11일 사용 → 2026-11-01 에 5일 만료.
  // 관리자가 이월 처리하면 다음 기간 첫날(2026-11-02) 날짜의 CARRYOVER 줄이 생긴다.
  const hire = d("2021-11-02");
  const txns: LeaveTxn[] = [
    { date: d("2026-05-04"), days: 11, type: "USE" },
    { date: d("2026-11-02"), days: 5, type: "CARRYOVER", note: "이월" },
  ];

  it("지난 기간 마지막 날 기준으로는 아직 없는 것 — 만료 잔여 5일이 그대로다 (연차수당 상세가 읽는 값)", () => {
    const s = summarizeLeave(hire, new Date("2026-11-01T23:59:59Z"), txns);
    expect(s.period.remaining).toBe(5);
    expect(s.lots.some((l) => l.source === "CARRYOVER")).toBe(false);
  });

  it("새 기간에서는 발생 17 + 이월 5 = 잔여 22 — 이월을 발생에 섞지 않는다", () => {
    const s = summarizeLeave(hire, d("2026-11-06"), txns);
    expect(s.period.granted).toBe(17);
    expect(s.period.carriedOver).toBe(5);
    expect(s.period.remaining).toBe(22);
    expect(s.period.granted + s.period.carriedOver - s.period.used).toBe(s.period.remaining);
  });

  it("**같은 날 만료된 lot 의 '소멸' 이 '이월' 로 바뀐다** — 발생 누계·소멸 누계도 두 번 세지 않는다", () => {
    const s = summarizeLeave(hire, d("2026-11-06"), txns);
    const old = s.lots.find((l) => l.grantDate.getTime() === d("2025-11-02").getTime())!;
    expect(old.expiredLost).toBe(0);
    expect(old.carriedOut).toBe(5);
    expect(s.expired).toBe(11 + 15 + 15 + 16); // 1년 미만 11 + 1~3년차 — 이월한 5일은 소멸이 아니다
    expect(s.granted).toBe(11 + 15 + 15 + 16 + 16 + 17); // 이월 5 는 발생이 아니다
  });

  it("이월분은 새 기간 발생분 다음에 쓰이고, 둘 다 다음 기념일에 함께 소멸한다 — 그때 만료 정산 대상", () => {
    const used = [...txns, { date: d("2027-03-02"), days: 10, type: "USE" as const }];
    const s = summarizeLeave(hire, new Date("2027-11-01T23:59:59Z"), used);
    expect(s.period.remaining).toBe(12); // 17 + 5 − 10
    const after = summarizeLeave(hire, d("2027-11-03"), used);
    expect(after.expired).toBe(11 + 15 + 15 + 16 + 12);
    expect(after.period.remaining).toBe(17);
  });

  it("실제로 만료된 일수보다 많이 이월해도(3일 남았는데 5일) 소멸은 0 이고 나머지는 이월로 더해진다", () => {
    const s = summarizeLeave(hire, d("2026-11-06"), [
      { date: d("2026-05-04"), days: 13, type: "USE" },
      { date: d("2026-11-02"), days: 5, type: "CARRYOVER" },
    ]);
    const old = s.lots.find((l) => l.grantDate.getTime() === d("2025-11-02").getTime())!;
    expect(old.expiredLost).toBe(0);
    expect(old.carriedOut).toBe(3);
    expect(s.period.carriedOver).toBe(5);
  });
});

describe("조정(ADJUST +) 의 발생일이 기준일 뒤면 아직 없는 것으로 본다 — 대휴(summarizeComp)와 같은 규칙", () => {
  it("미래 날짜의 부여는 그날이 와야 잔여에 든다", () => {
    const hire = d("2021-01-01");
    const future: LeaveTxn[] = [{ date: d("2026-09-01"), days: 3, type: "ADJUST" }];
    expect(summarizeLeave(hire, d("2026-07-26"), future).period.remaining).toBe(17);
    expect(summarizeLeave(hire, d("2026-09-01"), future).period.remaining).toBe(20);
  });
});

describe("초과사용(미리 쓴 연차)은 그 뒤에 발생하는 연차가 갚는다 — 기념일을 넘기며 두 번 깎이지 않는다", () => {
  // 2026-11 실제로 겪은 것(날짜·일수만 옮긴 가상 직원). 입사 2025-11-26 — 1년 미만 발생 11일에 사용 11.5일이라
  // 기념일 전날 잔여는 −0.5 다. 기념일(11/26)에 15일이 생기면 14.5 여야 하는데 **13.5** 로 나왔다.
  //  · 첫 발생(12/26) 전에 쓴 12/24 의 1일과 7/31 의 0.5일은 쓴 날 유효한 발생분이 없어 '초과사용' 이 된다.
  //  · 예전엔 그 초과분을 **계산 시점의 마지막 lot** 에 얹었다. 기념일 전에는 마지막 lot 이 10/26 발생분이라
  //    −0.5 로 맞았지만, 기념일에 새 15일이 생기자 초과분 1.5일이 통째로 그쪽으로 옮겨 붙고, 그것을 메우던
  //    10/26 발생분 1일은 '미사용 → 소멸' 이 됐다 — 하루가 두 번 빠졌다. 해가 바뀔 때마다 또 옮겨 붙으므로
  //    한 번 생긴 초과사용이 **해마다 다시** 깎였다.
  const hire = d("2025-11-26");
  const txns: LeaveTxn[] = [
    { date: d("2025-12-24"), days: -1, type: "USE" }, // 첫 발생(12/26) 전
    { date: d("2026-04-22"), days: -1, type: "USE" },
    { date: d("2026-04-27"), days: -1, type: "USE" },
    { date: d("2026-04-28"), days: -1, type: "USE" },
    { date: d("2026-05-22"), days: -1, type: "USE" },
    { date: d("2026-06-25"), days: -0.5, type: "USE" },
    { date: d("2026-06-29"), days: -1, type: "USE" },
    { date: d("2026-07-29"), days: -1, type: "USE" },
    { date: d("2026-07-30"), days: -1, type: "USE" },
    { date: d("2026-07-31"), days: -1, type: "USE" },
    { date: d("2026-10-13"), days: -2, type: "USE" },
  ];
  const lotOn = (s: ReturnType<typeof summarizeLeave>, day: string) =>
    s.lots.find((l) => l.grantDate.getTime() === d(day).getTime())!;

  it("기념일 전날 — 발생 11 − 사용 11.5 = −0.5 (아직 갚지 못한 초과사용 0.5)", () => {
    const s = summarizeLeave(hire, new Date("2026-11-25T23:59:59Z"), txns);
    expect(s.period.granted).toBe(11);
    expect(s.period.used).toBe(11.5);
    expect(s.period.remaining).toBe(-0.5);
    expect(s.overdrawn).toBe(0.5);
    expect(s.expired).toBe(0);
  });

  it("**기념일 뒤 — 15 − 0.5 = 14.5** (13.5 가 아니다). 소멸된 것도 없다", () => {
    for (const at of ["2026-11-26", "2026-11-27", "2027-03-02"]) {
      const s = summarizeLeave(hire, d(at), txns);
      expect(s.period.label).toBe("2년차");
      expect(s.period.granted).toBe(15);
      expect(s.period.used).toBe(0);
      expect(s.period.remaining).toBe(14.5);
      expect(s.remaining).toBe(14.5);
      expect(s.expired).toBe(0);
      expect(s.overdrawn).toBe(0);
    }
  });

  it("화면의 셈이 맞아떨어진다 — 발생 15 − 지난 기간 초과사용 0.5 − 사용 0 = 잔여 14.5", () => {
    const p = summarizeLeave(hire, d("2026-11-27"), txns).period;
    expect(p.priorOverdraft).toBe(0.5);
    expect(p.granted + p.carriedOver - p.priorOverdraft - p.used).toBe(p.remaining);
  });

  it("미리 쓴 몫은 그 뒤 발생분이 **발생 순서대로** 갚는다 — lot 이 마이너스가 되지 않는다", () => {
    const s = summarizeLeave(hire, d("2026-11-27"), txns);
    expect(s.lots.every((l) => l.remaining >= 0)).toBe(true);
    // 12/24 에 미리 쓴 1일은 이틀 뒤 생긴 12/26 발생분이 갚는다
    expect(lotOn(s, "2025-12-26")).toMatchObject({ used: 1, advanceUsed: 1, remaining: 0 });
    // 마지막 월 개근분(10/26)은 10/13 사용분이 가져간다 — 예전엔 '미사용 → 소멸 1' 로 남았다
    expect(lotOn(s, "2026-10-26")).toMatchObject({ used: 1, advanceUsed: 1, expiredLost: 0 });
    // 그래도 남은 0.5일만 새 15일에서 빠진다
    expect(lotOn(s, "2026-11-26")).toMatchObject({ days: 15, used: 0.5, advanceUsed: 0.5, remaining: 14.5 });
    // 발생 = 사용 + 잔여 + 소멸 + 이월 이 lot 마다 맞는다
    for (const l of s.lots) expect(l.used + l.remaining + l.expiredLost + l.carriedOut).toBe(l.days);
  });

  it("기념일을 넘겨도 지난 배분이 바뀌지 않는다 — 기념일 전에 쓴 것으로 잡힌 lot 은 그대로다", () => {
    const before = summarizeLeave(hire, new Date("2026-11-25T23:59:59Z"), txns);
    const after = summarizeLeave(hire, d("2026-11-27"), txns);
    before.lots.forEach((l, i) => {
      expect(after.lots[i].grantDate.getTime()).toBe(l.grantDate.getTime());
      expect(after.lots[i].used).toBe(l.used);
    });
    // 기념일 전의 '아직 못 갚은 0.5' 가 새 발생분으로 넘어갔을 뿐이다
    expect(after.remaining).toBe(15 + before.remaining);
  });

  it("**다음 해에 또 깎이지 않는다** — 2년차를 한 번도 안 써도 3년차는 15일 그대로", () => {
    const s = summarizeLeave(hire, d("2027-11-27"), txns);
    expect(s.period.label).toBe("3년차");
    expect(s.period.granted).toBe(15);
    expect(s.period.priorOverdraft).toBe(0);
    expect(s.period.remaining).toBe(15);
    // 2년차 15일 중 0.5일은 1년차 초과분이 가져갔고 나머지 14.5일이 소멸했다
    expect(lotOn(s, "2026-11-26")).toMatchObject({ used: 0.5, expiredLost: 14.5 });
    expect(s.expired).toBe(14.5);
  });

  it("기간 안에서도 같다 — 1년 미만은 달마다 발생분이 초과사용을 갚아 나간다", () => {
    expect(summarizeLeave(hire, d("2026-10-20"), txns).remaining).toBe(-1.5); // 발생 10 − 사용 11.5
    expect(summarizeLeave(hire, d("2026-10-27"), txns).remaining).toBe(-0.5); // 10/26 발생분이 1일을 갚았다
  });
});

describe("초과사용은 한 번만 갚는다 — 연 단위 발생분도 같다", () => {
  // 입사 2021-01-01. 5년차(2025) 16일인데 18일을 써 2일 초과 → 6년차(2026) 17일에서 2일이 먼저 빠진다.
  const hire = d("2021-01-01");
  const txns: LeaveTxn[] = [
    { date: d("2025-03-03"), days: -16, type: "USE" },
    { date: d("2025-09-01"), days: -2, type: "USE" }, // 초과 2일
    { date: d("2026-05-04"), days: -10, type: "USE" },
  ];

  it("초과한 다음 해 — 17 − 2(지난 기간 초과) − 10 = 5", () => {
    const s = summarizeLeave(hire, d("2026-12-01"), txns);
    expect(s.period.granted).toBe(17);
    expect(s.period.priorOverdraft).toBe(2);
    expect(s.period.used).toBe(10);
    expect(s.period.remaining).toBe(5);
  });

  it("**그 다음 해에는 흔적이 없다** — 예전엔 2일이 최신 발생분으로 또 옮겨 붙어 15일로 나왔다", () => {
    const s = summarizeLeave(hire, d("2027-03-01"), txns);
    expect(s.period.granted).toBe(17);
    expect(s.period.priorOverdraft).toBe(0);
    expect(s.period.remaining).toBe(17);
    const y2026 = s.lots.find((l) => l.grantDate.getTime() === d("2026-01-01").getTime())!;
    expect(y2026).toMatchObject({ used: 12, advanceUsed: 2, expiredLost: 5 });
  });

  it("초과분을 메우려고 관리자가 부여(ADJUST +)하면 그 부여분이 먼저 갚는다", () => {
    const s = summarizeLeave(hire, d("2025-12-01"), [
      ...txns.slice(0, 2),
      { date: d("2025-10-01"), days: 2, type: "ADJUST", note: "초과분 보전" },
    ]);
    expect(s.overdrawn).toBe(0);
    expect(s.period.remaining).toBe(0);
    // 다음 해 발생분은 온전하다
    const next = summarizeLeave(hire, d("2026-02-01"), [
      ...txns.slice(0, 2),
      { date: d("2025-10-01"), days: 2, type: "ADJUST", note: "초과분 보전" },
    ]);
    expect(next.period.priorOverdraft).toBe(0);
    expect(next.period.remaining).toBe(17);
  });

  it("갚을 발생분이 없으면 숨지 않고 마이너스로 남는다 — 미적용 직원의 지난 부여분이 이미 소멸한 경우", () => {
    // 예전엔 초과분을 '마지막 lot' 에 얹었는데 그 lot 이 이미 소멸한 것이면 잔여 계산에서 통째로 빠졌다(0 으로 보였다)
    const s = summarizeLeave(
      d("2023-03-01"),
      d("2026-07-27"),
      [
        { date: d("2024-01-10"), days: 3, type: "ADJUST", note: "약정휴가" }, // 2025-01-10 소멸
        { date: d("2025-06-02"), days: -1, type: "USE" },
      ],
      { eligible: false }
    );
    expect(s.remaining).toBe(-1);
    expect(s.overdrawn).toBe(1);
    expect(s.expired).toBe(3);
  });
});

describe("summarizeLeave — 시간순으로 한 줄씩 밟은 결과와 같다 (독립 구현과 대조)", () => {
  // 발생·사용을 날짜순으로 늘어놓고 '빚' 을 들고 다니는 단순한 구현. 발생분이 생기는 순간 빚부터 갚는다.
  function simulate(hire: Date, asOf: Date, txns: LeaveTxn[], eligible: boolean) {
    const period = currentLeavePeriod(hire, asOf);
    const lots = [
      ...(eligible ? generateGrants(hire, asOf) : []).map((l) => ({
        grant: l.grantDate.getTime(),
        expiry: l.expiryDate.getTime(),
        left: l.days,
      })),
      ...txns
        .filter((t) => t.type === "ADJUST" && t.days > 0 && t.date.getTime() <= asOf.getTime())
        .map((t) => ({ grant: t.date.getTime(), expiry: addYears(t.date, 1).getTime(), left: t.days })),
    ].sort((a, b) => a.grant - b.grant);
    let debt = 0;
    let used = 0;
    const events: { at: number; order: number; run: () => void }[] = [];
    for (const l of lots)
      events.push({
        at: l.grant,
        order: 0, // 같은 날이면 발생이 먼저
        run: () => {
          const pay = Math.min(debt, l.left);
          l.left -= pay;
          debt -= pay;
        },
      });
    for (const t of txns) {
      if (t.type !== "USE") continue;
      if (t.date.getTime() >= period.endExclusive.getTime()) continue; // 다음 기간 날짜의 사용은 아직 세지 않는다
      const at = t.date.getTime();
      events.push({
        at,
        order: 1,
        run: () => {
          let need = Math.abs(t.days);
          used += need;
          for (const l of lots) {
            if (need <= 0) break;
            if (l.grant > at || l.expiry <= at || l.left <= 0) continue;
            const take = Math.min(l.left, need);
            l.left -= take;
            need -= take;
          }
          debt += need;
        },
      });
    }
    events.sort((a, b) => a.at - b.at || a.order - b.order);
    for (const e of events) e.run();
    const alive = lots.filter((l) => l.expiry > asOf.getTime());
    return {
      remaining: alive.reduce((a, l) => a + l.left, 0) - debt,
      expired: lots.filter((l) => l.expiry <= asOf.getTime()).reduce((a, l) => a + l.left, 0),
      used,
      debt,
    };
  }

  // 결정적 난수 (mulberry32) — 실패하면 같은 사례가 다시 나와야 한다
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const DAY = 86400000;
  const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];

  function scenario(r: () => number, opts: { adjust: boolean; future: boolean }) {
    const hire = new Date(d("2019-01-01").getTime() + Math.floor(r() * 2500) * DAY);
    const span = Math.floor(r() * 1500);
    const asOf = new Date(hire.getTime() + span * DAY);
    const txns: LeaveTxn[] = [];
    const uses = Math.floor(r() * 15);
    for (let i = 0; i < uses; i++) {
      const off = Math.floor(r() * (span + (opts.future ? 90 : 1)));
      txns.push({ date: new Date(hire.getTime() + off * DAY), days: -pick(r, [0.5, 1, 1, 1, 2, 3]), type: "USE" });
    }
    if (opts.adjust) {
      const adj = Math.floor(r() * 3);
      for (let i = 0; i < adj; i++) {
        const off = Math.floor(r() * (span + (opts.future ? 60 : 1)));
        txns.push({ date: new Date(hire.getTime() + off * DAY), days: pick(r, [0.5, 1, 2, 3]), type: "ADJUST" });
      }
    }
    return { hire, asOf, txns, eligible: r() < 0.85 };
  }

  it("잔여·소멸·사용 누계·못 갚은 초과사용이 500가지 무작위 사례에서 모두 같다", () => {
    const r = rng(20261127);
    for (let n = 0; n < 500; n++) {
      const c = scenario(r, { adjust: true, future: true });
      const s = summarizeLeave(c.hire, c.asOf, c.txns, { eligible: c.eligible });
      const ref = simulate(c.hire, c.asOf, c.txns, c.eligible);
      const at = `#${n} 입사 ${c.hire.toISOString().slice(0, 10)} 기준 ${c.asOf.toISOString().slice(0, 10)}`;
      expect(s.remaining, at).toBe(ref.remaining);
      expect(s.expired, at).toBe(ref.expired);
      expect(s.used, at).toBe(ref.used);
      expect(s.overdrawn, at).toBe(ref.debt);
      // lot 은 마이너스가 되지 않고, 발생 = 사용 + 잔여 + 소멸(+이월) 이 lot 마다 맞는다
      for (const l of s.lots) {
        expect(l.remaining, at).toBeGreaterThanOrEqual(0);
        expect(l.used + l.remaining + l.expiredLost + l.carriedOut, at).toBe(l.days);
        expect(l.advanceUsed, at).toBeLessThanOrEqual(l.used);
      }
    }
  });

  it("법정 발생분만 있을 때는 이번 기간의 셈이 늘 맞는다 — 발생 − 지난 기간 초과사용 − 사용 = 잔여", () => {
    const r = rng(7);
    for (let n = 0; n < 300; n++) {
      const c = scenario(r, { adjust: false, future: true });
      const p = summarizeLeave(c.hire, c.asOf, c.txns).period;
      expect(p.carriedOver).toBe(0);
      expect(p.granted - p.priorOverdraft - p.used, `#${n}`).toBe(p.remaining);
    }
  });

  it("시간이 흘러 새 발생분이 생겨도 이미 배분된 사용은 움직이지 않는다", () => {
    const r = rng(42);
    for (let n = 0; n < 300; n++) {
      const c = scenario(r, { adjust: true, future: false });
      const later = new Date(c.asOf.getTime() + (1 + Math.floor(r() * 800)) * DAY);
      const a = summarizeLeave(c.hire, c.asOf, c.txns, { eligible: c.eligible });
      const b = summarizeLeave(c.hire, later, c.txns, { eligible: c.eligible });
      a.lots.forEach((l, i) => {
        expect(b.lots[i].grantDate.getTime(), `#${n}`).toBe(l.grantDate.getTime());
        expect(b.lots[i].used, `#${n} lot ${i}`).toBe(l.used);
      });
      // 못 갚고 있던 초과사용은 늘지 않는다 (새 발생분이 갚을 뿐이다)
      expect(b.overdrawn, `#${n}`).toBeLessThanOrEqual(a.overdrawn);
    }
  });
});
