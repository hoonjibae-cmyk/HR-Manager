import { describe, it, expect } from "vitest";
import {
  parseLeaveText,
  leaveModalView,
  readLeaveModal,
  leaveLauncherBlocks,
  leaveCancelModalView,
  readCancelModal,
  recordBlocks,
  makeupModalView,
  readMakeupModal,
  makeupLauncherBlocks,
  makeupConfirmModalView,
  readMakeupConfirmModal,
  makeupConfirmRequestBlocks,
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
  it("반차는 오전/오후 구분 없이 HALF", () => {
    expect(parseLeaveText("반차 8/14 병원")!.leaveType).toBe("HALF");
    expect(parseLeaveText("반차 8/14 병원")!.half).toBe(true);
    // 예전 표현으로 적어도 반차로 인식
    expect(parseLeaveText("오전반차 8/14 병원")!.leaveType).toBe("HALF");
    expect(parseLeaveText("오후반차 8/14 병원")!.leaveType).toBe("HALF");
  });
  it("반차 표기를 지운 나머지가 사유", () => {
    expect(parseLeaveText("반차 8/14 병원")!.reason).toBe("병원");
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
    expect(ids).toEqual(["kind", "start", "end", "halftime", "reason", "workplan"]);
  });

  it("종료일·반차시간·업무조치사항은 선택 항목", () => {
    const opt = (id: string) => view.blocks.find((b: any) => b.block_id === id)?.optional;
    expect(opt("end")).toBe(true);
    expect(opt("halftime")).toBe(true);
    expect(opt("workplan")).toBe(true);
    expect(opt("kind")).toBeUndefined(); // 필수
  });

  it("모든 입력 요소에 action_id 가 있다 (슬랙 필수)", () => {
    view.blocks
      .filter((b: any) => b.type === "input")
      .forEach((b: any) => expect(b.element.action_id).toBe("v"));
  });

  it("이번 연차기간이 상단에 표시된다", () => {
    const v: any = leaveModalView({
      empName: "홍길동",
      remaining: 12,
      compRemaining: 0,
      serviceLabel: "3년 2개월",
      period: { start: "2026-01-01", end: "2026-12-31", granted: 16, used: 4 },
    });
    expect(v.blocks[0].text.text).toContain("2026-01-01 ~ 2026-12-31");
    expect(v.blocks[0].text.text).toContain("발생 16 · 사용 4");
    expect(v.blocks[0].text.text).toContain("잔여 *12일*");
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

  it("휴가종류 5가지 — 반차는 오전/오후로 나누지 않는다", () => {
    const kind = view.blocks.find((b: any) => b.block_id === "kind");
    expect(kind.element.options.map((o: any) => o.value)).toEqual([
      "ANNUAL",
      "HALF",
      "COMP",
      "SICK",
      "SPECIAL",
    ]);
    expect(kind.element.options.map((o: any) => o.text.text)).not.toContain("오전반차");
  });
});

describe("readLeaveModal — 제출값 파싱", () => {
  it("입력값을 그대로 읽는다", () => {
    const submitted = {
      state: {
        values: {
          kind: { v: { selected_option: { value: "HALF" } } },
          start: { v: { selected_date: "2026-08-14" } },
          end: { v: { selected_date: null } },
          halftime: { v: { value: " 14시~18시 " } },
          reason: { v: { value: "병원 방문" } },
          workplan: { v: { value: "8/14 A반 → 김OO 선생님 대강" } },
        },
      },
    };
    expect(readLeaveModal(submitted)).toEqual({
      kind: "HALF",
      start: "2026-08-14",
      end: null,
      halftime: "14시~18시",
      reason: "병원 방문",
      workplan: "8/14 A반 → 김OO 선생님 대강",
    });
  });

  it("빈 값도 안전하게 처리", () => {
    expect(readLeaveModal({})).toEqual({
      kind: "ANNUAL",
      start: null,
      end: null,
      halftime: "",
      reason: "",
      workplan: "",
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
        { id: 13, label: "2026-09-01 · 반차 0.5일" },
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

/* ───────────── 보강 · 주말근무 사전신청 모달 ───────────── */

const blockIds = (view: any) => view.blocks.filter((b: any) => b.block_id).map((b: any) => b.block_id);

describe("makeupModalView — 보강/주말근무 두 갈래", () => {
  it("보강 양식에는 보강 종류·대상반·수강인원이 있다", () => {
    const v = makeupModalView({ empName: "김지연" });
    expect(blockIds(v)).toEqual(["sdate", "stime", "edate", "etime", "category", "target", "headcount", "detail", "note"]);
    expect(JSON.stringify(v)).toContain("대상반");
  });

  it("주말근무 양식은 보강 종류·수강인원을 묻지 않는다", () => {
    const v = makeupModalView({ empName: "박조교", kind: "WEEKEND" });
    expect(blockIds(v)).toEqual(["sdate", "stime", "edate", "etime", "target", "detail", "note"]);
    expect(JSON.stringify(v)).toContain("어떤 업무인가요?");
    expect(v.title.text).toBe("주말근무 사전신청");
  });

  it("어느 입구였는지는 private_metadata 에 담긴다 (제출값에 종류 칸이 없다)", () => {
    const v = makeupModalView({ empName: "박조교", kind: "WEEKEND", channel: "C1" });
    expect(JSON.parse(v.private_metadata)).toEqual({ channel: "C1", kind: "WEEKEND" });
  });

  it("두 양식 모두 '다음날부터 직접 확정' 을 안내한다", () => {
    for (const kind of ["MAKEUP", "WEEKEND"] as const)
      expect(JSON.stringify(makeupModalView({ empName: "김지연", kind }))).toContain("다음날부터");
  });
});

describe("readMakeupModal — 주말근무는 카테고리가 WEEKEND 로 고정", () => {
  const view = (kind: string, category?: string) => ({
    private_metadata: JSON.stringify({ kind }),
    state: {
      values: {
        sdate: { v: { selected_date: "2026-08-15" } },
        stime: { v: { selected_time: "09:00" } },
        etime: { v: { selected_time: "16:00" } },
        ...(category ? { category: { v: { selected_option: { value: category } } } } : {}),
        target: { v: { value: "은가람중3" } },
        detail: { v: { value: "모의고사" } },
      },
    },
  });

  it("보강은 고른 종류를 그대로 쓴다", () => {
    expect(readMakeupModal(view("MAKEUP", "MANDATORY")).category).toBe("MANDATORY");
  });

  it("주말근무는 종류 칸이 없어도 WEEKEND 로 읽힌다", () => {
    expect(readMakeupModal(view("WEEKEND")).category).toBe("WEEKEND");
  });

  it("metadata 가 깨져도 보강 기본값으로 떨어진다", () => {
    expect(readMakeupModal({ private_metadata: "{{", state: { values: {} } }).category).toBe("IMMEDIATE");
  });
});

describe("makeupConfirmModalView — 실근무 확정", () => {
  const base = {
    id: 7,
    kindLabel: "보강",
    dateLabel: "2026.08.15(토) 09:00~16:00 · 7시간",
    categoryLabel: "내신의무보강",
    targetClass: "은가람중3",
    startDate: "2026-08-15",
    startTime: "09:00",
    endDate: "2026-08-15",
    endTime: "16:00",
    honesty: "실제로 근무한 시간을 있는 그대로 적어 주세요.",
  };

  it("예정 시각이 초기값으로 채워진다", () => {
    const v = makeupConfirmModalView(base);
    const el = (id: string) => v.blocks.find((b: any) => b.block_id === id)!.element as any;
    expect(el("sdate").initial_date).toBe("2026-08-15");
    expect(el("stime").initial_time).toBe("09:00");
    expect(el("etime").initial_time).toBe("16:00");
  });

  it("솔직 입력 안내가 입력칸보다 앞에 온다", () => {
    const v = makeupConfirmModalView(base);
    const honestyAt = v.blocks.findIndex((b: any) => JSON.stringify(b).includes("있는 그대로"));
    const firstInput = v.blocks.findIndex((b: any) => b.block_id === "sdate");
    expect(honestyAt).toBeGreaterThanOrEqual(0);
    expect(honestyAt).toBeLessThan(firstInput);
  });

  it("내신 상한 안내는 있을 때만 붙는다", () => {
    expect(JSON.stringify(makeupConfirmModalView(base))).not.toContain("상한");
    const withCap = makeupConfirmModalView({ ...base, capNotice: "⚠️ 내신의무보강 인정 상한(10시간)" });
    expect(JSON.stringify(withCap)).toContain("상한");
  });

  it("어느 신청인지는 private_metadata 로 나른다", () => {
    expect(JSON.parse(makeupConfirmModalView(base).private_metadata)).toEqual({ id: 7 });
  });
});

describe("readMakeupConfirmModal", () => {
  it("id 와 입력값을 읽는다", () => {
    const v = readMakeupConfirmModal({
      private_metadata: JSON.stringify({ id: 7 }),
      state: {
        values: {
          sdate: { v: { selected_date: "2026-08-15" } },
          stime: { v: { selected_time: "09:30" } },
          etime: { v: { selected_time: "14:00" } },
          note: { v: { value: " 30분 일찍 종료 " } },
        },
      },
    });
    expect(v).toEqual({
      id: 7,
      startDate: "2026-08-15",
      startTime: "09:30",
      endDate: null,
      endTime: "14:00",
      note: "30분 일찍 종료",
    });
  });

  it("id 가 없거나 깨졌으면 null — 남의 건을 건드리지 않게 호출부가 막는다", () => {
    expect(readMakeupConfirmModal({ private_metadata: "", state: { values: {} } }).id).toBeNull();
    expect(readMakeupConfirmModal({ private_metadata: '{"id":"x"}', state: {} }).id).toBeNull();
  });
});

describe("makeupLauncherBlocks — 입구를 둘로 나눈다", () => {
  const ids = makeupLauncherBlocks()
    .find((b: any) => b.type === "actions")!
    .elements!.map((e: any) => e.action_id);

  it("보강·주말근무·내 신청 내역 세 버튼", () => {
    expect(ids).toEqual(["open_makeup_modal", "open_weekend_modal", "check_makeup_list"]);
  });
});

describe("makeupConfirmRequestBlocks — 확정 요청 DM", () => {
  const args = {
    id: 7,
    name: "김지연",
    kindLabel: "보강",
    categoryLabel: "직전보강",
    dateLabel: "2026.08.15(토) 09:00~16:00 · 7시간",
    targetClass: "은가람중3",
  };

  it("확정 버튼이 신청 id 를 나른다", () => {
    const btn = makeupConfirmRequestBlocks(args)
      .find((b: any) => b.type === "actions")!
      .elements![0] as any;
    expect(btn.action_id).toBe("open_makeup_confirm");
    expect(btn.value).toBe("7");
    expect(btn.text.text).toBe("실근무 시간 확정");
  });

  it("이미 확정한 건이면 '수정' 으로 바뀐다", () => {
    const btn = makeupConfirmRequestBlocks({ ...args, alreadyConfirmed: true })
      .find((b: any) => b.type === "actions")!
      .elements![0] as any;
    expect(btn.text.text).toBe("확정 시간 수정");
  });

  it("확정한 시간이 곧 수당이라고 알린다", () => {
    expect(JSON.stringify(makeupConfirmRequestBlocks(args))).toContain("수당으로 산정");
  });
});
