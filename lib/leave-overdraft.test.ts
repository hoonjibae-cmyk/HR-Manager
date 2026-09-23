// 연차 초과 사용(잔여 마이너스) 신청 — 판정·안내·동의란.
// 동의 없이 초과 신청이 만들어지면 퇴직 시 초과분을 공제할 근거(§43 의 명시적 동의)가 없다.

import { describe, it, expect } from "vitest";
import {
  checkOverdraft,
  showConsentUpfront,
  affectsAnnualBalance,
  overdraftNoticeText,
  overdraftApprovalLine,
  OVERDRAFT_CONSENT_LABEL,
} from "./leave-overdraft";
import {
  leaveModalView,
  readLeaveModal,
  leaveModalHasConsent,
  approvalBlocks,
  preApprovalBlocks,
} from "./slack";

describe("checkOverdraft — 이번 신청으로 잔여가 0 밑으로 가는가", () => {
  it("잔여 안이면 초과 아님", () => {
    const c = checkOverdraft({ leaveType: "ANNUAL", remaining: 3, pending: 0, days: 2 });
    expect(c.overdrawn).toBe(false);
    expect(c.after).toBe(1);
  });

  it("잔여를 딱 다 쓰는 것(0)은 초과가 아니다", () => {
    expect(checkOverdraft({ leaveType: "ANNUAL", remaining: 2, pending: 0, days: 2 }).overdrawn).toBe(false);
  });

  it("이번 신청으로 마이너스가 되면 초과", () => {
    const c = checkOverdraft({ leaveType: "ANNUAL", remaining: 1, pending: 0, days: 2 });
    expect(c.overdrawn).toBe(true);
    expect(c.after).toBe(-1);
  });

  it("이미 마이너스면 반차 하나도 초과", () => {
    const c = checkOverdraft({ leaveType: "HALF", remaining: -1, pending: 0, days: 0.5 });
    expect(c.overdrawn).toBe(true);
    expect(c.after).toBe(-1.5);
  });

  it("승인 대기 신청을 함께 뺀다 — 연달아 낸 두 건이 합쳐 넘는 경우", () => {
    // 잔여 1일, 이미 1일 신청이 대기 중 → 이번 1일은 승인되면 −1
    const c = checkOverdraft({ leaveType: "ANNUAL", remaining: 1, pending: 1, days: 1 });
    expect(c.overdrawn).toBe(true);
    expect(c.after).toBe(-1);
  });

  it("대휴·병가·경조사는 연차 잔여와 무관 — 초과로 보지 않는다", () => {
    for (const t of ["COMP", "SICK", "SPECIAL"]) {
      expect(affectsAnnualBalance(t)).toBe(false);
      expect(checkOverdraft({ leaveType: t, remaining: -3, pending: 0, days: 1 }).overdrawn).toBe(false);
    }
  });

  it("소수 잔차가 판정을 흔들지 않는다 (0.1+0.2 류)", () => {
    const c = checkOverdraft({ leaveType: "HALF", remaining: 0.1 + 0.2 + 0.2, pending: 0, days: 0.5 });
    expect(c.after).toBe(0);
    expect(c.overdrawn).toBe(false);
  });
});

describe("showConsentUpfront — 양식을 열 때부터 띄우나", () => {
  it("쓸 수 있는 잔여가 0 이하면 띄운다", () => {
    expect(showConsentUpfront(0, 0)).toBe(true);
    expect(showConsentUpfront(-2, 0)).toBe(true);
    expect(showConsentUpfront(1, 1)).toBe(true); // 대기분을 빼면 0
  });
  it("잔여가 남아 있으면 띄우지 않는다 — 제출 때 판정", () => {
    expect(showConsentUpfront(0.5, 0)).toBe(false);
    expect(showConsentUpfront(3, 1)).toBe(false);
  });
});

describe("안내 문구", () => {
  it("제출 때 — 잔여·대기·이번 신청·신청 후를 모두 적는다", () => {
    const t = overdraftNoticeText({ remaining: 1, pending: 0.5, days: 2, after: -1.5 });
    expect(t).toContain("현재 잔여 *1일*");
    expect(t).toContain("승인 대기 0.5일");
    expect(t).toContain("이번 신청 2일");
    expect(t).toContain("*신청 후 -1.5일*");
  });
  it("원칙(발생분 안에서만 사용)과 두 가지 처리(이후 발생분으로 충당·퇴직월 급여 공제)를 적는다", () => {
    const t = overdraftNoticeText({ remaining: 0, pending: 0, days: 0, after: 0 }, { upfront: true });
    expect(t).toContain("이미 발생한 일수 안에서 사용하는 것이 원칙");
    expect(t).toContain("이후 발생하는 연차로 초과분이 먼저 채워집니다");
    expect(t).toContain("퇴직월 급여에서 공제");
    expect(t).toContain("1일 통상임금");
  });
  it("동의 문구는 슬랙 선택지 한도(75자) 안이다", () => {
    expect(OVERDRAFT_CONSENT_LABEL.length).toBeLessThanOrEqual(75);
  });
});

describe("휴가신청서 모달 — 동의란", () => {
  const base = { empName: "홍길동", remaining: 0, compRemaining: 0, serviceLabel: "1년", channel: "C1" };

  it("초과가 아니면 동의란이 없다 (기존 양식 그대로)", () => {
    const v: any = leaveModalView({ ...base, remaining: 5 });
    expect(leaveModalHasConsent(v)).toBe(false);
    expect(v.blocks.some((b: any) => b.block_id === "overdraft_notice")).toBe(false);
  });

  it("초과면 안내와 동의 체크란이 양식 맨 아래(제출 버튼 위)에 붙는다", () => {
    const v: any = leaveModalView({
      ...base,
      overdraft: { check: { remaining: 0, pending: 0, days: 0, after: 0 }, upfront: true },
    });
    expect(leaveModalHasConsent(v)).toBe(true);
    const ids = v.blocks.map((b: any) => b.block_id).filter(Boolean);
    expect(ids.slice(-2)).toEqual(["overdraft_notice", "consent"]);
    const consent = v.blocks.find((b: any) => b.block_id === "consent");
    // 필수로 두면 슬랙 기본 문구만 떠서 왜 막혔는지 모른다 — 서버가 검사한다
    expect(consent.optional).toBe(true);
    expect(consent.element.type).toBe("checkboxes");
    expect(consent.element.options[0].text.text).toBe(OVERDRAFT_CONSENT_LABEL);
  });

  it("다시 그릴 때 적어 둔 값을 그대로 살린다", () => {
    const v: any = leaveModalView({
      ...base,
      overdraft: { check: { remaining: 1, pending: 0, days: 2, after: -1 } },
      prefill: {
        kind: "ANNUAL",
        start: "2026-10-05",
        end: "2026-10-06",
        halftime: "",
        reason: "가족여행",
        workplan: "대강 김OO",
        consent: false,
      },
    });
    const el = (id: string) => v.blocks.find((b: any) => b.block_id === id).element;
    expect(el("kind").initial_option.value).toBe("ANNUAL");
    expect(el("start").initial_date).toBe("2026-10-05");
    expect(el("end").initial_date).toBe("2026-10-06");
    expect(el("reason").initial_value).toBe("가족여행");
    expect(el("workplan").initial_value).toBe("대강 김OO");
    expect(el("halftime").initial_value).toBeUndefined();
    expect(el("consent").initial_options).toBeUndefined(); // 동의는 미리 체크하지 않는다
  });

  it("제출값에서 동의 여부를 읽는다", () => {
    const checked = { state: { values: { consent: { v: { selected_options: [{ value: "agree" }] } } } } };
    const unchecked = { state: { values: { consent: { v: { selected_options: [] } } } } };
    expect(readLeaveModal(checked).consent).toBe(true);
    expect(readLeaveModal(unchecked).consent).toBe(false);
    expect(readLeaveModal({ state: { values: {} } }).consent).toBe(false);
  });
});

describe("승인 카드·중간결재 DM — 초과 신청 표시", () => {
  const args = {
    requestId: 7,
    name: "홍길동",
    dept: "교수부",
    start: new Date(Date.UTC(2026, 9, 5)),
    end: new Date(Date.UTC(2026, 9, 6)),
    days: 2,
    reason: "[연차] 가족여행",
    remaining: 1,
  };
  const has = (blocks: any[]) => JSON.stringify(blocks).includes("잔여 초과 신청");

  it("초과 동의 신청이면 버튼 위에 표시가 붙는다", () => {
    const a = approvalBlocks({ ...args, overdraftAfter: -1 });
    const p = preApprovalBlocks({ ...args, overdraftAfter: -1 });
    expect(has(a)).toBe(true);
    expect(has(p)).toBe(true);
    const idx = a.findIndex((b: any) => b.type === "actions");
    expect(JSON.stringify(a[idx - 1])).toContain("잔여 초과 신청");
    expect(overdraftApprovalLine(-1)).toContain("승인 시 잔여 -1일");
  });

  it("보통 신청에는 붙지 않는다", () => {
    expect(has(approvalBlocks(args))).toBe(false);
    expect(has(preApprovalBlocks(args))).toBe(false);
  });
});
