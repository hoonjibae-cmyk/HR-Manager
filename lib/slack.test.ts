import { describe, it, expect } from "vitest";
import {
  parseLeaveText,
  leaveModalView,
  readLeaveModal,
  leaveLauncherBlocks,
} from "./slack";

describe("parseLeaveText — 빠른 신청 문법", () => {
  const y = new Date().getFullYear();
  it("하루 신청", () => {
    const r = parseLeaveText("8/14 개인사유")!;
    expect(r.start.toISOString().slice(0, 10)).toBe(`${y}-08-14`);
    expect(r.end.toISOString().slice(0, 10)).toBe(`${y}-08-14`);
    expect(r.leaveType).toBe("ANNUAL");
    expect(r.reason).toBe("개인사유");
  });
  it("기간 신청", () => {
    const r = parseLeaveText("8/14~8/16 가족여행")!;
    expect(r.start.toISOString().slice(0, 10)).toBe(`${y}-08-14`);
    expect(r.end.toISOString().slice(0, 10)).toBe(`${y}-08-16`);
    expect(r.reason).toBe("가족여행");
  });
  it("오전/오후 반차", () => {
    expect(parseLeaveText("오전반차 8/14 병원")!.leaveType).toBe("HALF_AM");
    expect(parseLeaveText("오후반차 8/14 병원")!.leaveType).toBe("HALF_PM");
    expect(parseLeaveText("오후반차 8/14 병원")!.half).toBe(true);
  });
  it("대휴 사용", () => {
    const r = parseLeaveText("대휴 8/14")!;
    expect(r.leaveType).toBe("COMP");
  });
  it("사유 미기재 시 기본값", () => {
    expect(parseLeaveText("8/14")!.reason).toBe("개인사유");
  });
  it("날짜가 없으면 null", () => {
    expect(parseLeaveText("내일 쉴게요")).toBeNull();
  });
});

describe("leaveModalView — 휴가신청서 모달 구조", () => {
  const view: any = leaveModalView({
    empName: "홍길동",
    remaining: 12,
    compRemaining: 2,
    serviceLabel: "3년 2개월",
    channel: "C123",
  });

  it("모달 기본 속성", () => {
    expect(view.type).toBe("modal");
    expect(view.callback_id).toBe("leave_request_submit");
    expect(view.submit.text).toBe("제출");
    expect(JSON.parse(view.private_metadata).channel).toBe("C123");
  });

  it("기존 워크플로 양식과 동일한 항목을 가진다", () => {
    const ids = view.blocks.filter((b: any) => b.type === "input").map((b: any) => b.block_id);
    expect(ids).toEqual(["kind", "start", "end", "halftime", "reason"]);
  });

  it("종료일·반차시간은 선택 항목", () => {
    const opt = (id: string) => view.blocks.find((b: any) => b.block_id === id)?.optional;
    expect(opt("end")).toBe(true);
    expect(opt("halftime")).toBe(true);
    expect(opt("kind")).toBeUndefined(); // 필수
  });

  it("모든 입력 요소에 action_id 가 있다 (슬랙 필수)", () => {
    view.blocks
      .filter((b: any) => b.type === "input")
      .forEach((b: any) => expect(b.element.action_id).toBe("v"));
  });

  it("상단에 이름·잔여 연차가 표시된다", () => {
    expect(view.blocks[0].text.text).toContain("홍길동");
    expect(view.blocks[0].text.text).toContain("12일");
    expect(view.blocks[0].text.text).toContain("대휴보상연차");
  });

  it("대휴 잔여가 0이면 대휴 문구를 넣지 않는다", () => {
    const v: any = leaveModalView({
      empName: "김직원",
      remaining: 5,
      compRemaining: 0,
      serviceLabel: "1년",
    });
    expect(v.blocks[0].text.text).not.toContain("대휴보상연차");
  });

  it("휴가종류 6가지를 제공한다", () => {
    const kind = view.blocks.find((b: any) => b.block_id === "kind");
    expect(kind.element.options.map((o: any) => o.value)).toEqual([
      "ANNUAL",
      "HALF_AM",
      "HALF_PM",
      "COMP",
      "SICK",
      "SPECIAL",
    ]);
  });
});

describe("readLeaveModal — 제출값 파싱", () => {
  it("입력값을 그대로 읽는다", () => {
    const submitted = {
      state: {
        values: {
          kind: { v: { selected_option: { value: "HALF_PM" } } },
          start: { v: { selected_date: "2026-08-14" } },
          end: { v: { selected_date: null } },
          halftime: { v: { value: " 3시~5시30분 " } },
          reason: { v: { value: "병원 방문" } },
        },
      },
    };
    expect(readLeaveModal(submitted)).toEqual({
      kind: "HALF_PM",
      start: "2026-08-14",
      end: null,
      halftime: "3시~5시30분",
      reason: "병원 방문",
    });
  });

  it("빈 값도 안전하게 처리", () => {
    expect(readLeaveModal({})).toEqual({
      kind: "ANNUAL",
      start: null,
      end: null,
      halftime: "",
      reason: "",
    });
  });
});

describe("leaveLauncherBlocks — 채널 버튼", () => {
  it("신청·잔여확인 버튼 2개", () => {
    const blocks: any = leaveLauncherBlocks("주식회사 유쌤에듀");
    const actions = blocks.find((b: any) => b.type === "actions");
    expect(actions.elements.map((e: any) => e.action_id)).toEqual([
      "open_leave_modal",
      "check_leave_balance",
    ]);
    expect(blocks[0].text.text).toContain("휴가 신청");
  });
});
