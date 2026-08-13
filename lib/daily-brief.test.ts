// 운영진 일일 안내 — 오늘 휴가 · 오늘 보강.
//
// 못박아 둘 것 둘:
//  ① **낼 것이 없으면 null** — 매일 "오늘은 없습니다" 가 오면 있는 날의 알림까지 묻힌다.
//  ② 두 갈래를 **한 통에 담지 않는다** — 함수가 아예 따로다.

import { describe, it, expect } from "vitest";
import {
  leaveBriefText,
  makeupBriefText,
  isBriefable,
  dayLabel,
  hhmm,
  DEFAULT_DAILY_CHANNEL,
  DEFAULT_DAILY_TIMING,
  skipReasonOf,
  skipNotice,
  isSchoolBreakTitle,
  SCHOOL_BREAK_KEYWORD,
  type BriefSession,
} from "./daily-brief";
import type { LeaveDay } from "./leave-calendar";

const TODAY = "2026-08-12"; // 수요일
const t = (hm: string) => new Date(`${TODAY}T${hm}:00Z`); // KST 벽시계를 UTC 필드에 담는다

const day = (over: Partial<LeaveDay> = {}): LeaveDay =>
  ({
    key: "k1",
    date: TODAY,
    employeeId: 1,
    name: "김서준",
    department: "교수부",
    days: 1,
    pool: "ANNUAL",
    leaveType: "ANNUAL",
    status: "APPROVED",
    requestId: null,
    note: null,
    span: null,
    ...over,
  }) as LeaveDay;

const sess = (over: Partial<BriefSession> = {}): BriefSession => ({
  id: 1,
  name: "이지우",
  department: "교수부",
  category: "IMMEDIATE",
  status: "PLANNED",
  planStart: t("14:00"),
  planEnd: t("16:00"),
  targetClass: "은가람중3",
  headcount: 8,
  ...over,
});

const CAT = { IMMEDIATE: "직전보강", MANDATORY: "내신의무보강", ABSENCE: "결시보강", WEEKEND: "주말근무" };

describe("기본값", () => {
  it("운영진 채널과 14:00 KST", () => {
    expect(DEFAULT_DAILY_CHANNEL).toBe("C0AP5EWJR71");
    expect(DEFAULT_DAILY_TIMING).toMatchObject({ enabled: true, hour: 14, minute: 0 });
  });

  it("날짜·시각 표기", () => {
    expect(dayLabel(TODAY)).toBe("8월 12일 (수)");
    expect(hhmm(t("09:05"))).toBe("09:05");
    expect(hhmm(t("22:00"))).toBe("22:00");
  });
});

describe("오늘 휴가", () => {
  it("**아무도 없으면 null** — 보내지 않는다", () => {
    expect(leaveBriefText([], TODAY)).toBeNull();
  });

  it("다른 날 휴가만 있으면 null (오늘 것만 본다)", () => {
    expect(leaveBriefText([day({ date: "2026-08-13" })], TODAY)).toBeNull();
  });

  it("이름·부서·종류를 한 줄씩", () => {
    const s = leaveBriefText([day()], TODAY)!;
    expect(s).toContain("오늘 휴가");
    expect(s).toContain("8월 12일 (수)");
    expect(s).toContain("• 김서준 (교수부) — 연차");
  });

  it("반차는 '반차' 로 적는다 (0.5일)", () => {
    expect(leaveBriefText([day({ days: 0.5, leaveType: "HALF" })], TODAY)!).toContain("— 반차");
  });

  it("대휴·병가·휴무도 함께 낸다 — 그날 자리에 없는 건 같다", () => {
    const s = leaveBriefText(
      [
        day({ key: "a", name: "가", pool: "COMP" }),
        day({ key: "b", name: "나", pool: "UNPAID_POOL" }),
        day({ key: "c", name: "다", pool: "DAYOFF" }),
      ],
      TODAY
    )!;
    expect(s).toContain("대휴");
    expect(s).toContain("병가·경조");
    expect(s).toContain("휴무");
  });

  it("**승인 대기는 아래에 따로 모은다** — 승인분과 섞이면 그냥 쉬는 사람으로 읽힌다", () => {
    const s = leaveBriefText(
      [day({ key: "a", name: "승인자" }), day({ key: "b", name: "대기자", status: "PENDING" })],
      TODAY
    )!;
    expect(s).toContain("아직 결재되지 않은 건 1건");
    const iApproved = s.indexOf("승인자");
    const iPending = s.indexOf("대기자");
    expect(iApproved).toBeLessThan(iPending);
    expect(s).toContain("승인 대기");
  });

  it("취소 요청도 결재 대기로 본다", () => {
    expect(leaveBriefText([day({ status: "CANCEL_PENDING" })], TODAY)!).toContain(
      "아직 결재되지 않은 건"
    );
  });

  it("인원 수를 머리줄에 적는다", () => {
    const s = leaveBriefText([day({ key: "a" }), day({ key: "b", name: "박도윤" })], TODAY)!;
    expect(s).toContain("2명");
  });

  it("여러 날짜리는 며칠째인지 적는다", () => {
    const s = leaveBriefText([day({ span: { index: 1, total: 3 } })], TODAY)!;
    expect(s).toContain("3일 중 2일째");
  });

  it("부서가 없으면 괄호를 붙이지 않는다", () => {
    expect(leaveBriefText([day({ department: null })], TODAY)!).toContain("• 김서준 — 연차");
  });

  it("이름 순으로 세운다", () => {
    const s = leaveBriefText([day({ key: "a", name: "하윤" }), day({ key: "b", name: "가온" })], TODAY)!;
    expect(s.indexOf("가온")).toBeLessThan(s.indexOf("하윤"));
  });
});

describe("오늘 보강", () => {
  it("**없으면 null**", () => {
    expect(makeupBriefText([], TODAY, CAT)).toBeNull();
  });

  it("시각·이름·종류·대상반을 한 줄씩", () => {
    const s = makeupBriefText([sess()], TODAY, CAT)!;
    expect(s).toContain("오늘 보강·주말근무");
    expect(s).toContain("• 14:00~16:00 · 이지우 (교수부) · 직전보강 · 은가람중3 · 8명");
  });

  it("**취소·미실시는 빼고, 다 빠지면 null**", () => {
    expect(isBriefable({ status: "CANCELED" })).toBe(false);
    expect(isBriefable({ status: "NOSHOW" })).toBe(false);
    expect(isBriefable({ status: "PLANNED" })).toBe(true);
    expect(isBriefable({ status: "CONFIRMED" })).toBe(true);
    expect(
      makeupBriefText([sess({ status: "NOSHOW" }), sess({ id: 2, status: "CANCELED" })], TODAY, CAT)
    ).toBeNull();
  });

  it("실근무를 확정한 건도 낸다 (그날 있는 일인 건 같다)", () => {
    expect(makeupBriefText([sess({ status: "CONFIRMED" })], TODAY, CAT)).not.toBeNull();
  });

  it("시각 순으로 세운다 — 운영진은 시간 축으로 본다", () => {
    const s = makeupBriefText(
      [
        sess({ id: 1, name: "늦은사람", planStart: t("20:00"), planEnd: t("22:00") }),
        sess({ id: 2, name: "이른사람", planStart: t("10:00"), planEnd: t("12:00") }),
      ],
      TODAY,
      CAT
    )!;
    expect(s.indexOf("이른사람")).toBeLessThan(s.indexOf("늦은사람"));
  });

  it("주말근무도 함께 낸다 (대상반·인원은 비어 있다)", () => {
    const s = makeupBriefText(
      [sess({ category: "WEEKEND", targetClass: null, headcount: null })],
      TODAY,
      CAT
    )!;
    expect(s).toContain("주말근무");
    expect(s).not.toContain("· null");
  });

  it("건수를 머리줄에 적고, 뺀 건은 세지 않는다", () => {
    const s = makeupBriefText([sess(), sess({ id: 2, status: "NOSHOW" })], TODAY, CAT)!;
    expect(s).toContain("1건");
  });

  it("모르는 카테고리는 코드를 그대로 적는다 (빈칸으로 흘리지 않는다)", () => {
    expect(makeupBriefText([sess({ category: "NEWKIND" })], TODAY, CAT)!).toContain("NEWKIND");
  });
});

describe("두 갈래는 서로를 모른다", () => {
  it("휴가가 있어도 보강 안내는 비면 null", () => {
    expect(leaveBriefText([day()], TODAY)).not.toBeNull();
    expect(makeupBriefText([], TODAY, CAT)).toBeNull();
  });

  it("보강이 있어도 휴가 안내는 비면 null", () => {
    expect(makeupBriefText([sess()], TODAY, CAT)).not.toBeNull();
    expect(leaveBriefText([], TODAY)).toBeNull();
  });
});


// 학원이 안 도는 날 알림이 오면 '안 봐도 되는 알림' 이 되어 평일 알림까지 무뎌진다.
describe("보내지 않는 날 — 토·일·공휴일·학원방학", () => {
  const MON = "2026-08-10";
  const SAT = "2026-08-15";
  const SUN = "2026-08-16";

  it("평일이고 아무것도 안 걸리면 보낸다 (null)", () => {
    expect(skipReasonOf(MON)).toBeNull();
  });

  it("토요일·일요일은 막는다", () => {
    expect(skipReasonOf(SAT)).toBe("WEEKEND");
    expect(skipReasonOf(SUN)).toBe("WEEKEND");
  });

  it("공휴일은 막는다", () => {
    expect(skipReasonOf(MON, { holidays: [MON] })).toBe("HOLIDAY");
  });

  it("학원방학은 막는다", () => {
    expect(skipReasonOf(MON, { breakDates: [MON] })).toBe("SCHOOL_BREAK");
  });

  it("다른 날 공휴일·방학은 오늘을 막지 않는다", () => {
    expect(skipReasonOf(MON, { holidays: ["2026-08-11"], breakDates: ["2026-08-12"] })).toBeNull();
  });

  // 모르는 것을 방학으로 단정해 거르면 멀쩡한 평일 알림이 통째로 사라진다
  it("**학사일정을 못 읽으면(빈 배열) 막지 않는다**", () => {
    expect(skipReasonOf(MON, { holidays: [], breakDates: [] })).toBeNull();
    expect(skipReasonOf(MON, {})).toBeNull();
  });

  it("주말이 공휴일이기도 하면 주말로 적는다 (둘 다 막는 건 같다)", () => {
    expect(skipReasonOf(SAT, { holidays: [SAT] })).toBe("WEEKEND");
  });

  it("건너뛴 이유를 사람 말로 적는다", () => {
    expect(skipNotice(SAT, "WEEKEND")).toContain("8월 15일 (토)");
    expect(skipNotice(SAT, "WEEKEND")).toContain("주말");
    expect(skipNotice(MON, "SCHOOL_BREAK")).toContain("학원방학");
  });
});

describe("학사일정 제목에서 학원방학 가려내기", () => {
  it("키워드가 들어 있으면 잡는다 — 표기가 사람 손에 달려 있다", () => {
    expect(SCHOOL_BREAK_KEYWORD).toBe("학원방학");
    for (const t of ["학원방학", "7월 학원방학", "학원방학 시작", "[학원방학] 8/1~8/10", "학원 방학"])
      expect(isSchoolBreakTitle(t)).toBe(true);
  });

  it("다른 일정은 잡지 않는다", () => {
    for (const t of ["여름 특강", "개학", "중간고사", "학부모 상담주간", "방학특강 접수", null, undefined, ""])
      expect(isSchoolBreakTitle(t as any)).toBe(false);
  });
});
