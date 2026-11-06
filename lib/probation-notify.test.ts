// 수습 종료 알림 — 창(통지 기한 N일 전 ~ 수습 마지막 날) · 한 번만 · 빼는 경우 · 문구
import { describe, it, expect } from "vitest";
import {
  probationsToAnnounce,
  probationAlertText,
  slackErrorHint,
  DEFAULT_PROBATION_TIMING,
  DEFAULT_PROBATION_CHANNEL,
  type ProbationRow,
} from "./hr-notify";

/** KST 벽시계 → UTC Date (앱이 UTC 로 도는 것을 흉내 낸다) */
const kst = (s: string) => new Date(new Date(`${s}:00Z`).getTime() - 9 * 3600000);

// 11/9 시작 · 3개월 → 수습 마지막 날 2/8 · 통지 기한 1/9(토) · 창은 1/2 부터
const row = (over: Partial<ProbationRow> = {}): ProbationRow => ({
  id: 1,
  employeeId: 10,
  name: "가상신입",
  department: "교육운영팀",
  position: "매니저",
  startDate: "2026-11-09",
  endDate: "2027-11-08",
  isProbation: true,
  probationMonths: 3,
  contractor: false,
  active: true,
  resignDate: null,
  status: "ACTIVE",
  notifiedAt: null,
  ...over,
});
const at = (day: string, rows: ProbationRow[] = [row()], lead = 7) =>
  probationsToAnnounce(rows, kst(`${day}T12:00`), lead);

describe("기본값", () => {
  it("통지 기한 7일 전 12:00 · 지정 채널", () => {
    expect(DEFAULT_PROBATION_TIMING).toMatchObject({ enabled: true, leadDays: 7, hour: 12, minute: 0 });
    expect(DEFAULT_PROBATION_CHANNEL).toBe("C057NN63VFT");
  });
});

describe("창 — 통지 기한 N일 전 ~ 수습 마지막 날", () => {
  it("창이 열리기 전에는 내지 않는다", () => {
    expect(at("2027-01-01")).toEqual([]);
  });

  it("통지 기한 7일 전에 열린다 — 수습 종료일이 아니라 통지 기한이 기준", () => {
    const [a] = at("2027-01-02");
    expect(a).toMatchObject({ probationEnd: "2027-02-08", noticeBy: "2027-01-09", decideBy: "2027-01-09", dDay: 7, overdue: false });
  });

  it("통지 기한이 지나도 수습이 안 끝났으면 낸다 — 늦게 만든 계약·빠진 크론도 놓치지 않게", () => {
    const [a] = at("2027-01-12");
    expect(a).toMatchObject({ dDay: -3, overdue: true });
    expect(at("2027-02-08")).toHaveLength(1); // 수습 마지막 날까지
  });

  it("수습이 끝나면 내지 않는다 — 그때는 본채용이다", () => {
    expect(at("2027-02-09")).toEqual([]);
  });

  it("한 계약에 한 번만", () => {
    expect(at("2027-01-05", [row({ notifiedAt: new Date() })])).toEqual([]);
  });

  it("예고 일수가 음수면 0 으로 — 통지 기한 당일에 연다", () => {
    expect(at("2027-01-08", [row()], -5)).toEqual([]);
    expect(at("2027-01-09", [row()], -5)[0]).toMatchObject({ dDay: 0 });
  });

  it("2개월(2026-11 이전) 수습은 §26 예외라 수습 마지막 날이 기준", () => {
    const legacy = row({ probationMonths: 2 }); // 마지막 날 1/8
    expect(at("2026-12-31", [legacy])).toEqual([]);
    expect(at("2027-01-01", [legacy])[0]).toMatchObject({ noticeBy: null, decideBy: "2027-01-08", dDay: 7, overdue: false });
    expect(at("2027-01-08", [legacy])[0]).toMatchObject({ dDay: 0, overdue: false });
  });
});

describe("빼는 경우", () => {
  const day = "2027-01-05";
  it("수습이 아니거나 위탁·퇴사자·해지 계약", () => {
    expect(at(day, [row({ isProbation: false })])).toEqual([]);
    expect(at(day, [row({ contractor: true })])).toEqual([]);
    expect(at(day, [row({ active: false })])).toEqual([]);
    expect(at(day, [row({ status: "TERMINATED" })])).toEqual([]);
  });

  it("수습 종료 전에 퇴사하면 판단할 일이 없다", () => {
    expect(at(day, [row({ resignDate: "2027-01-31" })])).toEqual([]);
    expect(at(day, [row({ resignDate: "2027-02-08" })])).toEqual([]);
    expect(at(day, [row({ resignDate: "2027-03-01" })])).toHaveLength(1);
  });

  it("계약이 수습 종료일 이전에 끝나면 계약 종료 예고가 맡는다", () => {
    expect(at(day, [row({ endDate: "2027-02-08" })])).toEqual([]);
    expect(at(day, [row({ endDate: "2027-02-28" })])).toHaveLength(1);
    expect(at(day, [row({ endDate: null })])).toHaveLength(1);
  });

  it("날짜를 못 읽으면 내지 않는다", () => {
    expect(at(day, [row({ startDate: "" })])).toEqual([]);
  });
});

describe("순서", () => {
  it("판단 기준일이 이른 순, 같으면 이름순", () => {
    const rows = [
      row({ id: 1, name: "하늘", startDate: "2026-11-12" }), // 통지 기한 1/12
      row({ id: 2, name: "나리" }), // 1/9
      row({ id: 3, name: "가람" }), // 1/9
    ];
    expect(at("2027-01-06", rows).map((a) => a.name)).toEqual(["가람", "나리", "하늘"]);
  });
});

describe("문구", () => {
  const plain = (s: string) => s.replace(/\*/g, "");

  it("통지 기한을 요일까지 적고, 서면 통지·§26·§27 을 함께 적는다", () => {
    const { text } = probationAlertText(at("2027-01-02"));
    const t = plain(text);
    expect(t).toContain("수습 종료 예정 — 본채용 여부 확인 — 1명");
    expect(t).toContain("통지 기한 D-7 · 가상신입 (교육운영팀 · 매니저)");
    expect(t).toContain("수습 3개월 · 2026-11-09 ~ 2027-02-08");
    expect(t).toContain("2027년 1월 9일 (토) 까지 사유·종료일을 적어 서면 통지");
    expect(t).toContain("근로기준법 §27");
    expect(t).toContain("§26");
  });

  it("기한이 지난 건은 무엇이 생기는지 적는다", () => {
    const t = plain(probationAlertText(at("2027-01-12")).text);
    expect(t).toContain("통지 기한 지남");
    expect(t).toContain("해고예고수당");
  });

  it("2개월 수습은 예고 예외라고 적는다", () => {
    const t = plain(probationAlertText(at("2027-01-08", [row({ probationMonths: 2 })])).text);
    expect(t).toContain("수습 종료 오늘");
    expect(t).toContain("해고예고 예외");
  });

  it("앱 주소가 있으면 직원 카드 버튼을 붙인다", () => {
    const withUrl = probationAlertText(at("2027-01-02"), { appUrl: "https://hr.example.test/" });
    expect(JSON.stringify(withUrl.blocks)).toContain("https://hr.example.test/employees/10");
    expect(JSON.stringify(probationAlertText(at("2027-01-02")).blocks)).not.toContain("accessory");
  });
});

describe("슬랙 오류 안내", () => {
  it("코드를 할 일로 바꾼다", () => {
    expect(slackErrorHint("not_in_channel")).toContain("초대");
    expect(slackErrorHint("channel_not_found")).toContain("채널 ID");
    expect(slackErrorHint("whatever")).toBe("슬랙 오류: whatever");
    expect(slackErrorHint(null)).toBeNull();
  });
});
