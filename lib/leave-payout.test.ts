// 연차기간이 끝나는 달의 미사용 연차수당 정산 제안.
//
// 연차기간 종료월은 **입사일에 따라 사람마다 다르다**. 급여 담당자가 매달 30명치 입사일을
// 헤아릴 수 없으니 시스템이 짚어 준다. 다만 **넣을지는 사람이 정한다**.

import { describe, it, expect } from "vitest";
import {
  payoutSuggestions,
  payoutAmount,
  payoutNotice,
  periodLastDay,
  inMonth,
  ymd,
  type PayoutInput,
} from "./leave-payout";
import { currentLeavePeriod } from "./leave";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const row = (over: Partial<PayoutInput> = {}): PayoutInput => ({
  employeeId: 1,
  name: "김서준",
  eligible: true,
  periodEnd: d("2026-08-31"),
  remaining: 5,
  alreadyDays: 0,
  hourlyWage: 20_000,
  dailyHours: 8,
  ...over,
});

describe("연차기간의 마지막 날", () => {
  // endExclusive 는 다음 기간의 첫날이다. 하루를 안 빼면 종료월이 한 달씩 밀린다.
  it("endExclusive 에서 하루를 뺀다", () => {
    expect(ymd(periodLastDay(d("2026-09-01")))).toBe("2026-08-31");
    expect(ymd(periodLastDay(d("2026-03-01")))).toBe("2026-02-28");
  });

  it("**입사일이 9/1 이면 종료월은 8월**이다 (9월이 아니다)", () => {
    const { endExclusive } = currentLeavePeriod(d("2024-09-01"), d("2026-08-15"));
    const last = periodLastDay(endExclusive);
    expect(ymd(last)).toBe("2026-08-31");
    expect(inMonth(last, 2026, 8)).toBe(true);
    expect(inMonth(last, 2026, 9)).toBe(false);
  });

  it("윤년 2월도 맞게 잡는다", () => {
    const { endExclusive } = currentLeavePeriod(d("2024-03-01"), d("2028-01-10"));
    expect(ymd(periodLastDay(endExclusive))).toBe("2028-02-29");
  });
});

describe("수당 금액 — 급여 엔진과 같은 식", () => {
  it("일수 × 통상시급 × 8시간", () => {
    expect(payoutAmount(5, 20_000)).toBe(800_000);
    expect(payoutAmount(0.5, 20_000)).toBe(80_000);
    expect(payoutAmount(3, 0)).toBe(0);
  });

  /*
   * 1일 소정근로가 8시간이 아닌 체계(14~22시 · 휴게 30분 = 7.5시간)에서는 하루치가
   * 통상시급 × 7.5 다. 8 로 곱하면 지급(+)은 부풀고 초과사용 정산(−)은 더 깎는다.
   */
  it("**1일 소정근로시간을 곱한다** — 7.5시간 체계는 × 7.5", () => {
    expect(payoutAmount(4, 13_014, 7.5)).toBe(390_420);
    expect(payoutAmount(4, 13_014)).toBe(416_448); // 옛 8시간 고정과 구분
  });

  it("미리보기 금액이 dailyHours 를 따른다", () => {
    const [s1] = payoutSuggestions([row({ dailyHours: 7.5, hourlyWage: 13_014, remaining: 4 })], 2026, 8);
    expect(s1.suggestAmount).toBe(390_420);
  });
});

describe("제안 목록", () => {
  it("그 달에 기간이 끝나는 사람만 낸다", () => {
    const rows = [
      row({ employeeId: 1, name: "이번달", periodEnd: d("2026-08-31") }),
      row({ employeeId: 2, name: "다음달", periodEnd: d("2026-09-30") }),
      row({ employeeId: 3, name: "지난달", periodEnd: d("2026-07-31") }),
    ];
    expect(payoutSuggestions(rows, 2026, 8).map((s) => s.name)).toEqual(["이번달"]);
  });

  it("**연차 미적용자는 뺀다** — 발생한 적이 없으니 정산할 것도 없다", () => {
    expect(payoutSuggestions([row({ eligible: false })], 2026, 8)).toHaveLength(0);
  });

  it("**남은 일수가 0 이하면 뺀다** — 다 쓴 사람에게 뜨면 소음이다", () => {
    expect(payoutSuggestions([row({ remaining: 0 })], 2026, 8)).toHaveLength(0);
    expect(payoutSuggestions([row({ remaining: -1 })], 2026, 8)).toHaveLength(0);
  });

  it("잔여·기한·제안 일수·금액을 함께 낸다", () => {
    const [s] = payoutSuggestions([row({ remaining: 5, hourlyWage: 20_000 })], 2026, 8);
    expect(s).toMatchObject({
      name: "김서준",
      expiry: "2026-08-31",
      remaining: 5,
      alreadyDays: 0,
      suggestDays: 5,
      suggestAmount: 800_000,
      done: false,
    });
  });

  it("이미 넣어 둔 만큼 빼서 제안한다", () => {
    const [s] = payoutSuggestions([row({ remaining: 5, alreadyDays: 2 })], 2026, 8);
    expect(s.suggestDays).toBe(3);
    expect(s.done).toBe(false);
  });

  // 목록에서 사라지면 '내가 넣었는지' 를 확인할 길이 없다
  it("**다 넣었으면 목록에 남기되 `done` 으로 표시한다**", () => {
    const [s] = payoutSuggestions([row({ remaining: 5, alreadyDays: 5 })], 2026, 8);
    expect(s.done).toBe(true);
    expect(s.suggestDays).toBe(0);
    expect(s.suggestAmount).toBe(0);
  });

  it("넣은 값이 잔여보다 많아도 음수로 제안하지 않는다", () => {
    const [s] = payoutSuggestions([row({ remaining: 3, alreadyDays: 5 })], 2026, 8);
    expect(s.suggestDays).toBe(0);
    expect(s.done).toBe(true);
  });

  it("반차(0.5) 단위가 소수점 잔차로 새지 않는다", () => {
    const [s] = payoutSuggestions([row({ remaining: 5.5, alreadyDays: 1.1 })], 2026, 8);
    expect(s.suggestDays).toBe(4.4);
  });

  it("기한이 이른 사람부터, 같으면 이름 순", () => {
    const rows = [
      row({ employeeId: 1, name: "하윤", periodEnd: d("2026-08-31") }),
      row({ employeeId: 2, name: "가온", periodEnd: d("2026-08-31") }),
      row({ employeeId: 3, name: "이른", periodEnd: d("2026-08-05") }),
    ];
    expect(payoutSuggestions(rows, 2026, 8).map((s) => s.name)).toEqual(["이른", "가온", "하윤"]);
  });
});

describe("표 위 한 줄", () => {
  it("아직 넣지 않은 것만 세어 적는다", () => {
    const list = payoutSuggestions(
      [
        row({ employeeId: 1, name: "가", remaining: 5 }),
        row({ employeeId: 2, name: "나", remaining: 3, alreadyDays: 3 }), // done
        row({ employeeId: 3, name: "다", remaining: 2 }),
      ],
      2026,
      8
    );
    const msg = payoutNotice(list)!;
    expect(msg).toContain("2명");
    expect(msg).toContain("7일");
  });

  it("다 넣었으면 null — 아무 일 없는데 알리지 않는다", () => {
    const list = payoutSuggestions([row({ remaining: 5, alreadyDays: 5 })], 2026, 8);
    expect(payoutNotice(list)).toBeNull();
  });

  it("대상이 없으면 null", () => {
    expect(payoutNotice([])).toBeNull();
  });
});

describe("퇴사 정산 — 그 달에 퇴사하는 직원도 짚는다", () => {
  /*
   * 퇴직하면 남은 연차를 더 쓸 수 없게 되므로 미사용분은 **마지막 급여에서** 수당으로
   * 정산해야 한다. 연차기간이 안 끝났어도 마찬가지다 — 기간 만료만 보면 8월 입사자가
   * 3월에 퇴사할 때 아무도 짚어 주지 않아 그대로 체불이 된다.
   */
  it("**기간이 안 끝났어도 그 달 퇴사자는 목록에 오른다** (kind=RESIGN, 기준일=퇴사일)", () => {
    const [s1] = payoutSuggestions(
      [row({ periodEnd: d("2027-02-28"), resignDate: d("2026-08-20") })],
      2026,
      8
    );
    expect(s1).toBeDefined();
    expect(s1.kind).toBe("RESIGN");
    expect(s1.expiry).toBe("2026-08-20");
    expect(s1.suggestDays).toBe(5);
  });

  it("퇴사가 다른 달이면 오르지 않는다 (그 달 시트의 일이 아니다)", () => {
    expect(
      payoutSuggestions([row({ periodEnd: d("2027-02-28"), resignDate: d("2026-09-10") })], 2026, 8)
    ).toHaveLength(0);
  });

  // 근로관계가 끝나는 쪽이 우선한다 — '기간 만료' 로 적으면 이월 선택지가 있는 줄 안다
  it("**같은 달에 기간도 끝나고 퇴사도 하면 '퇴사 정산' 으로 본다**", () => {
    const [s1] = payoutSuggestions(
      [row({ periodEnd: d("2026-08-31"), resignDate: d("2026-08-15") })],
      2026,
      8
    );
    expect(s1.kind).toBe("RESIGN");
    expect(s1.expiry).toBe("2026-08-15");
  });

  it("퇴사자라도 잔여가 0이면 오르지 않는다 (정산할 것이 없다)", () => {
    expect(
      payoutSuggestions(
        [row({ periodEnd: d("2027-02-28"), resignDate: d("2026-08-20"), remaining: 0 })],
        2026,
        8
      )
    ).toHaveLength(0);
  });

  /*
   * 발생분보다 많이 쓰고 나가는 퇴사자 — 초과일수를 (−)로 정산해 마지막 급여에서 공제해야
   * 하는데(임금공제 동의서 근거) 양수만 거르면 목록에서 빠져 그대로 놓친다.
   */
  it("**잔여가 마이너스(초과 사용)인 퇴사자도 오른다** — (−) 정산 제안", () => {
    const [s1] = payoutSuggestions(
      [row({ periodEnd: d("2027-02-28"), resignDate: d("2026-08-20"), remaining: -4, dailyHours: 7.5, hourlyWage: 13_014 })],
      2026,
      8
    );
    expect(s1).toBeDefined();
    expect(s1.kind).toBe("RESIGN");
    expect(s1.suggestDays).toBe(-4);
    expect(s1.suggestAmount).toBe(-390_420); // −4일 × 13,014원 × 7.5시간
    expect(s1.done).toBe(false);
  });

  it("이미 (−)로 넣어 뒀으면 done — 다시 제안하지 않는다", () => {
    const [s1] = payoutSuggestions(
      [row({ periodEnd: d("2027-02-28"), resignDate: d("2026-08-20"), remaining: -4, alreadyDays: -4 })],
      2026,
      8
    );
    expect(s1.suggestDays).toBe(0);
    expect(s1.done).toBe(true);
  });

  it("재직자의 기간 만료는 예전대로 양수만 — 초과분 자동 제안은 하지 않는다", () => {
    expect(
      payoutSuggestions([row({ periodEnd: d("2026-08-31"), remaining: -2 })], 2026, 8)
    ).toHaveLength(0);
  });

  it("안내 한 줄이 갈래를 밝힌다", () => {
    const resign = payoutSuggestions(
      [row({ periodEnd: d("2027-02-28"), resignDate: d("2026-08-20") })],
      2026,
      8
    );
    expect(payoutNotice(resign)).toContain("퇴사 정산");
    const both = payoutSuggestions(
      [
        row({ periodEnd: d("2027-02-28"), resignDate: d("2026-08-20") }),
        row({ employeeId: 2, name: "이만료", periodEnd: d("2026-08-31") }),
      ],
      2026,
      8
    );
    expect(payoutNotice(both)).toContain("연차기간 만료·퇴사 정산");
  });
});
