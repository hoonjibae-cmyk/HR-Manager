import { describe, it, expect } from "vitest";
import {
  parseLeaveText,
  leaveModalView,
  readLeaveModal,
  leaveLauncherBlocks,
  leaveCancelModalView,
  readCancelModal,
  recordBlocks,
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
  it("신청·잔여확인·취소신청 버튼 3개", () => {
    const blocks: any = leaveLauncherBlocks("주식회사 유쌤에듀");
    const actions = blocks.find((b: any) => b.type === "actions");
    expect(actions.elements.map((e: any) => e.action_id)).toEqual([
      "open_leave_modal",
      "check_leave_balance",
      "open_cancel_modal",
    ]);
    expect(blocks[0].text.text).toContain("휴가 신청");
  });
});

describe("휴가 취소 모달", () => {
  it("취소 대상 목록과 사유 입력을 제공", () => {
    const v: any = leaveCancelModalView(
      [
        { id: 12, label: "2026-08-14 ~ 2026-08-16 · 연차 3일" },
        { id: 13, label: "2026-09-01 · 오후반차 0.5일" },
      ],
      "C999"
    );
    expect(v.callback_id).toBe("leave_cancel_submit");
    const ids = v.blocks.filter((b: any) => b.type === "input").map((b: any) => b.block_id);
    expect(ids).toEqual(["target", "reason"]);
    const opts = v.blocks.find((b: any) => b.block_id === "target").element.options;
    expect(opts.map((o: any) => o.value)).toEqual(["12", "13"]);
    expect(JSON.parse(v.private_metadata).channel).toBe("C999");
  });

  it("제출값 파싱", () => {
    expect(
      readCancelModal({
        state: {
          values: {
            target: { v: { selected_option: { value: "12" } } },
            reason: { v: { value: " 일정 변경 " } },
          },
        },
      })
    ).toEqual({ requestId: 12, reason: "일정 변경" });
  });
});

describe("recordBlocks — 휴가-기록 채널 메시지", () => {
  const base = {
    name: "홍길동",
    dept: "교수부",
    range: "2026-08-14",
    days: 1,
    typeLabel: "연차",
    reason: "개인사유",
    by: "U123",
  };
  it("승인 기록에 캘린더·잔여 표기", () => {
    const b: any = recordBlocks({ ...base, calendarSynced: true, deducted: true, remaining: 11 });
    expect(b[0].text.text).toContain("휴가 승인");
    const ctx = b[2].elements[0].text;
    expect(ctx).toContain("구글 캘린더에 등록됨");
    expect(ctx).toContain("잔여 연차 11일");
  });
  it("병가·경조사는 '연차 미차감' 표기", () => {
    const b: any = recordBlocks({ ...base, typeLabel: "병가", deducted: false });
    expect(b[2].elements[0].text).toContain("연차 미차감");
  });
  it("취소 확정 기록", () => {
    const b: any = recordBlocks({ ...base, canceled: true, calendarSynced: true });
    expect(b[0].text.text).toContain("휴가 취소 확정");
    expect(b[2].elements[0].text).toContain("구글 캘린더에서 삭제됨");
  });
});
