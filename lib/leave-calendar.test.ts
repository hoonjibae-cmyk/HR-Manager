import { describe, it, expect } from "vitest";
import {
  buildLeaveCalendar,
  spreadWorkdays,
  leaveDaysByDate,
  groupConsecutive,
  upcomingLeave,
  relativeDayLabel,
  blockRangeLabel,
  poolOf,
  leaveAmountLabel,
  type LeaveRequestInput,
  type LeaveTxnInput,
} from "./leave-calendar";

// 2026-08-10 은 월요일, 8/15 토, 8/16 일, 8/17 은 대체공휴일(광복절)
const HOLIDAYS = ["2026-08-17"];

const req = (o: Partial<LeaveRequestInput> = {}): LeaveRequestInput => ({
  id: 1,
  employeeId: 7,
  name: "김서준",
  department: "교수부",
  startDate: "2026-08-10",
  endDate: "2026-08-10",
  days: 1,
  leaveType: "ANNUAL",
  status: "APPROVED",
  reason: "개인 사유",
  ...o,
});

const txn = (o: Partial<LeaveTxnInput> = {}): LeaveTxnInput => ({
  id: 100,
  employeeId: 7,
  name: "김서준",
  department: "교수부",
  date: "2026-08-20",
  days: -1,
  category: "STATUTORY",
  requestId: null,
  ...o,
});

const dates = (ds: { date: string }[]) => ds.map((d) => d.date);

describe("여러 날 신청은 날짜별로 펼친다", () => {
  it("원장은 시작일 한 줄뿐이라 펼치지 않으면 3일 휴가가 하루로 보인다", () => {
    const out = buildLeaveCalendar({
      requests: [req({ startDate: "2026-08-10", endDate: "2026-08-12", days: 3 })],
      txns: [],
    });
    expect(dates(out)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
    expect(out.every((d) => d.days === 1)).toBe(true);
  });

  it("주말·공휴일은 건너뛴다 (관리자 반영 경로와 같은 규칙)", () => {
    // 8/14(금) ~ 8/18(화) — 15 토, 16 일, 17 대체공휴일
    const out = buildLeaveCalendar({
      requests: [req({ startDate: "2026-08-14", endDate: "2026-08-18", days: 2 })],
      txns: [],
      holidays: HOLIDAYS,
    });
    expect(dates(out)).toEqual(["2026-08-14", "2026-08-18"]);
  });

  it("몇째 날인지 남긴다 (툴팁에서 '2/3일째' 로 읽힌다)", () => {
    const out = buildLeaveCalendar({
      requests: [req({ startDate: "2026-08-10", endDate: "2026-08-12", days: 3 })],
      txns: [],
    });
    expect(out[1].span).toEqual({ index: 2, total: 3 });
    expect(out[0].span?.total).toBe(3);
  });

  it("하루짜리에는 span 을 붙이지 않는다", () => {
    expect(buildLeaveCalendar({ requests: [req()], txns: [] })[0].span).toBeNull();
  });

  it("반차는 기간을 펼치지 않고 0.5일로 하루만", () => {
    const out = buildLeaveCalendar({
      requests: [req({ leaveType: "HALF", days: 0.5, endDate: "2026-08-12" })],
      txns: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].days).toBe(0.5);
  });

  it("종료일이 시작일보다 앞서도(잘못된 데이터) 시작일 하루로 살려 낸다", () => {
    const out = buildLeaveCalendar({
      requests: [req({ startDate: "2026-08-12", endDate: "2026-08-10" })],
      txns: [],
    });
    expect(dates(out)).toEqual(["2026-08-12"]);
  });

  it("종료일이 터무니없이 멀어도 달력을 멈추지 않는다", () => {
    const out = spreadWorkdays("2026-08-10", "2099-01-01", new Set());
    expect(out.length).toBeLessThanOrEqual(120);
  });

  it("하루짜리인데 그날이 공휴일이면 지우지 않고 그대로 낸다 (관리자가 봐야 한다)", () => {
    const out = buildLeaveCalendar({
      requests: [req({ startDate: "2026-08-17", endDate: "2026-08-17" })],
      txns: [],
      holidays: HOLIDAYS,
    });
    expect(dates(out)).toEqual(["2026-08-17"]);
  });
});

describe("신청서와 원장을 겹쳐 그리지 않는다", () => {
  it("승인 트랜잭션은 신청서의 그림자라 건너뛴다", () => {
    const out = buildLeaveCalendar({
      requests: [req({ id: 5, startDate: "2026-08-10", endDate: "2026-08-11", days: 2 })],
      // 승인이 만든 줄 — 시작일에 총 일수로 한 줄 (lib/leave-service.ts)
      txns: [txn({ id: 900, date: "2026-08-10", days: -2, requestId: 5 })],
    });
    expect(dates(out)).toEqual(["2026-08-10", "2026-08-11"]);
    expect(out.filter((d) => d.date === "2026-08-10")).toHaveLength(1);
  });

  it("관리자가 직접 반영한 줄(requestId 없음)은 그대로 그린다", () => {
    const out = buildLeaveCalendar({ requests: [], txns: [txn({ date: "2026-08-20" })] });
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("RECORDED");
  });

  it("부여(+)는 달력에 내지 않는다 — 그날 쉰 것이 아니다", () => {
    const out = buildLeaveCalendar({
      requests: [],
      txns: [txn({ days: +3, category: "COMP" }), txn({ id: 101, days: -1 })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].days).toBe(1);
  });
});

describe("상태·주머니", () => {
  it("반려·취소된 신청은 빼고, 승인 대기와 취소 요청은 낸다", () => {
    const out = buildLeaveCalendar({
      requests: [
        req({ id: 1, status: "APPROVED" }),
        req({ id: 2, status: "PENDING", startDate: "2026-08-11", endDate: "2026-08-11" }),
        req({ id: 3, status: "CANCEL_PENDING", startDate: "2026-08-12", endDate: "2026-08-12" }),
        req({ id: 4, status: "REJECTED", startDate: "2026-08-13", endDate: "2026-08-13" }),
        req({ id: 5, status: "CANCELED", startDate: "2026-08-14", endDate: "2026-08-14" }),
      ],
      txns: [],
    });
    expect(out.map((d) => d.status)).toEqual(["APPROVED", "PENDING", "CANCEL_PENDING"]);
  });

  it("대휴는 연차와 다른 주머니다", () => {
    expect(poolOf("COMP")).toBe("COMP");
    expect(poolOf("ANNUAL", "COMP")).toBe("COMP");
    expect(poolOf("ANNUAL")).toBe("ANNUAL");
  });

  it("병가·경조사는 연차를 깎지 않지만 자리는 비우므로 달력에는 낸다", () => {
    const out = buildLeaveCalendar({
      requests: [req({ leaveType: "SICK" }), req({ id: 2, leaveType: "SPECIAL", startDate: "2026-08-11", endDate: "2026-08-11" })],
      txns: [],
    });
    expect(out.map((d) => d.pool)).toEqual(["UNPAID_POOL", "UNPAID_POOL"]);
  });
});

describe("날짜별 묶기 · 정렬", () => {
  it("같은 날 칩은 이름 순으로 고정된다 (매번 자리가 바뀌면 눈으로 못 좇는다)", () => {
    const out = buildLeaveCalendar({
      requests: [
        req({ id: 1, employeeId: 2, name: "홍이서" }),
        req({ id: 2, employeeId: 3, name: "강민서" }),
        req({ id: 3, employeeId: 4, name: "박도윤" }),
      ],
      txns: [],
    });
    expect(out.map((d) => d.name)).toEqual(["강민서", "박도윤", "홍이서"]);
  });

  it("날짜별로 묶어 준다", () => {
    const m = leaveDaysByDate(
      buildLeaveCalendar({
        requests: [req({ startDate: "2026-08-10", endDate: "2026-08-11", days: 2 })],
        txns: [],
      })
    );
    expect([...m.keys()]).toEqual(["2026-08-10", "2026-08-11"]);
    expect(m.get("2026-08-10")).toHaveLength(1);
  });
});

describe("연달아 붙은 날을 한 줄로 묶는다", () => {
  const build = (o: Partial<LeaveRequestInput>) =>
    buildLeaveCalendar({ requests: [req(o)], txns: [], holidays: HOLIDAYS });

  it("3일 휴가는 세 줄이 아니라 한 줄", () => {
    const b = groupConsecutive(build({ startDate: "2026-08-10", endDate: "2026-08-12", days: 3 }));
    expect(b).toHaveLength(1);
    expect(b[0].start).toBe("2026-08-10");
    expect(b[0].end).toBe("2026-08-12");
    expect(b[0].days).toBe(3);
  });

  it("주말을 낀 휴가가 두 토막으로 갈라지지 않는다 (이어짐은 근무일 기준)", () => {
    // 금(8/14) + 화(8/18) — 사이에 토·일·대체공휴일뿐이라 이어진 것으로 본다
    const b = groupConsecutive(build({ startDate: "2026-08-14", endDate: "2026-08-18", days: 2 }), HOLIDAYS);
    expect(b).toHaveLength(1);
    expect(b[0].dates).toEqual(["2026-08-14", "2026-08-18"]);
  });

  it("사람이 다르면 묶지 않는다", () => {
    const days = buildLeaveCalendar({
      requests: [
        req({ id: 1, employeeId: 1, name: "가", startDate: "2026-08-10", endDate: "2026-08-10" }),
        req({ id: 2, employeeId: 2, name: "나", startDate: "2026-08-11", endDate: "2026-08-11" }),
      ],
      txns: [],
    });
    expect(groupConsecutive(days)).toHaveLength(2);
  });

  it("상태가 다르면 묶지 않는다 (승인분과 대기분이 한 줄이 되면 안 된다)", () => {
    const days = buildLeaveCalendar({
      requests: [
        req({ id: 1, status: "APPROVED", startDate: "2026-08-10", endDate: "2026-08-10" }),
        req({ id: 2, status: "PENDING", startDate: "2026-08-11", endDate: "2026-08-11" }),
      ],
      txns: [],
    });
    expect(groupConsecutive(days)).toHaveLength(2);
  });

  it("반차가 섞이면 날짜 수가 아니라 일수 합이 나온다", () => {
    const days = buildLeaveCalendar({
      requests: [req({ id: 1, startDate: "2026-08-10", endDate: "2026-08-10" })],
      txns: [txn({ id: 5, date: "2026-08-11", days: -0.5 })],
    });
    const b = groupConsecutive(days);
    // 상태가 달라 두 줄이지만, 각 줄의 일수는 제 값이다
    expect(b.map((x) => x.days).sort()).toEqual([0.5, 1]);
  });
});

describe("다가오는 휴가 (대시보드)", () => {
  const NOW = new Date("2026-08-10T09:00:00Z"); // 월요일

  it("오늘부터 7일 안의 것만 낸다", () => {
    const days = buildLeaveCalendar({
      requests: [
        req({ id: 1, startDate: "2026-08-07", endDate: "2026-08-07" }), // 지난주 — 뺀다
        req({ id: 2, startDate: "2026-08-10", endDate: "2026-08-10" }), // 오늘 — 낸다
        req({ id: 3, startDate: "2026-08-14", endDate: "2026-08-14" }), // 이번 주 — 낸다
        req({ id: 4, startDate: "2026-08-20", endDate: "2026-08-20" }), // 열흘 뒤 — 뺀다
      ],
      txns: [],
    });
    expect(upcomingLeave(days, NOW).map((b) => b.start)).toEqual(["2026-08-10", "2026-08-14"]);
  });

  it("오늘 쉬는 사람도 낸다 — '지금 자리에 없는 사람' 이 먼저 궁금하다", () => {
    const days = buildLeaveCalendar({
      requests: [req({ startDate: "2026-08-08", endDate: "2026-08-12", days: 3 })],
      txns: [],
    });
    const b = upcomingLeave(days, NOW);
    expect(b).toHaveLength(1);
    expect(b[0].start).toBe("2026-08-10"); // 창 밖(8/8)은 잘리고 오늘부터
  });

  it("승인 대기도 함께 낸다 — 모레 시작인데 결재가 안 된 건이 가장 급하다", () => {
    const days = buildLeaveCalendar({
      requests: [req({ status: "PENDING", startDate: "2026-08-12", endDate: "2026-08-12" })],
      txns: [],
    });
    expect(upcomingLeave(days, NOW)[0].status).toBe("PENDING");
  });

  it("창 길이를 바꿀 수 있다", () => {
    const days = buildLeaveCalendar({
      requests: [req({ startDate: "2026-08-13", endDate: "2026-08-13" })],
      txns: [],
    });
    expect(upcomingLeave(days, NOW, { withinDays: 3 })).toHaveLength(0);
    expect(upcomingLeave(days, NOW, { withinDays: 7 })).toHaveLength(1);
  });

  it("아무것도 없으면 빈 목록", () => {
    expect(upcomingLeave([], NOW)).toEqual([]);
  });
});

describe("날짜 문구", () => {
  const NOW = new Date("2026-08-10T09:00:00Z");

  it("가까운 날은 요일보다 '오늘·내일·모레' 가 빨리 읽힌다", () => {
    expect(relativeDayLabel("2026-08-10", NOW)).toBe("오늘");
    expect(relativeDayLabel("2026-08-11", NOW)).toBe("내일");
    expect(relativeDayLabel("2026-08-12", NOW)).toBe("모레");
    expect(relativeDayLabel("2026-08-14", NOW)).toBe("8월 14일 (금)");
  });

  it("여러 날이면 끝날까지 적는다", () => {
    const days = buildLeaveCalendar({
      requests: [req({ startDate: "2026-08-10", endDate: "2026-08-12", days: 3 })],
      txns: [],
    });
    expect(blockRangeLabel(groupConsecutive(days)[0], NOW)).toBe("오늘 ~ 8월 12일 (수)");
  });

  it("하루면 그날만 적는다", () => {
    const days = buildLeaveCalendar({ requests: [req()], txns: [] });
    expect(blockRangeLabel(groupConsecutive(days)[0], NOW)).toBe("오늘");
  });
});

describe("종류·일수 문구", () => {
  it("반차가 '반차 반차' 로 나오지 않는다", () => {
    expect(leaveAmountLabel("HALF", 0.5, "반차")).toBe("반차");
  });

  it("종류와 일수가 다르면 둘 다 적는다", () => {
    expect(leaveAmountLabel("ANNUAL", 3, "연차")).toBe("연차 3일");
    expect(leaveAmountLabel("COMP", 1, "대휴(보상)")).toBe("대휴(보상) 1일");
    // 대휴 반차처럼 종류가 '반차' 가 아닌 반나절도 제대로 읽힌다
    expect(leaveAmountLabel("COMP", 0.5, "대휴(보상)")).toBe("대휴(보상) 반차");
  });
});
