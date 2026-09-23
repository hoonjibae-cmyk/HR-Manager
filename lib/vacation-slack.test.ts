// 방학 근무·연차 — 슬랙 화면. 미리 고르지 않고, 확인 항목은 미체크로 시작하는지 못박는다.
import { describe, it, expect } from "vitest";
import {
  allChecked,
  choiceModalView,
  groupApprovalBlocks,
  missingChoiceErrors,
  noticeDmBlocks,
  noticeView,
  selectableDatesInView,
  waitingView,
  readChoiceValues,
  readSignValues,
  receiptDmBlocks,
  signModalView,
} from "./vacation-slack";
import { CHECK_ITEMS, dateInfo, type DateInfo } from "./vacation";
import { signDocToken, verifyDocToken, DOC_TOKEN_TTL_SEC } from "./vacation-token";

const head = {
  noticeId: 1,
  title: "겨울방학 근무·연차 안내",
  version: 1,
  classOffStart: "2026-12-28",
  classOffEnd: "2027-01-03",
  dates: ["2026-12-28", "2026-12-29", "2027-01-01"],
  deadline: "2026-12-20",
  contactName: "담당",
  extraNote: "",
};
const infos: DateInfo[] = [
  { ...dateInfo("2026-12-28", baseCtx()) },
  { ...dateInfo("2026-12-29", baseCtx()) },
  { ...dateInfo("2027-01-01", { ...baseCtx(), holidays: new Map([["2027-01-01", "신정"]]) }) },
];
function baseCtx() {
  return {
    employee: { id: 1, hireDate: new Date("2024-01-01T00:00:00Z"), resignDate: null },
    schedule: (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({ day, work: true, start: "14:00", end: "22:00", breakH: 0.5 })),
    holidays: new Map<string, string>(),
    dayOffs: new Set<string>(),
    existing: [],
    unconfirmed: new Set<string>(),
    conditionReady: true,
    periodLastDay: null,
  };
}
const balance = { remaining: 5, pending: 0, scheduled: 0, ineligibleNote: null };

describe("선택 모달", () => {
  const view = choiceModalView({
    assignmentId: 7,
    versionId: 3,
    head,
    employeeName: "가상직원",
    condition: { place: "본원", hours: "근무표", breakTime: "30분", duties: "검수", environment: "난방" },
    infos,
    choices: {},
    balance,
    ownStatus: {},
  });
  const radios = view.blocks.filter((b: any) => b.element?.type === "radio_buttons");

  it("고를 수 있는 날짜마다 두 선택지 — 어느 쪽도 미리 선택하지 않는다", () => {
    expect(radios).toHaveLength(2);
    for (const r of radios) {
      expect(r.element.options.map((o: any) => o.value)).toEqual(["WORK", "LEAVE"]);
      expect(r.element.initial_option).toBeUndefined();
      expect(r.dispatch_action).toBe(true); // 고르는 즉시 임시저장
    }
  });

  it("공휴일은 선택지 없이 사유만 보인다", () => {
    expect(JSON.stringify(view.blocks)).toContain("선택 대상 아님: 공휴일(신정)");
  });

  it("본인이 이미 고른 값만 되살린다", () => {
    const v = choiceModalView({ assignmentId: 7, versionId: 3, head, employeeName: "x", condition: null, infos, choices: { "2026-12-29": "LEAVE" }, balance, ownStatus: {} });
    const r = v.blocks.find((b: any) => b.block_id === "d_2026-12-29");
    expect(r.element.initial_option.value).toBe("LEAVE");
    expect(v.blocks.find((b: any) => b.block_id === "d_2026-12-28").element.initial_option).toBeUndefined();
  });

  it("문의 버튼이 있고, 사유 입력칸이 없다", () => {
    expect(JSON.stringify(view.blocks)).toContain("vac_inquiry_open");
    expect(view.blocks.some((b: any) => b.element?.type === "plain_text_input")).toBe(false);
  });

  it("선택값·미선택 오류를 읽는다", () => {
    const vals = readChoiceValues({ state: { values: { "d_2026-12-28": { vac_pick: { selected_option: { value: "WORK" } } }, "d_2026-12-29": { vac_pick: { selected_option: null } } } } });
    expect(vals).toEqual({ "2026-12-28": "WORK" });
    expect(Object.keys(missingChoiceErrors(["2026-12-29"]))).toEqual(["d_2026-12-29"]);
  });
});

describe("서명 모달", () => {
  const v = signModalView({
    assignmentId: 7,
    versionId: 3,
    choices: { "2026-12-28": "WORK", "2026-12-29": "LEAVE" },
    preview: {
      companyName: "가상학원",
      employeeName: "가상직원",
      department: "교수부",
      head,
      condition: null,
      rows: [
        { label: "12/28 (월)", hours: null, choice: "WORK", days: 0 },
        { label: "12/29 (화)", hours: null, choice: "LEAVE", days: 1 },
      ],
      balance: { remaining: 5, pending: 0, adding: 1, releasing: 0, after: 4, shortage: 0 },
      basis: "입사일 기준",
      supersedesDocNo: null,
    },
  });
  it("확인 항목 셋이 미체크로 시작하고 성명 직접 입력칸이 있다", () => {
    const checks = v.blocks.find((b: any) => b.block_id === "checks");
    expect(checks.element.options).toHaveLength(3);
    expect(checks.element.initial_options).toBeUndefined();
    expect(v.blocks.find((b: any) => b.block_id === "signed_name")).toBeTruthy();
  });
  it("확인 항목 문구는 슬랙 선택지 한도(75자) 안", () => {
    for (const c of CHECK_ITEMS) expect(c.label.length).toBeLessThanOrEqual(75);
  });
  it("서명 화면이 보여 준 잔여를 함께 싣는다 (제출 때 재검증)", () => {
    const meta = JSON.parse(v.private_metadata);
    expect(meta.s).toEqual([5, 0, 1, 0]);
    expect(meta.c["2026-12-29"]).toBe("LEAVE");
  });
  it("모두 체크해야 통과", () => {
    expect(allChecked(["c1", "c2"])).toBe(false);
    expect(allChecked(["c1", "c2", "c3"])).toBe(true);
    expect(readSignValues({ state: { values: { checks: { v: { selected_options: [{ value: "c1" }] } }, signed_name: { v: { value: " 가상직원 " } } } } })).toEqual({ checks: ["c1"], signedName: "가상직원" });
  });
});

describe("DM·결재 카드", () => {
  it("확인 요청 DM 은 중립 — 연차를 권하지 않는다", () => {
    const { blocks } = noticeDmBlocks({ kind: "REMIND", head, assignmentId: 7 });
    const t = JSON.stringify(blocks);
    expect(t).toContain("정상근무 또는 연차 신청 중 원하는 쪽");
    expect(t).not.toMatch(/연차를 (사용|쓰)시/);
  });
  it("변경 안내는 이전 서명이 새 조건에 적용되지 않는다고 적는다", () => {
    const { blocks } = noticeDmBlocks({ kind: "CHANGED", head, assignmentId: 7, changes: ["대상 날짜 제외: 2026-12-29"], needsReconfirm: true });
    const t = JSON.stringify(blocks);
    expect(t).toContain("이전 서명은 새 조건에 적용되지 않습니다");
    expect(t).toContain("자동으로 취소되지 않습니다");
  });
  it("묶음 결재 카드 — 버튼이 제출 id 를 싣는다", () => {
    const b = groupApprovalBlocks({ submissionId: 12, name: "가상직원", dept: "교수부", docNo: "VW-1-1-1", dates: ["2026-12-29"], remaining: 5, after: 4 });
    const actions = b.find((x: any) => x.type === "actions");
    expect(actions.elements.map((e: any) => [e.action_id, e.value])).toEqual([["vac_approve", "12"], ["vac_reject", "12"]]);
    const pre = groupApprovalBlocks({ submissionId: 12, name: "x", dept: "x", docNo: "x", dates: [], remaining: 0, after: 0, pre: true });
    expect(pre.find((x: any) => x.type === "actions").elements[0].action_id).toBe("vac_pre_approve");
  });
  it("영수 DM 에 문서 받기·다시 보기 버튼", () => {
    const { blocks } = receiptDmBlocks({ kind: "WORK_ONLY", docNo: "d", title: "t", submissionId: 3, assignmentId: 7, summary: "s" });
    expect(JSON.stringify(blocks)).toContain("vac_doc");
    expect(JSON.stringify(blocks)).toContain("확인 내역 받기");
  });
});

describe("문서 받기 토큰", () => {
  const secret = "x".repeat(40);
  it("서명·만료를 본다", () => {
    const now = Date.now();
    const t = signDocToken({ sid: 5, u: "U1" }, secret, now);
    expect(verifyDocToken(t, secret, now)).toEqual({ sid: 5, u: "U1" });
    expect(verifyDocToken(t, "y".repeat(40), now)).toBeNull();
    expect(verifyDocToken(t, secret, now + (DOC_TOKEN_TTL_SEC + 5) * 1000)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sid: 6, u: "U1", exp: 9e9 })).toString("base64url");
    expect(verifyDocToken(`${forged}.${sig}`, secret, now)).toBeNull();
    expect(verifyDocToken(`${body}.`, secret, now)).toBeNull();
  });
});

describe("3초 응답 — 처리 중 화면", () => {
  it("모달에 그려진 선택 칸만으로 고를 날짜를 읽는다 (DB 없이 미선택 검사)", () => {
    const v = choiceModalView({ assignmentId: 7, versionId: 3, head, employeeName: "x", condition: null, infos, choices: {}, balance, ownStatus: {} });
    // 공휴일(1/1)은 선택 칸이 아니라 안내 줄이다
    expect(selectableDatesInView(v)).toEqual(["2026-12-28", "2026-12-29"]);
    expect(selectableDatesInView({})).toEqual([]);
  });

  it("처리 중 화면은 external_id 를 달고, 제출 버튼이 없다", () => {
    const w = waitingView("연차 신청서 확인·서명", "준비 중", "vac-1-x");
    expect(w.external_id).toBe("vac-1-x");
    expect(w.submit).toBeUndefined();
    expect(w.title.text.length).toBeLessThanOrEqual(24);
  });

  it("안내 화면 — 쌓인 화면 위에서는 닫기 문구를 '뒤로' 로", () => {
    const n = noticeView("연차 잔여 부족", "본문", { close: "뒤로" });
    expect(n.close.text).toBe("뒤로");
    expect(n.external_id).toBeUndefined();
  });
});
