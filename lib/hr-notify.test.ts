import { describe, it, expect } from "vitest";
import {
  notifyDue,
  contractsToAnnounce,
  birthdaysOn,
  birthMonthDay,
  announceWindow,
  isWorkday,
  contractAlertText,
  birthdayAlertText,
  recipientWarning,
  daysUntil,
  addDays,
  kstToday,
  DEFAULT_CONTRACT_TIMING,
  DEFAULT_BIRTHDAY_TIMING,
  type ContractRow,
  type BirthdayRow,
} from "./hr-notify";

/** KST 벽시계 → UTC Date (앱이 UTC 로 도는 것을 흉내 낸다) */
const kst = (s: string) => new Date(new Date(`${s}:00Z`).getTime() - 9 * 3600000);

describe("기본값", () => {
  it("계약은 60일(≈2개월) 전 12:00, 생일은 당일 12:00", () => {
    expect(DEFAULT_CONTRACT_TIMING).toMatchObject({ leadDays: 60, hour: 12, minute: 0 });
    expect(DEFAULT_BIRTHDAY_TIMING).toMatchObject({ leadDays: 0, hour: 12, minute: 0 });
  });
});

describe("보낼 시각인가", () => {
  const t = { enabled: true, leadDays: 60, hour: 12, minute: 0 };

  it("예정 시각 전에는 안 보낸다", () => {
    expect(notifyDue(t, kst("2026-08-10T11:59")).due).toBe(false);
  });

  it("예정 시각을 지나면 보낸다 — 크론이 매시 정각에만 돌아 정각에 못 맞춘다", () => {
    expect(notifyDue(t, kst("2026-08-10T12:00")).due).toBe(true);
    expect(notifyDue(t, kst("2026-08-10T18:00")).due).toBe(true);
  });

  it("같은 한국 날짜에 이미 보냈으면 건너뛴다", () => {
    const sent = { ...t, lastRunAt: kst("2026-08-10T12:00") };
    expect(notifyDue(sent, kst("2026-08-10T18:00")).due).toBe(false);
    expect(notifyDue(sent, kst("2026-08-11T12:00")).due).toBe(true);
  });

  it("KST 로 판단한다 — UTC 로 보면 날짜가 하루 어긋난다", () => {
    // KST 2026-08-11 00:30 = UTC 2026-08-10 15:30
    const sent = { ...t, lastRunAt: kst("2026-08-10T23:30") };
    expect(notifyDue(sent, kst("2026-08-11T12:00")).due).toBe(true);
  });

  it("꺼져 있으면 안 보내고, 강제 실행은 다 무시한다", () => {
    expect(notifyDue({ ...t, enabled: false }, kst("2026-08-10T12:00")).due).toBe(false);
    expect(notifyDue({ ...t, enabled: false }, kst("2026-08-10T00:00"), { force: true }).due).toBe(true);
  });
});

describe("계약 만료 예고", () => {
  const NOW = kst("2026-08-10T12:00");
  const c = (o: Partial<ContractRow> = {}): ContractRow => ({
    id: 1,
    employeeId: 7,
    name: "김서준",
    department: "교수부",
    position: "선임강사",
    stage: "RENEWAL_1",
    endDate: "2026-10-09", // D-60
    notifiedAt: null,
    status: "ACTIVE",
    ...o,
  });

  it("예고 창 안에 든 계약을 낸다", () => {
    const out = contractsToAnnounce([c()], NOW, 60);
    expect(out).toHaveLength(1);
    expect(out[0].dDay).toBe(60);
  });

  it("창 밖은 안 낸다", () => {
    expect(contractsToAnnounce([c({ endDate: "2026-10-10" })], NOW, 60)).toHaveLength(0);
  });

  it("**'딱 60일 전' 이 아니라 창 안이면 낸다** — 크론이 하루 걸러도 반드시 한 번은 나간다", () => {
    // 어제 놓친 D-59 짜리도 오늘 나간다
    const out = contractsToAnnounce([c({ endDate: "2026-10-08" })], NOW, 60);
    expect(out).toHaveLength(1);
    expect(out[0].dDay).toBe(59);
  });

  it("창 안에서 새로 만든 계약도 곧바로 잡힌다", () => {
    expect(contractsToAnnounce([c({ endDate: "2026-08-20" })], NOW, 60)).toHaveLength(1);
  });

  it("이미 알린 계약은 다시 알리지 않는다 — 매일 같은 알림이 오면 안 읽게 된다", () => {
    expect(contractsToAnnounce([c({ notifiedAt: kst("2026-08-01T12:00") })], NOW, 60)).toHaveLength(0);
  });

  it("종료일이 지난 계약은 예고가 아니라 사고다 — 여기서 내지 않는다", () => {
    expect(contractsToAnnounce([c({ endDate: "2026-08-09" })], NOW, 60)).toHaveLength(0);
  });

  it("오늘 끝나는 계약은 낸다 (D-0)", () => {
    expect(contractsToAnnounce([c({ endDate: "2026-08-10" })], NOW, 60)[0].dDay).toBe(0);
  });

  it("종료일이 없는(기간의 정함 없는) 계약은 대상이 아니다", () => {
    expect(contractsToAnnounce([c({ endDate: null })], NOW, 60)).toHaveLength(0);
  });

  it("해지된 계약은 뺀다", () => {
    expect(contractsToAnnounce([c({ status: "TERMINATED" })], NOW, 60)).toHaveLength(0);
  });

  it("급한 순으로 정렬한다", () => {
    const out = contractsToAnnounce(
      [
        c({ id: 1, endDate: "2026-10-01", name: "가" }),
        c({ id: 2, endDate: "2026-08-15", name: "나" }),
        c({ id: 3, endDate: "2026-09-01", name: "다" }),
      ],
      NOW,
      60
    );
    expect(out.map((x) => x.name)).toEqual(["나", "다", "가"]);
  });

  it("예고 일수를 줄이면 창이 좁아진다", () => {
    expect(contractsToAnnounce([c({ endDate: "2026-09-20" })], NOW, 30)).toHaveLength(0);
    expect(contractsToAnnounce([c({ endDate: "2026-09-05" })], NOW, 30)).toHaveLength(1);
  });
});

describe("생일", () => {
  const b = (o: Partial<BirthdayRow> = {}): BirthdayRow => ({
    id: 1,
    name: "이지우",
    department: "경영지원",
    position: "매니저",
    birth: "1990-08-10",
    ...o,
  });

  // 2026-08-10 은 월요일 · 08-14 금 · 08-15 토 · 08-16 일 · 08-17 월
  const on = (rows: BirthdayRow[], when: string, lead = 0, hols: string[] = []) =>
    birthdaysOn(rows, kst(when), lead, hols);

  it("오늘이 생일인 사람만", () => {
    const out = on([b(), b({ id: 2, birth: "1991-08-11", name: "다른이" })], "2026-08-10T12:00");
    expect(out.map((x) => x.name)).toEqual(["이지우"]);
    expect(out[0].age).toBe(36);
    expect(out[0].shifted).toBe(false);
  });

  it("연도를 몰라도 월·일만 맞으면 낸다 (나이는 비운다)", () => {
    const out = on([b({ birth: "900810" })], "2026-08-10T12:00");
    expect(out).toHaveLength(1);
    expect(out[0].age).toBeNull();
  });

  it("생년월일 표기가 여러 가지다", () => {
    expect(birthMonthDay("1990-08-10")).toBe("08-10");
    expect(birthMonthDay("1990.08.10")).toBe("08-10");
    expect(birthMonthDay("19900810")).toBe("08-10");
    expect(birthMonthDay("900810")).toBe("08-10");
  });

  it("읽을 수 없으면 조용히 건너뛴다 (엉뚱한 날 축하하지 않는다)", () => {
    expect(birthMonthDay("")).toBeNull();
    expect(birthMonthDay("몰라요")).toBeNull();
    expect(on([b({ birth: null })], "2026-08-10T12:00")).toHaveLength(0);
  });

  it("미리 알림(leadDays)을 주면 그날 생일인 사람을 낸다", () => {
    const out = on([b({ birth: "1990-08-13" })], "2026-08-10T12:00", 3);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-08-13");
  });

  it("2월 29일생은 평년에 2월 28일로 본다 — 3월 1일로 미루면 생일이 지난 뒤에 축하하게 된다", () => {
    const feb29 = b({ birth: "1996-02-29" });
    // 2027-02-28 은 **일요일**이라 그 전 마지막 평일인 2/26(금)에 나간다
    const fri = on([feb29], "2027-02-26T12:00");
    expect(fri).toHaveLength(1);
    expect(fri[0].date).toBe("2027-02-28");
    expect(fri[0].shifted).toBe(true);
    expect(on([feb29], "2027-03-01T12:00")).toHaveLength(0);
    // 윤년에는 제 날짜에 (2028-02-29 는 화요일)
    expect(on([feb29], "2028-02-28T12:00")).toHaveLength(0);
    expect(on([feb29], "2028-02-29T12:00")).toHaveLength(1);
  });

  it("KST 로 본다 — UTC 로 보면 자정 무렵에 하루 어긋난다", () => {
    // KST 2026-08-10 00:30 = UTC 2026-08-09 15:30
    expect(on([b()], "2026-08-10T00:30")).toHaveLength(1);
  });

  it("아무도 없으면 빈 목록", () => {
    expect(on([b({ birth: "1990-01-01" })], "2026-08-10T12:00")).toEqual([]);
  });
});

/*
 * 생일이 쉬는 날이면 **그 전 마지막 평일**에 알린다.
 * 지나고 나서 하는 축하는 안 하느니만 못하고, 쉬는 날 슬랙은 아무도 안 읽는다.
 */
describe("주말·공휴일 생일은 그 전 마지막 평일에", () => {
  const b = (birth: string, name = "이지우"): BirthdayRow => ({
    id: 1,
    name,
    department: "경영지원",
    position: "매니저",
    birth,
  });
  const on = (rows: BirthdayRow[], when: string, hols: string[] = []) =>
    birthdaysOn(rows, kst(when), 0, hols);

  it("근무일 판정 — 토·일·공휴일이 아니면 근무일", () => {
    const h = new Set(["2026-08-17"]);
    expect(isWorkday("2026-08-14", h)).toBe(true); // 금
    expect(isWorkday("2026-08-15", h)).toBe(false); // 토
    expect(isWorkday("2026-08-16", h)).toBe(false); // 일
    expect(isWorkday("2026-08-17", h)).toBe(false); // 월이지만 공휴일
  });

  it("금요일에 서면 금·토·일을 함께 챙긴다", () => {
    expect(announceWindow("2026-08-14", [])).toEqual(["2026-08-14", "2026-08-15", "2026-08-16"]);
  });

  it("연휴가 길면 그만큼 늘어난다 (월요일까지 공휴일이면 금~월)", () => {
    expect(announceWindow("2026-08-14", ["2026-08-17"])).toEqual([
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
    ]);
  });

  // 토요일에 뒤를 돌아보며 '금요일이 마지막 평일' 이라고 판정하면 금요일 몫이 또 나간다
  it("**오늘이 쉬는 날이면 아무것도 내지 않는다** — 그 몫은 이미 금요일에 나갔다", () => {
    expect(announceWindow("2026-08-15", [])).toEqual([]);
    expect(announceWindow("2026-08-16", [])).toEqual([]);
    expect(on([b("1990-08-15")], "2026-08-15T12:00")).toHaveLength(0);
    expect(on([b("1990-08-16")], "2026-08-16T12:00")).toHaveLength(0);
  });

  it("토요일 생일은 금요일에 나가고 날짜는 실제 생일로 적는다", () => {
    const out = on([b("1990-08-15")], "2026-08-14T12:00");
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-08-15");
    expect(out[0].shifted).toBe(true);
    expect(out[0].age).toBe(36);
  });

  it("공휴일 생일도 그 전 마지막 평일에", () => {
    const out = on([b("1990-08-17")], "2026-08-14T12:00", ["2026-08-17"]);
    expect(out[0].date).toBe("2026-08-17");
    expect(out[0].shifted).toBe(true);
    // 공휴일 표를 안 넘기면 월요일이 평일로 잡혀 금요일에는 안 나온다
    expect(on([b("1990-08-17")], "2026-08-14T12:00")).toHaveLength(0);
  });

  it("당일 생일과 앞당긴 생일이 한 통에 함께 실린다", () => {
    const out = on([b("1990-08-15", "토요일생"), b("1990-08-14", "금요일생")], "2026-08-14T12:00");
    expect(out.map((x) => [x.name, x.shifted])).toEqual([
      ["금요일생", false],
      ["토요일생", true],
    ]);
  });

  it("문구 — 앞당긴 사람이 있으면 날짜와 이유를 적는다", () => {
    const out = on([b("1990-08-15", "토요일생"), b("1990-08-14", "금요일생")], "2026-08-14T12:00");
    const { text } = birthdayAlertText(out);
    expect(text).toContain("2026년 8월 15일 (토)");
    expect(text).toContain("쉬는 날이라 미리 알립니다");
    expect(text).toContain("그 전 마지막 평일인 오늘");
    // '오늘이 생일' 이라고 적으면 받은 사람이 그날 축하해 버린다
    expect(text).not.toContain("오늘이 생일인 직원");
  });

  it("문구 — 모두 당일이면 예전 그대로 짧게", () => {
    const { text } = birthdayAlertText(on([b("1990-08-14")], "2026-08-14T12:00"));
    expect(text).toContain("오늘이 생일인 직원");
    expect(text).not.toContain("🗓");
  });
});

describe("문구", () => {
  const STAGE = { RENEWAL_1: "1년 추가계약" };

  it("계약 알림은 남은 일수를 앞에 세우고 할 일까지 적는다", () => {
    const alerts = contractsToAnnounce(
      [
        {
          id: 1,
          employeeId: 7,
          name: "김서준",
          department: "교수부",
          position: "선임강사",
          stage: "RENEWAL_1",
          endDate: "2026-10-09",
        },
      ],
      kst("2026-08-10T12:00"),
      60
    );
    const { text, blocks } = contractAlertText(alerts, { stageLabel: STAGE, appUrl: "https://hr.example.com/" });
    expect(text).toContain("D-60");
    expect(text).toContain("김서준");
    expect(text).toContain("1년 추가계약");
    expect(text).toContain("2026년 10월 9일 (금)");
    expect(text).toContain("신규 계약 작성");
    // 링크는 끝의 / 가 겹치지 않아야 한다
    expect(JSON.stringify(blocks)).toContain("https://hr.example.com/employees/7");
  });

  it("오늘 끝나는 계약은 'D-0' 이 아니라 '오늘 종료' 로 적는다", () => {
    const alerts = contractsToAnnounce(
      [{ id: 1, employeeId: 7, name: "가", department: null, position: null, stage: "REGULAR", endDate: "2026-08-10" }],
      kst("2026-08-10T12:00"),
      60
    );
    expect(contractAlertText(alerts).text).toContain("오늘 종료");
  });

  it("주소를 모르면 버튼을 붙이지 않는다", () => {
    const alerts = contractsToAnnounce(
      [{ id: 1, employeeId: 7, name: "가", department: null, position: null, stage: "REGULAR", endDate: "2026-09-01" }],
      kst("2026-08-10T12:00"),
      60
    );
    expect(JSON.stringify(contractAlertText(alerts).blocks)).not.toContain("accessory");
  });

  it("생일 알림은 짧다 — 할 일을 길게 붙이면 축하가 업무 지시로 읽힌다", () => {
    const out = birthdayAlertText(
      birthdaysOn(
        [{ id: 1, name: "이지우", department: "경영지원", position: "매니저", birth: "1990-08-10" }],
        kst("2026-08-10T12:00"),
        0,
        []
      )
    );
    expect(out.text).toContain("오늘이 생일인 직원");
    expect(out.text).toContain("이지우");
    expect(out.text).toContain("만 36세");
    expect(out.text.split("\n").length).toBeLessThan(6);
  });
});

describe("받을 사람이 없으면 알려 준다", () => {
  it("부서에 사람이 없을 때", () => {
    expect(recipientWarning("경영지원", 0, 0)).toContain("등록된 재직 직원이 없습니다");
  });

  it("슬랙이 아무도 연결 안 됐을 때", () => {
    expect(recipientWarning("경영지원", 3, 0)).toContain("모두 슬랙 계정이 연결되어 있지 않습니다");
  });

  it("일부만 연결됐을 때", () => {
    expect(recipientWarning("경영지원", 3, 1)).toContain("3명 중 1명만");
  });

  it("다 연결됐으면 경고 없음", () => {
    expect(recipientWarning("경영지원", 3, 3)).toBeNull();
  });
});

describe("날짜 도구", () => {
  it("남은 일수", () => {
    expect(daysUntil("2026-08-10", "2026-08-10")).toBe(0);
    expect(daysUntil("2026-10-09", "2026-08-10")).toBe(60);
  });

  it("월·연 경계를 넘어도 맞는다", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // 2026 은 평년
  });

  it("오늘은 KST 기준이다", () => {
    expect(kstToday(kst("2026-08-11T00:10"))).toBe("2026-08-11");
  });
});
