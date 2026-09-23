// 방학 근무·연차 — 판정·선택·잔여·원문. 가상 직원만 쓴다.
import { describe, it, expect } from "vitest";
import {
  NOTICE_BODY,
  APPLICATION_STATEMENT,
  CHECK_ITEMS,
  ATTESTATIONS,
  assignmentState,
  bannedPhrasesIn,
  blockingProblems,
  changeSummary,
  checkBalance,
  choicesKey,
  dateInfo,
  diffLeave,
  emptyContent,
  isMaterialChange,
  isSelectable,
  leaveDates,
  parseContent,
  publishProblems,
  remindable,
  renderSubmissionHtml,
  resolveTargets,
  reviewFlagsFor,
  sanitizeChoices,
  signatureNameMatches,
  unselectedDates,
  type DateContext,
  type NoticeContent,
  type SubmissionSnapshot,
  type TargetEmployee,
} from "./vacation";
import { snapshotHash } from "./vacation-hash";
import type { ScheduleDay } from "./constants";

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const weekdays = (start = "14:00", end = "22:00"): ScheduleDay[] =>
  (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({ day, work: true, start, end, breakH: 0.5 }));

const cond = { place: "본원 교무실", hours: "근무표대로", breakTime: "30분", duties: "교재 검수", environment: "냉난방 가동" };

function ctx(over: Partial<DateContext> = {}): DateContext {
  return {
    employee: { id: 1, hireDate: D("2024-03-01"), resignDate: null },
    schedule: weekdays(),
    holidays: new Map(),
    dayOffs: new Set(),
    existing: [],
    unconfirmed: new Set(),
    conditionReady: true,
    periodLastDay: "2027-02-28",
    ...over,
  };
}

// 2026-12-28(월) ~ 2027-01-01(금). 1/1 은 공휴일로 넣는다
const DATES = ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"];

describe("dateInfo — 날짜별 선택 가능 여부 (토·일이라는 이유만으로 판단하지 않는다)", () => {
  it("근무표상 근무일이면 고를 수 있고 근무시간이 붙는다", () => {
    const i = dateInfo("2026-12-28", ctx());
    expect(i.status).toBe("OPEN");
    expect(isSelectable(i)).toBe(true);
    expect(i.hours).toBe("14:00~22:00, 휴게 0.5h");
    expect(i.leaveDays).toBe(1);
  });

  it("공휴일은 선택 대상이 아니다", () => {
    const i = dateInfo("2027-01-01", ctx({ holidays: new Map([["2027-01-01", "신정"]]) }));
    expect(i.status).toBe("NOT_WORKDAY");
    expect(i.reason).toContain("신정");
  });

  it("개인 근무표에 없는 요일은 선택 대상이 아니다 (주 3일 근무자)", () => {
    const mwf: ScheduleDay[] = weekdays().map((s) => ({ ...s, work: ["mon", "wed", "fri"].includes(s.day) }));
    expect(dateInfo("2026-12-29", ctx({ schedule: mwf })).status).toBe("NOT_WORKDAY"); // 화
    expect(dateInfo("2026-12-30", ctx({ schedule: mwf })).status).toBe("OPEN"); // 수
  });

  it("토요일이 계약 근무일이면 선택 대상이다 (요일로 일괄 판단하지 않음)", () => {
    const sat: ScheduleDay[] = [...weekdays(), { day: "sat", work: true, start: "10:00", end: "16:00", breakH: 0.5 }];
    expect(dateInfo("2027-01-02", ctx({ schedule: sat })).status).toBe("OPEN");
    expect(dateInfo("2027-01-02", ctx()).status).toBe("NOT_WORKDAY");
  });

  it("근로시간표가 없으면 '확인 필요' — 신청·차감 대상이 아니다", () => {
    const i = dateInfo("2026-12-28", ctx({ schedule: [] }));
    expect(i.status).toBe("UNCONFIRMED");
    expect(isSelectable(i)).toBe(false);
  });

  it("같은 날 다른 휴가가 있으면 기존 기록을 보여 주고 새로 만들지 않는다", () => {
    const i = dateInfo("2026-12-29", ctx({ existing: [{ date: "2026-12-29", requestId: 9, label: "병가 신청 (승인)", own: false }] }));
    expect(i.status).toBe("EXISTING");
    expect(i.existing?.requestId).toBe(9);
  });

  it("이 공고로 낸 본인 신청은 막지 않는다 (이전 선택)", () => {
    const i = dateInfo("2026-12-29", ctx({ existing: [{ date: "2026-12-29", requestId: 9, label: "연차 신청", own: true }] }));
    expect(i.status).toBe("OPEN");
  });

  it("평일 휴무일은 선택 대상이 아니다", () => {
    expect(dateInfo("2026-12-30", ctx({ dayOffs: new Set(["2026-12-30"]) })).status).toBe("EXISTING");
  });

  it("운영조건 미확인(직원 전체·특정 날짜)·조건 미입력은 신청 대상이 아니다", () => {
    expect(dateInfo("2026-12-28", ctx({ unconfirmed: new Set(["1:*"]) })).status).toBe("UNCONFIRMED");
    expect(dateInfo("2026-12-28", ctx({ unconfirmed: new Set(["1:2026-12-28"]) })).status).toBe("UNCONFIRMED");
    expect(dateInfo("2026-12-29", ctx({ unconfirmed: new Set(["1:2026-12-28"]) })).status).toBe("OPEN");
    expect(dateInfo("2026-12-28", ctx({ conditionReady: false })).status).toBe("UNCONFIRMED");
  });

  it("입사 전·퇴사 후 날짜는 대상이 아니다", () => {
    expect(dateInfo("2026-12-28", ctx({ employee: { id: 1, hireDate: D("2026-12-29"), resignDate: null } })).status).toBe("NOT_WORKDAY");
    expect(dateInfo("2026-12-31", ctx({ employee: { id: 1, hireDate: D("2024-03-01"), resignDate: D("2026-12-30") } })).status).toBe("NOT_WORKDAY");
  });

  it("이번 연차기간 이후 날짜는 연차 산정 확인이 필요해 선택에서 빠진다(자동 선사용 없음)", () => {
    const i = dateInfo("2026-12-31", ctx({ periodLastDay: "2026-12-30" }));
    expect(i.status).toBe("OPEN");
    expect(i.leaveBlocked).toContain("산정 확인");
    expect(isSelectable(i)).toBe(false);
  });
});

describe("선택 — 날짜별로 섞어 고르고, 미응답은 아무 선택도 아니다", () => {
  const infos = DATES.map((d) => dateInfo(d, ctx({ holidays: new Map([["2027-01-01", "신정"]]) })));

  it("일부만 연차, 나머지 정상근무 (3일 중 1일 근무·2일 연차)", () => {
    const c = sanitizeChoices({ "2026-12-28": "WORK", "2026-12-29": "LEAVE", "2026-12-30": "LEAVE" }, infos);
    expect(leaveDates(c)).toEqual(["2026-12-29", "2026-12-30"]);
    expect(unselectedDates(c, infos)).toEqual(["2026-12-31"]);
  });

  it("아무것도 고르지 않으면 선택은 비어 있다 — 연차도 정상근무도 만들지 않는다", () => {
    const c = sanitizeChoices({}, infos);
    expect(c).toEqual({});
    expect(leaveDates(c)).toEqual([]);
    expect(unselectedDates(c, infos)).toHaveLength(4);
  });

  it("공휴일·대상 밖 날짜·엉뚱한 값은 버린다", () => {
    const c = sanitizeChoices({ "2027-01-01": "LEAVE", "2030-01-01": "LEAVE", "2026-12-28": "BOTH" }, infos);
    expect(c).toEqual({});
  });

  it("선택 지문은 순서와 무관하다", () => {
    expect(choicesKey({ b: "WORK", a: "LEAVE" } as any)).toBe(choicesKey({ a: "LEAVE", b: "WORK" } as any));
  });
});

describe("잔여 판정 — 부족하면 막는다(마이너스·선사용·무급으로 바꾸지 않는다)", () => {
  it("잔여 안이면 통과", () => {
    const b = checkBalance({ remaining: 5, pending: 1, adding: 3, releasing: 0 });
    expect(b.after).toBe(1);
    expect(b.shortage).toBe(0);
  });
  it("승인 대기분까지 빼서 모자라면 부족", () => {
    const b = checkBalance({ remaining: 3, pending: 2, adding: 2, releasing: 0 });
    expect(b.after).toBe(-1);
    expect(b.shortage).toBe(1);
  });
  it("이번에 철회하는 승인 대기분은 되돌려 준다", () => {
    expect(checkBalance({ remaining: 3, pending: 2, adding: 2, releasing: 1 }).shortage).toBe(0);
  });
  it("새로 신청하지 않으면(정상근무만) 부족이 아니다 — 이미 마이너스여도", () => {
    expect(checkBalance({ remaining: -1, pending: 0, adding: 0, releasing: 0 }).shortage).toBe(0);
  });
});

describe("변경 — 날짜 단위 비교", () => {
  it("추가·제외·유지", () => {
    expect(diffLeave(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"], kept: ["b"] });
  });
});

describe("서명 성명 대조", () => {
  it("공백만 무시하고 같아야 한다", () => {
    expect(signatureNameMatches("홍 길동", "홍길동")).toBe(true);
    expect(signatureNameMatches("홍길순", "홍길동")).toBe(false);
    expect(signatureNameMatches("", "홍길동")).toBe(false);
  });
});

describe("대상자", () => {
  const emp = (over: Partial<TargetEmployee>): TargetEmployee => ({
    id: 1,
    name: "가상직원",
    department: "교수부",
    active: true,
    hireDate: D("2024-01-01"),
    resignDate: null,
    slackUserId: "U1",
    contractor: false,
    ...over,
  });
  const content = { ...emptyContent(), dates: DATES, targetDepts: ["교수부"], targetEmployeeIds: [5], excludeEmployeeIds: [3] };
  it("부서·개별 추가 − 개별 제외, 위탁·퇴사자·기간 후 입사자는 사유와 함께 뺀다", () => {
    const r = resolveTargets(
      [
        emp({ id: 1 }),
        emp({ id: 2, department: "조교팀" }),
        emp({ id: 3 }),
        emp({ id: 4, contractor: true }),
        emp({ id: 5, department: "조교팀" }),
        emp({ id: 6, resignDate: D("2026-12-01") }),
        emp({ id: 7, hireDate: D("2027-02-01") }),
      ],
      content
    );
    expect(r.targets.map((t) => t.id)).toEqual([1, 5]);
    expect(Object.fromEntries(r.excluded.map((x) => [x.employee.id, x.reason]))).toEqual({
      3: "관리자가 대상에서 제외",
      4: "위탁계약 — 연차휴가 적용 대상 아님",
      6: "대상 기간 전 퇴사",
      7: "대상 기간 이후 입사",
    });
  });
});

describe("공고 발행 점검", () => {
  const full: NoticeContent = {
    ...emptyContent(),
    classOffStart: "2026-12-28",
    classOffEnd: "2027-01-03",
    dates: DATES,
    deadline: "2026-12-20",
    contactName: "경영지원 담당",
    targetDepts: ["교수부"],
    conditions: { 교수부: cond },
  };
  it("다 채우면 문제 없음", () => {
    expect(publishProblems(full, ["교수부"])).toEqual([]);
  });
  it("부서 조건이 비면 그 부서만 '운영조건 확인 필요' — 발행을 막지는 않는다", () => {
    const p = publishProblems(full, ["교수부", "조교팀"]);
    expect(p.some((x) => x.includes("조교팀"))).toBe(true);
    expect(blockingProblems(p)).toEqual([]);
  });
  it("권리 포기·간주 동의 표현은 막는다", () => {
    const p = publishProblems({ ...full, extraNote: "향후 이의 제기를 하지 않으며 모든 권리를 포기합니다" }, ["교수부"]);
    expect(blockingProblems(p).join()).toContain("쓸 수 없는 표현");
    expect(bannedPhrasesIn("미응답 시 동의한 것으로 간주합니다").length).toBeGreaterThan(0);
    expect(bannedPhrasesIn("민·형사상 책임")).toContain("민·형사");
  });
  it("필수 항목이 비면 막는다", () => {
    expect(blockingProblems(publishProblems(emptyContent(), [])).length).toBeGreaterThan(3);
  });
  it("저장값을 다시 읽어도 모양이 같다 (날짜 정렬·중복 제거)", () => {
    const c = parseContent(JSON.stringify({ ...full, dates: ["2026-12-30", "2026-12-28", "2026-12-28", "bad"] }));
    expect(c.dates).toEqual(["2026-12-28", "2026-12-30"]);
  });
});

describe("판 변경 — 중요한 변경만 재확인", () => {
  const a = { ...emptyContent(), dates: DATES, conditions: { 교수부: cond } };
  it("날짜·근무조건이 바뀌면 재확인", () => {
    expect(isMaterialChange(a, { ...a, dates: DATES.slice(0, 3) })).toBe(true);
    expect(isMaterialChange(a, { ...a, conditions: { 교수부: { ...cond, place: "별관" } } })).toBe(true);
  });
  it("기한·문의처만 바뀌면 재확인 아님(안내만)", () => {
    const b = { ...a, deadline: "2026-12-22", contactName: "다른 담당" };
    expect(isMaterialChange(a, b)).toBe(false);
    expect(changeSummary(a, b)).toEqual(["응답 요청 기한: 2026-12-22", "문의 담당자: 다른 담당"]);
  });
});

describe("현황 상태 — 미응답을 제출로 보지 않는다", () => {
  const base = { removed: false, slackLinked: true, firstOpenedAt: null, draftSavedAt: null, hasSubmission: false, needsReconfirm: false };
  it("상태 구분", () => {
    expect(assignmentState(base)).toBe("UNOPENED");
    expect(assignmentState({ ...base, firstOpenedAt: new Date() })).toBe("OPENED");
    expect(assignmentState({ ...base, firstOpenedAt: new Date(), draftSavedAt: new Date() })).toBe("DRAFT");
    expect(assignmentState({ ...base, hasSubmission: true })).toBe("SUBMITTED");
    expect(assignmentState({ ...base, hasSubmission: true, needsReconfirm: true })).toBe("RECONFIRM");
    expect(assignmentState({ ...base, slackLinked: false })).toBe("NOT_SENT");
  });
  it("확인 알림은 미제출자에게만 — 정상근무를 고른 제출자에게 연차를 권하지 않는다", () => {
    expect(remindable("UNOPENED")).toBe(true);
    expect(remindable("DRAFT")).toBe(true);
    expect(remindable("SUBMITTED")).toBe(false);
    expect(remindable("RECONFIRM")).toBe(false);
    expect(remindable("NOT_SENT")).toBe(true); // 발송 실패분은 다시 보낸다(슬랙 연동이 있을 때만)
  });
});

describe("사후 대조 — 사실 확인 필요로만 표시한다", () => {
  it("연차일에 근무 기록이 있으면 확인 필요, 해결 기록이 있으면 내린다", () => {
    const f = reviewFlagsFor({
      leaveDates: ["2026-12-29", "2026-12-30"],
      workedDates: new Map([["2026-12-29", "출퇴근 기록 4h"]]),
      workNotProvided: new Map(),
      workDates: [],
      today: "2027-01-05",
      resolved: new Set(),
    });
    expect(f).toEqual([{ date: "2026-12-29", kind: "LEAVE_WORKED", note: "연차일에 근무 기록이 있습니다 (출퇴근 기록 4h)" }]);
    expect(
      reviewFlagsFor({
        leaveDates: ["2026-12-29"],
        workedDates: new Map([["2026-12-29", "x"]]),
        workNotProvided: new Map(),
        workDates: [],
        today: "2027-01-05",
        resolved: new Set(["LEAVE_WORKED:2026-12-29"]),
      })
    ).toEqual([]);
  });
  it("정상근무를 골랐는데 근무가 제공되지 않은 날도 확인 필요", () => {
    const f = reviewFlagsFor({ leaveDates: [], workedDates: new Map(), workNotProvided: new Map([["2026-12-28", "건물 점검"]]), workDates: ["2026-12-28"], today: "2027-01-05", resolved: new Set() });
    expect(f[0].kind).toBe("WORK_NOT_PROVIDED");
  });
  it("아직 오지 않은 연차일은 대조하지 않는다", () => {
    const f = reviewFlagsFor({ leaveDates: ["2027-02-01"], workedDates: new Map([["2027-02-01", "x"]]), workNotProvided: new Map(), workDates: [], today: "2027-01-05", resolved: new Set() });
    expect(f).toEqual([]);
  });
});

describe("문안 — 원칙에 어긋나는 말이 없다", () => {
  const all = [...NOTICE_BODY, ...APPLICATION_STATEMENT, ...CHECK_ITEMS.map((c) => c.label), ...ATTESTATIONS.map((a) => a.label)].join(" ");
  it("권리 포기·간주 동의·일괄 대체 표현이 없다", () => {
    expect(bannedPhrasesIn(all)).toEqual([]);
  });
  it("발행 전 확인은 법률 검토 완료라고 말하지 않는다", () => {
    expect(all).not.toContain("법률 검토 완료");
  });
});

describe("제출 원문", () => {
  const snap = (kind: "LEAVE" | "WORK_ONLY"): SubmissionSnapshot => ({
    kind,
    docNo: "VW-1-1-1",
    companyName: "가상학원",
    employee: { id: 1, name: "가상직원", department: "교수부", empNo: "T001" },
    notice: { id: 1, title: "겨울방학 안내", version: 2, classOffStart: "2026-12-28", classOffEnd: "2027-01-03", deadline: "2026-12-20", contactName: "담당", body: NOTICE_BODY, extraNote: "" },
    condition: cond,
    rows: [
      { date: "2026-12-28", label: "12/28 (월)", hours: "14:00~22:00", choice: "WORK", days: 0 },
      { date: "2026-12-29", label: "12/29 (화)", hours: "14:00~22:00", choice: kind === "LEAVE" ? "LEAVE" : "WORK", days: kind === "LEAVE" ? 1 : 0 },
    ],
    skipped: [{ date: "2027-01-01", label: "1/1 (금)", reason: "공휴일(신정)" }],
    leaveTotal: kind === "LEAVE" ? 1 : 0,
    balance: { remaining: 5, pending: 0, adding: 1, releasing: 0, after: 4, shortage: 0, basis: "입사일 기준", scheduled: 0 },
    statement: kind === "LEAVE" ? APPLICATION_STATEMENT : null,
    checks: kind === "LEAVE" ? CHECK_ITEMS.map((c) => ({ label: c.label, checked: true })) : null,
    signature: kind === "LEAVE" ? { method: "슬랙 본인 계정 + 성명 입력", typedName: "가상직원", account: "슬랙 사용자 U1" } : null,
    submittedAt: "2026-12-10T05:00:00.000Z",
    supersedesDocNo: null,
    afterClose: false,
  });

  it("연차 신청서 — 필수 기재 항목이 모두 들어간다", () => {
    const h = renderSubmissionHtml(snap("LEAVE"));
    for (const t of ["연차유급휴가 신청서", "가상학원", "가상직원", "교수부", "겨울방학 안내", "제2판", "신청 총량", "산정 기준", "본원 교무실", APPLICATION_STATEMENT[1], "VW-1-1-1", "2026-12-10 14:00:00 (KST)", "성명(직접 입력)"])
      expect(h).toContain(t);
    expect(h).toContain("공휴일(신정)");
  });

  it("정상근무만 — 신청서가 아니라 확인 내역이고 서명·신청 문구가 없다", () => {
    const h = renderSubmissionHtml(snap("WORK_ONLY"));
    expect(h).toContain("근무 선택 확인 내역");
    expect(h).not.toContain("연차유급휴가 신청서");
    expect(h).not.toContain(APPLICATION_STATEMENT[1]);
    expect(h).not.toContain("성명(직접 입력)");
  });

  it("HTML 을 이스케이프한다", () => {
    const s = snap("LEAVE");
    s.employee.name = "<b>x</b>";
    expect(renderSubmissionHtml(s)).not.toContain("<b>x</b>");
  });

  it("지문은 같은 내용이면 같고, 한 글자만 달라도 다르다", () => {
    const a = snap("LEAVE");
    const b = snap("LEAVE");
    expect(snapshotHash(a)).toBe(snapshotHash(b));
    b.rows[1].days = 0.5;
    expect(snapshotHash(a)).not.toBe(snapshotHash(b));
  });
});
